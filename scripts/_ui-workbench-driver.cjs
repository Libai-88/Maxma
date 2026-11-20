/**
 * scripts/_ui-workbench-driver.cjs — 驱动真实 Electron 界面检查 Workbench P1。
 *
 * 和 P0 驱动同源：清掉 ELECTRON_RUN_AS_NODE，挂 desktop/electron/preload.cjs，
 * 用测试 IPC 绕开系统文件对话框。浏览器部分直接复用 browser-view.cjs——
 * 被测的是主进程真正会用的那份 WebContentsView 控制器。
 */

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const { app, BrowserWindow, desktopCapturer, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createBrowserController } = require("../desktop/electron/browser-view.cjs");
const { assertOpenableHtml } = require("../desktop/electron/path-actions.cjs");

const BASE = process.env.DRIVE_BASE;
const ORIGIN = String(BASE).replace(/\/$/, "");
const WORKSPACE = process.env.DRIVE_WORKSPACE;
const SHOT_DIR = process.env.DRIVE_SHOT_DIR;
const PRELOAD = path.join(__dirname, "..", "desktop", "electron", "preload.cjs");
const PARTITION = `maxma-uiwb-${process.pid}`;
const WEB_PARTITION = `maxma-uiwb-web-${process.pid}`;
const BROWSER_PARTITION = `maxma-uiwb-browser-${process.pid}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let win = null;
let browserController = null;
const externalUrls = [];

async function waitText(target, needle, stage, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = await target.webContents.executeJavaScript("document.body.innerText").catch(() => "");
    if (text.includes(needle)) return text;
    await sleep(500);
  }
  throw new Error(`${stage}：等待「${needle}」超时；页面文字片段：${text.slice(0, 800)}`);
}

async function waitFor(target, expression, stage, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await target.webContents.executeJavaScript(`Boolean(${expression})`).catch(() => false);
    if (ok) return;
    await sleep(400);
  }
  const text = await target.webContents.executeJavaScript("document.body.innerText").catch(() => "");
  throw new Error(`${stage}：条件超时；页面文字片段：${text.slice(0, 800)}`);
}

async function js(target, code) {
  return target.webContents.executeJavaScript(code);
}

async function clickButton(target, matcherSource) {
  const ok = await js(target, `(() => {
    const match = ${matcherSource};
    const button = [...document.querySelectorAll("button")].find(match);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!ok) throw new Error("找不到目标按钮");
}

async function clickTab(target, label) {
  const ok = await js(target, `(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => node.innerText.trim() === ${JSON.stringify(label)});
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  if (!ok) throw new Error(`找不到「${label}」tab`);
}

async function setInput(target, selector, value) {
  const ok = await js(target, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    return true;
  })()`);
  if (!ok) throw new Error(`找不到输入框：${selector}`);
  await sleep(120);
}

async function pressKeyOn(target, selector, key) {
  const ok = await js(target, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`找不到按键目标：${selector}`);
  await sleep(200);
}

async function ensureWorkbenchOpen(target) {
  await waitFor(target, `document.querySelector('button[aria-label="工作台"]')`, "等待工作台按钮");
  const expanded = await js(target, `document.querySelector('button[aria-label="工作台"]').getAttribute("aria-expanded")`);
  if (expanded !== "true") {
    await clickButton(target, `(button) => button.getAttribute("aria-label") === "工作台"`);
  }
  await waitFor(target, `[...document.querySelectorAll('[role="tab"]')].length > 0`, "打开工作台");
}

async function waitBrowser(predicate, stage, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = browserController?.state() ?? null;
    if (last && predicate(last)) return last;
    await sleep(250);
  }
  throw new Error(`${stage}：浏览器状态超时；当前 ${JSON.stringify(last)}`);
}

async function checkZoomAlignment(factor) {
  await win.webContents.setZoomFactor(factor);
  await sleep(900);
  const rect = await js(win, `(() => {
    const el = document.querySelector('[data-browser-viewport="true"]');
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  })()`);
  const expected = {
    x: Math.round(rect.x * factor),
    y: Math.round(rect.y * factor),
    width: Math.round(rect.width * factor),
    height: Math.round(rect.height * factor),
  };
  const deadline = Date.now() + 3000;
  let native = browserController.getBounds();
  while (Date.now() < deadline) {
    native = browserController.getBounds();
    if (["x", "y", "width", "height"].every((key) => Math.abs(native[key] - expected[key]) <= 3)) break;
    await sleep(150);
  }
  const mismatch = ["x", "y", "width", "height"].filter((key) => Math.abs(native[key] - expected[key]) > 3);
  if (mismatch.length) throw new Error(`zoom ${factor} bounds 错位：${JSON.stringify({ rect, expected, native })}`);
  return { factor, rect, native };
}

async function captureWithRetry(read, tries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const image = await read();
      if (image && !image.isEmpty()) return image;
    } catch (error) {
      lastError = error;
    }
    await sleep(300);
  }
  throw lastError ?? new Error("截图返回空图像");
}

async function captureWindow(fileName) {
  if (!SHOT_DIR) return null;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  win.setTitle("Maxma Workbench E2E");
  win.showInactive();
  win.webContents.setBackgroundThrottling(false);
  await sleep(1200);
  const bounds = win.getContentBounds();
  let image = null;
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: bounds.width, height: bounds.height },
      fetchWindowIcons: false,
    });
    image = sources.find((source) => source.name.includes("Maxma Workbench E2E"))?.thumbnail ?? null;
  } catch {
    // 某些桌面会话不允许窗口抓取；退回 webContents 截图，浏览器区会显示占位。
  }
  if (!image || image.isEmpty()) image = await captureWithRetry(() => win.webContents.capturePage());
  const file = path.join(SHOT_DIR, fileName);
  fs.writeFileSync(file, image.toPNG());
  return file;
}

async function captureBrowserPage(fileName) {
  if (!SHOT_DIR || !browserController) return null;
  const image = await captureWithRetry(() => browserController.capturePage());
  if (!image) return null;
  const file = path.join(SHOT_DIR, fileName);
  fs.writeFileSync(file, image.toPNG());
  return file;
}

ipcMain.handle("maxma:pick-path", async (_event, kind) => {
  if (kind !== "folder" && kind !== "file") throw new Error("bad kind");
  return { path: WORKSPACE };
});
ipcMain.handle("maxma:reveal-path", async () => undefined);
ipcMain.handle("maxma:open-path", async (_event, pathValue) => {
  assertOpenableHtml(pathValue);
  return undefined;
});

app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    title: "Maxma Workbench E2E",
    webPreferences: {
      preload: PRELOAD,
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  browserController = createBrowserController({
    getWindow: () => win,
    isTrustedSender: (event) => {
      const senderUrl = event?.senderFrame?.url ?? "";
      return senderUrl === ORIGIN || senderUrl.startsWith(`${ORIGIN}/`);
    },
    openExternal: (url) => externalUrls.push(url),
    partition: BROWSER_PARTITION,
  });
  browserController.registerIpc(ipcMain);

  const logs = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) logs.push(message);
  });
  win.webContents.on("render-process-gone", (_event, details) => logs.push("render-process-gone: " + JSON.stringify(details)));

  const result = { stage: "start", ok: false, checks: {}, consoleErrors: logs, externalUrls };
  try {
    await win.webContents.session.clearCache();
    await win.loadURL(ORIGIN + "/");
    result.stage = "loaded";
    await waitText(win, "Maxma", "等待对话页加载");
    await ensureWorkbenchOpen(win);
    result.stage = "workbench-open";
    await waitFor(win, `[...document.querySelectorAll('[role="tab"]')].some((node) => node.innerText.trim() === "文件")`, "等待文件 tab");
    await waitFor(win, `[...document.querySelectorAll('[role="tab"]')].some((node) => node.innerText.trim() === "浏览器")`, "等待浏览器 tab");

    const hasBridge = await js(win, "Boolean(window.maxmaDesktop && window.maxmaDesktop.pickPath && window.maxmaDesktop.browser)");
    if (!hasBridge) throw new Error("preload 没有暴露 pickPath/browser");

    await clickTab(win, "文件");
    await waitText(win, "还没有工作区", "切到文件面板");
    result.stage = "files-tab";

    await clickButton(win, `(button) => button.innerText.trim() === "选择文件夹"`);
    await waitText(win, "README.md", "选择工作区并列出文件");
    result.stage = "tree";

    // 目录懒加载
    await clickButton(win, `(button) => button.getAttribute("role") === "treeitem" && button.innerText.includes("src")`);
    await waitFor(win, `document.querySelector('[role="tree"]')?.innerText.includes("main.ts")`, "展开 src");
    result.checks.lazyTree = true;

    await clickButton(win, `(button) => button.innerText.includes("README.md")`);
    await waitText(win, "file pane reads this text", "预览 README");
    await waitFor(win, `document.querySelector('nav[aria-label="文件路径"]')?.innerText.includes("README.md")`, "文件面包屑");
    result.checks.breadcrumb = true;
    result.stage = "text-preview";

    const openGuard = await js(win, `window.maxmaDesktop.openPath(${JSON.stringify(path.join(WORKSPACE, "README.md"))})
      .then(() => "allowed", (error) => String(error && error.message ? error.message : error))`);
    if (openGuard === "allowed") throw new Error("openPath 未拦截非 HTML 文件");
    result.checks.openPathGuard = openGuard;

    await clickButton(win, `(button) => button.innerText.includes("main.ts")`);
    await waitText(win, "export const ok", "预览 main.ts");
    await waitFor(win, `document.querySelectorAll('button[aria-label^="关闭 "]').length >= 2`, "多文件 tab");
    result.checks.multiTab = true;

    await clickButton(win, `(button) => button.getAttribute("aria-label") === "关闭 main.ts"`);
    await waitFor(win, `document.querySelectorAll('button[aria-label^="关闭 "]').length === 1`, "关闭 tab");
    result.checks.closeTab = true;

    // 文件名过滤
    await setInput(win, 'input[placeholder="按文件名过滤…"]', "README");
    await waitFor(win, `document.querySelector('[role="tree"]')?.innerText.includes("README.md") && !document.querySelector('[role="tree"]')?.innerText.includes("notes.md")`, "文件过滤");
    await setInput(win, 'input[placeholder="按文件名过滤…"]', "");
    result.checks.filter = true;

    // 忽略项开关
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "显示忽略项"`);
    await waitFor(win, `document.querySelector('[role="tree"]')?.innerText.includes("node_modules")`, "显示忽略项");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "隐藏忽略项"`);
    result.checks.ignored = true;

    // 重命名根
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "重命名工作区"`);
    await setInput(win, 'input[aria-label="工作区名称"]', "E2E 工作区");
    await pressKeyOn(win, 'input[aria-label="工作区名称"]', "Enter");
    await waitText(win, "E2E 工作区", "重命名工作区");
    result.checks.rename = true;

    // HTML 仅源码，不注入主 DOM
    await clickButton(win, `(button) => button.innerText.includes("index.html")`);
    await waitText(win, "HTML 仅显示源码", "HTML 源码预览");
    const htmlInjected = await js(win, "window.__htmlInjected === true");
    if (htmlInjected) throw new Error("HTML 被注入主界面 DOM");
    result.checks.htmlSourceOnly = true;

    // 二进制文件不伪装成文本
    await clickButton(win, `(button) => button.innerText.includes("binary.bin")`);
    await waitText(win, "该文件不是可预览的 UTF-8 文本", "二进制预览");
    result.checks.binary = true;

    // 图片 blob 预览
    await clickButton(win, `(button) => button.innerText.includes("dot.png")`);
    await waitFor(win, `document.querySelector('img[alt="dot.png"]')`, "图片预览");
    result.checks.image = true;

    // 收掉临时预览，保留 README 作为视觉基线
    for (const label of ["dot.png", "binary.bin", "index.html"]) {
      const closed = await js(win, `(() => {
        const button = document.querySelector('button[aria-label=${JSON.stringify(`关闭 ${label}`)}]');
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!closed) throw new Error(`找不到关闭 ${label}`);
      await sleep(150);
    }
    await waitText(win, "file pane reads this text", "回到 README 预览");

    // 键盘调整宽度（分隔条聚焦后 ← 加宽 24）
    const widthBefore = await js(win, `document.querySelector('aside[aria-label="工作台"]').offsetWidth`);
    await pressKeyOn(win, '[aria-label="调整工作台宽度"]', "ArrowLeft");
    const widthAfter = await js(win, `document.querySelector('aside[aria-label="工作台"]').offsetWidth`);
    if (widthAfter <= widthBefore) throw new Error(`键盘调宽失败：${widthBefore} → ${widthAfter}`);
    result.checks.resize = { before: widthBefore, after: widthAfter };

    // 最大化覆盖工作区，恢复后回到原宽度
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "最大化工作台"`);
    await waitFor(win, `document.querySelector('aside[aria-label="工作台"]')?.getAttribute("data-maximized") === "true"`, "最大化工作台");
    const maximizeGeometry = await js(win, `(() => {
      const aside = document.querySelector('aside[aria-label="工作台"]');
      const parent = aside.parentElement;
      return { aside: aside.offsetWidth, parent: parent.clientWidth };
    })()`);
    if (maximizeGeometry.aside < maximizeGeometry.parent * 0.95) {
      throw new Error(`最大化未覆盖工作区：${JSON.stringify(maximizeGeometry)}`);
    }
    result.checks.maximize = maximizeGeometry;
    result.screenshots = result.screenshots || {};
    result.screenshots.maximized = await captureWindow("workbench-p1-maximized.png");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "还原工作台"`);
    await waitFor(win, `document.querySelector('aside[aria-label="工作台"]')?.getAttribute("data-maximized") === "false"`, "还原工作台");
    const restoredWidth = await js(win, `document.querySelector('aside[aria-label="工作台"]').offsetWidth`);
    result.checks.restoreWidth = restoredWidth;

    // 文件面板基线截图（含真实文件树/预览）
    result.screenshots.files = await captureWindow("workbench-p1-files.png");

    // 命令面板：Ctrl+P 打开，过滤并切换到浏览器
    await js(win, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }))`);
    await waitFor(win, `document.querySelector('[role="dialog"][aria-label="命令面板"]')`, "打开命令面板");
    await setInput(win, 'input[aria-label="搜索命令"]', "浏览器");
    await waitFor(win, `[...document.querySelectorAll('[role="option"]')].some((node) => node.innerText.includes("浏览器"))`, "过滤命令");
    await clickButton(win, `(button) => button.getAttribute("role") === "option" && button.innerText.includes("浏览器")`);
    await waitFor(win, `[...document.querySelectorAll('[role="tab"]')].some((node) => node.getAttribute("aria-selected") === "true" && node.innerText.trim() === "浏览器")`, "切到浏览器");
    result.stage = "browser-tab";

    // 地址栏提交到本机 health 接口，验证真实 WebContentsView 加载
    const healthUrl = ORIGIN + "/api/health";
    await setInput(win, 'input[aria-label="地址栏"]', healthUrl);
    await js(win, `document.querySelector('input[aria-label="地址栏"]').closest('form').requestSubmit()`);
    const browserState = await waitBrowser((state) => state.url.includes("/api/health") && !state.loading, "加载本机页面");
    if (!browserState.visible) throw new Error("浏览器 view 未显示");
    const addressValue = await js(win, `document.querySelector('input[aria-label="地址栏"]').value`);
    if (!addressValue.includes("/api/health")) throw new Error(`地址栏未同步：${addressValue}`);
    result.checks.browser = { url: browserState.url, visible: browserState.visible };

    // 后退/前进/刷新与系统打开
    await setInput(win, 'input[aria-label="地址栏"]', healthUrl + "?step=2");
    await js(win, `document.querySelector('input[aria-label="地址栏"]').closest('form').requestSubmit()`);
    await waitBrowser((state) => state.url.includes("step=2") && !state.loading, "第二页");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "后退"`);
    await waitBrowser((state) => state.url.includes("/api/health") && !state.url.includes("step=2"), "后退");
    await waitFor(win, `(() => { const b = document.querySelector('button[aria-label="前进"]'); return b && !b.disabled; })()`, "前进按钮可用");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "前进"`);
    await waitBrowser((state) => state.url.includes("step=2"), "前进");
    await waitFor(win, `(() => { const b = document.querySelector('button[aria-label="刷新"]'); return b && !b.disabled; })()`, "刷新按钮可用");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "刷新"`);
    await waitBrowser((state) => !state.loading, "刷新");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "在系统浏览器打开"`);
    await sleep(300);
    if (externalUrls.length === 0) throw new Error("外部打开没有触发受控回调");
    result.checks.browserNav = { externalUrls: [...externalUrls] };

    // Windows 缩放等价：webContents zoom 125%/150%，native view 必须跟着 DIP 缩放
    result.checks.zoom = [await checkZoomAlignment(1.25), await checkZoomAlignment(1.5)];
    await win.webContents.setZoomFactor(1);
    await sleep(500);

    result.screenshots.browser = await captureWindow("workbench-p1-browser.png");
    result.screenshots.browserPage = await captureBrowserPage("workbench-p1-browser-page.png");

    // 命令面板压住原生 view
    await js(win, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }))`);
    await waitFor(win, `document.querySelector('[role="dialog"][aria-label="命令面板"]')`, "浏览器上打开命令面板");
    await waitBrowser((state) => state.visible === false, "命令面板隐藏浏览器");
    await pressKeyOn(win, 'input[aria-label="搜索命令"]', "Escape");
    await waitFor(win, `!document.querySelector('[role="dialog"][aria-label="命令面板"]')`, "关闭命令面板");
    await waitBrowser((state) => state.visible === true, "关闭面板后恢复浏览器");
    result.checks.overlayHidesNative = true;

    // 切回文件页，原生 view 必须隐藏
    await clickTab(win, "文件");
    await waitBrowser((state) => state.visible === false, "切换 tab 隐藏浏览器");
    result.checks.tabHidesBrowser = true;

    // 768 窄窗不横向溢出
    win.setSize(768, 900);
    await sleep(700);
    const overflow = await js(win, `(() => {
      const aside = document.querySelector('aside[aria-label="工作台"]');
      const parent = aside?.parentElement;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        workbenchWidth: aside?.getBoundingClientRect().width ?? 0,
        parentWidth: parent?.getBoundingClientRect().width ?? 0,
        narrowOverlay: aside?.dataset.narrowOverlay === "true",
        splitter: Boolean(document.querySelector('[aria-label="调整工作台宽度"]')),
      };
    })()`);
    result.checks.narrow = overflow;
    if (overflow.scrollWidth > overflow.clientWidth + 1) {
      throw new Error(`768 窄窗横向溢出：scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`);
    }
    if (!overflow.narrowOverlay) throw new Error("768 窄窗没有切到整宽覆盖模式");
    if (Math.abs(overflow.workbenchWidth - overflow.parentWidth) > 1) {
      throw new Error(`768 窄窗工作台未占满父容器：workbench=${overflow.workbenchWidth} parent=${overflow.parentWidth}`);
    }
    if (overflow.splitter) throw new Error("768 窄窗不应再出现拖拽分隔条");
    result.screenshots.narrow = await captureWindow("workbench-p1-narrow.png");

    // 1280×900 浅色基线：刷新后工作台与根目录都应从持久化状态恢复
    win.setSize(1280, 900);
    await sleep(500);
    await js(win, `localStorage.setItem("maxma.theme", "flexoki-light")`);
    win.webContents.reload();
    await waitText(win, "Maxma", "浅色主题重载");
    await ensureWorkbenchOpen(win);
    await clickTab(win, "文件");
    await waitText(win, "README.md", "浅色文件树");
    await clickButton(win, `(button) => button.innerText.includes("README.md")`);
    await waitText(win, "file pane reads this text", "浅色 README 预览");
    const theme = await js(win, `document.documentElement.getAttribute("data-theme")`);
    if (theme !== "flexoki-light") throw new Error(`浅色主题未恢复：${theme}`);
    result.checks.lightTheme = theme;
    result.screenshots.light = await captureWindow("workbench-p1-files-light.png");

    // 纯 Web 形态：没有 preload 时不得出现文件/浏览器 tab
    const web = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: { partition: WEB_PARTITION },
    });
    await web.loadURL(ORIGIN + "/");
    await waitText(web, "Maxma", "等待纯 Web 对话页");
    await ensureWorkbenchOpen(web);
    const tabLabels = await js(web, `[...document.querySelectorAll('[role="tab"]')].map((node) => node.innerText.trim())`);
    if (tabLabels.includes("文件") || tabLabels.includes("浏览器")) throw new Error(`纯 Web 形态不应显示桌面 tab：${tabLabels.join(",")}`);
    result.checks.webTabs = tabLabels;
    result.stage = "web-no-desktop-tabs";
    web.destroy();

    result.ok = true;
    result.stage = "done";
    result.pageText = (await js(win, "document.body.innerText")).slice(0, 1600);
  } catch (error) {
    result.error = String(error?.message ?? error);
    result.pageText = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
  } finally {
    console.log("DRIVE_RESULT " + JSON.stringify(result));
    try { browserController?.destroy(); } catch { /* */ }
    try { win.destroy(); } catch { /* */ }
    app.quit();
  }
});
