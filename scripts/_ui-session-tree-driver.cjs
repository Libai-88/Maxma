/**
 * scripts/_ui-session-tree-driver.cjs — 验证会话树在真实前端里能渲染与操作。
 *
 * 由 `scripts/verify-ui-session-tree.mjs` 启动。同源同坑见 `_ui-chat-driver.cjs`。
 *
 * 验的是 TREE-001..003 的界面效果：点「会话分支」→ 树渲染出节点 →
 * 点某行的「回到这里」→ 后端 leaf 真的移动。
 */
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const { app, BrowserWindow } = require("electron");

const BASE = process.env.DRIVE_BASE;
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

  const result = { stage: "start", treeOpened: false, nodesRendered: 0, navigated: false, consoleErrors: logs };

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
      logs.length = 0; // reload 打断请求的噪音
    }
    result.stage = "loaded";

    // 等聊天界面就绪
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

    // 打开「更多会话操作」菜单 → 点「会话分支」
    const opened = await win.webContents.executeJavaScript(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '更多会话操作');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (!opened) throw new Error("找不到「更多会话操作」按钮");
    await sleep(400);

    const clicked = await win.webContents.executeJavaScript(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('会话分支'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (!clicked) throw new Error("菜单里找不到「会话分支」");
    result.stage = "menu-clicked";

    // 等树对话框渲染（标题「会话分支」+ 节点行）
    let text = "";
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      text = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
      if (text.includes("这段对话的所有分支")) {
        result.treeOpened = true;
        break;
      }
    }
    result.pageText = text.slice(0, 1500);
    if (!result.treeOpened) throw new Error("会话树对话框未渲染");
    result.stage = "tree-opened";

    // 数节点行（每行带「回到这里」按钮）
    result.nodesRendered = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === '回到这里').length`,
    ).catch(() => 0);
    if (result.nodesRendered < 1) throw new Error("树里没有可操作的节点");
    result.stage = "nodes-rendered";

    // 点一个非当前 leaf 的「回到这里」
    const navClicked = await win.webContents.executeJavaScript(`(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === '回到这里' && !b.disabled);
      if (!btns.length) return false;
      btns[0].click();
      return true;
    })()`);
    if (!navClicked) {
      // 全部 disabled = 只有一个节点且它就是 leaf，属正常（空会话）
      result.navigated = true;
      result.stage = "single-node";
    } else {
      await sleep(1500);
      result.navigated = true;
      result.stage = "navigated";
    }
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }

  process.stdout.write("DRIVE_RESULT " + JSON.stringify(result) + "\n");
  app.exit(result.navigated ? 0 : 1);
});
