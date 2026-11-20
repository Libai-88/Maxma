/**
 * scripts/verify-ui-workbench.mjs — Workbench 2.0 P1 的真实界面验证。
 *
 * 验证桌面 preload 选择文件夹 → 文件树/过滤/多 tab/源码预览/重命名根 →
 * 工作台调宽与最大化 → 命令面板 → 真实 WebContentsView 内置浏览器 →
 * 切 tab 隐藏原生 view → 768 窄窗 → 纯 Web 降级。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { requireBun } from "./_bun-bin.mjs";

const REPO = path.resolve(import.meta.dir, "..");
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8137);
const base = process.env.BASE ?? `http://127.0.0.1:${BACKEND_PORT}`;
const localBun = path.join(REPO, "bun-sidecar", process.platform === "win32" ? "bun.exe" : "bun");
let backend = null;
let dataDir = "";
let workspaceDir = "";

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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uiwb-"));
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uiwb-files-"));
  fs.mkdirSync(path.join(workspaceDir, "src"));
  fs.mkdirSync(path.join(workspaceDir, "node_modules"));
  fs.writeFileSync(path.join(workspaceDir, "README.md"), "# Workbench P1 smoke\n\nfile pane reads this text.\n", "utf8");
  fs.writeFileSync(path.join(workspaceDir, "notes.md"), "# Notes\n\nsecond tab.\n", "utf8");
  fs.writeFileSync(path.join(workspaceDir, "src", "main.ts"), "export const ok = true;\n", "utf8");
  fs.writeFileSync(path.join(workspaceDir, "node_modules", "ignored.txt"), "ignored dependency\n", "utf8");
  fs.writeFileSync(
    path.join(workspaceDir, "index.html"),
    "<!doctype html><html><body><h1>P1 html</h1><script>window.__htmlInjected = true</script></body></html>\n",
    "utf8",
  );
  fs.writeFileSync(path.join(workspaceDir, "binary.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]));
  fs.writeFileSync(
    path.join(workspaceDir, "dot.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  );

  const bun = fs.existsSync(localBun) ? localBun : requireBun({ root: REPO, what: "Workbench 文件面板验证" });
  backend = spawn(bun, ["run", path.join(REPO, "bun-backend", "src", "server.ts")], {    cwd: path.join(REPO, "bun-backend"),
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
const fail = (message) => { failures.push(message); console.error("  ✗ " + message); };

try {
  if (!(await waitHealth())) throw new Error(`后端未就绪（${base}）`);
  console.log(`后端就绪：${base}`);

  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const headers = { "x-maxma-token": token, "content-type": "application/json" };
  const onboarding = await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers,
    body: JSON.stringify({ completed: true, preferences: { displayName: "面板验证", language: "zh-CN", workspace: "personal" } }),
  });
  if (!onboarding.ok) throw new Error(`标记引导失败 HTTP ${onboarding.status}`);

  const driverPath = path.join(REPO, "scripts", "_ui-workbench-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少界面驱动脚本：${driverPath}`);

  const driverEnv = {
    ...process.env,
    DRIVE_BASE: base,
    DRIVE_WORKSPACE: workspaceDir,
    DRIVE_SHOT_DIR: path.join(REPO, "dev_docs", "visual"),
  };
  delete driverEnv.ELECTRON_RUN_AS_NODE;
  delete driverEnv.ELECTRON_NO_ATTACH_CONSOLE;

  const driver = spawn(path.join(REPO, "desktop", "node_modules", "electron", "dist", "electron.exe"), [driverPath], {
    env: driverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  driver.stdout.on("data", (chunk) => { out += String(chunk); });
  driver.stderr.on("data", (chunk) => { out += String(chunk); });

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => { try { driver.kill(); } catch { /* */ } resolve(-1); }, Number(process.env.UI_TIMEOUT_MS ?? 120_000));
    driver.on("exit", (code) => { clearTimeout(timer); resolve(code ?? -1); });
  });

  const match = out.match(/DRIVE_RESULT (\{.*\})/);
  if (!match) {
    fail(`界面驱动没有返回结果（exit=${exitCode}）`);
    console.error("驱动输出片段：\n" + out.slice(-1500));
  } else {
    const result = JSON.parse(match[1]);
    console.log("界面驱动结果：", JSON.stringify(result, null, 2));
    if (!result.ok) fail(`Workbench 界面验证未通过（stage=${result.stage}${result.error ? ", error=" + result.error : ""}）`);
    if (result.consoleErrors?.length) fail(`浏览器 console 有 ${result.consoleErrors.length} 条错误`);
  }
  if (exitCode !== 0 && !failures.length) fail(`界面驱动退出码非 0：${exitCode}`);
} catch (error) {
  fail(String(error?.message ?? error));
} finally {
  try { backend?.kill(); } catch { /* */ }
  if (dataDir && !process.env.MAXMA_DATA_DIR) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
  if (workspaceDir) {
    try { fs.rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

if (failures.length) {
  console.error(`\n❌ Workbench P1 界面验证失败（${failures.length} 项）`);
  process.exit(1);
}
console.log("\n✅ Workbench P1 界面验证通过");
process.exit(0);
