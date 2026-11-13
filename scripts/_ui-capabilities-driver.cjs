/**
 * scripts/_ui-capabilities-driver.cjs — 驱动真实界面检查「能力页」。
 *
 * 由 `scripts/verify-ui-capabilities.mjs` 启动。与 `_ui-chat-driver.cjs` 同源同坑
 * （裸模块名 `require("electron")` + 清掉 ELECTRON_RUN_AS_NODE），细节见那个文件的头注释。
 *
 * 它验的是本次改动最要紧的一件事：**配置来源表不再把零读取方的目录画成"存在"**，
 * 且每条都给出读取点。判据全部来自页面可见文本，不查 DOM 结构（结构会随样式变）。
 *
 * 输入：DRIVE_BASE（后端地址）。输出：stdout 一行 `DRIVE_RESULT {json}`。
 */
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const { app, BrowserWindow } = require("electron");

const BASE = process.env.DRIVE_BASE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: { sandbox: true, contextIsolation: true },
  });

  const logs = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) logs.push(message);
  });
  win.webContents.on("render-process-gone", (_e, d) => logs.push("render-process-gone: " + JSON.stringify(d)));

  const result = { stage: "start", ok: false, consoleErrors: logs };

  try {
    // 深链直接进能力页：验证 SPA 路由 + 静态资源在 http 托管下的相对路径解析
    // （历史上这里踩过 `<base href>` 缺失导致白屏的坑）。
    // 清缓存：Electron 的 Chromium 会缓存 index.html 与旧 chunk，
    // 复用端口重跑时可能加载到上一轮的产物（实测症状：页面渲染了，
    // 但 API 调用与当前后端契约不符）。
    await win.webContents.session.clearCache();
    await win.loadURL(BASE + "/capabilities");
    result.stage = "loaded";

    let text = "";
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      text = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
      if (text && text.includes("配置来源")) break;
    }
    result.pageText = text.slice(0, 2500);
    if (!text.includes("配置来源")) throw new Error("能力页没渲染出「配置来源」区块");
    result.stage = "sources-rendered";

    // ── 断言 1：零读取方的旧条目一个都不许出现 ──
    // 这些是 OMP 时代的直译行（`.omprc` / `.cursor` / `.github` / `.mcp.json` 等），
    // 在 Maxma + pi 的真实链路上没有任何读取方。它们曾以"存在"打勾的形式展示，
    // 等于告诉用户 Maxma 在用这些配置。
    const ghosts = [".omprc", ".claude", ".cursor", ".github", ".mcp.json", "CLI 参数"];
    result.ghostsVisible = ghosts.filter((g) => text.includes(g));
    if (result.ghostsVisible.length) {
      throw new Error("配置来源里仍出现零读取方条目：" + result.ghostsVisible.join(", "));
    }

    // ── 断言 2：真实读取方必须在列 ──
    const reals = ["settings_overrides.json", "panel_configs.json", "providers.yaml", "mcp_servers.yaml"];
    result.realsMissing = reals.filter((r) => !text.includes(r));
    if (result.realsMissing.length) {
      throw new Error("配置来源缺少真实读取方：" + result.realsMissing.join(", "));
    }

    // ── 断言 3：每条都给出「读取方」 ──
    result.readerLabels = (text.match(/读取方：/g) || []).length;
    if (result.readerLabels < 8) {
      throw new Error("「读取方」标注太少（" + result.readerLabels + " 条），来源表可能退回无出处状态");
    }

    // ── 断言 4：不再声称"高优先级覆盖低优先级" ──
    // 旧文案是 OMP 的优先级模型；新清单里应用层各文件职责互不重叠。
    if (text.includes("高优先级覆盖低优先级")) {
      throw new Error("仍在宣称「高优先级覆盖低优先级」——那是 OMP 的模型，与本清单不符");
    }

    // ── 断言 5：会话工作目录指向项目根，不是 bun-backend ──
    const cwdLine = (text.match(/会话工作目录\s*\n?\s*(\S+)/) || [])[1] || "";
    result.cwdShown = cwdLine;
    if (/bun-backend/i.test(cwdLine)) {
      throw new Error("会话工作目录显示成了 bun-backend（应指向项目根）：" + cwdLine);
    }

    result.ok = true;
    result.stage = "verified";
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }

  process.stdout.write("DRIVE_RESULT " + JSON.stringify(result) + "\n");
  app.exit(result.ok ? 0 : 1);
});
