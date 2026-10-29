/**
 * scripts/_ui-chat-driver.cjs — 用 Electron 驱动真实前端界面的最小主进程。
 *
 * 由 `scripts/verify-ui-chat-roundtrip.mjs` 启动；**不是**给人单独跑的脚本，
 * 但它随仓库分发（不是临时文件）—— 原因见 `verify-ui-chat-roundtrip.mjs` 里的注释：
 * 内联成模板字符串要在 `String.raw` 里再转义反引号，实测极易写错。
 *
 * 输入（环境变量）：`DRIVE_BASE`（后端地址）、`DRIVE_REPLY`（期望在界面上出现的正文）。
 * 输出：stdout 一行 `DRIVE_RESULT {json}`，退出码 0 = 界面出现回复。
 *
 * ## ⚠️⚠️ 关于 `require("electron")`：必须写**裸模块名**，不能写路径
 *
 * Electron 运行时对 `require("electron")` 做了**特殊接管**：它返回的是 Electron 的
 * 主进程 API（`app` / `BrowserWindow` …）。而 `desktop/node_modules/electron` 这个
 * **npm 包**导出的是**可执行文件路径字符串**（给 `spawn` 用的那种），
 * 两者同名不同物。
 *
 * 实测踩过两轮，症状完全不同、都很有误导性：
 *   1. 写 `require("electron")` 但进程被 `ELECTRON_RUN_AS_NODE` 退化成纯 Node
 *      ⇒ 找不到模块（因为那时走的是普通 CJS 解析，而 scripts/ 向上找不到
 *      desktop/node_modules）。
 *   2. 改成 `require(path.join(__dirname,"..","desktop","node_modules","electron"))`
 *      ⇒ Electron 能起来，但拿到的是 npm 包对象 ⇒
 *      `TypeError: Cannot read properties of undefined (reading 'whenReady')`。
 *
 * 正解是**裸模块名 + 清掉 ELECTRON_RUN_AS_NODE**（两者缺一不可）：
 * Electron 自己会接管解析，不依赖本文件的相对位置。
 */
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const { app, BrowserWindow } = require("electron");

const BASE = process.env.DRIVE_BASE;
const REPLY = process.env.DRIVE_REPLY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true },
  });

  const logs = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) logs.push(message); // warning / error
  });
  win.webContents.on("render-process-gone", (_e, d) => logs.push("render-process-gone: " + JSON.stringify(d)));

  // 不需要注入 token：前端自己会在首次 API 调用时从 BASE + "/auth/token" 取
  //（web/src/api/index.ts 的 ensureTokenLoaded），也没有 localStorage 持久化。
  await win.loadURL(BASE + "/");

  const result = { stage: "start", replySeen: false, sendEnabled: false, consoleErrors: logs };

  try {
    // 1) 等输入框出现
    //
    // ⚠️⚠️ 顺序很重要：**必须先打字、再看发送按钮是否可用**。
    // 发送按钮的 `:disabled` 表达式是
    //   `(!text.trim() && …) || disabled || noProvider || !canSend`
    // —— 第一项就是"输入框为空"。所以"一上来按钮就是禁用的"是**正常状态**，
    // 不是故障。第一版驱动先查按钮可用性、再打字，于是必然等到超时，
    // 而且 `title` 为空（因为 `noProvider` / `!canSend` 都为假），
    // 排查时完全指不到真因。实测踩过这一轮。
    let inputReady = false;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      const has = await win.webContents
        .executeJavaScript("!!document.querySelector('.input-area')")
        .catch(() => false);
      if (has) {
        inputReady = true;
        break;
      }
    }
    if (!inputReady) throw new Error("聊天输入框始终没出现（界面可能停在引导页或未渲染）");
    result.stage = "input-ready";

    // 2) 输入文本：用原生 value setter 再派发 input 事件，让 Vue 的 v-model 收到
    await win.webContents.executeJavaScript(`(() => {
      const ta = document.querySelector('.input-area');
      ta.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '请回复：${REPLY}');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value;
    })()`);

    // 3) 打字之后再等按钮可用（此时才真正检验 noProvider / canSend / disabled 三个门控）
    let sendUsable = false;
    let lastState = null;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      const st = await win.webContents
        .executeJavaScript(`(() => {
          const ta = document.querySelector('.input-area');
          const btn = document.querySelector('.btn-send');
          const err = document.querySelector('.chat-connection-error-text');
          return {
            hasInput: !!ta,
            hasSend: !!btn,
            disabled: btn ? btn.disabled : null,
            title: btn ? btn.getAttribute('title') : null,
            connError: err ? err.textContent : null,
            inputValue: ta ? ta.value.slice(0, 20) : null,
            statusText: (document.body.innerText.match(/就绪|连接中|未连接|重连/) || [null])[0],
          };
        })()`)
        .catch(() => null);
      if (!st) continue;
      lastState = st;
      if (st.hasSend && st.disabled === false) {
        sendUsable = true;
        result.sendEnabled = true;
        result.stage = "send-enabled";
        break;
      }
      result.stage = "send-disabled:" + (st.title || "(title 为空)");
    }
    if (!sendUsable) {
      result.gateState = lastState;
      throw new Error(
        "输入文本后发送按钮仍不可点（stage=" +
          result.stage +
          "，门控快照=" +
          JSON.stringify(lastState) +
          "）",
      );
    }

    // 4) 点发送
    const clicked = await win.webContents
      .executeJavaScript(`(() => {
        const btn = document.querySelector('.btn-send');
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      })()`);
    if (!clicked) throw new Error("发送按钮点击失败");
    result.stage = "sent";

    // 4) 等界面上出现回复正文（流式结束后应落入气泡）
    for (let i = 0; i < 160; i++) {
      await sleep(500);
      const txt = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
      if (txt && txt.includes(REPLY)) {
        result.replySeen = true;
        result.stage = "reply-seen";
        break;
      }
    }
    if (!result.replySeen) throw new Error("界面上始终没出现回复正文（stage=" + result.stage + "）");
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    result.pageText = await win.webContents
      .executeJavaScript("document.body.innerText.slice(0, 600)")
      .catch(() => "");
  }

  process.stdout.write("DRIVE_RESULT " + JSON.stringify(result) + "\n");
  app.exit(result.replySeen ? 0 : 1);
});
