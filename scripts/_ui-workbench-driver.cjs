/**
 * scripts/_ui-workbench-driver.cjs — 驱动真实 Electron 界面检查 Workbench P0。
 *
 * 和 verify-ui-capabilities 的驱动同源：清掉 ELECTRON_RUN_AS_NODE，由 Electron
 * 主进程创建隐藏窗口。不同点是这里必须挂 desktop/electron/preload.cjs，才能模拟
 * 桌面端的 window.maxmaDesktop；IPC handler 只返回测试文件夹，不弹真实对话框。
 */

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.DRIVE_BASE;
const WORKSPACE = process.env.DRIVE_WORKSPACE;
const SHOT = process.env.DRIVE_SHOT;
const PRELOAD = path.join(__dirname, "..", "desktop", "electron", "preload.cjs");
const PARTITION = `maxma-uiwb-${process.pid}`;
const WEB_PARTITION = `maxma-uiwb-web-${process.pid}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitText(win, needle, stage, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
    if (text.includes(needle)) return text;
    await sleep(500);
  }
  throw new Error(`${stage}：等待「${needle}」超时；页面文字片段：${text.slice(0, 800)}`);
}

async function waitFor(win, expression, stage, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await win.webContents.executeJavaScript(`Boolean(${expression})`).catch(() => false);
    if (ok) return;
    await sleep(500);
  }
  const text = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
  throw new Error(`${stage}：条件超时；页面文字片段：${text.slice(0, 800)}`);
}

async function clickButton(win, matcherSource) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const match = ${matcherSource};
    const button = [...document.querySelectorAll("button")].find(match);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!ok) throw new Error("找不到目标按钮");
}

async function ensureWorkbenchOpen(win) {
  await waitFor(win, `document.querySelector('button[aria-label="工作台"]')`, "等待工作台按钮");
  const expanded = await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="工作台"]').getAttribute("aria-expanded")`);
  if (expanded !== "true") {
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "工作台"`);
  }
  await waitFor(win, `[...document.querySelectorAll('[role="tab"]')].length > 0`, "打开工作台");
}

ipcMain.handle("maxma:pick-path", async (_event, kind) => {
  if (kind !== "folder" && kind !== "file") throw new Error("bad kind");
  return { path: WORKSPACE };
});
ipcMain.handle("maxma:reveal-path", async () => undefined);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
    webPreferences: {
      preload: PRELOAD,
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const logs = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) logs.push(message);
  });
  win.webContents.on("render-process-gone", (_event, details) => logs.push("render-process-gone: " + JSON.stringify(details)));

  const result = { stage: "start", ok: false, consoleErrors: logs };
  try {
    await win.webContents.session.clearCache();
    await win.loadURL(BASE + "/");
    result.stage = "loaded";
    await waitText(win, "Maxma", "等待对话页加载");
    await ensureWorkbenchOpen(win);
    result.stage = "workbench-open";
    await waitFor(win, `[...document.querySelectorAll('[role="tab"]')].some((node) => node.innerText.trim() === "文件")`, "等待文件 tab");

    const hasBridge = await win.webContents.executeJavaScript("Boolean(window.maxmaDesktop && window.maxmaDesktop.pickPath)");
    if (!hasBridge) throw new Error("preload 没有暴露 window.maxmaDesktop.pickPath");

    await win.webContents.executeJavaScript(`(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => node.innerText.trim() === "文件");
      if (!tab) return false;
      tab.click();
      return true;
    })()`).then((ok) => { if (!ok) throw new Error("找不到「文件」tab"); });
    await waitText(win, "还没有工作区", "切到文件面板");
    result.stage = "files-tab";

    await clickButton(win, `(button) => button.innerText.trim() === "选择文件夹"`);
    await waitText(win, "README.md", "选择工作区并列出文件");
    result.stage = "tree";

    await clickButton(win, `(button) => button.innerText.includes("README.md")`);
    await waitText(win, "file pane reads this text", "预览文本文件");
    result.stage = "text-preview";

    if (SHOT) {
      fs.mkdirSync(path.dirname(SHOT), { recursive: true });
      // 隐藏窗口会被 Chromium 判定为 occluded，capturePage 取到旧帧；
      // 只 showInactive（不抢焦点），让页面真实绘制一帧再截图。
      win.showInactive();
      win.webContents.setBackgroundThrottling(false);
      await sleep(1500);
      const image = await win.webContents.capturePage();
      fs.writeFileSync(SHOT, image.toPNG());
      result.screenshot = SHOT;

      // P0 验收：768 窄窗不能出现横向溢出。
      win.setSize(768, 900);
      await sleep(600);
      const overflow = await win.webContents.executeJavaScript(`({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      })`);
      result.narrow = overflow;
      if (overflow.scrollWidth > overflow.clientWidth + 1) {
        throw new Error(`768 窄窗横向溢出：scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`);
      }
    }

    // 纯 Web 形态：没有 preload 时不得出现文件 tab（否则是死入口）。
    const web = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { partition: WEB_PARTITION },
    });
    await web.loadURL(BASE + "/");
    await waitText(web, "Maxma", "等待纯 Web 对话页");
    await ensureWorkbenchOpen(web);
    const tabLabels = await web.webContents.executeJavaScript(`[...document.querySelectorAll('[role="tab"]')].map((n) => n.innerText.trim())`);
    if (tabLabels.includes("文件")) throw new Error("纯 Web 形态不应显示文件 tab");
    result.webTabs = tabLabels;
    result.stage = "web-no-files";
    web.destroy();

    result.ok = true;
    result.pageText = (await win.webContents.executeJavaScript("document.body.innerText")).slice(0, 1800);
  } catch (error) {
    result.error = String(error?.message ?? error);
    result.pageText = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
  } finally {
    console.log("DRIVE_RESULT " + JSON.stringify(result));
    try { win.destroy(); } catch { /* */ }
    app.quit();
  }
});
