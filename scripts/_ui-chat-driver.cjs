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
const fs = require("node:fs");

const BASE = process.env.DRIVE_BASE;
const REPLY = process.env.DRIVE_REPLY;
const SESSION_ID = process.env.DRIVE_SESSION_ID || "";
const PROVIDER_ID = process.env.DRIVE_PROVIDER || "";
const MODEL_NAME = process.env.DRIVE_MODEL || "";

/**
 * 界面选择器 —— **React 重写后的真实钩子**。
 *
 * ⚠️ 这份驱动曾经查 `.input-area` / `.btn-send` / `.chat-connection-error-text`，
 * 那是 Vue 时代的类名。2026-11-11 前端重写为 React + shadcn 后这三个类都不存在了，
 * 于是脚本永远停在「输入框始终没出现」——而它被列为交付前的真实验证手段之一，
 * 也就是说**这条验证路径静默失效了近两周**（HANDOFF 里只记了"Vue 测试套件退役"，
 * 没提这个仍被当作现役手段的脚本）。
 *
 * 现在的真实钩子（改界面时请同步这里）：
 *   - 输入框：`components/ui/composer.tsx` 的 textarea（ChatInput 传 `aria-label`）
 *   - 发送按钮：同一文件的 Button，`aria-label` 默认 "Send"（流式中变 "Stop"）
 * 优先用 aria-label / data-slot 这类**语义钩子**，不用样式类名——样式会随设计改，
 * 语义钩子改的时候通常也会顺手改测试。
 */
const SEL = {
  input: '[data-slot="composer"] textarea',
  send: '[data-slot="composer"] button[aria-label="Send"]',
  stop: '[data-slot="composer"] button[aria-label="Stop"]',
};

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

  // 选中假渠道：否则界面会沿用上次真实渠道（实测跑到 MiMo 免费额度上，
  // 上游 429 直接结束回合，验收窗口自然不会出现——这不是界面缺陷）。
  // 先把 session/provider/model 写进 localStorage，再 reload 让应用读到。
  if (SESSION_ID) {
    await win.webContents.executeJavaScript(`(() => {
      localStorage.setItem('maxma_session_id', ${JSON.stringify(SESSION_ID)});
      ${PROVIDER_ID ? `localStorage.setItem('maxma_selected_provider', ${JSON.stringify(PROVIDER_ID)});` : ''}
      ${MODEL_NAME ? `localStorage.setItem('maxma_selected_model', ${JSON.stringify(MODEL_NAME)});` : ''}
      return true;
    })()`).catch(() => null);
    await win.webContents.reload();
    await sleep(3000);
    logs.length = 0;
  }

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
        .executeJavaScript("!!document.querySelector('" + SEL.input + "')")
        .catch(() => false);
      if (has) {
        inputReady = true;
        break;
      }
    }
    if (!inputReady) throw new Error("聊天输入框始终没出现（界面可能停在引导页或未渲染）");
    result.stage = "input-ready";

    // 2) 输入文本：用原生 value setter 再派发 input 事件，让 React 的受控组件收到
    //
    // 注意：这里**不能**把 REPLY 本身写进用户消息。第一版写的是
    // `请回复：${REPLY}`，于是 `document.body.innerText` 在用户气泡里就命中了 REPLY——
    // 即使模型报错、根本没有回复，脚本也会判定"看到回复"（实测 2026-11-18 踩到）。
    await win.webContents.executeJavaScript(`(() => {
      const ta = document.querySelector('${SEL.input}');
      ta.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '请回复一句验证语');
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
          const ta = document.querySelector('${SEL.input}');
          const btn = document.querySelector('${SEL.send}');
          const stopBtn = document.querySelector('${SEL.stop}');
          return {
            hasInput: !!ta,
            hasSend: !!btn,
            disabled: btn ? btn.disabled : null,
            label: btn ? btn.getAttribute('aria-label') : null,
            streaming: !!stopBtn,
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
      result.stage = "send-disabled:label=" + (st.label || "(无 aria-label)") + ",streaming=" + st.streaming;
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
        const btn = document.querySelector('${SEL.send}');
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

    // 5) 完成后验收必须是一个**一直悬浮**的窗口：
    //    - position=fixed（不跟消息区滚动、不占消息区高度）；
    //    - 停靠在视口内；
    //    - 滚动聊天区后位置不变；
    //    - 等一会儿仍在（不是闪现）。
    let review = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      review = await win.webContents.executeJavaScript(`(() => {
        const el = document.querySelector('[data-slot="task-review-window"]');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          position: cs.position,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          vw: innerWidth, vh: innerHeight,
          text: el.innerText.slice(0, 160),
        };
      })()`).catch(() => null);
      if (review) break;
    }
    if (!review) throw new Error("回答结束后没有出现「完成后验收」悬浮窗");
    if (review.position !== "fixed") throw new Error("完成后验收不是 fixed 定位（position=" + review.position + "）");
    if (review.rect.x < 0 || review.rect.y < 0 || review.rect.x + review.rect.w > review.vw || review.rect.y + review.rect.h > review.vh) {
      throw new Error("完成后验收窗口超出视口：" + JSON.stringify(review));
    }

    const scrolled = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('[data-slot="task-review-window"]');
      const before = el.getBoundingClientRect();
      const scrollers = [...document.querySelectorAll('*')].filter((node) => {
        const s = getComputedStyle(node);
        return /(auto|scroll)/.test(s.overflowY) && node.scrollHeight > node.clientHeight + 40;
      });
      (scrollers[0] || document.scrollingElement).scrollTop += 600;
      const after = el.getBoundingClientRect();
      return { dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y), scrollers: scrollers.length };
    })()`);
    if (Math.abs(scrolled.dx) > 1 || Math.abs(scrolled.dy) > 1) {
      throw new Error("滚动聊天区后验收窗口跟着移动了（dx=" + scrolled.dx + ", dy=" + scrolled.dy + "）");
    }
    await sleep(1500);
    const stillThere = await win.webContents.executeJavaScript("!!document.querySelector('[data-slot=\"task-review-window\"]')").catch(() => false);
    if (!stillThere) throw new Error("验收窗口在回答结束后自行消失（未保持悬浮）");

    result.reviewFloating = true;
    result.reviewState = review;
    result.stage = "review-floating";

    // 可选存证：DRIVE_SHOT=<png 路径>。默认不写盘，避免验证脚本留下垃圾文件。
    // 放在点击「结果符合预期」之前——点完窗口就收起了，那样只截到一张没有浮窗的图。
    if (process.env.DRIVE_SHOT) {
      try {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(process.env.DRIVE_SHOT, image.toPNG());
        result.shot = process.env.DRIVE_SHOT;
      } catch (err) {
        result.shotError = String(err && err.message ? err.message : err);
      }
    }

    // 决策后必须收起：点「结果符合预期」→ 后端 accepted → 窗口消失。
    // 若这里不清，用户会以为"已经处理过"却一直看到同一张卡片。
    await win.webContents.executeJavaScript(`(() => {
      const btns = [...document.querySelectorAll('[data-slot="task-review-window"] button')];
      const accept = btns.find((b) => b.textContent.trim() === '结果符合预期');
      if (!accept) return false;
      accept.click();
      return true;
    })()`);
    let cleared = false;
    for (let i = 0; i < 16; i++) {
      await sleep(400);
      cleared = await win.webContents.executeJavaScript("!document.querySelector('[data-slot=\"task-review-window\"]')").catch(() => false);
      if (cleared) break;
    }
    if (!cleared) throw new Error("点「结果符合预期」后验收窗口没有收起");
    result.reviewCleared = true;
    result.stage = "review-cleared";
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    result.pageText = await win.webContents
      .executeJavaScript("document.body.innerText.slice(0, 600)")
      .catch(() => "");
  }

  process.stdout.write("DRIVE_RESULT " + JSON.stringify(result) + "\n");
  app.exit(result.replySeen && result.reviewFloating ? 0 : 1);
});
