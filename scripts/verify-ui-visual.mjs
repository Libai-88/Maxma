/**
 * scripts/verify-ui-visual.mjs — 六个关键页面截图存证（美学改动的"看得见"验收）。
 *
 * ## 为什么需要它
 *
 * 2026-11-18 的排版整理把 33 个视图的 125 处任意字号收进六档阶梯，并统一了
 * 动效时长与浮层层级。这类改动**不改变任何契约**：tsc 全绿、307 个后端测试全绿、
 * 六个 verify-ui 脚本全绿，界面依然可能"某处挤了、某处被截断"。
 *
 * 现有的六个 UI 脚本只断言文本与状态（全仓库 `capturePage` 0 命中），看不见"好看不好看"。
 * 这个脚本补上那一格：把 6 个关键页面按固定窗口尺寸截图落盘，并给出每张图的
 * 尺寸与平均亮度，供前后对照与未来的回看。
 *
 * ## 用法
 *
 *   bun scripts/verify-ui-visual.mjs                 # 写到 dev_docs/visual/<今天>/
 *   bun scripts/verify-ui-visual.mjs --update-baseline  # 覆盖 dev_docs/visual/baseline/
 *
 * 退出码 0 = 六个页面都截到了图，且没有高等级 console error。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { requireBun } from "./_bun-bin.mjs";

const REPO = path.resolve(import.meta.dir, "..");
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8133);
const base = process.env.BASE ?? `http://127.0.0.1:${BACKEND_PORT}`;

const updateBaseline = process.argv.includes("--update-baseline");
const stamp = new Date().toISOString().slice(0, 10);
const outDir = updateBaseline
  ? path.join(REPO, "dev_docs", "visual", "baseline")
  : path.join(REPO, "dev_docs", "visual", stamp);

/** 六个页面：空对话、有会话的对话、指标、设置、扩展、外观。 */
const PAGES = process.env.VISUAL_PAGES
  ? JSON.parse(process.env.VISUAL_PAGES)
  : [
    { name: "chat-empty", path: "/" },
    { name: "chat-session", path: "/" },
    { name: "metrics", path: "/metrics" },
    { name: "settings", path: "/settings" },
    { name: "extensions", path: "/extensions" },
    { name: "appearance", path: "/appearance" },
  ];

let backend = null;
let dataDir = process.env.MAXMA_DATA_DIR ?? "";
const failures = [];

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

try {
  if (!process.env.BASE) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uivisual-"));
    backend = spawn(requireBun({ root: REPO, what: "界面截图存证" }), ["run", path.join(REPO, "bun-backend", "src", "server.ts")], {
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
  console.log(`后端就绪：${base}`);

  const tokenProbe = await fetch(base + "/api/auth/token").catch(() => null);
  if (!tokenProbe?.ok) {
    throw new Error(`端口 ${BACKEND_PORT} 上已有别的进程在监听（很可能是上一轮残留的后端），请先结束它或换 BACKEND_PORT。`);
  }
  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ completed: true, preferences: { displayName: "验证用", language: "zh-CN", workspace: "personal" } }),
  });

  const sessRes = await fetch(base + "/api/sessions", { method: "POST", headers: H });
  const sessBody = await sessRes.json().catch(() => ({}));
  const sessionId = sessBody.session_id ?? "";
  if (!sessionId) failures.push("建新会话失败：截图里的对话页会停在空态");

  const driverPath = path.join(REPO, "scripts", "_ui-visual-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少截图驱动脚本：${driverPath}`);

  const driverEnv = {
    ...process.env,
    DRIVE_BASE: base,
    DRIVE_OUT: outDir,
    DRIVE_SESSION_ID: sessionId,
    DRIVE_PAGES: JSON.stringify(PAGES),
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
    const timer = setTimeout(() => { try { driver.kill(); } catch { /* */ } res(-1); }, Number(process.env.UI_TIMEOUT_MS ?? 240_000));
    driver.on("exit", (c) => { clearTimeout(timer); res(c ?? -1); });
  });

  const line = out.split("\n").find((l) => l.includes("VISUAL_RESULT "));
  const result = line ? JSON.parse(line.slice(line.indexOf("VISUAL_RESULT ") + "VISUAL_RESULT ".length)) : null;

  if (!result) throw new Error(`驱动没有返回结果（exit ${code}）：\n${out.slice(-600)}`);
  if (result.stage !== "done") throw new Error(`截图失败：${result.error ?? "unknown"}`);

  console.log(`\n截图目录：${path.relative(REPO, outDir)}`);
  // 窗口尺寸是 DIP，截图是物理像素：Windows 150% 缩放时 1280×800 会变成 1920×1203。
  // 所以按「宽高比 + 一页渲染出文字」判定，而不是钉死像素。
  for (const r of result.results) {
    const ratio = r.width / r.height;
    console.log(`  ${r.name.padEnd(14)} ${r.width}x${r.height}  ${(r.bytes / 1024).toFixed(1)}KB  luma ${r.meanLuma}  路由 ${r.landed}  文字 ${String(r.text ?? "").slice(0, 40)}`);
    if (r.landed !== r.path) failures.push(`${r.name} 没有落到 ${r.path}（实际 ${r.landed}）`);
    if (ratio < 1.5 || ratio > 1.65) failures.push(`${r.name} 宽高比异常：${r.width}x${r.height}（1280×800 经 DPI 缩放应约为 1.6）`);
    if (r.meanLuma < 4 || r.meanLuma > 250) failures.push(`${r.name} 平均亮度异常：${r.meanLuma}（页面可能是空白或全黑）`);
    if (!r.text || r.text.length < 12) failures.push(`${r.name} 页面上几乎没有文字：${r.text ?? ""}`);
  }

  // 截图过程中的 console error 是产品缺陷，不是脚本噪声：这类页面不该报错。
  const errors = (result.consoleErrors ?? []).filter((m) => !/favicon|Failed to fetch|WebSocket/i.test(m));
  if (errors.length) failures.push(`页面 console error ${errors.length} 条：${errors.slice(0, 3).join(" | ")}`);

  if (code !== 0) failures.push(`驱动退出码 ${code}`);

  if (failures.length) {
    console.error("\n失败：");
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log(`\n✓ ${result.results.length} 个页面均已截图（尺寸/亮度正常，无高等级 console error）`);
  process.exit(0);
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
} finally {
  if (backend) {
    try { backend.kill(); } catch { /* */ }
  }
  // 临时数据目录不删：截图失败时它是最直接的现场。
}
