/**
 * scripts/verify-ui-chat-roundtrip.mjs — 用**真实前端界面**验证"能不能正常用"（零额度）。
 *
 * ## 为什么需要它
 *
 * 已有三个验证脚本，但都绕开了浏览器：
 *   - `smoke-e2e-roundtrip.mjs`  直连 WS，不经过前端代码；
 *   - `verify-portable-user-path.mjs` 只打 REST，不渲染任何界面；
 *   - `verify-desktop-render.ps1` 只确认"渲染层连上了 WS"，不验证用户操作。
 *
 * 所以"**点开界面、打字、点发送、看到回复**"这条最接近用户的路径一直没被验证过。
 * 而它恰好是最容易断的一环：前端要拿到模型列表（否则发送按钮 `noProvider` 置灰）、
 * 要建 WS、要渲染流式 token、要把 done 落到气泡里 —— 任何一环断了，
 * 用户看到的都是"没反应"或"按钮点不动"。
 *
 * ## 怎么在**没有 API key** 的情况下跑通
 *
 * 起一个本地假 OpenAI 兼容服务（SSE 流式），在 Maxma 里注册成自定义渠道
 * （`base_url` 指向 localhost）。前端把它当普通渠道显示在模型选择器里，
 * 于是发送按钮可用、回合真的走完 —— 全程不出外网、不花额度。
 *
 * ## 驱动方式
 *
 * 用 Electron 自带的 Chromium（桌面依赖里已有，无需另装浏览器）跑一个
 * **独立的最小 Electron 主进程**，它加载 Maxma 后端托管的前端页面，
 * 注入 token，然后按真实 DOM 钩子操作：
 *   1. 等 `availableModels` 生效（发送按钮从 disabled 变可点）；
 *   2. 往 `.input-area` 输入一句话；
 *   3. 点 `.btn-send`；
 *   4. 断言页面上**真的出现了本次回复的正文**（假服务返回的固定串）。
 *
 * ## 用法
 *
 *   bun scripts/verify-ui-chat-roundtrip.mjs            # 自动起后端（临时数据目录）
 *   BASE=... bun scripts/verify-ui-chat-roundtrip.mjs   # 用已在跑的后端
 *
 * 退出码 0 = 界面路径通；非 0 = 打印失败环节与页面诊断（含浏览器 console 错误）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "..");
const STUB_PORT = Number(process.env.STUB_PORT ?? 8101);
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8102);
/** 假模型返回的固定正文——界面上必须原样出现这一串。 */
const REPLY = "界面链路已验证通过";

// ── 1. 假 OpenAI 兼容服务（SSE 流式）─────────────────────────
const stub = Bun.serve({
  port: STUB_PORT,
  async fetch(req) {
    const pathname = new URL(req.url).pathname;
    if (pathname.endsWith("/models")) {
      return Response.json({ object: "list", data: [{ id: "ui-stub-model", object: "model" }] });
    }
    if (pathname.endsWith("/chat/completions")) {
      const body = await req.json().catch(() => ({}));
      const usage = { prompt_tokens: 8, completion_tokens: REPLY.length, total_tokens: 8 + REPLY.length };
      const chunk = (p) => `data: ${JSON.stringify(p)}\n\n`;
      if (body?.stream === false) {
        return Response.json({
          id: "c1", object: "chat.completion", model: "ui-stub-model",
          choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }],
          usage,
        });
      }
      const deltas = [...REPLY].map((t) =>
        chunk({ id: "c1", object: "chat.completion.chunk", model: "ui-stub-model", choices: [{ index: 0, delta: { content: t } }] }),
      );
      const tail = chunk({
        id: "c1", object: "chat.completion.chunk", model: "ui-stub-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage,
      });
      return new Response(new Blob([...deltas, tail, "data: [DONE]\n\n"]).stream(), {
        headers: { "content-type": "text/event-stream" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

// ── 2. 后端：默认自起一个（临时数据目录），或用外部给的 ────────
let backend = null;
let dataDir = process.env.MAXMA_DATA_DIR ?? "";
let base = process.env.BASE ?? `http://127.0.0.1:${BACKEND_PORT}`;

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

if (!process.env.BASE) {
  // ⚠️ 临时数据目录放**系统临时目录**，不要放仓库根。
  //
  // 早先建在 `REPO/.tmp-uichat-*`，理由是"沙箱可能拒绝写系统临时目录"；
  // 但实测那个顾虑不成立（本脚本在 pwsh/bash 下都能写 %TEMP%），
  // 而放仓库根的代价是实打实的：进程若被强杀（如端口冲突那次），
  // `finally` 不执行 ⇒ 仓库里**留下未被忽略的垃圾目录**，
  // 既污染 `git status`，也让人误以为它是仓库内容。
  // 另一边修：`.gitignore` 也加上 `.tmp-*` 兜底（双保险）。
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uichat-"));
  backend = spawn(process.env.MAXMA_BUN ?? "bun", ["run", path.join(REPO, "bun-backend", "src", "server.ts")], {
    cwd: path.join(REPO, "bun-backend"),
    env: {
      ...process.env,
      MAXMA_DATA_DIR: dataDir,
      MAXMA_BUNDLE_DIR: REPO,
      MAXMA_EXE_DIR: REPO,
      PI_CODING_AGENT_DIR: path.join(dataDir, "pi"),
      MAXMA_BUN_PORT: String(BACKEND_PORT),
      MAXMA_API_PORT: String(BACKEND_PORT),
      MAXMA_BUN_HOST: "127.0.0.1",
      MAXMA_SERVE_WEB: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const failures = [];
function fail(msg) { failures.push(msg); console.error("  ✗ " + msg); }

try {
  if (!(await waitHealth())) {
    throw new Error(`后端未就绪（${base}）。若自起失败请看上面子进程输出。`);
  }
  console.log(`后端就绪：${base}`);
  if (dataDir) console.log(`数据目录：${dataDir}`);

  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  // ── 3. 注册指向假服务的渠道（这是"没有 API key 也能跑通"的关键）──
  await fetch(base + "/api/providers/local-ui-stub", { method: "DELETE", headers: H }).catch(() => {});
  const created = await fetch(base + "/api/providers", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      id: "local-ui-stub",
      label: "本地界面验证渠道",
      base_url: `http://127.0.0.1:${STUB_PORT}/v1`,
      provider_type: "openai-completions",
      api_key: "stub-key",
      models: ["ui-stub-model"],
      enabled: true,
    }),
  });
  if (!created.ok) fail(`注册渠道失败 HTTP ${created.status}`);

  // ── 3.5 把首次引导标记为完成 ─────────────────────────────
  // 否则界面停在 onboarding 欢迎页（"欢迎使用 / 跳过"），
  // 聊天界面根本没渲染，后面所有 DOM 断言都无从谈起。
  // 走**后端状态接口**而不是模拟点击"跳过"：状态本来就由后端持有
  //（`routes/onboarding.ts` 的 DATA_DIR/config/onboarding.json），
  // 直接置位比驱动 UI 更稳、也不会因文案改版而失效。
  const ob = await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({
      completed: true,
      preferences: { displayName: "验证用", language: "zh-CN", workspace: "personal" },
    }),
  });
  if (!ob.ok) fail(`标记引导完成失败 HTTP ${ob.status}`);

  // ── 4. 用 Electron 驱动真实界面 ──────────────────────────
  // 驱动脚本是**仓库里的真实文件**，不是内联模板字符串：
  // 内联版本得在 String.raw 里再转义反引号，既脆弱又难读 ——
  // 实测第一版就因转义写错，生成的临时 .cjs 直接语法报错
  //（"Invalid or unexpected token"），排查成本全花在转义上而不是被测对象上。
  const driverPath = path.join(REPO, "scripts", "_ui-chat-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少界面驱动脚本：${driverPath}`);

  // ⚠️⚠️ 必须**从环境里真正删掉** `ELECTRON_RUN_AS_NODE`，而不是设成空字符串。
  //
  // 实测踩到：`ELECTRON_RUN_AS_NODE: ""` 在 Windows 上仍被视为"该变量存在"，
  // Electron 于是退化成纯 Node 运行 —— 症状极具误导性：子进程能起来，
  // 但报 `Cannot find module 'electron'`（因为那是 Node 在找工作目录下的包），
  // 而输出末尾的 `Node.js v24.21.0` 才是真正的线索（不是 Electron 的版本）。
  // 这与 `scripts/verify-desktop-render.ps1` 里记录的是同一个坑，
  // 区别只在那边用的是 PowerShell 的 `Remove-Item Env:`。
  const driverEnv = { ...process.env, DRIVE_BASE: base, DRIVE_REPLY: REPLY };
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
    const timer = setTimeout(() => { try { driver.kill(); } catch {} res(-1); }, Number(process.env.UI_TIMEOUT_MS ?? 180_000));
    driver.on("exit", (c) => { clearTimeout(timer); res(c ?? -1); });
  });

  const match = out.match(/DRIVE_RESULT (\{.*\})/);
  if (!match) {
    fail(`界面驱动没有返回结果（exit=${code}）`);
    console.error("驱动输出片段：\n" + out.slice(-1500));
  } else {
    const r = JSON.parse(match[1]);
    console.log("界面驱动结果：", JSON.stringify(r, null, 2));
    if (!r.replySeen) {
      fail(`界面未出现回复正文（stage=${r.stage}${r.error ? ", error=" + r.error : ""}）`);
      if (r.pageText) console.error("页面文字片段：\n" + r.pageText);
      if (r.consoleErrors?.length) console.error("浏览器 console 错误：\n" + r.consoleErrors.slice(0, 8).join("\n"));
    } else {
      console.log("✅ 真实界面：输入 → 发送 → 收到回复，全链路通");
    }
  }
  if (code !== 0 && !failures.length) fail(`界面驱动退出码非 0：${code}`);
  // ⚠️ 这里**曾经**有一行 `fs.rmSync(driverPath)`（内联模板时代的清理，当时驱动是临时文件）。
  // 改成随仓库分发的真实文件后那行成了破坏性代码 —— 实测它真把
  // scripts/_ui-chat-driver.cjs 删掉了，下一次运行报"缺少驱动脚本"。
  // 教训与本次其它修复同型：**留下一个只对旧形态成立的清理动作**，
  // 比不清理更坏（它让下一次运行以"缺文件"失败，而根因在上一轮）。
} catch (err) {
  fail(String(err?.message ?? err));
} finally {
  try { stub.stop(); } catch {}
  // ⚠️ 必须连**子进程树**一起杀，不能只 kill 父进程：
  // `bun run src/server.ts` 会派生子进程，只杀父进程会留下孤儿**占住端口**，
  // 于是下一次运行以 `EADDRINUSE` 失败（实测踩到：8101/8102 两处残留，
  // 表现为"脚本跑不起来"，而根因是上一次的清理不彻底）。
  // Windows 用 taskkill /T /F；失败不阻断清理流程。
  if (backend?.pid) {
    try {
      if (process.platform === "win32") {
        Bun.spawnSync(["taskkill", "/PID", String(backend.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
      } else {
        backend.kill("SIGKILL");
      }
    } catch { /* 尽力而为 */ }
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  // ⚠️ 不要删 scripts/_ui-chat-driver.cjs —— 它是**随仓库分发的文件**，不是临时产物。
  // （模板时代会 rmSync 一个 .tmp-*.cjs；改成真实文件后那行若留着，会把驱动删掉，
  //   表现为"第二次运行缺文件"。）
}

if (failures.length) {
  console.error(`\n❌ 界面链路验证未通过（${failures.length} 项）`);
  process.exit(1);
}
console.log("\n✅ 界面链路验证通过");
