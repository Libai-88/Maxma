/**
 * scripts/verify-ui-capabilities.mjs — 用真实前端界面验证「能力页 · 配置来源」的诚实性。
 *
 * ## 为什么需要它
 *
 * 配置来源表的数据由后端算，但**用户看到的**是渲染结果。后端测试能证明 JSON 里
 * 没有 `.omprc`，却证明不了页面不会把它画出来（字段改名、映射漏掉、旧产物缓存
 * 都会让两者分叉）。而这张表恰恰是"界面撒谎"的重灾区：它曾把 `.cursor`、
 * `.github`、`~/.claude` 这些零读取方的目录画成打勾的"存在"。
 *
 * ## 用法
 *
 *   bun scripts/verify-ui-capabilities.mjs            # 自动起后端（临时数据目录）
 *   BASE=http://127.0.0.1:8000 bun scripts/verify-ui-capabilities.mjs
 *
 * 退出码 0 = 页面符合预期；非 0 = 打印失败环节与页面文本。
 * 驱动脚本是仓库里的真实文件 `scripts/_ui-capabilities-driver.cjs`（同
 * verify-ui-chat-roundtrip.mjs 的取舍：不内联，避免转义地狱）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "..");
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8112);

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

if (!process.env.BASE) {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uicap-"));
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const failures = [];
const fail = (m) => { failures.push(m); console.error("  ✗ " + m); };

try {
  if (!(await waitHealth())) throw new Error(`后端未就绪（${base}）`);
  console.log(`后端就绪：${base}`);
  if (dataDir) console.log(`数据目录：${dataDir}`);

  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  // 首次引导若未完成，界面停在欢迎页，深链 /capabilities 也进不去。
  // 与聊天验证脚本同一做法：直接置后端状态，比驱动 UI 稳。
  const ob = await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ completed: true, preferences: { displayName: "验证用", language: "zh-CN", workspace: "personal" } }),
  });
  if (!ob.ok) fail(`标记引导完成失败 HTTP ${ob.status}`);

  const driverPath = path.join(REPO, "scripts", "_ui-capabilities-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少界面驱动脚本：${driverPath}`);

  const driverEnv = { ...process.env, DRIVE_BASE: base };
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
    const timer = setTimeout(() => { try { driver.kill(); } catch { /* */ } res(-1); }, Number(process.env.UI_TIMEOUT_MS ?? 120_000));
    driver.on("exit", (c) => { clearTimeout(timer); res(c ?? -1); });
  });

  const match = out.match(/DRIVE_RESULT (\{.*\})/);
  if (!match) {
    fail(`界面驱动没有返回结果（exit=${code}）`);
    console.error("驱动输出片段：\n" + out.slice(-1500));
  } else {
    const r = JSON.parse(match[1]);
    console.log("界面驱动结果：", JSON.stringify(r, null, 2));
    if (!r.ok) {
      fail(`能力页校验未通过（stage=${r.stage}${r.error ? ", error=" + r.error : ""}）`);
      if (r.pageText) console.error("页面文字片段：\n" + r.pageText.slice(0, 1200));
      if (r.consoleErrors?.length) console.error("浏览器 console 错误：\n" + r.consoleErrors.slice(0, 8).join("\n"));
    } else {
      console.log("✅ 能力页：配置来源只列真实读取方，逐条带读取点，无 console 错误");
    }
    if (r.consoleErrors?.length) fail(`浏览器 console 有 ${r.consoleErrors.length} 条错误`);
  }
  if (code !== 0 && !failures.length) fail(`界面驱动退出码非 0：${code}`);
} catch (err) {
  fail(String(err?.message ?? err));
} finally {
  try { backend?.kill(); } catch { /* */ }
  if (dataDir && !process.env.MAXMA_DATA_DIR) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

if (failures.length) {
  console.error(`\n❌ 能力页验证失败（${failures.length} 项）`);
  process.exit(1);
}
console.log("\n✅ 能力页验证通过");
process.exit(0);
