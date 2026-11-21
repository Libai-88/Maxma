/**
 * browser-cdp.cjs — 内置浏览器的 Chromium DevTools Protocol 层。
 *
 * 这里提供“原生操控”而不是 DOM 模拟：
 * - Accessibility.getFullAXTree 生成带稳定 ref 的可操作元素快照；
 * - DOM.getBoxModel 定位元素，Input.dispatchMouseEvent/KeyEvent 发真实输入；
 * - Runtime.evaluate 只用于取页面正文、等待条件和显式 evaluate。
 *
 * 页面仍然是独立 WebContentsView，CDP 不把 Electron 对象暴露给远端页面。
 */

const fs = require("node:fs");
const path = require("node:path");

const NON_TARGET_ROLES = new Set(["RootWebArea", "WebArea", "document", "browser"]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

const MAX_ELEMENTS = 120;
const MAX_TEXT = 12_000;
const MAX_LOGS = 80;

function axValue(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.value === "string") return value.value;
  if (typeof value.value === "number" || typeof value.value === "boolean") return String(value.value);
  return "";
}

function axBoolean(node, name) {
  const property = node?.properties?.find((item) => item.name === name);
  const value = property?.value?.value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return undefined;
}

/**
 * 把 Accessibility.getFullAXTree 的扁平节点压成模型可用的元素表。
 * 纯函数：不依赖 Electron，单测可直接喂 fixture。
 */
function buildA11ySnapshot(nodes, { epoch = "1", maxElements = MAX_ELEMENTS } = {}) {
  const elements = [];
  const refs = new Map();
  for (const node of nodes) {
    if (!node || node.ignored || !node.role) continue;
    const role = axValue(node.role);
    if (!role) continue;
    if (NON_TARGET_ROLES.has(role)) continue;
    const name = axValue(node.name).trim();
    const value = axValue(node.value).trim();
    const focusable = axBoolean(node, "focusable") === true;
    if (!INTERACTIVE_ROLES.has(role) && !(focusable && name)) continue;
    if (elements.length >= maxElements) break;
    const ref = `e${elements.length + 1}`;
    const backendNodeId = node.backendDOMNodeId;
    if (!Number.isFinite(backendNodeId)) continue;
    const element = { ref, role };
    if (name) element.name = name.slice(0, 240);
    if (value) element.value = value.slice(0, 240);
    const checked = axBoolean(node, "checked");
    const disabled = axBoolean(node, "disabled");
    const focused = axBoolean(node, "focused");
    const expanded = axBoolean(node, "expanded");
    const selected = axBoolean(node, "selected");
    if (checked !== undefined) element.checked = checked;
    if (disabled !== undefined) element.disabled = disabled;
    if (focused !== undefined) element.focused = focused;
    if (expanded !== undefined) element.expanded = expanded;
    if (selected !== undefined) element.selected = selected;
    const level = node?.properties?.find((item) => item.name === "level")?.value?.value;
    if (Number.isFinite(level)) element.level = level;
    elements.push(element);
    refs.set(ref, backendNodeId);
  }
  return { elements, refs, epoch: String(epoch) };
}

const SPECIAL_KEYS = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Esc: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Space: { key: " ", code: "Space", keyCode: 32, text: " " },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  F5: { key: "F5", code: "F5", keyCode: 116 },
};

const PUNCTUATION = {
  ".": { code: "Period", keyCode: 190 },
  ",": { code: "Comma", keyCode: 188 },
  "/": { code: "Slash", keyCode: 191 },
  "\\": { code: "Backslash", keyCode: 220 },
  "-": { code: "Minus", keyCode: 189 },
  "=": { code: "Equal", keyCode: 187 },
  ";": { code: "Semicolon", keyCode: 186 },
  "'": { code: "Quote", keyCode: 222 },
  "[": { code: "BracketLeft", keyCode: 219 },
  "]": { code: "BracketRight", keyCode: 221 },
  "@": { code: "At", keyCode: 64 },
  "+": { code: "Plus", keyCode: 187 },
  "#": { code: "Hash", keyCode: 51 },
  "?": { code: "Question", keyCode: 191 },
  "!": { code: "Exclamation", keyCode: 49 },
};

/**
 * 解析 "Control+A"、"Enter"、"Shift+Tab" 这类键串，返回 CDP KeyboardEvent。
 * 未知键返回 null，由调用方给出中文错误，不静默发错键。
 */
function parseKeyChord(chord) {
  if (typeof chord !== "string" || !chord.trim()) return null;
  const parts = chord.trim().split("+").filter(Boolean);
  if (!parts.length) return null;
  const modifiers = { alt: 0, control: 0, meta: 0, shift: 0 };
  let keyName = "";
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") modifiers.control = 1;
    else if (lower === "alt") modifiers.alt = 1;
    else if (lower === "meta" || lower === "cmd" || lower === "command") modifiers.meta = 1;
    else if (lower === "shift") modifiers.shift = 1;
    else keyName = part;
  }
  if (!keyName) return null;
  const modifierBits =
    (modifiers.alt ? 1 : 0) |
    (modifiers.control ? 2 : 0) |
    (modifiers.meta ? 4 : 0) |
    (modifiers.shift ? 8 : 0);

  const special = SPECIAL_KEYS[keyName] ?? SPECIAL_KEYS[
    Object.keys(SPECIAL_KEYS).find((name) => name.toLowerCase() === keyName.toLowerCase()) ?? ""
  ];
  if (special) {
    return {
      key: special.key,
      code: special.code,
      windowsVirtualKeyCode: special.keyCode,
      nativeVirtualKeyCode: special.keyCode,
      modifiers: modifierBits,
      text: special.text,
    };
  }
  if (keyName.length !== 1) {
    if (/^F\d{1,2}$/i.test(keyName)) {
      const number = Number(keyName.slice(1));
      return {
        key: `F${number}`,
        code: `F${number}`,
        windowsVirtualKeyCode: 111 + number,
        modifiers: modifierBits,
      };
    }
    return null;
  }

  let key = keyName;
  let code = "";
  let keyCode = 0;
  let text = keyName;
  if (/^[a-z]$/i.test(keyName)) {
    key = modifiers.shift ? keyName.toUpperCase() : keyName.toLowerCase();
    code = `Key${keyName.toUpperCase()}`;
    keyCode = keyName.toUpperCase().charCodeAt(0);
    text = modifiers.control || modifiers.meta || modifiers.alt ? "" : key;
  } else if (/^[0-9]$/.test(keyName)) {
    code = `Digit${keyName}`;
    keyCode = keyName.charCodeAt(0);
    text = modifiers.control || modifiers.meta || modifiers.alt ? "" : keyName;
  } else if (PUNCTUATION[keyName]) {
    code = PUNCTUATION[keyName].code;
    keyCode = PUNCTUATION[keyName].keyCode;
    text = modifiers.control || modifiers.meta || modifiers.alt ? "" : keyName;
  } else {
    return null;
  }
  return {
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers: modifierBits,
    text,
  };
}

function truncateJson(value, limit = 20_000) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return String(value);
  }
  if (typeof serialized !== "string") return String(serialized);
  return serialized.length > limit ? `${serialized.slice(0, limit)}…` : serialized;
}

/** 视口坐标：必须是有限数字，四舍五入并限制在 0..max（max 未知时只拒负数）。 */
function normalizePoint(x, y, maxX = Infinity, maxY = Infinity) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  if (px < 0 || py < 0) return null;
  return {
    x: Math.min(Math.round(px), Math.max(1, Math.floor(maxX))),
    y: Math.min(Math.round(py), Math.max(1, Math.floor(maxY))),
  };
}

/**
 * 上传文件路径校验（纯函数，便于单测）：
 * 只收绝对路径、必须存在且是普通文件；拒绝 NUL、目录、超过 512 MiB，
 * 最多 10 个。路径不会回显给页面，只交给 CDP 的 DOM.setFileInputFiles。
 */
function normalizeUploadPaths(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("upload 需要 files 数组");
  if (files.length > 10) throw new Error("一次最多上传 10 个文件");
  const normalized = [];
  for (const raw of files) {
    if (typeof raw !== "string" || !raw.trim()) throw new Error("files 里必须是非空路径字符串");
    if (raw.includes("\0")) throw new Error("文件路径包含 NUL 字节");
    if (!path.isAbsolute(raw)) throw new Error("upload 只接受绝对路径");
    const candidate = path.resolve(raw);
    let stat;
    try {
      stat = fs.statSync(candidate);
    } catch {
      throw new Error(`文件不存在：${candidate}`);
    }
    if (!stat.isFile()) throw new Error(`不是普通文件：${candidate}`);
    if (stat.size > 512 * 1024 * 1024) throw new Error(`文件超过 512 MiB：${candidate}`);
    if (!normalized.includes(candidate)) normalized.push(candidate);
  }
  return normalized;
}

function createCdpBrowser(getView) {
  let attached = false;
  let attachPromise = null;
  let boundWebContents = null;
  let epoch = 0;
  let refs = new Map();
  let logs = [];
  let lastError = "";

  function currentView() {
    const view = getView();
    if (!view) throw new Error("浏览器尚未创建");
    const contents = view.webContents;
    if (!contents || contents.isDestroyed()) throw new Error("浏览器页面已销毁");
    return { view, contents };
  }

  function pushLog(entry) {
    logs.push({ at: Date.now(), ...entry });
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
  }

  function onDebuggerMessage(_event, method, params) {
    if (method === "Runtime.consoleAPICalled") {
      const args = Array.isArray(params?.args) ? params.args : [];
      const text = args.map((arg) => {
        if (typeof arg.value === "string") return arg.value;
        if (typeof arg.value === "number" || typeof arg.value === "boolean") return String(arg.value);
        return arg.description || arg.unserializableValue || arg.type || "?";
      }).join(" ");
      pushLog({ level: String(params?.type || "log"), text: text.slice(0, 2000) });
    } else if (method === "Runtime.exceptionThrown") {
      const description = params?.exceptionDetails?.exception?.description
        || params?.exceptionDetails?.text
        || "页面异常";
      lastError = String(description).slice(0, 500);
      pushLog({ level: "error", text: lastError });
    } else if (method === "Log.entryAdded") {
      const entry = params?.entry || {};
      pushLog({
        level: String(entry.level || "log"),
        text: String(entry.text || "").slice(0, 2000),
        url: entry.url ? String(entry.url).slice(0, 500) : undefined,
      });
    }
  }

  function onDetached() {
    attached = false;
    boundWebContents = null;
    refs = new Map();
  }

  async function rawSend(contents, method, params = {}) {
    return contents.debugger.sendCommand(method, params);
  }

  async function ensureAttached() {
    const { contents } = currentView();
    if (contents.debugger.isAttached()) {
      attached = true;
      boundWebContents = contents;
      return contents;
    }
    if (attachPromise) return attachPromise;
    attachPromise = (async () => {
      try {
        contents.debugger.attach("1.3");
      } catch (error) {
        if (!/already attached/i.test(String(error?.message || error))) throw error;
      }
      attached = true;
      boundWebContents = contents;
      contents.debugger.on("message", onDebuggerMessage);
      contents.debugger.on("detached", onDetached);
      await rawSend(contents, "Runtime.enable").catch(() => undefined);
      await rawSend(contents, "Log.enable").catch(() => undefined);
      await rawSend(contents, "Page.enable").catch(() => undefined);
      await rawSend(contents, "Accessibility.enable").catch(() => undefined);
      // WebContentsView 在主窗口不活跃时会让页面进入 blur 状态，Chromium
      // 会丢弃 Input 域发来的键盘/鼠标事件。AI 操控需要页面始终接受输入。
      await rawSend(contents, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
      return contents;
    })();
    try {
      return await attachPromise;
    } finally {
      attachPromise = null;
    }
  }

  async function send(method, params = {}) {
    const contents = await ensureAttached();
    return rawSend(contents, method, params);
  }

  function detach() {
    const contents = boundWebContents;
    boundWebContents = null;
    attached = false;
    refs = new Map();
    if (!contents || contents.isDestroyed()) return;
    try {
      contents.debugger.removeListener("message", onDebuggerMessage);
      contents.debugger.removeListener("detached", onDetached);
      if (contents.debugger.isAttached()) contents.debugger.detach();
    } catch {
      // WebContents already tearing down.
    }
  }

  async function pageText() {
    const result = await send("Runtime.evaluate", {
      expression: `(() => ({
        text: (document.body && document.body.innerText || "").slice(0, ${MAX_TEXT}),
        url: location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY }
      }))()`,
      returnByValue: true,
    });
    return result?.result?.value ?? { text: "", url: "", title: "", viewport: { width: 0, height: 0, scrollX: 0, scrollY: 0 } };
  }

  async function snapshot() {
    const tree = await send("Accessibility.getFullAXTree");
    epoch += 1;
    const next = buildA11ySnapshot(tree?.nodes || [], { epoch: String(epoch), maxElements: MAX_ELEMENTS });
    refs = next.refs;
    const page = await pageText();
    return {
      url: page.url,
      title: page.title,
      text: page.text,
      viewport: page.viewport,
      elements: next.elements,
      refs_epoch: next.epoch,
      hint: "ref 只在本次快照内有效；页面变化后请重新 snapshot。",
    };
  }

  function backendForRef(ref) {
    if (typeof ref !== "string" || !/^e\d+$/.test(ref)) throw new Error("ref 必须来自最近一次 snapshot，例如 e3");
    const backendNodeId = refs.get(ref);
    if (!Number.isFinite(backendNodeId)) throw new Error(`ref ${ref} 已失效；请重新 snapshot 后再操作`);
    return backendNodeId;
  }

  async function resolveTarget(args) {
    if (args?.ref) {
      const backendNodeId = backendForRef(args.ref);
      const resolved = await send("DOM.resolveNode", { backendNodeId });
      const objectId = resolved?.object?.objectId;
      if (!objectId) throw new Error(`无法解析 ref ${args.ref}；请重新 snapshot`);
      return { objectId, ref: args.ref };
    }
    if (typeof args?.selector === "string" && args.selector.trim()) {
      const selector = args.selector.trim().slice(0, 500);
      const evaluated = await send("Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
      });
      const objectId = evaluated?.result?.objectId;
      if (!objectId) throw new Error(`selector 未命中：${selector}`);
      return { objectId, selector };
    }
    throw new Error("这个动作需要 ref（推荐，来自 snapshot）或 selector");
  }

  async function callOn(objectId, functionDeclaration, args = []) {
    const result = await send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: args,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result?.exceptionDetails) {
      throw new Error(
        `页面操作异常：${result.exceptionDetails.exception?.description || result.exceptionDetails.text || "unknown"}`,
      );
    }
    return result;
  }

  function targetLabel(target) {
    return target.ref ? { ref: target.ref } : { selector: target.selector };
  }

  async function scrollIntoView(objectId) {
    await callOn(objectId, "function(){ this.scrollIntoView({ block: 'center', inline: 'center' }); return true; }");
  }

  async function centerOf(objectId) {
    const box = await send("DOM.getBoxModel", { objectId });
    const quad = box?.model?.border;
    if (!Array.isArray(quad) || quad.length < 8) throw new Error("元素没有可点击的几何位置");
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    return {
      x: Math.round(xs.reduce((sum, value) => sum + value, 0) / 4),
      y: Math.round(ys.reduce((sum, value) => sum + value, 0) / 4),
    };
  }

  async function mouseClick(point, clickCount = 1) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount });
  }

  async function focus(objectId) {
    await callOn(objectId, "function(){ this.focus(); return true; }");
  }

  function directPoint(args, xKey = "x", yKey = "y") {
    if (args?.[xKey] === undefined && args?.[yKey] === undefined) return null;
    const point = normalizePoint(args?.[xKey], args?.[yKey]);
    if (!point) throw new Error(`${xKey}/${yKey} 必须是两个非负数字`);
    return point;
  }

  async function pointFor(args, keys = {}) {
    const xKey = keys.xKey || "x";
    const yKey = keys.yKey || "y";
    const refKey = keys.refKey || "ref";
    const selectorKey = keys.selectorKey || "selector";
    const direct = directPoint(args, xKey, yKey);
    if (direct) return { point: direct };
    const target = await resolveTarget({ ref: args?.[refKey], selector: args?.[selectorKey] });
    await scrollIntoView(target.objectId);
    return { point: await centerOf(target.objectId), target };
  }

  async function clickTarget(args) {
    const direct = directPoint(args);
    if (direct) {
      await mouseClick(direct, Math.max(1, Math.min(3, Number(args.clickCount) || 1)));
      return { acted: "click", point: direct, coordinates: true };
    }
    const target = await resolveTarget(args);
    await scrollIntoView(target.objectId);
    const point = await centerOf(target.objectId);
    await mouseClick(point, Math.max(1, Math.min(3, Number(args.clickCount) || 1)));
    return { acted: "click", ...targetLabel(target), point };
  }

  async function drag(args) {
    const source = await pointFor(args);
    const destination = await pointFor(args, {
      xKey: "toX",
      yKey: "toY",
      refKey: "toRef",
      selectorKey: "toSelector",
    });
    const steps = Math.max(4, Math.min(60, Number(args.steps) || 20));
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: source.point.x, y: source.point.y, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: source.point.x, y: source.point.y, button: "left", buttons: 1, clickCount: 1 });
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(source.point.x + (destination.point.x - source.point.x) * ratio),
        y: Math.round(source.point.y + (destination.point.y - source.point.y) * ratio),
        button: "left",
        buttons: 1,
      });
    }
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: destination.point.x,
      y: destination.point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    return { acted: "drag", from: source.point, to: destination.point, steps };
  }

  async function upload(args) {
    const files = normalizeUploadPaths(args?.files);
    const target = await resolveTarget(args);
    const kind = await callOn(target.objectId, "function(){ return this.type || this.tagName.toLowerCase(); }");
    if (kind?.result?.value !== "file") throw new Error("upload 目标必须是 input[type=file]");
    await send("DOM.setFileInputFiles", { objectId: target.objectId, files });
    return {
      acted: "upload",
      ...targetLabel(target),
      count: files.length,
      names: files.map((file) => path.basename(file)),
    };
  }

  async function scrollTarget(args) {
    const target = await resolveTarget(args);
    await scrollIntoView(target.objectId);
    const point = await centerOf(target.objectId);
    return { acted: "scrollIntoView", ...targetLabel(target), point };
  }

  async function dispatchKey(chord) {
    const definition = parseKeyChord(chord);
    if (!definition) throw new Error(`不支持的按键：${chord}`);
    const base = {
      modifiers: definition.modifiers,
      key: definition.key,
      code: definition.code,
      windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
      nativeVirtualKeyCode: definition.nativeVirtualKeyCode,
    };
    if (definition.text) {
      // keyDown 会同时产生 keydown 与 char；rawKeyDown + char 在窗口失焦的
      // WebContentsView 上曾被 Chromium 丢弃，页面收不到 keydown。
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        ...base,
        text: definition.text,
        unmodifiedText: definition.text,
      });
    } else {
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    }
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    return { acted: "press", key: chord };
  }

  async function press(args) {
    const { contents } = currentView();
    // 先把页面置于调试器前台并重新聚焦，避免宿主窗口/React 地址栏在
    // 页签切换后短暂抢走焦点，导致键盘事件被 Chromium 丢弃。
    try { await send("Page.bringToFront"); } catch { /* older target */ }
    try { contents.focus(); } catch { /* closing */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (args.ref || args.selector) {
      const target = await resolveTarget(args);
      await focus(target.objectId);
    }
    const chord = typeof args.key === "string" ? args.key.slice(0, 100) : "";
    if (!chord) throw new Error("press 需要 key，例如 Enter、Tab、Control+A");
    // CDP 的 rawKeyDown + char 序列不依赖宿主窗口是否拿到 OS 前台焦点；
    // sendInputEvent 在窗口被终端遮挡/失焦时会静默丢键，页面收不到 keydown。
    const result = await dispatchKey(chord);
    return { ...result, transport: "cdp", webContentsFocused: contents.isFocused() };
  }

  async function fill(args) {
    if (typeof args.text !== "string") throw new Error("fill/type 需要 text");
    if (args.text.length > 5000) throw new Error("text 最长 5000 字符");
    const target = await resolveTarget(args);
    await scrollIntoView(target.objectId);
    const point = await centerOf(target.objectId);
    await mouseClick(point);
    if (args.action === "fill") {
      await send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        modifiers: 2,
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
        commands: ["selectAll"],
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        modifiers: 2,
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
      });
      await dispatchKey("Backspace");
    }
    await send("Input.insertText", { text: args.text });
    return { acted: args.action, ...targetLabel(target), length: args.text.length };
  }

  async function hover(args) {
    const target = await resolveTarget(args);
    await scrollIntoView(target.objectId);
    const point = await centerOf(target.objectId);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
    return { acted: "hover", ...targetLabel(target), point };
  }

  async function selectOption(args) {
    if (typeof args.value !== "string") throw new Error("select 需要 value");
    const target = await resolveTarget(args);
    const result = await callOn(
      target.objectId,
      "function(value){ if (!(this instanceof HTMLSelectElement)) throw new Error('目标不是 select'); this.value = value; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); return this.value; }",
      [{ value: args.value }],
    );
    return { acted: "select", ...targetLabel(target), value: result?.result?.value ?? args.value };
  }

  async function check(args) {
    const target = await resolveTarget(args);
    const state = await callOn(target.objectId, "function(){ return Boolean(this.checked); }");
    const currently = Boolean(state?.result?.value);
    const desired = args.action === "check";
    if (currently === desired) return { acted: args.action, ...targetLabel(target), changed: false, checked: currently };
    await clickTarget(args);
    return { acted: args.action, ...targetLabel(target), changed: true, checked: desired };
  }

  async function evaluate(args) {
    if (typeof args.expression !== "string" || !args.expression.trim()) throw new Error("evaluate 需要 expression");
    if (args.expression.length > 4000) throw new Error("expression 最长 4000 字符");
    const result = await send("Runtime.evaluate", {
      expression: args.expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result?.exceptionDetails) {
      throw new Error(`页面脚本异常：${result.exceptionDetails.exception?.description || result.exceptionDetails.text || "unknown"}`);
    }
    return { acted: "evaluate", value: result?.result?.value ?? null, type: result?.result?.type ?? "undefined" };
  }

  async function waitFor(args) {
    const timeoutMs = Math.max(1, Math.min(15_000, Number(args.timeoutMs) || 5000));
    if (Number.isFinite(Number(args.ms)) && Number(args.ms) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, Number(args.ms))));
      return { acted: "wait", waitedMs: Math.min(15_000, Number(args.ms)) };
    }
    const selector = typeof args.selector === "string" ? args.selector.trim().slice(0, 500) : "";
    const text = typeof args.text === "string" ? args.text.slice(0, 500) : "";
    if (!selector && !text) throw new Error("wait 需要 selector、text 或 ms");
    const started = Date.now();
    const expression = selector && text
      ? `Boolean(document.querySelector(${JSON.stringify(selector)})) && (document.body?.innerText || "").includes(${JSON.stringify(text)})`
      : selector
        ? `Boolean(document.querySelector(${JSON.stringify(selector)}))`
        : `(document.body?.innerText || "").includes(${JSON.stringify(text)})`;
    while (Date.now() - started < timeoutMs) {
      const present = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (present?.result?.value === true) return { acted: "wait", selector: selector || undefined, text: text || undefined, waitedMs: Date.now() - started };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`等待超时：${selector || text}（${timeoutMs}ms）`);
  }

  async function act(args = {}) {
    const action = typeof args.action === "string" ? args.action : "";
    if (action === "click") return clickTarget(args);
    if (action === "fill" || action === "type") return fill({ ...args, action });
    if (action === "press") return press(args);
    if (action === "hover") return hover(args);
    if (action === "select") return selectOption(args);
    if (action === "check" || action === "uncheck") return check({ ...args, action });
    if (action === "drag") return drag(args);
    if (action === "upload") return upload(args);
    if (action === "scrollIntoView") return scrollTarget(args);
    if (action === "wait") return waitFor(args);
    if (action === "evaluate") return evaluate(args);
    throw new Error(`未知浏览器操作：${action}`);
  }

  async function consoleLogs({ clear = false } = {}) {
    await ensureAttached();
    const current = logs.slice(-MAX_LOGS);
    if (clear) {
      logs = [];
      lastError = "";
    }
    return { logs: current, error: lastError || undefined };
  }

  return {
    attach: ensureAttached,
    detach,
    snapshot,
    act,
    console: consoleLogs,
    truncateJson,
  };
}

module.exports = {
  createCdpBrowser,
  buildA11ySnapshot,
  parseKeyChord,
  truncateJson,
  normalizePoint,
  normalizeUploadPaths,
};
