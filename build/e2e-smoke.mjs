/**
 * build/e2e-smoke.mjs — 产物级端到端冒烟（CI 与本地构建共用）。
 *
 * 用法：bun build/e2e-smoke.mjs <apiPort>
 * 前置：目标端口上已经跑着 Maxma 后端（build/smoke-test-server.ps1 负责启停）。
 *
 * 脚本自带 OpenAI 兼容 stub（随机端口），不需要外网/真实供应商。覆盖：
 *   能力清单 / 会话创建 / 普通对话往返 / 用量 / 历史会话可见（P1）/
 *   恢复幂等（P1）/ 删除历史会话 / 鉴权与未知路由。
 * 不覆盖：真实模型、bash 工具（CI 环境差异大，另行专项验证）。
 */

const port = process.argv[2];
if (!port) {
  console.error("用法：bun build/e2e-smoke.mjs <apiPort>");
  process.exit(2);
}
const BASE = `http://127.0.0.1:${port}`;

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(24)} ${String(detail).replace(/\s+/g, " ").slice(0, 88)}`);

// ── stub：按最后一条用户消息回复；TOOL* 触发一次 bash 工具调用 ──
const stubPort = 18000 + Math.floor(Math.random() * 1000);
const enc = new TextEncoder();
const chunk = (obj) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.text ?? "").join("")
      : "";

const stub = Bun.serve({
  port: stubPort,
  hostname: "127.0.0.1",
  async fetch(req) {
    const body = await req.json().catch(() => ({}));
    const messages = body.messages ?? [];
    const last = textOf([...messages].reverse().find((m) => m.role === "user")?.content ?? "");
    const sawToolResult = messages.some((m) => m.role === "tool" || m.role === "tool_result");
    const stream = new ReadableStream({
      async start(ctrl) {
        const send = (obj) => ctrl.enqueue(chunk(obj));
        send({ id: "x", object: "chat.completion.chunk", model: "stub-model", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
        if (String(last).startsWith("TOOL") && !sawToolResult) {
          send({ id: "x", object: "chat.completion.chunk", model: "stub-model", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_e2e", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "echo e2e-ok" }) } }] }, finish_reason: null }] });
          send({ id: "x", object: "chat.completion.chunk", model: "stub-model", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
        } else {
          const text = String(last).startsWith("SLOW") ? "慢速回复".repeat(12) : "E2E 回复正常。";
          for (const part of text.match(/.{1,6}/g) ?? []) {
            send({ id: "x", object: "chat.completion.chunk", model: "stub-model", choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
            await new Promise((r) => setTimeout(r, 20));
          }
          send({ id: "x", object: "chat.completion.chunk", model: "stub-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 } });
        }
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  },
});

let token = "";
const H = () => ({ "X-Maxma-Token": token, "Content-Type": "application/json" });
const waitFor = async (pred, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const value = pred();
    if (value) return value;
    await Bun.sleep(50);
  }
  return null;
};

try {
  const auth = await fetch(`${BASE}/api/auth/token`).then((r) => r.json());
  token = auth.token;

  const cap = await fetch(`${BASE}/api/capabilities`, { headers: H() }).then((r) => r.json());
  check("capabilities", Array.isArray(cap.tools) && cap.tools.length >= 14, `${cap.tools?.length} tools`);
  check("auth.enforced", (await fetch(`${BASE}/api/sessions`)).status === 401);
  check("unknown.route", (await fetch(`${BASE}/api/nope`, { headers: H() })).status === 404);

  await fetch(`${BASE}/api/providers`, {
    method: "POST",
    headers: H(),
    body: JSON.stringify({
      id: "e2e-stub",
      label: "E2E Stub",
      provider_type: "openai",
      base_url: `http://127.0.0.1:${stubPort}/v1`,
      api_key: "x",
      models: ["stub-model"],
    }),
  });

  const created = await fetch(`${BASE}/api/sessions`, { method: "POST", headers: H() }).then((r) => r.json());
  const sid = created.session_id;
  check("session.create", /^[0-9a-f]{32}$/.test(String(sid)), sid);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/chat/${sid}`, [token]);
  const inbox = [];
  ws.addEventListener("message", (ev) => {
    try { inbox.push(JSON.parse(ev.data)); } catch { /* ignore */ }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
    setTimeout(() => reject(new Error("ws open timeout")), 8000);
  });

  ws.send(JSON.stringify({
    type: "chat",
    payload: {
      message: "普通回复",
      turn_id: "smoke-1",
      client_msg_id: "smoke-1",
      private: false,
      provider_id: "e2e-stub",
      model_name: "stub-model",
      temperature: 0.7,
      max_tokens: 256,
      thinking: "off",
    },
  }));
  const done = await waitFor(() => inbox.find((m) => m.type === "done"));
  check("chat.roundtrip", inbox.some((m) => m.type === "answer" && m.payload?.content === "E2E 回复正常。"));
  check("chat.usage", done?.payload?.context_usage?.model_request_count >= 1);

  const history = await fetch(`${BASE}/api/sessions/history`, { headers: H() }).then((r) => r.json());
  const entry = history.sessions.find((s) => s.session_id === sid);
  check("history.lists-live", !!entry && entry.active === true, entry ? `${entry.message_count} msgs` : "missing");
  check("history.no-file-field", entry ? !("file" in entry) : false);

  const resumed = await fetch(`${BASE}/api/sessions/${sid}/resume`, { method: "POST", headers: H() }).then((r) => r.json());
  check("resume.idempotent", resumed.session_id === sid && resumed.active === true);
  check("resume.bad-id", (await fetch(`${BASE}/api/sessions/not-hex/resume`, { method: "POST", headers: H() })).status === 400);

  // 取消：SLOW 触发慢流后立即取消，必须收到 cancelled 的 done
  inbox.length = 0;
  ws.send(JSON.stringify({
    type: "chat",
    payload: {
      message: "SLOW 取消",
      turn_id: "smoke-2",
      client_msg_id: "smoke-2",
      private: false,
      provider_id: "e2e-stub",
      model_name: "stub-model",
      temperature: 0.7,
      max_tokens: 256,
      thinking: "off",
    },
  }));
  await waitFor(() => inbox.find((m) => m.type === "token"), 8000);
  ws.send(JSON.stringify({ type: "cancel", payload: {} }));
  check("cancel.mid-stream", !!(await waitFor(() => inbox.find((m) => m.type === "done" && m.payload?.cancelled === true), 8000)));
  ws.close();

  // 删除：把当前会话删掉后，历史列表不应再出现
  const del = await fetch(`${BASE}/api/sessions/${sid}`, { method: "DELETE", headers: H() });
  check("session.delete", del.status === 200);
  const after = await fetch(`${BASE}/api/sessions/history`, { headers: H() }).then((r) => r.json());
  check("history.delete-persisted", !after.sessions.some((s) => s.session_id === sid));
} finally {
  stub.stop(true);
}

console.log(results.join("\n"));
process.exit(results.some((line) => line.startsWith("FAIL")) ? 1 : 0);