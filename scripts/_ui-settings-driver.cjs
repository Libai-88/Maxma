delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;
const { app, BrowserWindow } = require("electron");
const BASE = process.env.DRIVE_BASE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { sandbox: true, contextIsolation: true } });
  const logs = [];
  win.webContents.on("console-message", (_e, l, m) => { if (l >= 2) logs.push(m); });
  const result = { stage: "start", modelTab: false, imagesTab: false, compactionFields: 0, consoleErrors: logs };
  try {
    await win.webContents.session.clearCache();
    await win.loadURL(BASE + "/settings");
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const t = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
      if (t.includes("上下文管理")) { result.pageText = t.slice(0, 2000); break; }
    }
    // 点「模型行为」tab
    const ok1 = await win.webContents.executeJavaScript(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '模型行为');
      if (!b) return false; b.click(); return true; })()`);
    await sleep(600);
    const t1 = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
    result.modelTab = ok1 && t1.includes("缓存预热") && t1.includes("默认思考档位");
    // 点「图片」tab
    const ok2 = await win.webContents.executeJavaScript(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '图片');
      if (!b) return false; b.click(); return true; })()`);
    await sleep(600);
    const t2 = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
    result.imagesTab = ok2 && t2.includes("自动缩放") && t2.includes("禁止发送图片");
    // 回上下文管理数新字段
    await win.webContents.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='上下文管理'); if(b)b.click(); })()`);
    await sleep(600);
    const t3 = await win.webContents.executeJavaScript("document.body.innerText").catch(() => "");
    result.compactionFields = ["压缩触发余量","压缩后保留","分支摘要不询问"].filter(k => t3.includes(k)).length;
    result.stage = "done";
  } catch (e) { result.error = String(e?.message ?? e); }
  process.stdout.write("DRIVE_RESULT " + JSON.stringify(result) + "\n");
  app.exit(result.modelTab && result.imagesTab && result.compactionFields === 3 ? 0 : 1);
});
