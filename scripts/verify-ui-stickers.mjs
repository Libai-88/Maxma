/**
 * scripts/verify-ui-stickers.mjs — 真实前端界面验收表情选择器与管理面板。
 *
 * 只验证 UI 链路，不调用模型、不花额度：
 *   1. 起临时后端（自带 328 张内置表情）；
 *   2. 标记 onboarding 完成 + 新建会话；
 *   3. Electron 加载真实页面，点「添加附件 → 表情」；
 *   4. 断言选择器打开、焦点在搜索框、Tab 不逃逸、Escape 关闭并归还焦点；
 *   5. 真实触控 + 键盘 Enter 各插入一个 `[表情: …]`；
 *   6. 重新打开选择器，点「管理图库」，断言管理对话框出现；
 *   7. 截图与 `dev_docs/visual/sticker-baseline/` 做像素回归（--update-baseline 更新基线）。
 *
 * 用法：bun scripts/verify-ui-stickers.mjs [--update-baseline]
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "..");
const BUN_BIN = process.env.MAXMA_BUN || path.join(REPO, "bun-sidecar", "bun.exe");
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8120);
const base = `http://127.0.0.1:${BACKEND_PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uisticker-"));
const shotDir = process.env.UI_KEEP_SHOTS
  ? path.join(REPO, "dev_docs", "visual", "sticker-current")
  : fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uisticker-shots-"));
const baselineDir = path.join(REPO, "dev_docs", "visual", "sticker-baseline");
const updateBaseline = process.argv.includes("--update-baseline");

let backend = null;
const failures = [];
function fail(msg) {
  failures.push(msg);
  console.error("  ✗ " + msg);
}

function waitHealth(timeoutMs = 60_000) {
  return (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(base + "/api/health");
        if (r.ok) return true;
      } catch {}
      await Bun.sleep(400);
    }
    return false;
  })();
}

try {
  backend = spawn(
    BUN_BIN,
    ["run", path.join(REPO, "bun-backend", "src", "server.ts")],
    {
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
    },
  );
  let backendLog = "";
  backend.stdout.on("data", (c) => (backendLog += String(c)));
  backend.stderr.on("data", (c) => (backendLog += String(c)));

  if (!(await waitHealth())) {
    throw new Error("后端未就绪；日志片段：\n" + backendLog.slice(-1200));
  }

  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  // 让点击表情走「插入输入框」而不是「直接发送」，才能断言 marker。
  const settingsRes = await fetch(base + "/api/stickers/settings", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ pickerSendOnClick: false }),
  });
  if (!settingsRes.ok) fail(`关闭点击直发失败 HTTP ${settingsRes.status}`);

  const ob = await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({
      completed: true,
      preferences: { displayName: "表情验证", language: "zh-CN", workspace: "personal" },
    }),
  });
  if (!ob.ok) fail(`标记引导完成失败 HTTP ${ob.status}`);

  const sessRes = await fetch(base + "/api/sessions", { method: "POST", headers: H });
  const sess = await sessRes.json().catch(() => ({}));
  if (!sess.session_id) fail(`建会话失败 HTTP ${sessRes.status}`);

  const driverPath = path.join(REPO, "scripts", "_ui-sticker-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少界面驱动脚本：${driverPath}`);

  // 三组场景共用同一个后端/会话，但每个场景都用独立 Electron 窗口。
  // 深色桌面是既有回归；亮色和窄屏覆盖主题与移动端布局，不再只靠一张桌面图。
  const scenarios = [
    { name: "desktop-dark", suffix: "", theme: "dark", width: 1280, height: 900 },
    { name: "desktop-light", suffix: "-light", theme: "light", width: 1280, height: 900 },
    { name: "narrow-dark", suffix: "-narrow", theme: "dark", width: 768, height: 900 },
  ].filter((sc) => !process.env.UI_SCENARIO || process.env.UI_SCENARIO === sc.name);

  async function runScenario(sc) {
    const driverEnv = {
      ...process.env,
      DRIVE_BASE: base,
      DRIVE_SESSION_ID: sess.session_id ?? "",
      DRIVE_OUT: shotDir,
      DRIVE_BASELINE_DIR: baselineDir,
      DRIVE_UPDATE_BASELINE: updateBaseline ? "1" : "",
      DRIVE_THEME: sc.theme,
      DRIVE_WIDTH: String(sc.width),
      DRIVE_HEIGHT: String(sc.height),
      DRIVE_SHOT_SUFFIX: sc.suffix,
    };
    delete driverEnv.ELECTRON_RUN_AS_NODE;
    delete driverEnv.ELECTRON_NO_ATTACH_CONSOLE;

    const driver = spawn(path.join(REPO, "desktop", "node_modules", "electron", "dist", "electron.exe"), [driverPath], {
      env: driverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    driver.stdout.on("data", (c) => (out += String(c)));
    driver.stderr.on("data", (c) => (out += String(c)));

    const code = await new Promise((res) => {
      const timer = setTimeout(() => {
        try { driver.kill(); } catch {}
        res(-1);
      }, Number(process.env.UI_TIMEOUT_MS ?? 180_000));
      driver.on("exit", (c) => { clearTimeout(timer); res(c ?? -1); });
    });

    const match = out.match(/DRIVE_RESULT (\{.*\})/);
    if (!match) {
      fail(`[${sc.name}] 界面驱动没有返回结果（exit=${code}）`);
      console.error(out.slice(-1500));
      return;
    }
    const r = JSON.parse(match[1]);
    console.log(`界面驱动结果 [${sc.name}]：`, JSON.stringify(r, null, 2));
    if (!r.pickerOpened) fail(`[${sc.name}] 表情选择器没有打开（stage=${r.stage}）`);
    if (!r.searchFocused) fail(`[${sc.name}] 打开选择器后焦点没有落在搜索框`);
    if (!r.tabFocusInDialog) fail(`[${sc.name}] 按 Tab 后焦点逃出选择器（实际=${r.tabFocusLabel || "?"}）`);
    if (!r.escapeClosed) fail(`[${sc.name}] 按 Escape 后选择器没有关闭`);
    if (!r.focusRestored) fail(`[${sc.name}] 关闭选择器后焦点没有回到消息输入框`);
    if (!r.imagesLoaded) fail(`[${sc.name}] 表情选择器里没有成功加载的图片`);
    if (!r.searchHit) fail(`[${sc.name}] 搜索「委屈」没有命中结果`);
    if (!r.touchInserted) fail(`[${sc.name}] 真实触控点击没有插入表情标记`);
    if (!r.keyboardInserted) fail(`[${sc.name}] 键盘 Enter 没有插入第二个标记（实际=${JSON.stringify(r.inputValue)?.slice(0, 80)}）`);
    if (!r.markerInserted) fail(`[${sc.name}] 输入框没有 [表情: …]（实际=${JSON.stringify(r.inputValue)?.slice(0, 80)}）`);
    if (!r.imeCommitted) fail(`[${sc.name}] IME 组合输入没有进入消息输入框`);
    if (!r.multiTouchStable) fail(`[${sc.name}] 双指捏合导致选择器关闭或误插入`);
    if (!r.managerOpened) fail(`[${sc.name}] 点「管理图库」后管理对话框没有出现`);
    for (const shot of r.shots ?? []) {
      if (shot.status === "missing") {
        fail(`[${sc.name}] 缺少视觉基线 ${shot.baselinePath}；用 --update-baseline 生成后再纳入回归`);
      } else if (shot.status === "size-mismatch") {
        fail(`[${sc.name}] 视觉基线尺寸不一致 ${shot.name}: current=${JSON.stringify(shot.current)} baseline=${JSON.stringify(shot.baseline)}`);
      } else if (shot.status === "compared" && shot.ratio > 0.02) {
        fail(`[${sc.name}] 视觉回归超阈值 ${shot.name}: ${(shot.ratio * 100).toFixed(2)}% 像素变化（阈值 2%）`);
      }
    }
    if (r.consoleErrors?.length) {
      fail(`[${sc.name}] 浏览器 console 有 ${r.consoleErrors.length} 条 warning/error`);
      console.error("浏览器 console 错误：\n" + r.consoleErrors.slice(0, 8).join("\n"));
    }
    if (code !== 0) fail(`[${sc.name}] 界面驱动退出码非 0：${code}`);
  }

  for (const sc of scenarios) await runScenario(sc);
  if (updateBaseline) console.log(`已更新视觉基线：${baselineDir}`);
  if (!failures.length) console.log("✅ 真实界面：焦点/Tab/Escape → 触控 → 键盘 Enter → 多指 → IME → 管理面板 → 明暗/窄屏像素回归，全链路通");
} catch (err) {
  fail(String(err?.message ?? err));
} finally {
  if (backend?.pid) {
    try {
      Bun.spawnSync(["taskkill", "/PID", String(backend.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
    } catch {}
  }
  // 不删仓库里的驱动文件；临时数据目录尽力清理（Windows SQLite 句柄可能延迟）。
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
      break;
    } catch {
      await Bun.sleep(100);
    }
  }
  if (!process.env.UI_KEEP_SHOTS) {
    try { fs.rmSync(shotDir, { recursive: true, force: true }) } catch { /* 截图临时目录 */ }
  }}

if (failures.length) {
  console.error(`\n❌ 表情界面验证未通过（${failures.length} 项）`);
  process.exit(1);
}
console.log("\n✅ 表情界面验证通过");
