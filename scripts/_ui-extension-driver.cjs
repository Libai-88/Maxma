/**
 * scripts/_ui-extension-driver.cjs — 验证扩展对话框在真实前端里能弹出并回传。
 *
 * 由 `scripts/verify-ui-extension.mjs` 启动。与 `_ui-chat-driver.cjs` 同源同坑
 * （裸模块名 `require("electron")` + 清掉 ELECTRON_RUN_AS_NODE）。
 *
 * ## 验的是完整真实链路
 *
 * 后端真的加载了一个扩展（`~/.pi/agent/extensions/probe-confirm.ts`），前端真的发
 * `/probe-confirm` 触发它，扩展真的 `await ctx.ui.confirm(...)`，界面真的弹窗，
 * 点「是」后扩展真的收到 `true` 并 notify。
 *
 * 不使用伪造事件或注入 store：那样只能证明"组件能渲染"，证明不了"扩展的
 * ctx.ui 真的有落点"——而后者才是 EXT-UI-001 要解决的问题。
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

  const result = { stage: "start", dialogShown: false, replied: false, consoleErrors: logs };

  try {
    await win.webContents.session.clearCache();

    // 先把新会话 id 写进 localStorage，**再**首次加载页面。
    //
    // 前端「优先续上最近一次对话」会读 `maxma_session_id`。pi 的扩展在
    // create_session 时装配，复用旧会话就不会加载本轮新放的扩展——症状是
    // 「扩展命令被当成普通消息发给模型」。先加载一次空壳再写键会晚一步
    // （页面已经开始初始化旧会话），所以这里用 about:blank 打底。
    const SESSION_KEY = process.env.DRIVE_SESSION_KEY || "maxma_session_id";
    const sid = process.env.DRIVE_SESSION_ID;

    // 先加载首页（建立同源 origin），立刻写 sessionId，再 reload 一次让应用读到它。
    // 这一步会产生若干 `Failed to fetch`——第一次加载时应用已经开始连 WS/REST，
    // reload 打断了它们。那是**本脚本的**噪音，不是产品缺陷，下面过滤掉。
    await win.loadURL(BASE + "/");
    if (sid) {
      await win.webContents.executeJavaScript(
        `(() => { localStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(sid)}); return true })()`,
      ).catch(() => null);
      await win.webContents.reload();
      // 等应用在 reload 后重新连上 WS/REST，再把这段时间的瞬时失败清掉。
      // 它们来自 reload 打断正在进行的请求，是本脚本引入的，不是产品缺陷。
      await sleep(3000);
      logs.length = 0;
    }
    result.stage = "loaded";

    // 等聊天输入框就绪
    let ready = false;
    for (let i = 0; i < 80; i++) {
      await sleep(500);
      ready = await win.webContents
        .executeJavaScript('!!document.querySelector(\'[data-slot="composer"] textarea\')')
        .catch(() => false);
      if (ready) break;
    }
    if (!ready) throw new Error("聊天界面未就绪（输入框未出现）");
    result.stage = "chat-ready";

    // 发 /probe-confirm —— 走真实 WS，后端会把它分发给扩展命令
    await win.webContents.executeJavaScript(`(() => {
      const ta = document.querySelector('[data-slot="composer"] textarea');
      ta.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '/probe-confirm');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value;
    })()`);
    await sleep(500);

    const sent = await win.webContents.executeJavaScript(`(() => {
      const btn = document.querySelector('[data-slot="composer"] button[aria-label="Send"]');
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    })()`);
    if (!sent) throw new Error("发送按钮不可点（/probe-confirm 未发出）");
    result.stage = "sent";

    // 扩展的 ctx.ui.confirm 应当弹窗
    let text = "";
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      text = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
      if (text.includes("扩展确认")) {
        result.dialogShown = true;
        break;
      }
    }
    result.pageText = text.slice(0, 1500);
    if (!result.dialogShown) {
      throw new Error("扩展的 ctx.ui.confirm 没有弹出对话框——UI 上下文仍未接通");
    }
    result.stage = "dialog-shown";

    // 点「是」，扩展应收到 true 并 notify「用户点了是」
    const clicked = await win.webContents.executeJavaScript(`(() => {
      const btns = [...document.querySelectorAll('button')];
      const yes = btns.find((b) => b.textContent.trim() === '是');
      if (!yes) return false;
      yes.click();
      return true;
    })()`);
    if (!clicked) throw new Error("找不到「是」按钮");

    for (let i = 0; i < 30; i++) {
      await sleep(400);
      const after = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
      // 扩展的 notify 会以 toast 形式出现
      if (after.includes("用户点了是")) {
        result.replied = true;
        break;
      }
    }
    if (!result.replied) throw new Error("点「是」后扩展没有收到答复（notify 未出现）");
    result.stage = "replied";
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }

  process.stdout.write("DRIVE_RESULT " + JSON.stringify(result) + "\n");
  app.exit(result.replied ? 0 : 1);
});
