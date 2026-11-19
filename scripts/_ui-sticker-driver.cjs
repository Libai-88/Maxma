/**
 * scripts/_ui-sticker-driver.cjs — 表情选择器/管理面板的真实界面驱动。
 * 由 scripts/verify-ui-stickers.mjs 启动，不单独使用。
 *
 * 输出 stdout 一行 `DRIVE_RESULT {json}`；退出码 0 = 全部断言通过。
 */
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const { app, BrowserWindow, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.DRIVE_BASE;
const SESSION_ID = process.env.DRIVE_SESSION_ID || "";
const OUT = process.env.DRIVE_OUT || "";
const BASELINE_DIR = process.env.DRIVE_BASELINE_DIR || "";
const UPDATE_BASELINE = process.env.DRIVE_UPDATE_BASELINE === "1";
const THEME = process.env.DRIVE_THEME || "dark";
const WIDTH = Number(process.env.DRIVE_WIDTH || 1280);
const HEIGHT = Number(process.env.DRIVE_HEIGHT || 900);
const SHOT_SUFFIX = process.env.DRIVE_SHOT_SUFFIX || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function js(win, code) {
  return win.webContents.executeJavaScript(code).catch(() => null);
}

async function waitFor(win, code, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await js(win, code);
    if (value) return value;
    await sleep(300);
  }
  return null;
}

async function pressKey(win, keyCode) {
  // show:false 的窗口默认不是焦点窗口；不先聚焦，Enter 不会走原生按钮默认动作。
  win.webContents.focus();
  win.webContents.sendInputEvent({ type: "keyDown", keyCode });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  await sleep(300);
}

/** BGRA 位图逐像素比较；忽略极小的抗锯齿差异，但保留真实布局/内容变化。 */
function comparePng(currentPng, baselinePath) {
  if (!fs.existsSync(baselinePath)) return { status: "missing", baselinePath };
  const a = nativeImage.createFromBuffer(currentPng);
  const b = nativeImage.createFromPath(baselinePath);
  const as = a.getSize();
  const bs = b.getSize();
  if (as.width !== bs.width || as.height !== bs.height) {
    return { status: "size-mismatch", current: as, baseline: bs };
  }
  const ab = a.getBitmap();
  const bb = b.getBitmap();
  let diff = 0;
  let maxDelta = 0;
  for (let i = 0; i + 3 < ab.length; i += 4) {
    const d = Math.max(
      Math.abs(ab[i] - bb[i]),
      Math.abs(ab[i + 1] - bb[i + 1]),
      Math.abs(ab[i + 2] - bb[i + 2]),
    );
    if (d > 6) diff += 1;
    if (d > maxDelta) maxDelta = d;
  }
  return {
    status: "compared",
    width: as.width,
    height: as.height,
    differentPixels: diff,
    totalPixels: ab.length / 4,
    ratio: Number((diff / (ab.length / 4)).toFixed(4)),
    maxDelta,
    baselinePath,
  };
}

async function captureShot(win, name, results) {
  if (!OUT) return;
  const shotName = `${name}${SHOT_SUFFIX}`;
  fs.mkdirSync(OUT, { recursive: true });
  const png = (await win.webContents.capturePage()).toPNG();
  const currentPath = path.join(OUT, `${shotName}.png`);
  fs.writeFileSync(currentPath, png);
  const baselinePath = BASELINE_DIR ? path.join(BASELINE_DIR, `${shotName}.png`) : "";
  let visual = { status: "not-configured", currentPath };
  if (baselinePath) {
    if (UPDATE_BASELINE) {
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, png);
      visual = { status: "updated", baselinePath };
    } else {
      visual = comparePng(png, baselinePath);
    }
  }
  results.push({ name: shotName, currentPath, ...visual });
}

/** 打开附件菜单并点「表情」。 */
async function openStickerPicker(win) {
  const attach = await js(win, `(() => {
    const b = document.querySelector('button[aria-label^="添加附件"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!attach) throw new Error("找不到添加附件按钮");
  const menu = await waitFor(win, `(() => {
    const b = [...document.querySelectorAll('button[role="menuitem"]')].find((x) => x.textContent.trim() === '表情');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!menu) throw new Error("附件菜单里没有「表情」项");
  const dialog = await waitFor(win, `!!document.querySelector('[role="dialog"][aria-label="表情选择器"]')`);
  if (!dialog) throw new Error("表情选择器没有打开");
}

/** 用 DevTools 的真实 touch 事件点按元素，而不是把 click 当成“触控”。 */
async function touchClick(win, code) {
  const point = await js(win, `(() => {
    const el = ${code};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!point) throw new Error("触控目标不存在");
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
  try {
    await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: point.x, y: point.y, id: 1 }],
    });
    await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    try { win.webContents.debugger.detach(); } catch { /* 已断开 */ }
  }
  await sleep(800);
}

/** 双指捏合：验证多指触摸不会误触发表情按钮或把选择器关掉。 */
async function multiTouchPinch(win, code) {
  const box = await js(win, `(() => {
    const el = ${code};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height * 0.4, 260) };
  })()`);
  if (!box) throw new Error("多指触控目标不存在");
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
  try {
    await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: box.x - 40, y: box.y, id: 1 },
        { x: box.x + 40, y: box.y, id: 2 },
      ],
    });
    await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: box.x - 90, y: box.y, id: 1 },
        { x: box.x + 90, y: box.y, id: 2 },
      ],
    });
    await win.webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    try { win.webContents.debugger.detach(); } catch { /* 已断开 */ }
  }
  await sleep(800);
}

/** CDP IME 组合输入：走 Chromium 的 composition 路径，验证中文输入不被 React 吞掉。 */
async function imeCommit(win, text) {
  await js(win, `(() => {
    const ta = document.querySelector('[data-slot="composer"] textarea');
    if (!ta) return false;
    ta.focus();
    return true;
  })()`);
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
  try {
    await win.webContents.debugger.sendCommand("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
      replacementStart: 0,
      replacementEnd: 0,
    });
    await sleep(200);
    await win.webContents.debugger.sendCommand("Input.insertText", { text });
  } finally {
    try { win.webContents.debugger.detach(); } catch { /* 已断开 */ }
  }
  await sleep(400);
}

app.whenReady().then(async () => {
  // 先用一个一次性窗口写 localStorage（主题/会话），再销毁它。
  // 不能在同一个窗口 reload：旧页面的 init 请求和 console 事件会跨 reload 串进来，
  // 把测试自身的中断误记成产品错误。新窗口从干净上下文开始。
  const bootstrap = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  await bootstrap.loadURL(BASE + "/");
  await js(bootstrap, `(() => { localStorage.setItem('maxma.theme', ${JSON.stringify(THEME)}); return true })()`);
  if (SESSION_ID) {
    await js(bootstrap, `(() => {
      localStorage.setItem('maxma_session_id', ${JSON.stringify(SESSION_ID)});
      return true;
    })()`);
  }
  // 保留 bootstrap 窗口（隐藏），否则 Windows 上所有窗口关闭会触发 Electron 默认退出，
  // 后续新窗口 loadURL 会直接 ERR_FAILED。
  bootstrap.hide();

  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  const logs = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) logs.push(message);
  });
  await win.loadURL(BASE + "/");
  // 隐藏窗口会被 Chromium 判定为 occluded，CSS 入场动画停在 opacity:0，capturePage 也拿不到新帧。
  // 只 showInactive，不抢用户焦点；这是真实界面验收，不是无头渲染。
  win.showInactive();
  await sleep(2500);

  // 等聊天输入框出现；没有 provider 也能打开表情面板。
  const composer = await waitFor(win, `!!document.querySelector('[data-slot="composer"] textarea')`, 90_000);
  const result = { stage: "start", pickerOpened: false, searchFocused: false, tabFocusInDialog: false, escapeClosed: false, focusRestored: false, imagesLoaded: false, searchHit: false, markerInserted: false, keyboardInserted: false, touchInserted: false, multiTouchStable: false, imeCommitted: false, managerOpened: false, viewport: { width: WIDTH, height: HEIGHT, theme: THEME }, inputValue: "", shots: [], consoleErrors: logs };

  try {
    if (!composer) throw new Error("聊天输入框始终没出现（界面可能停在引导页）");
    result.stage = "composer-ready";

    // IME：用 Chromium 的组合输入路径写中文，确认 React 受控输入框能收到并保留。
    await imeCommit(win, "爸爸");
    const imeValue = (await js(win, `document.querySelector('[data-slot="composer"] textarea')?.value || ''`)) || "";
    result.imeCommitted = imeValue.includes("爸爸");
    result.stage = "ime-checked";
    if (!result.imeCommitted) throw new Error("IME 组合输入没有进入消息输入框");
    await js(win, `(() => {
      const ta = document.querySelector('[data-slot="composer"] textarea');
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);

    await openStickerPicker(win);
    result.pickerOpened = true;
    result.stage = "picker-opened";

    const loaded = await waitFor(win, `(() => {
      const d = document.querySelector('[role="dialog"][aria-label="表情选择器"]');
      if (!d) return 0;
      const imgs = [...d.querySelectorAll('img')];
      const ready = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
      return ready >= 4 ? ready : 0;
    })()`, 30_000);
    if (!loaded) throw new Error("表情选择器打开后没有图片成功加载");
    result.imagesLoaded = true;
    result.stage = "images-loaded";
    await sleep(800);

    const focusInfo = await js(win, `(() => {
      const d = document.querySelector('[role="dialog"][aria-label="表情选择器"]');
      const a = document.activeElement;
      return { inDialog: !!d && d.contains(a), label: a?.getAttribute?.('aria-label') || a?.id || '', tag: a?.tagName || '' };
    })()`);
    result.searchFocused = focusInfo?.label === '搜索表情';
    result.stage = "focus-checked";
    await captureShot(win, "sticker-picker", result.shots);

    await pressKey(win, "Tab");
    const tabInfo = await js(win, `(() => {
      const d = document.querySelector('[role="dialog"][aria-label="表情选择器"]');
      const a = document.activeElement;
      return { inDialog: !!d && d.contains(a), label: a?.getAttribute?.('aria-label') || a?.textContent?.trim().slice(0, 24) || '', tag: a?.tagName || '' };
    })()`);
    result.tabFocusInDialog = !!tabInfo?.inDialog;
    result.tabFocusLabel = tabInfo?.label || "";
    result.stage = "tab-checked";

    await pressKey(win, "Escape");
    result.escapeClosed = !!(await waitFor(win, `!document.querySelector('[role="dialog"][aria-label="表情选择器"]')`, 5_000));
    const restore = await js(win, `(() => { const a = document.activeElement; return { id: a?.id || '', label: a?.getAttribute?.('aria-label') || '', tag: a?.tagName || '' } })()`);
    result.focusRestored = restore?.id === 'composer-textarea' || restore?.label === '消息输入框';
    result.stage = "escape-checked";
    if (!result.searchFocused) throw new Error("打开选择器后焦点没有落在搜索框");
    if (!result.tabFocusInDialog) throw new Error("按 Tab 后焦点跑出了表情选择器");
    if (!result.escapeClosed) throw new Error("按 Escape 后表情选择器没有关闭");
    if (!result.focusRestored) throw new Error("关闭选择器后焦点没有回到消息输入框");

    // 搜索后先做真实触控点击（CDP touch），再做键盘 Enter；两条都走原生按钮事件。
    await openStickerPicker(win);
    const typed = await js(win, `(() => {
      const input = document.querySelector('input[aria-label="搜索表情"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '委屈');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (!typed) throw new Error("找不到搜索表情输入框");
    const hit = await waitFor(win, `(() => {
      const d = document.querySelector('[role="dialog"][aria-label="表情选择器"]');
      if (!d) return 0;
      return [...d.querySelectorAll('button[aria-label]')].filter((b) => (b.getAttribute('aria-label') || '').startsWith('委屈')).length;
    })()`, 15_000);
    if (!hit) throw new Error("搜索「委屈」没有命中表情");
    result.searchHit = true;
    result.stage = "search-hit";

    await touchClick(win, `[...document.querySelectorAll('[role="dialog"][aria-label="表情选择器"] button[aria-label]')].find((b) => (b.getAttribute('aria-label') || '').startsWith('委屈'))`);
    const touchValue = (await js(win, `document.querySelector('[data-slot="composer"] textarea')?.value || ''`)) || "";
    result.touchInserted = touchValue.includes("[表情:");
    result.stage = "touch-inserted";
    if (!result.touchInserted) throw new Error("真实触控点击没有插入表情标记");

    await openStickerPicker(win);
    await js(win, `(() => {
      const input = document.querySelector('input[aria-label="搜索表情"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '委屈');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await waitFor(win, `(() => {
      const d = document.querySelector('[role="dialog"][aria-label="表情选择器"]');
      return d ? [...d.querySelectorAll('button[aria-label]')].filter((b) => (b.getAttribute('aria-label') || '').startsWith('委屈')).length : 0;
    })()`, 15_000);
    const focusedButton = await js(win, `(() => {
      const d = document.querySelector('[role="dialog"][aria-label="表情选择器"]');
      const b = d && [...d.querySelectorAll('button[aria-label]')].find((x) => (x.getAttribute('aria-label') || '').startsWith('委屈'));
      if (!b) return false;
      b.focus();
      return true;
    })()`);
    if (!focusedButton) throw new Error("无法聚焦搜索结果按钮");
    await pressKey(win, "Enter");
    await sleep(600);
    const keyboardValue = (await js(win, `document.querySelector('[data-slot="composer"] textarea')?.value || ''`)) || "";
    result.keyboardInserted = keyboardValue.split("[表情:").length - 1 >= 2;
    result.inputValue = keyboardValue;
    result.markerInserted = keyboardValue.includes("[表情:");
    result.stage = "keyboard-inserted";
    if (!result.keyboardInserted) throw new Error("键盘 Enter 没有插入第二个表情标记");

    // 多指：在选择器网格上做双指捏合；不得误插入，也不得把选择器弄关。
    // 这是 CDP 多触点模拟，不等价于真机触屏硬件；真机由 UI smoke 负责。
    await openStickerPicker(win);
    const beforePinch = (await js(win, `document.querySelector('[data-slot="composer"] textarea')?.value || ''`)) || "";
    await multiTouchPinch(win, `document.querySelector('[role="dialog"][aria-label="表情选择器"]')`);
    const pickerStillOpen = !!(await js(win, `!!document.querySelector('[role="dialog"][aria-label="表情选择器"]')`));
    const afterPinch = (await js(win, `document.querySelector('[data-slot="composer"] textarea')?.value || ''`)) || "";
    result.multiTouchStable = pickerStillOpen && afterPinch === beforePinch;
    result.stage = "multi-touch-checked";
    if (!result.multiTouchStable) throw new Error("双指捏合导致选择器关闭或误插入表情");
    await pressKey(win, "Escape");
    await waitFor(win, `!document.querySelector('[role="dialog"][aria-label="表情选择器"]')`, 5_000);

    // 重新打开选择器，进入管理面板并截取第二张基线图。
    await openStickerPicker(win);
    const manage = await js(win, `(() => {
      const b = document.querySelector('button[aria-label="管理图库"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!manage) throw new Error("选择器里没有「管理图库」按钮");
    const manager = await waitFor(win, `(() => {
      return [...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent || '').includes('表情图库管理'));
    })()`, 15_000);
    if (!manager) throw new Error("管理对话框没有出现");
    await sleep(800);
    result.dialogDebug = await js(win, `(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => {
      const r = d.getBoundingClientRect();
      const cs = getComputedStyle(d);
      return {
        label: d.getAttribute('aria-label') || '',
        text: (d.textContent || '').trim().slice(0, 40),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        z: cs.zIndex,
      };
    }))()`);
    await captureShot(win, "sticker-manager", result.shots);
    result.pageMetrics = await js(win, `(() => {
      const doc = document.documentElement;
      const overflowing = [...document.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 2).slice(0, 12).map((e) => ({
        tag: e.tagName,
        cls: String(e.className || '').slice(0, 90),
        scrollWidth: e.scrollWidth,
        clientWidth: e.clientWidth,
      }));
      return { clientWidth: doc.clientWidth, scrollWidth: doc.scrollWidth, bodyScrollWidth: document.body.scrollWidth, overflowing };
    })()`);
    result.managerOpened = true;
    result.stage = "manager-opened";
  } catch (err) {
    result.error = String(err?.message ?? err);
    result.pageText = (await js(win, "document.body.innerText.slice(0, 1200)")) || "";
  }

  console.log("DRIVE_RESULT " + JSON.stringify(result));
  app.quit();
}).catch((err) => {
  console.error("DRIVE_ERROR " + String(err?.stack ?? err));
  app.exit(1);
});
