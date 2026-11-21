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
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { createBrowserController } = require("../desktop/electron/browser-view.cjs");
const { startBrowserAgentServer } = require("../desktop/electron/browser-agent-server.cjs");
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
let browserAgent = null;
let browserAgentDir = "";
const externalUrls = [];
let interactivePage = null;
let interactivePageUrl = "";

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
    const button = [...document.querySelectorAll("button")]
      .filter((node) => node.getClientRects().length > 0)
      .find(match);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!ok) throw new Error(`找不到目标按钮：${matcherSource}`);
}

const WORKBENCH_PANE_IDS = {
  推理: "reasoning",
  画布: "canvas",
  文件: "files",
  变更: "changes",
  命令: "commands",
  浏览器: "browser",
  任务: "tasks",
};

async function openPaneMenu(target, triggerLabel = "添加工作台面板") {
  const matcher = triggerLabel === "switcher"
    ? `(button) => button.matches('[data-workbench-pane-switcher="true"]')`
    : `(button) => button.getAttribute("aria-label") === ${JSON.stringify(triggerLabel)}`;
  await clickButton(target, matcher);
  await waitFor(target, `document.querySelector('[role="dialog"][aria-label="工作台面板"]')`, "展开工作台面板库");
  await sleep(150);
}

async function readPaneMenu(target) {
  return js(target, `[...document.querySelectorAll('[role="dialog"][aria-label="工作台面板"] [data-workbench-pane]')]
    .map((node) => ({ id: node.dataset.workbenchPane, label: node.getAttribute("aria-label").split("：").pop() }))`);
}

async function closePaneMenu(target) {
  await clickButton(target, `(button) => button.getAttribute("aria-label") === "关闭面板列表"`);
  await waitFor(target, `!document.querySelector('[role="dialog"][aria-label="工作台面板"]')`, "关闭工作台面板库");
}

async function clickTab(target, label) {
  const paneId = WORKBENCH_PANE_IDS[label];
  if (!paneId) throw new Error(`未知工作台面板：${label}`);
  const expanded = await js(target, `document.querySelector('[data-workbench-pane-switcher="true"]')?.getAttribute("aria-expanded") ?? null`);
  if (expanded === null) throw new Error("找不到工作台面板切换器");
  if (expanded !== "true") {
    await openPaneMenu(target, "switcher");
  }
  await waitFor(target, `document.querySelector('[role="dialog"][aria-label="工作台面板"]')`, "打开工作台面板库");
  const ok = await js(target, `(() => {
    const item = document.querySelector('[role="dialog"][aria-label="工作台面板"] [data-workbench-pane="${paneId}"]');
    if (!item || item.getClientRects().length === 0) return false;
    item.click();
    return true;
  })()`);
  if (!ok) throw new Error(`面板库里没有「${label}」（${paneId}）`);
  await waitFor(
    target,
    `[...document.querySelectorAll('[role="tab"]')].some((node) => node.getAttribute("aria-selected") === "true" && node.innerText.trim() === ${JSON.stringify(label)})`,
    `切换到${label}面板`,
  );
}

async function setInput(target, selector, value) {
  const ok = await js(target, `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((node) => node.getClientRects().length > 0);
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    return true;
  })()`);
  if (!ok) throw new Error(`找不到输入框：${selector}`);
  await sleep(120);
}

async function readDesignCanvas(target) {
  return js(target, `(() => {
    const root = document.querySelector('[data-design-canvas="true"]');
    if (!root) return null;
    const stage = document.querySelectorAll('[data-design-stage="true"] canvas')[0] || null;
    const rect = stage ? stage.getBoundingClientRect() : null;
    return {
      count: Number(root.dataset.elementCount || 0),
      selectedId: root.dataset.selectedId || "",
      selectedX: root.dataset.selectedX === "" ? null : Number(root.dataset.selectedX),
      selectedY: root.dataset.selectedY === "" ? null : Number(root.dataset.selectedY),
      tool: root.dataset.tool || "",
      artboardWidth: Number(root.dataset.artboardWidth || 0),
      artboardHeight: Number(root.dataset.artboardHeight || 0),
      viewX: Number(root.dataset.viewX || 0),
      viewY: Number(root.dataset.viewY || 0),
      viewScale: Number(root.dataset.viewScale || 0),
      name: document.querySelector('input[aria-label="设计项目名称"]')?.value ?? "",
      projectName: root.dataset.projectName || "",
      stage: rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null,
    };
  })()`);
}

async function canvasPixelHash(target) {
  return js(target, `(() => {
    const canvas = document.querySelectorAll('[data-design-stage="true"] canvas')[0];
    if (!canvas) return null;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || canvas.width === 0 || canvas.height === 0) return null;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let index = 0; index < data.length; index += 16) {
      hash = (hash * 31 + data[index]) >>> 0;
    }
    return { width: canvas.width, height: canvas.height, hash };
  })()`);
}

async function dispatchCanvasMouse(target, type, x, y) {
  const ok = await js(target, `(() => {
    const canvas = document.querySelectorAll('[data-design-stage="true"] canvas')[0];
    if (!canvas) return false;
    canvas.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, {
      bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y},
      buttons: ${type === "mousedown" ? 1 : 0}, button: 0,
    }));
    return true;
  })()`);
  if (!ok) throw new Error("找不到设计画布的 Konva 画布");
  await sleep(140);
}

async function pressKeyOn(target, selector, key) {
  const ok = await js(target, `(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((node) => node.getClientRects().length > 0);
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
  await waitFor(target, `document.querySelector('[data-workbench-pane-switcher="true"]')`, "打开工作台");
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

async function agentExecute(action, args = {}) {
  const config = JSON.parse(fs.readFileSync(browserAgent.configPath, "utf8"));
  const response = await fetch(`http://127.0.0.1:${config.port}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-maxma-browser-secret": config.secret },
    body: JSON.stringify({ action, args }),
  });
  return response.json();
}

/** 真实验证：Maxma 自己的 browser_* 工具 → loopback → 原生 WebContentsView。 */
async function runBrowserToolSmoke() {
  const bun = path.join(__dirname, "..", "bun-sidecar", "bun.exe");
  const script = path.join(__dirname, "_browser-tool-smoke.mjs");
  const uploadFile = path.join(browserAgentDir, "browser-upload.txt");
  const downloadUrl = `http://127.0.0.1:${interactivePage.address().port}/download.txt`;
  fs.writeFileSync(uploadFile, "maxma browser upload", "utf8");
  return await new Promise((resolve, reject) => {
    const child = spawn(bun, [script, interactivePageUrl, uploadFile, downloadUrl], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, MAXMA_DATA_DIR: browserAgentDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`浏览器工具端到端超时；stderr=${stderr.slice(0, 1200)}`));
    }, 30_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const line = stdout.trim().split(/\r?\n/).pop() || "";
      let parsed = null;
      try { parsed = JSON.parse(line); } catch { /* handled below */ }
      if (code !== 0 || !parsed?.ok) {
        reject(new Error(`浏览器工具端到端失败 code=${code}：${line || stderr.slice(0, 1200)}`));
        return;
      }
      resolve(parsed);
    });
  });
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

  browserAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uiwb-agent-"));
  browserController = createBrowserController({
    getWindow: () => win,
    isTrustedSender: (event) => {
      const senderUrl = event?.senderFrame?.url ?? "";
      return senderUrl === ORIGIN || senderUrl.startsWith(`${ORIGIN}/`);
    },
    openExternal: (url) => externalUrls.push(url),
    partition: BROWSER_PARTITION,
    downloadsDir: path.join(browserAgentDir, "downloads"),
    policyPath: path.join(browserAgentDir, "browser-policy.json"),
  });
  browserController.registerIpc(ipcMain);
  browserAgent = startBrowserAgentServer({
    controller: browserController,
    dataDir: browserAgentDir,
    logger: { info() {}, warn() {} },
  });
  await browserAgent.start();

  // 本地交互页：只用于验收“真实输入能改变页面状态”，不依赖外网。
  interactivePage = http.createServer((request, response) => {
    if (request.url === "/download.txt") {
      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": 'attachment; filename="maxma-e2e-download.txt"',
      });
      response.end("maxma download body\n");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Maxma Native Gate</title></head>
<body>
  <h1>Maxma Native Gate</h1>
  <label for="name">Your name</label>
  <input id="name" aria-label="Your name" autocomplete="off">
  <label for="choice">Choice</label>
  <select id="choice" aria-label="Choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
  <label><input id="agree" type="checkbox" aria-label="I agree"> I agree</label>
  <button id="greet" type="button">Greet</button>
  <div id="out">Waiting</div>
  <label for="doc">Document</label>
  <input id="doc" type="file" aria-label="Document">
  <div id="fileout">No file</div>
  <div id="pad" aria-label="Drag pad" style="width:240px;height:120px;background:#d8d8d8;margin-top:12px">Drag here</div>
  <div id="dragout">No drag</div>
  <pre id="note">native pre block</pre>
  <img id="allowlist-probe" src="http://blocked.invalid/pixel.png" alt="" width="1" height="1">
  <script>
    const name = document.querySelector('#name');
    const choice = document.querySelector('#choice');
    const agree = document.querySelector('#agree');
    const out = document.querySelector('#out');
    const doc = document.querySelector('#doc');
    const fileout = document.querySelector('#fileout');
    const pad = document.querySelector('#pad');
    const dragout = document.querySelector('#dragout');
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') out.textContent = 'Enter ' + name.value;
    });
    document.querySelector('#greet').addEventListener('click', () => {
      out.textContent = 'Hello ' + name.value + ' ' + choice.value + ' ' + (agree.checked ? 'yes' : 'no');
      console.log('maxma-greeted');
    });
    doc.addEventListener('change', () => {
      fileout.textContent = 'File ' + (doc.files[0] ? doc.files[0].name : 'none');
    });
    let dragStart = null;
    pad.addEventListener('mousedown', (event) => {
      dragStart = { x: Math.round(event.offsetX), y: Math.round(event.offsetY) };
      dragout.textContent = 'Start ' + dragStart.x + ',' + dragStart.y;
    });
    pad.addEventListener('mousemove', (event) => {
      if (!dragStart) return;
      dragout.textContent = 'Drag ' + dragStart.x + ',' + dragStart.y + ' -> ' + Math.round(event.offsetX) + ',' + Math.round(event.offsetY);
    });
    document.addEventListener('mouseup', () => { dragStart = null; });
  </script>
</body></html>`);
  });
  await new Promise((resolve) => interactivePage.listen(0, "127.0.0.1", resolve));
  interactivePageUrl = `http://127.0.0.1:${interactivePage.address().port}/`;

  const logs = [];
  const ignoredWarnings = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level < 2) return;
    // Chromium 在 CodeMirror / 滚动的 ResizeObserver 里会发这条良性循环警告；
    // 单独记录，不混进真正的错误门禁。
    if (message.startsWith("ResizeObserver loop completed with undelivered notifications")) {
      ignoredWarnings.push(message);
      return;
    }
    logs.push(message);
  });
  win.webContents.on("render-process-gone", (_event, details) => logs.push("render-process-gone: " + JSON.stringify(details)));

  const result = { stage: "start", ok: false, checks: {}, screenshots: {}, consoleErrors: logs, ignoredWarnings, externalUrls };
  try {
    await win.webContents.session.clearCache();
    await win.loadURL(ORIGIN + "/");
    result.stage = "loaded";
    await waitText(win, "Maxma", "等待对话页加载");

    // P3 浏览器 Agent：未打开浏览器 tab 时也能创建一个隐藏 view 完成加载/读取，
    // 且绝不能突然盖住聊天区。
    const agentHealth = ORIGIN + "/api/health";
    const agentOpen = await agentExecute("open", { url: agentHealth });
    if (!agentOpen.ok || !String(agentOpen.result?.url ?? "").includes("/api/health")) {
      throw new Error("浏览器 Agent 隐藏打开失败：" + JSON.stringify(agentOpen));
    }
    const hiddenState = await waitBrowser((state) => state.url.includes("/api/health") && !state.loading, "Agent 隐藏加载");
    if (hiddenState.visible) throw new Error("Agent 擅自显示了浏览器原生 view");
    result.checks.agentHiddenView = { url: hiddenState.url, visible: hiddenState.visible };

    await win.webContents.executeJavaScript("(() => { window.confirm = () => true; return true; })()");
    await ensureWorkbenchOpen(win);
    result.stage = "workbench-open";
    await waitFor(win, `document.querySelector('[data-workbench-pane-switcher="true"]')`, "等待面板切换器");
    await openPaneMenu(win);
    const desktopPanes = await readPaneMenu(win);
    const desktopPaneIds = desktopPanes.map((pane) => pane.id);
    if (!desktopPaneIds.includes("files") || !desktopPaneIds.includes("browser")) {
      throw new Error("工作台面板库缺少桌面 Pane：" + JSON.stringify(desktopPanes));
    }
    const expectedDesktopOrder = ["reasoning", "tasks", "canvas", "files", "changes", "commands", "browser"];
    if (JSON.stringify(desktopPaneIds) !== JSON.stringify(expectedDesktopOrder)) {
      throw new Error(`工作台面板顺序不符：${JSON.stringify(desktopPaneIds)}`);
    }
    result.checks.paneMenu = desktopPanes;
    result.screenshots.paneMenu = await captureWindow("workbench-pane-picker.png");
    await closePaneMenu(win);

    const hasBridge = await js(win, "Boolean(window.maxmaDesktop && window.maxmaDesktop.pickPath && window.maxmaDesktop.browser)");
    if (!hasBridge) throw new Error("preload 没有暴露 pickPath/browser");

    // ── 设计画布：真实画板、文字、变换、图层、预设、导出回对话 ─────
    result.stage = "design-canvas";
    await clickTab(win, "画布");
    await waitFor(win, `document.querySelector('[data-design-canvas="true"]')`, "进入设计画布");
    const designInitial = await readDesignCanvas(win);
    if (!designInitial?.stage) throw new Error("设计画布没有挂载 Konva 画布：" + JSON.stringify(designInitial));
    if (designInitial.count !== 0) throw new Error(`新画布不应带元素：${designInitial.count}`);
    if (designInitial.artboardWidth !== 1080 || designInitial.artboardHeight !== 1080) {
      throw new Error(`默认画板尺寸不符：${designInitial.artboardWidth}×${designInitial.artboardHeight}`);
    }
    result.screenshots.designBlank = await captureWindow("workbench-design-canvas-blank.png");

    await setInput(win, 'input[aria-label="设计项目名称"]', "E2E 设计画布");
    await js(win, `(() => { document.querySelector('input[aria-label="设计项目名称"]')?.blur(); return true; })()`);
    const afterRename = await readDesignCanvas(win);
    if (afterRename?.projectName !== "E2E 设计画布") {
      throw new Error(`重命名未提交：${JSON.stringify(afterRename)} input=${await js(win, `document.querySelector('input[aria-label="设计项目名称"]')?.value ?? null`)}`);
    }

    const pointAt = (state, rx, ry) => ({
      x: state.stage.x + state.viewX + state.artboardWidth * state.viewScale * rx,
      y: state.stage.y + state.viewY + state.artboardHeight * state.viewScale * ry,
    });

    const hashBlank = await canvasPixelHash(win);
    if (!hashBlank?.hash) throw new Error("空白画布像素读取失败");

    await clickButton(win, `(button) => button.getAttribute("aria-label") === "文字（T）"`);
    await waitFor(win, `document.querySelector('[data-design-canvas="true"]')?.dataset.tool === "text"`, "选中文字工具");
    const center = pointAt(designInitial, 0.5, 0.5);
    await dispatchCanvasMouse(win, "mousedown", center.x, center.y);
    await dispatchCanvasMouse(win, "mouseup", center.x, center.y);
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.elementCount || 0) === 1`, "文字落到画板");
    const afterTextAdd = await readDesignCanvas(win);
    if (!afterTextAdd.selectedId) throw new Error("新增文字后没有自动选中");

    await clickButton(win, `(button) => button.getAttribute("aria-label") === "属性"`);
    await waitFor(win, `document.querySelector('textarea[aria-label="画布文字内容"]')`, "打开属性面板");

    await setInput(win, 'textarea[aria-label="画布文字内容"]', "Maxma 设计画布 E2E");
    await waitFor(win, `document.querySelector('textarea[aria-label="画布文字内容"]')?.value === "Maxma 设计画布 E2E"`, "修改画布文字");
    await sleep(600);
    const hashText = await canvasPixelHash(win);
    if (!hashText || hashText.hash === hashBlank.hash) {
      throw new Error(`文字没有改变画板像素：${hashBlank.hash} → ${hashText?.hash}`);
    }

    const beforeX = (await readDesignCanvas(win)).selectedX;
    await setInput(win, 'input[aria-label="Y"]', "80");
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.selectedY || 0) === 80`, "属性面板改 Y");
    await setInput(win, 'input[aria-label="X"]', "40");
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.selectedX || 0) === 40`, "属性面板改 X");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "撤销"`);
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.selectedX || 0) !== 40`, "撤销回退 X");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "重做"`);
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.selectedX || 0) === 40`, "重做恢复 X");
    result.checks.designUndoRedo = { beforeX, applied: 40, undo: true, redo: true };

    await clickButton(win, `(button) => button.getAttribute("aria-label") === "关闭侧栏"`);
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "矩形（R）"`);
    await waitFor(win, `document.querySelector('[data-design-canvas="true"]')?.dataset.tool === "rect"`, "选中矩形工具");
    const rectStart = pointAt(designInitial, 0.08, 0.55);
    const rectEnd = pointAt(designInitial, 0.35, 0.72);
    await dispatchCanvasMouse(win, "mousedown", rectStart.x, rectStart.y);
    await dispatchCanvasMouse(win, "mousemove", rectEnd.x, rectEnd.y);
    await sleep(260);
    await js(win, `(() => {
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, pointerId: 1, pointerType: "mouse",
        clientX: ${rectEnd.x}, clientY: ${rectEnd.y},
      }));
      return true;
    })()`);
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.elementCount || 0) === 2`, "拖框创建矩形");

    await js(win, `(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d");
      context.fillStyle = "#2F5D7C";
      context.fillRect(0, 0, 320, 180);
      context.fillStyle = "#F7F3EA";
      context.beginPath();
      context.arc(58, 90, 32, 0, Math.PI * 2);
      context.fill();
      context.font = "600 28px sans-serif";
      context.fillText("素材画布", 104, 100);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "canvas-material.png", { type: "image/png" }));
      const stage = document.querySelector('[data-design-stage="true"]');
      stage.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      stage.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      return true;
    })()`);
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.elementCount || 0) === 3`, "拖入图片素材");

    await clickButton(win, `(button) => button.getAttribute("aria-label") === "图层"`);
    await waitFor(win, `document.querySelector('[data-design-canvas="true"] aside')?.innerText.includes("图片")`, "图片素材进入图层");
    await waitFor(win, `document.querySelector('[data-design-canvas="true"] aside')?.innerText.includes("矩形")`, "图层列表出现矩形");
    const layers = await js(win, `({
      text: document.querySelector('[data-design-canvas="true"] aside')?.innerText ?? "",
      buttons: [...document.querySelectorAll('[data-design-canvas="true"] aside button[aria-label="上移一层"]')].length,
    })`);
    if (!layers.text.includes("Maxma 设计画布 E2E") || !layers.text.includes("图片") || layers.buttons !== 3) {
      throw new Error(`图层列表不完整：${JSON.stringify(layers)}`);
    }
    result.screenshots.design = await captureWindow("workbench-design-canvas.png");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "关闭侧栏"`);
    result.screenshots.designEditor = await captureWindow("workbench-design-canvas-editor.png");

    await clickButton(win, `(button) => button.getAttribute("aria-label") === "画板尺寸预设"`);
    await waitFor(win, `document.querySelector('[role="menu"][aria-label="画板尺寸预设"]')`, "打开画板预设");
    await clickButton(win, `(button) => button.getAttribute("role") === "menuitemradio" && button.innerText.includes("A4 海报")`);
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.artboardHeight || 0) === 1754`, "切换 A4 画板");
    const a4 = await readDesignCanvas(win);
    if (a4.artboardWidth !== 1240 || a4.count !== 3) throw new Error(`A4 预设未保留元素：${JSON.stringify(a4)}`);
    await sleep(500);
    result.screenshots.designA4 = await captureWindow("workbench-design-canvas-a4.png");

    // ── Agent 接管：同一会话的全局桥直接改真实画布，整批只压一条撤销 ─────
    await waitFor(win, `Boolean(window.__maxmaCanvasAgent)`, "画布 Agent 桥注册");
    const agentImageDataUrl = await js(win, `(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d");
      context.fillStyle = "#2F5D7C";
      context.fillRect(0, 0, 320, 180);
      context.fillStyle = "#F7F3EA";
      context.font = "600 28px sans-serif";
      context.fillText("Agent 素材", 24, 100);
      return canvas.toDataURL("image/png");
    })()`);
    const agentApply = await js(win, `window.__maxmaCanvasAgent.execute('apply', ${JSON.stringify({
      operations: [
        { op: "rename", name: "Agent 接管画布" },
        { op: "preset", preset: "社媒方图" },
        { op: "clear" },
        {
          op: "add_text",
          text: "Maxma 自己接管画布",
          x: 80, y: 120, width: 920, height: 260,
          name: "Agent 标题", fontSize: 72, fontWeight: 700, color: "#16181D",
        },
        {
          op: "add_shape", shape: "rect",
          x: 80, y: 520, width: 540, height: 260,
          name: "Agent 色块", fill: "#C96F4A", radius: 28,
        },
        {
          op: "add_image",
          dataUrl: agentImageDataUrl,
          fileName: "agent-material.png",
          name: "Agent 素材",
          x: 660, y: 520, width: 340, height: 260,
          fit: "cover",
        },
      ],
    })})`);
    if (!agentApply?.ok) throw new Error(`Agent 画布编辑失败：${JSON.stringify(agentApply)}`);
    await waitFor(win, `document.querySelector('[data-design-canvas="true"]')?.dataset.projectName === "Agent 接管画布"`, "Agent 改项目名");
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.elementCount || 0) === 3`, "Agent 重建三个元素");
    const agentRead = await js(win, `window.__maxmaCanvasAgent.execute('read')`);
    if (!agentRead?.ok || agentRead.result?.elementCount !== 3) {
      throw new Error(`Agent 读画布不符：${JSON.stringify(agentRead)}`);
    }
    if (!String(agentRead.result?.elements?.[0]?.text ?? "").includes("Maxma 自己接管画布")) {
      throw new Error(`Agent 读不到新建文字：${JSON.stringify(agentRead.result?.elements?.[0])}`);
    }
    if (agentRead.result?.elements?.[2]?.type !== "image" || !agentRead.result?.elements?.[2]?.assetId) {
      throw new Error(`Agent 图片没有落成画布元素：${JSON.stringify(agentRead.result?.elements?.[2])}`);
    }
    result.screenshots.designAgent = await captureWindow("workbench-design-canvas-agent.png");

    await clickButton(win, `(button) => button.getAttribute("aria-label") === "撤销"`);
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.artboardHeight || 0) === 1754 && Number(document.querySelector('[data-design-canvas="true"]')?.dataset.elementCount || 0) === 3`, "Agent 整批操作只回退一层");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "重做"`);
    await waitFor(win, `document.querySelector('[data-design-canvas="true"]')?.dataset.projectName === "Agent 接管画布" && Number(document.querySelector('[data-design-canvas="true"]')?.dataset.elementCount || 0) === 3`, "重做恢复 Agent 构图");

    const agentExport = await js(win, `window.__maxmaCanvasAgent.execute('export', { toChat: true })`);
    if (!agentExport?.ok || agentExport.result?.queuedForChat !== true) {
      throw new Error(`Agent 导出失败：${JSON.stringify({ ok: agentExport?.ok, error: agentExport?.error })}`);
    }
    await waitText(win, "Agent接管画布.png", "Agent 导出图进入对话输入框", 60_000);
    await waitFor(win, `Boolean(document.querySelector('[data-design-canvas="true"]'))`, "Agent 导出后画布仍在");

    // 回到手动路径的 A4 基线，后续“发到对话”与刷新持久化断言保持不变。
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "撤销"`);
    await waitFor(win, `document.querySelector('[data-design-canvas="true"]')?.dataset.projectName === "E2E 设计画布" && Number(document.querySelector('[data-design-canvas="true"]')?.dataset.artboardHeight || 0) === 1754 && Number(document.querySelector('[data-design-canvas="true"]')?.dataset.elementCount || 0) === 3`, "回到 A4 手动基线");

    await clickButton(win, `(button) => button.getAttribute("aria-label") === "发到对话"`);
    await waitText(win, "已发到对话输入框", "画布导出并发回对话", 60_000);
    await waitText(win, "截图已加入对话", "对话输入框收到画布图片", 60_000);
    await waitText(win, "E2E设计画布.png", "对话引用里出现画布文件名", 60_000);
    result.checks.designCanvas = {
      blank: { width: designInitial.artboardWidth, height: designInitial.artboardHeight, count: 0, hash: hashBlank.hash },
      text: { count: afterTextAdd.count, selected: Boolean(afterTextAdd.selectedId), hash: hashText.hash },
      shape: { count: 2, layers: layers.buttons, text: layers.text.slice(0, 200) },
      image: { count: 3, layerPresent: layers.text.includes("图片") },
      presetA4: { width: a4.artboardWidth, height: a4.artboardHeight, count: a4.count },
      agent: {
        applied: agentApply.ok,
        readCount: agentRead.result?.elementCount,
        exported: agentExport.result?.name,
        queuedForChat: agentExport.result?.queuedForChat === true,
        batchUndo: true,
        redo: true,
      },
      exportedToChat: true,
    };

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

    // ── P1 收口：后端递归搜索 ─────────────────────────────
    await setInput(win, 'input[placeholder="按文件名过滤…"]', "main");
    await waitFor(win, `(() => {
      const text = document.querySelector('[role="tree"]')?.innerText ?? "";
      return text.includes("main.ts") && !text.includes("递归搜索中");
    })()`, "递归搜索结果");
    await waitText(win, "递归搜索", "递归搜索结果提示");
    result.checks.search = await js(win, `({
      tree: document.querySelector('[role="tree"]')?.innerText ?? "",
      hint: [...document.querySelectorAll("p")].find((node) => node.innerText.includes("递归搜索"))?.innerText ?? "",
    })`);
    await setInput(win, 'input[placeholder="按文件名过滤…"]', "");

    // ── P2 编辑器：CodeMirror、dirty、Ctrl+S 原子保存 ───────
    await clickButton(win, `(button) => button.innerText.trim() === "编辑"`);
    await waitFor(win, `document.querySelector('.cm-content')`, "进入编辑模式");
    await js(win, `(() => { const el = document.querySelector('.cm-content'); el.focus(); return true; })()`);
    win.webContents.insertText("<!--maxma-editor-smoke-->\n");
    await waitFor(win, `document.querySelector('.cm-content')?.innerText.includes("maxma-editor-smoke")`, "输入编辑内容");
    await waitFor(win, `(() => { const b = document.querySelector('button[aria-label="保存文件"]'); return b && !b.disabled; })()`, "dirty 保存按钮可用");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "保存文件"`);
    let saved = "";
    const saveDeadline = Date.now() + 4000;
    while (Date.now() < saveDeadline) {
      saved = fs.readFileSync(path.join(WORKSPACE, "README.md"), "utf8");
      if (saved.includes("maxma-editor-smoke")) break;
      await sleep(250);
    }
    if (!saved.includes("maxma-editor-smoke")) throw new Error("编辑器保存没有落到磁盘");
    await waitText(win, "已保存", "保存成功提示");
    result.checks.editor = { saved: true, bytes: Buffer.byteLength(saved), mode: "codemirror" };

    // ── 架构验收：关闭工作台/切走 tab 都不许丢未保存草稿 ─────
    await js(win, `(() => { const el = document.querySelector('.cm-content'); el.focus(); return true; })()`);
    win.webContents.insertText("<!--maxma-keepalive-->\n");
    await waitFor(win, `document.querySelector('.cm-content')?.innerText.includes("maxma-keepalive")`, "输入未保存草稿");
    await waitFor(win, `(() => { const b = document.querySelector('button[aria-label="保存文件"]'); return b && !b.disabled; })()`, "草稿 dirty");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "关闭工作台"`);
    await waitFor(win, `document.querySelector('aside[aria-label="工作台"]')?.classList.contains("hidden")`, "工作台关闭只隐藏");
    await ensureWorkbenchOpen(win);
    await waitFor(win, `document.querySelector('.cm-content')?.innerText.includes("maxma-keepalive")`, "重开工作台后草稿仍在");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "保存文件"`);
    let keepSaved = "";
    const keepDeadline = Date.now() + 5000;
    while (Date.now() < keepDeadline) {
      keepSaved = fs.readFileSync(path.join(WORKSPACE, "README.md"), "utf8");
      if (keepSaved.includes("maxma-keepalive")) break;
      await sleep(250);
    }
    if (!keepSaved.includes("maxma-keepalive")) throw new Error("keep-alive 草稿没有保存成功");
    result.checks.paneKeepAlive = { draftPreserved: true, closedHidden: true, saved: true };

    result.screenshots.editor = await captureWindow("workbench-p2-editor.png");

    // ── P2 命令运行器：默认关闭、显式启用、真实执行 ─────────
    await clickTab(win, "命令");
    await waitText(win, "命令运行器默认关闭", "命令运行器默认关闭");
    await clickButton(win, `(button) => button.innerText.includes("启用命令运行器")`);
    await waitFor(win, `document.querySelector('input[aria-label="命令"]')`, "启用命令运行器");
    await setInput(win, 'input[aria-label="命令"]', "echo maxma-command-ok");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "运行命令"`);
    await waitText(win, "maxma-command-ok", "命令真实输出");
    await waitText(win, "exit 0", "命令退出码");
    result.checks.commandRunner = await js(win, `({
      output: [...document.querySelectorAll("pre")].map((node) => node.innerText).join("\\n"),
      enabled: Boolean(document.querySelector('input[aria-label="命令"]')),
    })`);
    result.screenshots.commands = await captureWindow("workbench-p2-commands.png");

    // ── P2 变更/diff + P3 Git 写：暂存、diff、提交、不 push ──
    await clickTab(win, "变更");
    await waitText(win, "README.md", "变更面板列出 README");
    await waitText(win, "src/main.ts", "变更面板列出 main.ts");
    await clickButton(win, `(button) => button.innerText.includes("README.md")`);
    await waitText(win, "maxma-editor-smoke", "diff 显示编辑内容");
    result.checks.diff = await js(win, `({
      header: [...document.querySelectorAll("span")].map((node) => node.innerText).find((text) => text.includes("已修改")) ?? "",
      patch: [...document.querySelectorAll("pre")].map((node) => node.innerText).join("\\n").slice(0, 500),
    })`);
    result.screenshots.changes = await captureWindow("workbench-p2-changes.png");
    await clickButton(win, `(button) => button.innerText.trim() === "全部暂存"`);
    await waitText(win, "已暂存到索引", "暂存到索引");
    await setInput(win, 'input[aria-label="提交信息"]', "UI acceptance commit");
    await clickButton(win, `(button) => button.innerText.trim() === "提交"`);
    await waitText(win, "已提交", "本地提交");
    await waitText(win, "工作区是干净的", "提交后工作区干净");
    const gitSubject = execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: WORKSPACE, encoding: "utf8" }).trim();
    const gitStatus = execFileSync("git", ["status", "--porcelain"], { cwd: WORKSPACE, encoding: "utf8" }).trim();
    if (gitSubject !== "UI acceptance commit") throw new Error(`提交信息不符：${gitSubject}`);
    if (gitStatus) throw new Error(`提交后仍有未提交变更：${gitStatus}`);
    result.checks.gitWrite = { subject: gitSubject, clean: true, pushed: false };

    // ── P2 任务/计划面板：复用现有状态，无第二套模型 ─────────
    await clickTab(win, "任务");
    await waitText(win, "还没有任务或计划", "任务面板空态");
    result.checks.tasks = true;
    result.screenshots.tasks = await captureWindow("workbench-p3-tasks.png");

    // 命令面板：Ctrl+P 打开，过滤并切换到浏览器
    await js(win, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }))`);
    await waitFor(win, `document.querySelector('[role="dialog"][aria-label="命令面板"]')`, "打开命令面板");
    await setInput(win, 'input[aria-label="搜索命令"]', "浏览器");
    await waitFor(win, `[...document.querySelectorAll('[role="option"]')].some((node) => node.innerText.includes("浏览器"))`, "过滤命令");
    await clickButton(win, `(button) => button.getAttribute("role") === "option" && button.innerText.includes("浏览器")`);
    await waitFor(win, `[...document.querySelectorAll('[role="tab"]')].some((node) => node.getAttribute("aria-selected") === "true" && node.innerText.trim() === "浏览器")`, "切到浏览器");
    result.stage = "browser-tab";

    // BrowserPane 是懒加载 chunk；命令面板切过来后要等地址栏真正挂载，不能
    // 只凭 tab aria-selected 就假设组件已经渲染完成。
    await waitFor(win, `document.querySelector('input[aria-label="地址栏"]')`, "等待浏览器地址栏挂载");
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

    // ── P3 浏览器 Agent：snapshot / screenshot / 错误动作 ────
    const agentSnapshot = await agentExecute("snapshot");
    if (!agentSnapshot.ok || typeof agentSnapshot.result?.text !== "string" || !agentSnapshot.result.text.trim()) {
      throw new Error("浏览器 Agent snapshot 失败：" + JSON.stringify(agentSnapshot).slice(0, 500));
    }
    const agentShot = await agentExecute("screenshot");
    const shotBytes = typeof agentShot.result?.data === "string" ? Buffer.from(agentShot.result.data, "base64").length : 0;
    if (!agentShot.ok || shotBytes < 2000) {
      throw new Error(`浏览器 Agent 截图失败：${shotBytes} bytes ${JSON.stringify(agentShot).slice(0, 600)}`);
    }
    const agentUnknown = await agentExecute("rm-rf");
    if (agentUnknown.ok) throw new Error("浏览器 Agent 接受了未知动作");
    result.checks.browserAgent = {
      snapshotChars: agentSnapshot.result.text.length,
      screenshotBytes: shotBytes,
      unknownRejected: String(agentUnknown.error ?? ""),
      elements: Array.isArray(agentSnapshot.result.elements) ? agentSnapshot.result.elements.length : 0,
    };

    // ── 工具端到端：Maxma browser_* 工具 → 本机端点 → 原生 view ───
    // CDP/原生键盘事件需要一个有焦点的宿主窗口；测试机窗口可能被终端盖住，
    // 先显式把窗口提到前台并聚焦，再走真实键盘输入，避免把环境失焦误判成产品失败。
    win.setAlwaysOnTop(true, "floating");
    win.show();
    win.moveTop();
    win.focus();
    await sleep(300);
    result.checks.smokeFocus = {
      window: win.isFocused(),
      webContents: win.webContents.isFocused(),
      alwaysOnTop: win.isAlwaysOnTop(),
    };
    const browserTools = await runBrowserToolSmoke();
    win.setAlwaysOnTop(false);
    result.checks.browserToolE2E = browserTools;

    // ── 多页签 UI：新建、切回、关闭，原生 view 只显示 active 页签 ──
    result.stage = "browser-tabs-ui";
    result.checks.browserUiBeforeTabs = await js(win, `(() => ({
      newTab: document.querySelectorAll('button[aria-label="新建浏览器页签"]').length,
      newTabVisible: [...document.querySelectorAll('button[aria-label="新建浏览器页签"]')].some((node) => node.getClientRects().length > 0),
      newTabDisabled: document.querySelector('button[aria-label="新建浏览器页签"]')?.disabled ?? null,
      tabLabels: [...document.querySelectorAll('[aria-label="浏览器页签"] [role="tab"]')].map((node) => node.innerText.trim()),
      addressVisible: [...document.querySelectorAll('input[aria-label="地址栏"]')].some((node) => node.getClientRects().length > 0),
      bodyText: document.querySelector('[aria-label="浏览器页面区域"]')?.innerText.slice(0, 80) ?? null,
    }))()`);
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "新建浏览器页签"`);
    const twoTabs = await waitBrowser((state) => state.tabs.length === 2, "新建第二个浏览器页签");
    await setInput(win, 'input[aria-label="地址栏"]', healthUrl + "?tab=2");
    await js(win, `document.querySelector('input[aria-label="地址栏"]').closest('form').requestSubmit()`);
    await waitBrowser((state) => state.tabs.length === 2 && state.url.includes("tab=2") && !state.loading, "第二页签加载");
    const browserTabLabels = await js(win, `[...document.querySelectorAll('[aria-label="浏览器页签"] [role="tab"]')].map((node) => node.innerText.trim())`);
    if (browserTabLabels.length !== 2) throw new Error(`浏览器页签数量不是 2：${JSON.stringify(browserTabLabels)}`);
    // 面板库是 React 浮层：原生 WebContentsView 必须临时隐藏，否则会盖住菜单。
    await openPaneMenu(win, "switcher");
    await waitBrowser((state) => state.visible === false, "面板库隐藏原生浏览器");
    result.screenshots.paneMenuBrowser = await captureWindow("workbench-pane-picker-browser.png");
    await closePaneMenu(win);
    await waitBrowser((state) => state.visible === true, "关闭面板库恢复原生浏览器");
    result.checks.pickerHidesNative = { hiddenWhileOpen: true, restoredAfterClose: true };
    const switched = await js(win, `(() => {
      const first = document.querySelector('[aria-label="浏览器页签"] [role="tab"]');
      if (!first) return false;
      first.click();
      return true;
    })()`);
    if (!switched) throw new Error("无法点击第一个浏览器页签");
    await waitBrowser((state) => state.activeTabId === "tab-1" && !state.url.includes("tab=2"), "切回第一个页签");
    result.screenshots.browserTabs = await captureWindow("workbench-p1-browser-tabs.png");
    const closeSecond = await js(win, `(() => {
      const buttons = [...document.querySelectorAll('button[aria-label^="关闭页签"]')];
      if (buttons.length < 2) return false;
      buttons[1].click();
      return true;
    })()`);
    if (!closeSecond) throw new Error("找不到第二个页签的关闭按钮");
    await waitBrowser((state) => state.tabs.length === 1, "关闭第二个页签");
    result.checks.browserTabs = {
      before: 1,
      afterNew: twoTabs.tabs.length,
      labels: browserTabLabels,
      afterClose: 1,
    };

    // 下载面板：工具产生的下载记录必须由 UI 读到，打开面板时原生 view 隐藏。
    result.stage = "browser-downloads-panel";
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "浏览器下载"`);
    await waitText(win, browserTools.downloadName, "下载面板显示文件名");
    await waitBrowser((state) => state.visible === false, "下载面板隐藏原生浏览器");
    result.screenshots.browserDownloads = await captureWindow("workbench-p1-browser-downloads.png");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "关闭下载面板"`);
    await waitBrowser((state) => state.visible === true, "关闭下载面板恢复浏览器");
    result.checks.browserDownloads = {
      name: browserTools.downloadName,
      bytes: browserTools.downloadBytes,
      panel: true,
    };

    // 网络 allowlist：先验证白名单 UI 可打开，再用真实请求验证主请求与子资源拦截。
    result.stage = "browser-allowlist-panel";
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "网络 allowlist"`);
    await waitText(win, "网络 allowlist", "网络 allowlist 面板");
    result.screenshots.browserAllowlist = await captureWindow("workbench-p1-browser-allowlist.png");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "取消网络设置"`);
    await waitBrowser((state) => state.visible === true, "关闭 allowlist 面板恢复浏览器");

    const blockedOpen = await agentExecute("open", { url: interactivePageUrl });    if (!blockedOpen.ok) throw new Error("默认 all 模式下本地页被拦截：" + JSON.stringify(blockedOpen));
    result.checks.networkAllowlistDefault = "allowed";

    browserController.setNetworkPolicy({ mode: "allowlist", domains: ["example.com"] });
    const deniedOpen = await agentExecute("open", { url: interactivePageUrl });
    if (deniedOpen.ok || !String(deniedOpen.error ?? "").includes("网络 allowlist")) {
      throw new Error("allowlist 没有拒绝白名单外的主请求：" + JSON.stringify(deniedOpen));
    }
    result.checks.networkAllowlistMain = deniedOpen.error;

    browserController.setNetworkPolicy({ mode: "allowlist", domains: ["127.0.0.1"] });
    const allowedLocal = await agentExecute("open", { url: interactivePageUrl });
    if (!allowedLocal.ok) throw new Error("allowlist 误拦了白名单内主请求：" + JSON.stringify(allowedLocal));
    await sleep(700);
    const blockedState = browserController.state();
    if (!blockedState.network.blocked.some((item) => item.host === "blocked.invalid")) {
      throw new Error("allowlist 没有拦截页面子资源：" + JSON.stringify(blockedState.network.blocked));
    }
    result.checks.networkAllowlistSubresource = blockedState.network.blocked[0];
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "网络 allowlist"`);
    await waitBrowser((state) => state.visible === false, "拦截后打开 allowlist 面板");
    result.screenshots.browserAllowlistBlocked = await captureWindow("workbench-p1-browser-allowlist-blocked.png");
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "取消网络设置"`);
    await waitBrowser((state) => state.visible === true, "关闭 allowlist 面板");
    browserController.setNetworkPolicy({ mode: "all", domains: [] });
    result.checks.networkAllowlistReset = browserController.state().network.mode;

    // 注意：上一个 allowlist 测试把当前页切回了交互页；截图/拾取测试继续使用它。

    // ── P3 截图标注：真实截图 → 画框 → 上传为对话图片附件 ─────
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "截图并标注"`);
    await waitFor(win, `document.querySelector('[role="dialog"][aria-label="截图标注"] canvas')`, "打开截图标注");
    await waitBrowser((state) => state.visible === false, "标注时隐藏原生浏览器");
    // Esc 关闭：先验证只关闭标注层，再重新打开继续下面的绘制。
    await js(win, `(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; })()`);
    await waitFor(win, `!document.querySelector('[role="dialog"][aria-label="截图标注"]')`, "Esc 关闭截图标注");
    result.checks.annotatorEscape = true;
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "截图并标注"`);
    await waitFor(win, `document.querySelector('[role="dialog"][aria-label="截图标注"] canvas')`, "重新打开截图标注");
    await waitBrowser((state) => state.visible === false, "重新标注时隐藏原生浏览器");
    const canvasBefore = await js(win, `(() => {
      const canvas = document.querySelector('[role="dialog"][aria-label="截图标注"] canvas');
      window.__annotChecksum = () => {
        const probe = document.createElement("canvas");
        probe.width = canvas.width;
        probe.height = canvas.height;
        const context = probe.getContext("2d", { willReadFrequently: true });
        context.drawImage(canvas, 0, 0);
        const data = context.getImageData(0, 0, probe.width, probe.height).data;
        let hash = 0;
        // 全通道哈希：只取 R 通道时，红色文字落在白底上 R 不变，
        // 会误判“没有改变像素”。必须把 G/B/A 一起算进来。
        for (let index = 0; index < data.length; index += 1) hash = (hash * 31 + data[index]) >>> 0;
        return hash;
      };
      return window.__annotChecksum();
    })()`);
    await js(win, `(() => {
      const canvas = document.querySelector('[role="dialog"][aria-label="截图标注"] canvas');
      const rect = canvas.getBoundingClientRect();
      const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y,
      }));
      fire("pointerdown", rect.left + 24, rect.top + 24);
      fire("pointermove", rect.left + Math.min(160, rect.width - 24), rect.top + Math.min(120, rect.height - 24));
      fire("pointerup", rect.left + Math.min(160, rect.width - 24), rect.top + Math.min(120, rect.height - 24));
      return true;
    })()`);
    await sleep(350);
    const rectChecksum = await js(win, `window.__annotChecksum()`);
    if (rectChecksum === canvasBefore) throw new Error(`矩形没有改变像素：${canvasBefore} → ${rectChecksum}`);    // 文字工具：prompt 由测试替换，点击画布落下文字标注。
    await clickButton(win, `(button) => button.innerText.trim() === "文字"`);
    await waitFor(win, `[...document.querySelectorAll('button[aria-pressed="true"]')].some((node) => node.innerText.trim() === "文字")`, "选中文字工具");
    result.checks.annotatorPrompt = await js(win, `(() => {
      const original = window.prompt;
      window.prompt = () => "E2E 标注文字";
      return { replaced: window.prompt !== original, sample: window.prompt("probe") };
    })()`);
    await js(win, `(() => { window.prompt = () => "E2E 标注文字"; return true; })()`);
    await js(win, `(() => {
      const canvas = document.querySelector('[role="dialog"][aria-label="截图标注"] canvas');
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, pointerId: 2, pointerType: "mouse",
        clientX: rect.left + 40, clientY: rect.top + 160,
      }));
      return true;
    })()`);
    await sleep(250);
    const annotatorState = await js(win, `(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="截图标注"]');
      const undo = [...document.querySelectorAll('button')].find((node) => node.innerText.trim() === "撤销");
      return { tool: dialog?.dataset.tool, shapeCount: Number(dialog?.dataset.shapeCount || 0), undoEnabled: Boolean(undo && !undo.disabled) };
    })()`);
    result.checks.annotatorState = annotatorState;
    if (annotatorState.tool !== "text") throw new Error(`文字工具未选中：${JSON.stringify(annotatorState)}`);
    if (annotatorState.shapeCount < 2) throw new Error(`文字标注没有进入形状栈：${JSON.stringify(annotatorState)}`);
    const textShapeAdded = annotatorState.undoEnabled;
    if (!textShapeAdded) throw new Error("文字标注没有进入撤销栈");
    const undoEnabled = await js(win, `(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.innerText.trim() === "撤销");
      return Boolean(button && !button.disabled);
    })()`);
    if (!undoEnabled) throw new Error("标注形状没有进入撤销栈（指针事件未生效）");
    const canvasAfter = await js(win, `window.__annotChecksum()`);
    if (canvasAfter === rectChecksum) throw new Error(`文字标注没有改变像素：${rectChecksum} → ${canvasAfter}`);
    result.checks.annotator = { before: canvasBefore, rect: rectChecksum, after: canvasAfter, text: true };
    result.screenshots.annotator = await captureWindow("workbench-p3-annotate.png");
    await clickButton(win, `(button) => button.innerText.trim() === "加入对话"`);
    await waitFor(win, `!document.querySelector('[role="dialog"][aria-label="截图标注"]')`, "关闭截图标注");
    await waitText(win, "截图已加入对话", "截图回填附件");
    await waitBrowser((state) => state.visible === true, "标注后恢复浏览器");
    result.checks.screenshotToChat = true;

    // ── P3 元素拾取：页面内点选 → 选择器插入输入框 ───────────
    await clickButton(win, `(button) => button.getAttribute("aria-label") === "拾取网页元素"`);
    const pickDeadline = Date.now() + 4000;
    let overlayReady = false;
    while (Date.now() < pickDeadline) {
      overlayReady = await browserController.ensure().view.webContents.executeJavaScript('Boolean(document.querySelector("[data-maxma-pick]"))').catch(() => false);
      if (overlayReady) break;
      await sleep(150);
    }
    if (!overlayReady) throw new Error("元素拾取覆盖层没有注入页面");
    const pickTarget = await browserController.ensure().view.webContents.executeJavaScript(
      'Boolean(document.querySelector("pre"))',
    );
    if (!pickTarget) throw new Error("测试页面没有 pre 元素，无法验证非 body 拾取");
    await browserController.ensure().view.webContents.executeJavaScript(
      'document.querySelector("pre").dispatchEvent(new MouseEvent("click", { bubbles: true }))',
    );
    await waitText(win, "已拾取", "元素拾取结果");
    const composer = await js(win, `Array.from(document.querySelectorAll("textarea")).map((node) => node.value).join("\\n")`);
    if (!composer.includes("引用网页元素") || !composer.includes("pre")) {
      throw new Error("元素选择器没有回填 pre 元素：" + composer.slice(0, 200));
    }
    result.checks.elementPicker = { overlay: true, target: "pre", composer: composer.slice(-120) };

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

    // 设计画布跨刷新持久化：项目名、A4 尺寸与三个元素都来自 IndexedDB。
    await clickTab(win, "画布");
    await waitFor(win, `Number(document.querySelector('[data-design-canvas="true"]')?.dataset.elementCount || 0) === 3`, "刷新后恢复画布元素");
    const restoredCanvas = await readDesignCanvas(win);
    if (restoredCanvas.name !== "E2E 设计画布" || restoredCanvas.artboardHeight !== 1754) {
      throw new Error(`画布刷新恢复不完整：${JSON.stringify(restoredCanvas)}`);
    }
    result.checks.designCanvasPersistence = {
      name: restoredCanvas.name,
      width: restoredCanvas.artboardWidth,
      height: restoredCanvas.artboardHeight,
      count: restoredCanvas.count,
    };
    result.screenshots.designLight = await captureWindow("workbench-design-canvas-light.png");

    // ── P3 并行会话：最多 3 个 tab，切换不丢 tab 状态 ───────────
    await waitFor(win, `document.querySelector('[aria-label="并行会话"]')`, "并行会话 tab");
    const oldLabel = await js(win, `document.querySelector('[aria-label="并行会话"] [role="tab"]')?.innerText.trim() ?? ""`);
    if (!oldLabel) throw new Error("并行会话没有当前 tab");
    await clickButton(win, `(button) => button.innerText.trim() === "新会话"`);
    await waitFor(win, `document.querySelectorAll('[aria-label="并行会话"] [role="tab"]').length >= 2`, "新会话 tab");
    const newTabs = await js(win, `[...document.querySelectorAll('[aria-label="并行会话"] [role="tab"]')].map((node) => node.innerText.trim())`);
    if (!newTabs.some((label) => label.includes(oldLabel))) throw new Error("新会话后旧 tab 消失：" + JSON.stringify(newTabs));
    const switchBack = await js(win, `(() => {
      const tablist = document.querySelector('[aria-label="并行会话"]');
      const tab = tablist && [...tablist.querySelectorAll('[role="tab"]')].find((node) => node.innerText.includes(${JSON.stringify(oldLabel)}));
      if (!tab) return false;
      tab.click();
      return true;
    })()`);
    if (!switchBack) throw new Error("找不到旧会话 tab");
    await sleep(500);
    const backTabs = await js(win, `[...document.querySelectorAll('[aria-label="并行会话"] [role="tab"]')].map((node) => node.innerText.trim())`);
    if (!backTabs.some((label) => label.includes(oldLabel))) throw new Error("切回后旧 tab 消失：" + JSON.stringify(backTabs));
    const maxTabs = await js(win, `document.querySelectorAll('[aria-label="并行会话"] [role="tab"]').length`);
    if (maxTabs > 3) throw new Error("并行 tab 超过 3 个");
    result.checks.sessionTabs = { before: oldLabel, afterNew: newTabs, afterBack: backTabs, max: maxTabs };

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
    await openPaneMenu(web);
    const webPanes = await readPaneMenu(web);
    if (webPanes.some((pane) => pane.id === "files" || pane.id === "browser")) {
      throw new Error(`纯 Web 形态不应显示桌面 Pane：${webPanes.map((pane) => pane.label).join(",")}`);
    }
    const expectedWebOrder = ["reasoning", "tasks", "canvas"];
    if (JSON.stringify(webPanes.map((pane) => pane.id)) !== JSON.stringify(expectedWebOrder)) {
      throw new Error(`纯 Web 面板顺序不符：${JSON.stringify(webPanes)}`);
    }
    result.checks.webTabs = webPanes;
    await closePaneMenu(web);
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
    try { interactivePage?.close(); } catch { /* */ }
    try { browserAgent?.stop(); } catch { /* */ }
    try { if (browserAgentDir) fs.rmSync(browserAgentDir, { recursive: true, force: true }); } catch { /* */ }
    try { browserController?.destroy(); } catch { /* */ }
    try { win.destroy(); } catch { /* */ }
    app.quit();
  }
});
