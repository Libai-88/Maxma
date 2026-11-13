/**
 * scripts/verify-ui-thinking-separation.mjs — 验证思考内容不混进回复（THINK-SPLIT-001）。
 *
 * ## 为什么需要
 *
 * 用户报障：回复开头出现了本应属于"思考"的文字（"用户想了解我。用 Maxma 人格
 * 介绍自己…"），后面才是真正的回答。根因是 pi 的事件顺序：
 *
 *   thinking_start → thinking_delta… → text_delta… → thinking_end → text_end
 *
 * `thinking_end` 在**全部 text_delta 之后**才到，而前端旧的判断是"思考块已结束
 * 才另起答案块"，于是所有答案文字被拼进思考块。
 *
 * 本脚本用假 provider 同时返回 `reasoning_content` 与 `content`，跑真实前端，
 * 断言答案节点的文本里不含思考内容。
 *
 * ## 用法
 *
 *   bun scripts/verify-ui-thinking-separation.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "..");
const STUB_PORT = Number(process.env.STUB_PORT ?? 8403);
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8404);

/** 两段文本刻意不含对方片段，避免子串误判。 */
const REASONING = "用户想了解我，需要用温暖自然的语气做自我介绍，避免服务式口吻。";
const ANSWER = "我在呢，就是那个替你收拾杂事、陪你说话的家伙。";

// ── 假 OpenAI 兼容服务：先流 reasoning_content，再流 content ──
const stub = Bun.serve({
  port: STUB_PORT,
  async fetch(req) {
    const p = new URL(req.url).pathname;
    if (p.endsWith("/models")) {
      return Response.json({ object: "list", data: [{ id: "think-split-model", object: "model" }] });
    }
    if (p.endsWith("/chat/completions")) {
      const chunk = (o) => `data: ${JSON.stringify(o)}\n\n`;
      const b = { id: "c1", object: "chat.completion.chunk", model: "think-split-model" };
      // 逐块**延迟**发送：整个流必须在 ~1s 内可观测，否则采样器只会看到最终态，
      // 而 THINK-SPLIT-001 的缺陷只存在于流式中间态（结束时 answer 会覆盖）。
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          for (const ch of REASONING) {
            controller.enqueue(enc.encode(chunk({ ...b, choices: [{ index: 0, delta: { reasoning_content: ch } }] })));
            await Bun.sleep(25);
          }
          for (const ch of ANSWER) {
            controller.enqueue(enc.encode(chunk({ ...b, choices: [{ index: 0, delta: { content: ch } }] })));
            await Bun.sleep(25);
          }
          controller.enqueue(enc.encode(chunk({ ...b, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })));
          controller.enqueue(enc.encode("data: [DONE]" + String.fromCharCode(10, 10)));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
    return new Response("nf", { status: 404 });
  },
});

let backend = null;
let dataDir = process.env.MAXMA_DATA_DIR ?? "";
const base = process.env.BASE ?? `http://127.0.0.1:${BACKEND_PORT}`;

async function waitHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) return true;
    } catch { /* 未就绪 */ }
    await Bun.sleep(400);
  }
  return false;
}

const failures = [];
const fail = (m) => { failures.push(m); console.error("  ✗ " + m); };

try {
  if (!process.env.BASE) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uithink-"));
    backend = spawn(process.env.MAXMA_BUN ?? "bun", ["run", path.join(REPO, "bun-backend", "src", "server.ts")], {
      cwd: path.join(REPO, "bun-backend"),
      env: {
        ...process.env,
        MAXMA_DATA_DIR: dataDir,
        MAXMA_BUNDLE_DIR: REPO,
        MAXMA_EXE_DIR: REPO,
        MAXMA_BUN_PORT: String(BACKEND_PORT),
        MAXMA_API_PORT: String(BACKEND_PORT),
        MAXMA_BUN_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  if (!(await waitHealth())) throw new Error(`后端未就绪（${base}）`);
  {
    const probe = await fetch(base + "/api/auth/token").catch(() => null);
    if (!probe?.ok) throw new Error(`端口 ${BACKEND_PORT} 上有别的进程在监听，请先结束它或换 BACKEND_PORT`);
  }

  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  // 注册指向假服务的渠道
  await fetch(base + "/api/providers/local-think-stub", { method: "DELETE", headers: H }).catch(() => {});
  const created = await fetch(base + "/api/providers", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      id: "local-think-stub",
      label: "思考分离验证渠道",
      base_url: `http://127.0.0.1:${STUB_PORT}/v1`,
      provider_type: "openai-completions",
      api_key: "sk-stub",
      // THINK-CAP-002：不开这个开关，pi 对该模型只报 off 一档，
      // 输入框底部的思考选择器就只有「关闭」——正是用户报障的现象。
      reasoning: true,
      models: ["think-split-model"],
      enabled: true,
    }),
  });
  if (!created.ok) fail(`注册渠道失败 HTTP ${created.status}`);

  const ob = await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ completed: true, preferences: { displayName: "验证用", language: "zh-CN", workspace: "personal" } }),
  });
  if (!ob.ok) fail(`标记引导完成失败 HTTP ${ob.status}`);

  const sessRes = await fetch(base + "/api/sessions", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ provider_id: "local-think-stub", model_name: "think-split-model" }),
  });
  const sess = await sessRes.json().catch(() => ({}));
  const freshSessionId = sess.session_id;
  if (!freshSessionId) fail(`建会话失败 HTTP ${sessRes.status}`);
  else console.log(`会话：${freshSessionId}`);

  const driverPath = path.join(REPO, "scripts", "_ui-thinking-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少界面驱动脚本：${driverPath}`);

  const driverEnv = {
    ...process.env,
    DRIVE_BASE: base,
    DRIVE_SESSION_ID: freshSessionId ?? "",
    DRIVE_ANSWER: ANSWER,
    DRIVE_REASONING: REASONING,
    DRIVE_MODEL: "think-split-model",
  };
  delete driverEnv.ELECTRON_RUN_AS_NODE;
  delete driverEnv.ELECTRON_NO_ATTACH_CONSOLE;

  const driver = spawn(path.join(REPO, "desktop", "node_modules", "electron", "dist", "electron.exe"), [driverPath], {
    env: driverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  driver.stdout.on("data", (c) => { out += String(c); });
  driver.stderr.on("data", (c) => { out += String(c); });

  const code = await new Promise((res) => {
    const timer = setTimeout(() => { try { driver.kill(); } catch { /* */ } res(-1); }, Number(process.env.UI_TIMEOUT_MS ?? 180_000));
    driver.on("exit", (c) => { clearTimeout(timer); res(c ?? -1); });
  });

  const match = out.match(/DRIVE_RESULT (\{.*\})/);
  if (!match) {
    fail(`界面驱动没有返回结果（exit=${code}）`);
    console.error("驱动输出片段：\n" + out.slice(-1500));
  } else {
    const r = JSON.parse(match[1]);
    console.log("界面驱动结果：", JSON.stringify(r, null, 2));
    if (!r.answerSeen) fail(`回复正文没出现（stage=${r.stage}${r.error ? ", error=" + r.error : ""}）`);
    if (r.reasoningLeaked) fail("思考内容混进了回复正文");
    if (r.consoleErrors?.length) fail(`浏览器 console 有 ${r.consoleErrors.length} 条错误`);
    if (r.answerSeen && !r.reasoningLeaked && !r.consoleErrors?.length) {
      console.log("✅ 思考与回复已分离：正文只有回答，思考留在折叠区");
    }
    if (r.pageText && !r.answerSeen) console.error("页面文字片段：\n" + r.pageText.slice(0, 1200));
  }
  if (code !== 0 && !failures.length) fail(`界面驱动退出码非 0：${code}`);
} catch (err) {
  fail(String(err?.message ?? err));
} finally {
  try { backend?.kill(); } catch { /* */ }
  try { stub.stop(true); } catch { /* */ }
  if (dataDir && !process.env.MAXMA_DATA_DIR) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

if (failures.length) {
  console.error(`\n❌ 思考分离验证失败（${failures.length} 项）`);
  process.exit(1);
}
console.log("\n✅ 思考分离验证通过");
process.exit(0);
