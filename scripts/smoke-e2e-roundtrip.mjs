/**
 * scripts/smoke-e2e-roundtrip.mjs — 端到端回合冒烟（零额度、不依赖外网）。
 *
 * ## 它验证什么
 *
 * `web → WS → bun-backend → kernel → pi AgentSession → provider HTTP → SSE 流回`
 * 这一整条链路。类型检查与单元测试都证明不了它：pi 的回合语义、事件映射、
 * provider 注册、流式解析任何一环断了，前端都只会看到"没反应"。
 *
 * 做法是**在本地起一个假的 OpenAI 兼容服务**（SSE 流式），把它注册成 Maxma 的
 * 一个渠道，然后真发一个回合。因此不需要任何 API key、不花额度、也不受上游
 * 免费渠道配额影响（2026-10-27 就是因为免费渠道被 429 卡住，才需要这个手段）。
 *
 * ## 前置
 *
 * 后端必须在跑，并带上它的 token（开发模式下从 `api/data/maxma.db` 的 auth_tokens 读）：
 *
 *   cd bun-backend && bun run src/server.ts          # 默认 :8000
 *   MAXMA_DATA_DIR=<数据目录> 时，DB 在 <数据目录>/api/data/maxma.db
 *
 * ## 用法
 *
 *   BASE=http://127.0.0.1:8000 TOKEN=<token> bun scripts/smoke-e2e-roundtrip.mjs
 *
 * 退出码 0 = 拿到 token 帧且收到 done；非 0 = 链路有问题（打印事件计数与 error）。
 * 结束后会自动删掉临时会话与临时渠道，不在 providers.yaml 里留残渣。
 */

const BASE = process.env.BASE ?? "http://127.0.0.1:8000";
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("需要 TOKEN 环境变量（后端 auth_tokens 里的 token）");
  process.exit(2);
}

const STUB_PORT = Number(process.env.STUB_PORT ?? 8099);
const PROVIDER_ID = "local-e2e-stub";
const MODEL_ID = "stub-model";
const REPLY = "收到，链路通";

// ── 1. 假的 OpenAI 兼容服务（流式 SSE） ────────────────────
let stubRequests = 0;
const stub = Bun.serve({
  port: STUB_PORT,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.endsWith("/models")) {
      return Response.json({ object: "list", data: [{ id: MODEL_ID, object: "model" }] });
    }
    if (path.endsWith("/chat/completions")) {
      const body = await req.json().catch(() => ({}));
      stubRequests += 1;
      const chunk = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
      const usage = { prompt_tokens: 5, completion_tokens: REPLY.length, total_tokens: 5 + REPLY.length };
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
      const tail = chunk({
        id: "c1", object: "chat.completion.chunk", model: MODEL_ID,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage,
      });
      return new Response(new Blob([...deltas, tail, "data: [DONE]\n\n"]).stream(), {
        headers: { "content-type": "text/event-stream" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

const H = { "x-maxma-token": TOKEN, "content-type": "application/json" };
let sessionId = "";
let ws = null;

try {
  // ── 2. 注册指向假服务的渠道 ──────────────────────────────
  const created = await fetch(BASE + "/api/providers", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      id: PROVIDER_ID,
      label: "本地端到端验证渠道",
      base_url: `http://127.0.0.1:${STUB_PORT}/v1`,
      provider_type: "openai-completions",
      api_key: "stub-key",
      models: [MODEL_ID],
      enabled: true,
    }),
  });
  if (created.status !== 200) {
    throw new Error(`注册临时渠道失败 ${created.status}: ${(await created.text()).slice(0, 200)}`);
  }

  // ── 3. 建会话，走 WS 真发一个回合 ────────────────────────
  const sessionRes = await fetch(BASE + "/api/sessions", { method: "POST", headers: H, body: "{}" });
  const sessionBody = await sessionRes.json().catch(() => null);
  sessionId = String(sessionBody?.session_id ?? "");
  if (!sessionId) throw new Error(`创建会话失败 ${sessionRes.status}: ${JSON.stringify(sessionBody)}`);

  ws = new WebSocket(BASE.replace(/^http/, "ws") + `/ws/chat/${sessionId}`, [TOKEN]);
  const seen = new Map();
  let answer = "";
  let tokenFrames = 0;
  let done = null;
  let errored = null;

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    seen.set(msg.type, (seen.get(msg.type) ?? 0) + 1);
    const p = msg.payload ?? {};
    if (msg.type === "token") { tokenFrames += 1; answer += String(p.token ?? ""); }
    if (msg.type === "answer") answer = String(p.content ?? answer);
    if (msg.type === "done") done = p;
    if (msg.type === "error") errored = p;
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    setTimeout(() => reject(new Error("WS 连接超时（后端在跑吗？端口对吗？）")), 15_000);
  });
  ws.send(JSON.stringify({ type: "chat", payload: { message: "测试", provider_id: PROVIDER_ID, model_name: MODEL_ID } }));

  const settled = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), Number(process.env.TIMEOUT_MS ?? 60_000));
    const poll = setInterval(() => {
      if (done || errored) { clearTimeout(timer); clearInterval(poll); resolve(done ? "done" : "error"); }
    }, 100);
  });

  console.log("回合结束方式:", settled);
  console.log("事件计数:", JSON.stringify(Object.fromEntries(seen)));
  console.log("token 帧数:", tokenFrames, "| 累计文本:", JSON.stringify(answer));
  console.log("假服务收到请求数:", stubRequests);
  if (errored) console.log("error payload:", JSON.stringify(errored)?.slice(0, 400));
  if (done) console.log("done.context_usage:", JSON.stringify(done.context_usage ?? null)?.slice(0, 200));

  const ok = settled === "done" && tokenFrames > 0 && answer.includes(REPLY) && stubRequests > 0;
  console.log(ok ? "✅ 端到端链路通" : "❌ 端到端链路不通");
  process.exitCode = ok ? 0 : 1;
} finally {
  // 必须关 WS：否则 socket 挂着，Bun 的事件循环不退出，脚本"跑完但不结束"
  // ——第一版就是这么挂住的（表现为无任何输出，因为管道要等 EOF）。
  try { ws?.close(); } catch { /* 已关闭 */ }
  if (sessionId) {
    await fetch(`${BASE}/api/sessions/${sessionId}`, { method: "DELETE", headers: H }).catch(() => {});
  }
  await fetch(`${BASE}/api/providers/${PROVIDER_ID}`, { method: "DELETE", headers: H }).catch(() => {});
  stub.stop();
}
