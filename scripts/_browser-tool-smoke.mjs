/**
 * _browser-tool-smoke.mjs — 在真实 Electron 运行期间调用 Maxma 自己的浏览器工具。
 *
 * 由 _ui-workbench-driver.cjs 以独立 bun 进程启动，MAXMA_DATA_DIR 指向
 * browser-agent.json 所在的数据目录。输出最后一行是给驱动解析的 JSON。
 */

import fs from "node:fs";
import {
  browserActTool,
  browserNavigateTool,
  browserReadTool,
} from "../bun-sidecar/src/tools/browser.ts";

const url = process.argv[2];
const uploadPath = process.argv[3];
const downloadUrl = process.argv[4];
if (!url) throw new Error("缺少本地交互页 URL");
if (!uploadPath) throw new Error("缺少上传验收文件路径");
if (!downloadUrl) throw new Error("缺少下载验收 URL");

function textOf(result) {
  const block = (result?.content ?? []).find((item) => item.type === "text");
  if (!block || typeof block.text !== "string") throw new Error("工具没有返回 text 内容");
  return block.text;
}

function jsonOf(result, label) {
  const text = textOf(result);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 返回的不是 JSON：${text.slice(0, 400)}`);
  }
}

const call = (tool, id, params) => tool.execute(id, params);
const snapshot = async (id) => jsonOf(await call(browserReadTool(), id, { action: "snapshot" }), "snapshot");

async function main() {
  const navigate = jsonOf(await call(browserNavigateTool(), "e2e-nav", { url }), "navigate");
  if (!String(navigate.url).startsWith(url.replace(/\/$/, ""))) {
    throw new Error(`导航未落到本地页：${navigate.url}`);
  }

  const first = await snapshot("e2e-snap-1");
  const name = first.elements.find((item) => item.role === "textbox" && /Your name/i.test(item.name ?? ""));
  const choice = first.elements.find((item) => item.role === "combobox" && /Choice/i.test(item.name ?? ""));
  const agree = first.elements.find((item) => item.role === "checkbox" && /I agree/i.test(item.name ?? ""));
  const greet = first.elements.find((item) => item.role === "button" && /Greet/i.test(item.name ?? ""));
  for (const [label, item] of [["姓名输入框", name], ["下拉框", choice], ["复选框", agree], ["按钮", greet]]) {
    if (!item?.ref) throw new Error(`snapshot 缺少${label}的 ref：${JSON.stringify(first.elements)}`);
  }

  const fill = jsonOf(
    await call(browserActTool(), "e2e-fill", { action: "fill", ref: name.ref, text: "Maxma" }),
    "fill",
  );
  if (fill.length !== 5) throw new Error(`fill 长度不对：${JSON.stringify(fill)}`);
  let page = await snapshot("e2e-snap-2");
  if (!page.text.includes("Maxma")) throw new Error(`输入后正文没有 Maxma：${page.text}`);

  await call(browserActTool(), "e2e-enter-diag", {
    action: "evaluate",
    expression: "(() => { window.__maxmaKeys = []; document.addEventListener('keydown', (event) => window.__maxmaKeys.push({ key: event.key, target: event.target && event.target.id }), true); return true; })()",
  });
  const enterPress = await call(browserActTool(), "e2e-enter", { action: "press", ref: name.ref, key: "Enter" });
  const enterPressJson = jsonOf(enterPress, "enter press");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const enterDiag = jsonOf(
    await call(browserActTool(), "e2e-enter-diag-read", {
      action: "evaluate",
      expression: "({ active: document.activeElement && document.activeElement.id, focused: document.hasFocus(), keys: window.__maxmaKeys || [] })",
    }),
    "enter diag",
  ).value;
  page = await snapshot("e2e-snap-3");
  if (!page.text.includes("Enter Maxma")) throw new Error(`Enter 没有触发页面事件：${JSON.stringify(enterDiag)}；press=${JSON.stringify({ acted: enterPressJson.acted, key: enterPressJson.key, transport: enterPressJson.transport, webContentsFocused: enterPressJson.webContentsFocused })}；${page.text}`);

  const select = jsonOf(
    await call(browserActTool(), "e2e-select", { action: "select", ref: choice.ref, value: "b" }),
    "select",
  );
  if (select.value !== "b") throw new Error(`select 没有生效：${JSON.stringify(select)}`);

  const check = jsonOf(
    await call(browserActTool(), "e2e-check", { action: "check", ref: agree.ref }),
    "check",
  );
  if (check.checked !== true) throw new Error(`check 没有生效：${JSON.stringify(check)}`);

  const click = jsonOf(
    await call(browserActTool(), "e2e-click", { action: "click", ref: greet.ref }),
    "click",
  );
  if (!click.point || typeof click.point.x !== "number") throw new Error(`click 没有原生坐标：${JSON.stringify(click)}`);

  await call(browserActTool(), "e2e-wait", { action: "wait", selector: "#out", timeoutMs: 2000 });
  page = await snapshot("e2e-snap-4");
  const expected = "Hello Maxma b yes";
  if (!page.text.includes(expected)) throw new Error(`点击后正文不是「${expected}」：${page.text}`);

  // 视觉定位路径：不依赖 ref，用截图/坐标直接点同一个按钮。
  const coordinateClick = jsonOf(
    await call(browserActTool(), "e2e-click-xy", { action: "click", x: click.point.x, y: click.point.y }),
    "coordinate click",
  );
  if (coordinateClick.coordinates !== true) throw new Error(`坐标点击没有走原生路径：${JSON.stringify(coordinateClick)}`);

  // wait 支持正文文本，不再只等 selector。
  const waitByText = jsonOf(
    await call(browserActTool(), "e2e-wait-text", { action: "wait", text: expected, timeoutMs: 2000 }),
    "wait text",
  );
  if (waitByText.waitedMs === undefined) throw new Error(`wait text 没有返回等待时长：${JSON.stringify(waitByText)}`);

  // 真实鼠标拖拽：从画板内一点拖到另一点，页面自己记录起点/终点。
  const padRect = jsonOf(
    await call(browserActTool(), "e2e-pad-rect", {
      action: "evaluate",
      expression: "(() => { const r = document.querySelector('#pad').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()",
    }),
    "pad rect",
  ).value;
  const drag = jsonOf(
    await call(browserActTool(), "e2e-drag", {
      action: "drag",
      x: Math.round(padRect.x + 20),
      y: Math.round(padRect.y + 20),
      toX: Math.round(padRect.x + 180),
      toY: Math.round(padRect.y + 80),
    }),
    "drag",
  );
  if (drag.acted !== "drag") throw new Error(`drag 没有执行：${JSON.stringify(drag)}`);
  page = await snapshot("e2e-snap-5");
  if (!/Drag \d+,\d+ -> \d+,\d+/.test(page.text)) throw new Error(`拖拽没有触发页面事件：${page.text}`);

  // 原生文件上传：DOM.setFileInputFiles 写进真实 input[type=file]。
  const upload = jsonOf(
    await call(browserActTool(), "e2e-upload", { action: "upload", selector: "#doc", files: [uploadPath] }),
    "upload",
  );
  if (upload.count !== 1) throw new Error(`upload 没有写入文件：${JSON.stringify(upload)}`);
  await call(browserActTool(), "e2e-wait-file", { action: "wait", text: "File browser-upload.txt", timeoutMs: 2000 });
  page = await snapshot("e2e-snap-6");
  if (!page.text.includes("File browser-upload.txt")) throw new Error(`上传后页面没有文件名：${page.text}`);

  const scrollInto = jsonOf(
    await call(browserActTool(), "e2e-scroll-into", { action: "scrollIntoView", selector: "#note" }),
    "scrollIntoView",
  );
  if (scrollInto.acted !== "scrollIntoView" || typeof scrollInto.point?.y !== "number") {
    throw new Error(`scrollIntoView 没有返回几何位置：${JSON.stringify(scrollInto)}`);
  }

  const evaluated = jsonOf(
    await call(browserActTool(), "e2e-eval", {
      action: "evaluate",
      expression: "document.querySelector('#out').textContent",
    }),
    "evaluate",
  );
  if (evaluated.value !== expected) throw new Error(`evaluate 读回不一致：${JSON.stringify(evaluated)}`);

  // 给 console 事件一点派发时间，再走工具读取页面日志。
  await new Promise((resolve) => setTimeout(resolve, 300));
  const logs = jsonOf(await call(browserReadTool(), "e2e-console", { action: "console" }), "console");
  if (!(logs.logs ?? []).some((entry) => String(entry.text).includes("maxma-greeted"))) {
    throw new Error(`console 没有拿到页面日志：${JSON.stringify(logs)}`);
  }

  const badRef = textOf(
    await call(browserActTool(), "e2e-bad-ref", { action: "click", ref: "e999" }),
  );
  if (!badRef.includes("已失效")) throw new Error(`失效 ref 没有明确报错：${badRef}`);

  // 多页签：工具新建后台页签，不抢当前页面；接着定向关闭。
  const tabsBefore = jsonOf(await call(browserReadTool(), "e2e-tabs-1", { action: "tabs" }), "tabs before");
  if (!Array.isArray(tabsBefore.tabs) || tabsBefore.tabs.length !== 1) {
    throw new Error(`初始页签数量不对：${JSON.stringify(tabsBefore)}`);
  }
  const downloadTab = jsonOf(
    await call(browserNavigateTool(), "e2e-new-tab", { url: downloadUrl, newTab: true }),
    "download new tab",
  );
  if (typeof downloadTab.tabId !== "string") throw new Error(`新页签没有返回 tabId：${JSON.stringify(downloadTab)}`);
  const tabsAfter = jsonOf(await call(browserReadTool(), "e2e-tabs-2", { action: "tabs" }), "tabs after");
  if (tabsAfter.tabs.length !== 2 || !tabsAfter.tabs.some((tab) => tab.id === downloadTab.tabId)) {
    throw new Error(`新建页签没有进入 tab 列表：${JSON.stringify(tabsAfter)}`);
  }

  // 下载落盘：页面触发 will-download，文件必须保存在 Maxma downloads 目录并可读。
  let download = null;
  let downloadsPayload = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    downloadsPayload = jsonOf(await call(browserReadTool(), `e2e-downloads-${attempt}`, { action: "downloads" }), "downloads");
    download = (downloadsPayload.downloads ?? []).find((item) => item.state === "completed") ?? null;
    if (download) break;
  }
  if (!download) throw new Error(`下载没有完成：${JSON.stringify(downloadsPayload)}`);
  if (!fs.existsSync(download.path)) throw new Error(`下载文件不在磁盘：${download.path}`);
  if (!fs.readFileSync(download.path, "utf8").includes("maxma download body")) {
    throw new Error(`下载文件内容不对：${download.path}`);
  }
  if (!String(download.path).includes("downloads")) throw new Error(`下载不在 downloads 目录：${download.path}`);

  const closed = jsonOf(
    await call(browserActTool(), "e2e-close-tab", { action: "closeTab", tabId: downloadTab.tabId }),
    "close tab",
  );
  if (closed.tabs.length !== 1) throw new Error(`关闭页签后数量不对：${JSON.stringify(closed.tabs)}`);

  return {
    ok: true,
    url: navigate.url,
    tool: "browser_navigate/browser_read/browser_act",
    elements: first.elements.length,
    roles: first.elements.map((item) => `${item.role}:${item.name ?? item.value ?? ""}`),
    fillLength: fill.length,
    enterText: "Enter Maxma",
    selectValue: select.value,
    checked: check.checked,
    clickPoint: click.point,
    coordinateClick: coordinateClick.coordinates,
    drag: { from: drag.from, to: drag.to, steps: drag.steps },
    dragText: /Drag \d+,\d+ -> \d+,\d+/.exec(page.text)?.[0],
    uploadNames: upload.names,
    uploadText: "File browser-upload.txt",
    scrollIntoViewY: scrollInto.point.y,
    clickResult: expected,
    evaluated: evaluated.value,
    consoleLog: (logs.logs ?? []).find((entry) => String(entry.text).includes("maxma-greeted"))?.text,
    invalidRefRejected: badRef.slice(0, 160),
    tabCountBefore: tabsBefore.tabs.length,
    tabCountAfterNew: tabsAfter.tabs.length,
    downloadTabId: downloadTab.tabId,
    downloadName: download.filename,
    downloadPath: download.path,
    downloadBytes: download.receivedBytes,
    tabCountAfterClose: closed.tabs.length,
  };
}

main().then((result) => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}).catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.message ?? error) })}\n`);
  process.exitCode = 1;
});
