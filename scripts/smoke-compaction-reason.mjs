/**
 * scripts/smoke-compaction-reason.mjs — 验证「手动压缩」的 reason 不被钳成 threshold。
 *
 * ## 为什么单测覆盖不到
 *
 * 2026-10-27 修过一个缺陷：`kernel/events.ts` 的 compaction reason 白名单手抄了
 * `["threshold","overflow","idle","incomplete"]`，**漏了引擎真会发的 `manual`**，
 * 而未知值一律被 `?? "threshold"` 兜住 —— 于是用户点"手动压缩"，界面上显示的是
 * "阈值触发"。单测用的是合成事件，证明不了"真实手动压缩会走到哪条分支"。
 *
 * ## 它做什么
 *
 * 起本地假模型服务 → 聊一轮（让会话有上下文）→ 等回合成 idle → `POST /compact`
 * → 断言拿到的 `context_compressing.reason === "manual"`（而不是 "threshold"）。
 *
 * ## 用法
 *
 *   cd bun-backend && bun run src/server.ts        # 另开终端
 *   BASE=http://127.0.0.1:8000 TOKEN=<token> bun scripts/smoke-compaction-reason.mjs
 */

const BASE = process.env.BASE ?? "http://127.0.0.1:8000";
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("需要 TOKEN 环境变量（后端 auth_tokens 里的 token）");
  process.exit(2);
}

const STUB_PORT = Number(process.env.STUB_PORT ?? 8098);
const PROVIDER_ID = "local-compact-stub";
const MODEL_ID = "stub-model";
const H = { "x-maxma-token": TOKEN, "content-type": "application/json" };

/** 长一点的回答，保证压缩有东西可压。 */
const REPLY = "这是本地桩模型的回答，用于填充会话上下文。" + "上下文。".repeat(40);

const stub = Bun.serve({
  port: STUB_PORT,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.endsWith("/models")) {
      return Response.json({ object: "list", data: [{ id: MODEL_ID, object: "model" }] });
    }
    if (path.endsWith("/chat/completions")) {
      const body = await req.json().catch(() => ({}));
      const chunk = (p) => `data: ${JSON.stringify(p)}\n\n`;
      const usage = { prompt_tokens: 10, completion_tokens: 60, total_tokens: 70 };
      if (body?.stream === false) {
        return Response.json({
          id: "c1", object: "chat.completion", model: MODEL_ID,
          choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }],
          usage,
        });
      }
      const deltas = [...REPLY].map((t) =>
        chunk({ id: "c1", object: "chat.completion.chunk", model: MODEL_ID, choices: [{ index: 0, delta: { content: t } }] }),
      );
      return new Response(
        new Blob([...deltas, chunk({ id: "c1", object: "chat.completion.chunk", model: MODEL_ID, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage }), "data: [DONE]\n\n"]).stream(),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    return new Response("not found", { status: 404 });
  },
});

let sessionId = "";
let ws = null;
try {
  const created = await fetch(BASE + "/api/providers", {
    method: "POST", headers: H,
    body: JSON.stringify({
      id: PROVIDER_ID, label: "本地压缩验证渠道",
      base_url: `http://127.0.0.1:${STUB_PORT}/v1`,
      provider_type: "openai-completions", api_key: "stub-key",
      models: [MODEL_ID], enabled: true,
    }),
  });
  if (created.status !== 200) throw new Error(`注册渠道失败 ${created.status}`);

  const sessionRes = await fetch(BASE + "/api/sessions", { method: "POST", headers: H, body: "{}" });
  sessionId = String((await sessionRes.json().catch(() => null))?.session_id ?? "");
  if (!sessionId) throw new Error("创建会话失败");

  ws = new WebSocket(BASE.replace(/^http/, "ws") + `/ws/chat/${sessionId}`, [TOKEN]);
  const seen = new Map();
  let done = null;
  let errored = null;
  const compress = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    seen.set(m.type, (seen.get(m.type) ?? 0) + 1);
    const p = m.payload ?? {};
    if (m.type === "done") done = p;
    if (m.type === "error") errored = p;
    if (m.type === "context_compressing" || m.type === "context_compressed") {
      compress.push({ type: m.type, reason: p.reason, action: p.action });
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    setTimeout(() => rej(new Error("WS 连接超时")), 15_000);
  });

  // 连着聊两轮，让压缩有实质内容。
  for (let i = 0; i < 2; i++) {
    done = null;
    ws.send(JSON.stringify({ type: "chat", payload: { message: `第 ${i + 1} 轮`, provider_id: PROVIDER_ID, model_name: MODEL_ID } }));
    const settled = await new Promise((res) => {
      const timer = setTimeout(() => res("timeout"), Number(process.env.TIMEOUT_MS ?? 60_000));
      const poll = setInterval(() => { if (done || errored) { clearTimeout(timer); clearInterval(poll); res(done ? "done" : "error"); } }, 100);
    });
    console.log(`第 ${i + 1} 轮: ${settled}`);
    if (settled !== "done") throw new Error(`第 ${i + 1} 轮未正常结束: ${JSON.stringify(errored)?.slice(0, 200)}`);
  }

  // 等回合彻底空闲（后端对进行中的会回 409）。
  let compactRes = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await fetch(`${BASE}/api/sessions/${sessionId}/compact`, { method: "POST", headers: H });
    const text = await r.text();
    if (r.status === 200) { compactRes = { status: r.status, body: text }; break; }
    console.log(`  compact 尝试 ${attempt + 1}: HTTP ${r.status} ${text.slice(0, 80)}`);
    if (r.status !== 409) { compactRes = { status: r.status, body: text }; break; }
  }

  console.log("POST /compact =", compactRes?.status, (compactRes?.body ?? "").slice(0, 160));
  await new Promise((r) => setTimeout(r, 4000));

  console.log("压缩事件:", JSON.stringify(compress));
  const compressing = compress.find((c) => c.type === "context_compressing");
  const reason = compressing?.reason ?? "(未收到 context_compressing)";
  console.log("reason =", reason);

  const ok = reason === "manual";
  if (!ok) {
    console.log(
      `❌ 期望 reason="manual"，实得 "${reason}"。\n` +
        `   - 若为 "threshold"：正是被钳位的那个缺陷（白名单漏 manual）。\n` +
        `   - 若为 "(未收到 context_compressing)"：压缩没触发（上下文太小？pi 没发事件？）——` +
        `需要人工确认，不能当成通过。`,
    );
  } else {
    console.log("✅ 手动压缩的 reason 正确透传（未被钳成 threshold）");
  }
  process.exitCode = ok ? 0 : 1;
} finally {
  try { ws?.close(); } catch { /* 已关闭 */ }
  if (sessionId) await fetch(`${BASE}/api/sessions/${sessionId}`, { method: "DELETE", headers: H }).catch(() => {});
  await fetch(`${BASE}/api/providers/${PROVIDER_ID}`, { method: "DELETE", headers: H }).catch(() => {});
  stub.stop();
}
