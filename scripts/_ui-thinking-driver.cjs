/**
 * scripts/_ui-thinking-driver.cjs — 验证"思考不混进回复"（THINK-SPLIT-001）。
 *
 * 由 `scripts/verify-ui-thinking-separation.mjs` 启动。同源同坑见 `_ui-chat-driver.cjs`。
 *
 * 判据全部来自页面可见文本：
 *   - 回复正文必须出现（ANSWER）
 *   - 思考内容不得出现在回复里（REASONING）
 *
 * 不断言"思考块不存在"——思考本来就该显示（折叠区）。只断言它不混进正文。
 */
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const { app, BrowserWindow } = require("electron");

const BASE = process.env.DRIVE_BASE;
const ANSWER = process.env.DRIVE_ANSWER;
const REASONING = process.env.DRIVE_REASONING;
const SESSION_KEY = "maxma_session_id";
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

  const result = { stage: "start", answerSeen: false, reasoningLeaked: false, consoleErrors: logs };

  try {
    await win.webContents.session.clearCache();
    await win.loadURL(BASE + "/");
    const sid = process.env.DRIVE_SESSION_ID;
    if (sid) {
      await win.webContents.executeJavaScript(
        `(() => { localStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(sid)}); return true })()`,
      ).catch(() => null);
      await win.webContents.reload();
      await sleep(3000);
      logs.length = 0;
    }
    result.stage = "loaded";

    let ready = false;
    for (let i = 0; i < 80; i++) {
      await sleep(500);
      ready = await win.webContents
        .executeJavaScript('!!document.querySelector(\'[data-slot="composer"] textarea\')')
        .catch(() => false);
      if (ready) break;
    }
    if (!ready) throw new Error("聊天界面未就绪");
    result.stage = "chat-ready";

    // 切到假渠道的模型——否则用的是内置免费渠道，测不到 reasoning 分离。
    await win.webContents.executeJavaScript(`(() => {
      const trigger = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '模型');
      if (trigger) trigger.click();
      return !!trigger;
    })()`);
    await sleep(500);
    const picked = await win.webContents.executeJavaScript(`(() => {
      const items = [...document.querySelectorAll('[role="menuitemradio"], [role="option"], [role="menuitem"]')];
      const hit = items.find((el) => (el.textContent || '').includes(${JSON.stringify(process.env.DRIVE_MODEL ?? 'think-split-model')}));
      if (!hit) return false;
      hit.click();
      return true;
    })()`);
    if (!picked) throw new Error('模型选择器里找不到假渠道模型');
    await sleep(600);
    result.stage = "model-picked";

    await win.webContents.executeJavaScript(`(() => {
      const ta = document.querySelector('[data-slot="composer"] textarea');
      ta.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '介绍一下你自己');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value;
    })()`);
    await sleep(600);

    const sent = await win.webContents.executeJavaScript(`(() => {
      const btn = document.querySelector('[data-slot="composer"] button[aria-label="Send"]');
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    })()`);
    if (!sent) throw new Error("发送按钮不可点");
    result.stage = "sent";

    // 等回复正文出现，并在**流式过程中**持续采样：
    // 真正的缺陷只在流式中可见——结束后 answer 事件会把答案覆盖到块上，
    // 最终态看着总是干净的（所以只看最终态会漏掉，第一版变异验证就死在这）。
    let text = "";
    let leakedDuringStream = false;
    let leakedSample = "";
    for (let i = 0; i < 120; i++) {
      await sleep(100);
      const sample = await win.webContents.executeJavaScript(`(() => {
        const answer = ${JSON.stringify(ANSWER)};
        const probe = answer.slice(0, 6);
        // 必须用 textContent 而不是 innerText：思考块是 <details> 且默认关闭，
        // innerText 会排除未渲染的子节点——第一版用 innerText 探针，于是永远
        // 判定"答案还没出现"，漏掉了流式中的混入（自己踩了一次）。
        const details = [...document.querySelectorAll('details[data-slot="reasoning"]')];
        const inThinking = details.some((d) => (d.textContent || '').includes(probe));
        const bodyText = document.body.textContent || '';
        return { probeInPage: bodyText.includes(probe), inThinking };
      })()`).catch(() => null);
      if (!sample) continue;
      if (sample.probeInPage && sample.inThinking) {
        leakedDuringStream = true;
        leakedSample = await win.webContents.executeJavaScript("document.body.textContent").catch(() => "");
        break;
      }
      if (sample.probeInPage) { result.answerSeen = true; break; }
    }

    text = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
    result.pageText = text.slice(0, 2000);
    if (!result.answerSeen && !leakedDuringStream) throw new Error("回复正文没有出现");
    result.stage = "answer-seen";

    if (leakedDuringStream) {
      result.reasoningLeaked = true;
      result.pageText = String(leakedSample).slice(0, 2000);
      throw new Error("流式过程中答案文字出现在思考块里（思考与回复未分离）");
    }

    // 最终态再确认一次：正文节点的文本不含思考内容。
    const leaked = await win.webContents.executeJavaScript(`(() => {
      const answer = ${JSON.stringify(ANSWER)};
      const reasoning = ${JSON.stringify(REASONING)};
      const all = [...document.querySelectorAll('article *')];
      const holders = all.filter((el) => (el.textContent || '').includes(answer));
      if (!holders.length) return { found: false, leaked: false };
      const innermost = holders.filter((el) => ![...el.children].some((c) => (c.textContent || '').includes(answer)));
      const target = innermost[0] || holders[holders.length - 1];
      return { found: true, leaked: (target.textContent || '').includes(reasoning), text: (target.textContent || '').slice(0, 200) };
    })()`);

    result.answerNodeFound = leaked.found;
    if (leaked.leaked === true) result.reasoningLeaked = true;
    result.answerNodeText = leaked.text;

    if (result.reasoningLeaked) {
      throw new Error(`思考内容混进了回复正文：${String(leaked.text).slice(0, 120)}`);
    }
    // THINK-PICK-001：输入框底部必须有「思考」选择器（此前只有设置页能改）。
    //
    // 档位表在**每轮结束后**异步重取（会话模型是 chat-ws 按每条消息的
    // provider/model 现切的），所以要等它刷新，不能一答完就断言。
    let opts = [];
    let pickerText = "";
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const opened = await win.webContents.executeJavaScript(`(() => {
        const trigger = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '思考');
        if (!trigger) return { found: false };
        trigger.click();
        return { found: true, text: (trigger.textContent || '').trim() };
      })()`);
      if (!opened.found) throw new Error("输入框底部没有「思考」选择器");
      pickerText = opened.text;
      await sleep(400);
      opts = await win.webContents.executeJavaScript(`(() => {
        return [...document.querySelectorAll('[role="menuitemradio"]')].map((el) => (el.textContent || '').trim());
      })()`);
      await win.webContents.executeJavaScript(`(() => { document.body.click(); return true })()`);
      await sleep(200);
      if (opts.length > 1) break;
    }

    result.thinkingPicker = true;
    result.thinkingPickerLabel = pickerText;
    result.thinkingOptions = opts;
    result.thinkingOptionCount = opts.length;
    if (!opts.length) throw new Error("「思考」选择器没有展开出任何档位");
    if (opts.length < 2) {
      throw new Error(`思考档位只有 ${opts.length} 个（${opts.join("/")}）——渠道的 reasoning 标志没有生效`);
    }

    result.stage = "verified";
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }

  process.stdout.write("DRIVE_RESULT " + JSON.stringify(result) + "\n");
  app.exit(result.answerSeen && !result.reasoningLeaked && !result.error ? 0 : 1);
});
