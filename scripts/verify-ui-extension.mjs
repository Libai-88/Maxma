/**
 * scripts/verify-ui-extension.mjs — 验证 pi 扩展的 ctx.ui 在 Maxma 里真的可用（EXT-UI-001）。
 *
 * ## 为什么需要它
 *
 * 这是本轮 P0 的最终验收。此前 `bindExtensions({})` 传空对象，`ExtensionRunner`
 * 回落到 `noOpUIContext`，它的 `confirm` **恒返回 false**——pi 官方示例
 * `confirm-destructive.ts` 在 Maxma 里会静默拒绝一切操作。类型对不上能靠 tsc 发现，
 * 但"扩展的 ctx.ui 有没有落点"只能靠真跑。
 *
 * 本脚本：起真实后端 → 临时放一个扩展到 pi 的 agent 目录 → 真实前端发
 * `/probe-confirm` → 扩展弹窗 → 点「是」→ 扩展收到 true。全程不伪造事件。
 *
 * ## 用法
 *
 *   bun scripts/verify-ui-extension.mjs
 *
 * 退出码 0 = 扩展 UI 链路通；非 0 = 打印失败环节与页面文本。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "..");
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8122);

/** 临时扩展：模拟 pi 官方 confirm-destructive 的形状。 */
const PROBE_EXT_SOURCE = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("probe-confirm", {
    description: "验证扩展 UI 往返",
    handler: async (_args: any, ctx: any) => {
      const ok = await ctx.ui.confirm("扩展确认", "这是一个来自扩展的确认框");
      ctx.ui.notify(ok ? "用户点了是" : "用户点了否", "info");
    },
  });
}
`;

let backend = null;
let dataDir = process.env.MAXMA_DATA_DIR ?? "";
let extFile = "";
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
  // ── 1. 起后端（临时数据目录），再往它的 agentDir 放临时扩展 ──
  // 顺序很重要：agentDir 由后端自己解析（开发模式 = <dataDir>/api/data/pi），
  // 所以必须**先定 dataDir**，把扩展写到那个目录里，后端建会话时才会扫到。
  // 早先的写法在起后端前就写扩展，用的却是用户真实 agentDir，导致后端读不到。
  if (!process.env.BASE) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uiext-"));
  }
  const agentDir = process.env.PI_CODING_AGENT_DIR
    ? path.resolve(process.env.PI_CODING_AGENT_DIR)
    : dataDir
      ? path.join(dataDir, "api", "data", "pi")
      : path.join(os.homedir(), ".pi", "agent");
  const extDir = path.join(agentDir, "extensions");
  fs.mkdirSync(extDir, { recursive: true });
  extFile = path.join(extDir, "probe-confirm.ts");
  fs.writeFileSync(extFile, PROBE_EXT_SOURCE, "utf8");
  console.log(`临时扩展：${extFile}`);

  if (!process.env.BASE) {
    backend = spawn(process.env.MAXMA_BUN ?? "bun", ["run", path.join(REPO, "bun-backend", "src", "server.ts")], {
      cwd: path.join(REPO, "bun-backend"),
      env: {
        ...process.env,
        MAXMA_DATA_DIR: dataDir,
        MAXMA_BUNDLE_DIR: REPO,
        MAXMA_EXE_DIR: REPO,
        // 不注入 PI_CODING_AGENT_DIR：让后端按开发模式自己解析到 <dataDir>/api/data/pi，
        // 与上面写扩展的位置保持一致（注入外部路径会让两边分叉）。
        ...(process.env.PI_CODING_AGENT_DIR ? { PI_CODING_AGENT_DIR: agentDir } : {}),
        MAXMA_BUN_PORT: String(BACKEND_PORT),
        MAXMA_API_PORT: String(BACKEND_PORT),
        MAXMA_BUN_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  if (!(await waitHealth())) throw new Error(`后端未就绪（${base}）`);
  console.log(`后端就绪：${base}`);

  // ⚠️ 端口可能被**上一轮残留的后端**占着（实测：进程被强杀时 finally 不执行）。
  // 那样 waitHealth 会连到旧后端，它的 token 与临时数据目录里的不是同一个，
  // 于是后续所有请求 401——症状看起来像"脚本写错了"，实际是环境脏。
  // 这里先取 token 再验一次：拿不到就明确报出来，而不是让 401 在后面各处冒出来。
  {
    const probe = await fetch(base + "/api/auth/token").catch(() => null);
    if (!probe?.ok) {
      throw new Error(
        `端口 ${BACKEND_PORT} 上已有别的进程在监听（很可能是上一轮残留的后端）。` +
          `请先结束它再重跑，或换 BACKEND_PORT 环境变量。`,
      );
    }
  }

  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  // 引导完成，否则界面停在欢迎页
  const ob = await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ completed: true, preferences: { displayName: "验证用", language: "zh-CN", workspace: "personal" } }),
  });
  if (!ob.ok) fail(`标记引导完成失败 HTTP ${ob.status}`);

  // 注册一个假渠道，否则发送按钮被 noProvider 挡住
  await fetch(base + "/api/providers/local-ext-stub", { method: "DELETE", headers: H }).catch(() => {});
  const created = await fetch(base + "/api/providers", {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      id: "local-ext-stub",
      label: "扩展 UI 验证渠道",
      base_url: "http://127.0.0.1:9/v1",
      provider_type: "openai-completions",
      api_key: "stub-key",
      models: ["stub-model"],
      enabled: true,
    }),
  });
  if (!created.ok) fail(`注册渠道失败 HTTP ${created.status}`);

  // ── 3. 先用 API 建一个全新会话 ──
  //
  // 为什么要显式建：前端启动时会「优先续上最近一次对话」（会话恢复特性），
  // 而 pi 的扩展在 create_session 时装配。复用旧会话就不会加载本轮新放的扩展，
  // 症状是「扩展命令被当成普通消息发给模型」——实测踩过。
  const sessRes = await fetch(base + "/api/sessions", { method: "POST", headers: H });
  const sessBody = await sessRes.json().catch(() => ({}));
  const freshSessionId = sessBody.session_id;
  if (!freshSessionId) fail(`建新会话失败 HTTP ${sessRes.status}`);
  else console.log(`新会话：${freshSessionId}`);

  // ── 4. Electron 驱动真实界面 ──
  const driverPath = path.join(REPO, "scripts", "_ui-extension-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少界面驱动脚本：${driverPath}`);

  const driverEnv = { ...process.env, DRIVE_BASE: base, DRIVE_SESSION_ID: freshSessionId ?? "" };
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
    if (!r.replied) {
      fail(`扩展 UI 链路未通（stage=${r.stage}${r.error ? ", error=" + r.error : ""}）`);
      if (r.pageText) console.error("页面文字片段：\n" + r.pageText.slice(0, 1200));
      if (r.consoleErrors?.length) console.error("浏览器 console 错误：\n" + r.consoleErrors.slice(0, 8).join("\n"));
    } else {
      console.log("✅ 扩展 ctx.ui 真实链路：扩展弹窗 → 用户点「是」→ 扩展收到 true");
    }
    if (r.consoleErrors?.length) fail(`浏览器 console 有 ${r.consoleErrors.length} 条错误`);
  }
  if (code !== 0 && !failures.length) fail(`界面驱动退出码非 0：${code}`);
} catch (err) {
  fail(String(err?.message ?? err));
} finally {
  // 清理临时扩展——它装在用户真实 agent 目录里，必须删掉。
  try { if (extFile) fs.rmSync(extFile, { force: true }); } catch { /* */ }
  try { backend?.kill(); } catch { /* */ }
  if (dataDir && !process.env.MAXMA_DATA_DIR) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

if (failures.length) {
  console.error(`\n❌ 扩展 UI 验证失败（${failures.length} 项）`);
  process.exit(1);
}
console.log("\n✅ 扩展 UI 验证通过");
process.exit(0);
