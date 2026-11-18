/**
 * scripts/_ui-visual-driver.cjs — 界面截图存证（Electron 真实窗口，不截图 DOM 模拟）。
 *
 * 由 `scripts/verify-ui-visual.mjs` 启动。与 `_ui-extension-driver.cjs` 同源：
 * 裸模块名 `require("electron")`，并且先清掉 `ELECTRON_RUN_AS_NODE`。
 *
 * ## 为什么截图，而不是像素 diff
 *
 * 像素 diff 要自己解 PNG（zlib + filter），收益不足以抵消维护成本；而这次改的是
 * **尺度**（字号/时长/层级），要判断的是「有没有破」，人眼看六张图比阈值报警更快。
 * 所以这里只做两件可自动化的事：截图落盘 + 每张图的尺寸与平均亮度。
 * 亮度是廉价的一致性探针：某页突然变白/变黑（玻璃塌了、遮罩写错）会先在这里报警。
 *
 * 输出：DRIVE_OUT/<name>.png，并把 `VISUAL_RESULT {…}` 打到 stdout。
 */
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");

// 每次启动换一个干净的 profile：Electron 默认复用 %APPDATA% 下的同一份
// userData，上一次跑亮色抽查写进 localStorage 的 maxma.theme 会留到下一次，
// 让"深色基线"悄悄变成亮色（本轮真踩过：基线 luma 从 17 跳到 228）。
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "maxma-visual-profile-")));

const BASE = process.env.DRIVE_BASE;
const OUT = process.env.DRIVE_OUT;
const PAGES = JSON.parse(process.env.DRIVE_PAGES || "[]");
const SESSION_KEY = process.env.DRIVE_SESSION_KEY || "maxma_session_id";
const SESSION_ID = process.env.DRIVE_SESSION_ID || "";
/** 主题：默认钉成 dark（基线必须可复现）；"light" 用于亮色抽查。 */
const THEME = process.env.DRIVE_THEME || "dark";
/** 密度：留空则沿用默认（comfortable）；"compact" 用于紧凑档抽查。 */
const DENSITY = process.env.DRIVE_DENSITY || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true },
  });

  const logs = [];
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) logs.push(message);
  });

  const results = [];
  let themeApplied = false;
  try {
    // 先建立同源 origin 再写会话键，最后 reload——与 chat 驱动同一套启动顺序。
    await win.loadURL(BASE + "/");
    if (SESSION_ID) {
      await win.webContents
        .executeJavaScript(
          `(() => { localStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(SESSION_ID)}); return true })()`,
        )
        .catch(() => null);
      await win.webContents.reload();
      await sleep(2500);
      logs.length = 0;
    }

    for (const page of PAGES) {
      if ((THEME || DENSITY) && !themeApplied) {
        // 主题与密度都存在 localStorage 里、由启动时的 restore* 读回：改完必须 reload。
        const sets = [];
        if (THEME) sets.push(`localStorage.setItem('maxma.theme', ${JSON.stringify(THEME)})`);
        if (DENSITY) sets.push(`localStorage.setItem('maxma.density', ${JSON.stringify(DENSITY)})`);
        await win.webContents
          .executeJavaScript(`(() => { ${sets.join('; ')}; return true })()`)
          .catch(() => null);
        await win.webContents.reload();
        await sleep(2500);
        logs.length = 0;
        themeApplied = true;
      }
      await win.loadURL(BASE + page.path);
      // 等首屏与玻璃层稳定（字体、主题、图标的异步加载都在 2 秒内落定）。
      await sleep(Number(process.env.DRIVE_SETTLE_MS ?? 5000));
      // 诊断：路由是否真的落在这页、页面上有没有字。截图空白时先看这两个。
      const probe = await win.webContents
        .executeJavaScript(
          `(() => {
            const main = document.querySelector('main');
            const text = (document.body.innerText || '').replace(/\\s+/g, ' ');
            // 离屏渲染跳过（.turn-virtual = content-visibility:auto）的实际生效情况：
            // auto 数量证明规则挂上了元素，skipped 数量证明引擎真的跳过了屏外轮次
            // （checkVisibility 在 contentVisibilityAuto 模式下对跳过的子树返回 false）。
            const turns = Array.from(document.querySelectorAll('main article'));
            const autos = turns.filter((el) => getComputedStyle(el).contentVisibility === 'auto');
            const skipped = autos.filter((el) =>
              el.checkVisibility ? !el.checkVisibility({ contentVisibilityAuto: true }) : false,
            );
            return {
              path: location.pathname,
              text: text.slice(0, 160),
              mainLen: main ? (main.innerText || '').replace(/\\s+/g, ' ').length : -1,
              mainKids: main ? main.children.length : -1,
              mainText: main ? (main.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) : '',
              turns: turns.length,
              hosted: turns.length - autos.length,
              virtual: autos.length,
              skipped: skipped.length,
              scrollTop: (document.querySelector('.app-scroll') || {}).scrollTop ?? -1,
              scrollHeight: (document.querySelector('.app-scroll') || {}).scrollHeight ?? -1,
            };
          })()`,
        )
        .catch(() => ({ path: "?", text: "<probe failed>" }));
      const image = await win.webContents.capturePage();
      const file = path.join(OUT, `${page.name}.png`);
      const png = image.toPNG();
      fs.writeFileSync(file, png);
      const size = image.getSize();
      const bmp = image.getBitmap(); // BGRA
      let sum = 0;
      let count = 0;
      for (let i = 0; i + 3 < bmp.length; i += 4 * 1201) {
        sum += 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2];
        count += 1;
      }
      results.push({
        name: page.name,
        path: page.path,
        landed: probe.path,
        text: probe.text,
        mainLen: probe.mainLen,
        mainKids: probe.mainKids,
        mainText: probe.mainText,
        turns: probe.turns,
        hosted: probe.hosted,
        virtual: probe.virtual,
        skipped: probe.skipped,
        scrollTop: probe.scrollTop,
        scrollHeight: probe.scrollHeight,
        width: size.width,
        height: size.height,
        meanLuma: count ? Number((sum / count).toFixed(1)) : 0,
        bytes: png.length,
      });
      console.log(`  · ${page.name}  ${size.width}x${size.height}  ${(png.length / 1024).toFixed(1)}KB  luma ${count ? (sum / count).toFixed(1) : 0}  turns ${probe.turns ?? "-"}(virtual ${probe.virtual ?? "-"}/skipped ${probe.skipped ?? "-"})  @${probe.path}`);
    }
    console.log("VISUAL_RESULT " + JSON.stringify({ results, consoleErrors: logs, stage: "done" }));
    app.exit(0);
  } catch (err) {
    console.log("VISUAL_RESULT " + JSON.stringify({ results, consoleErrors: logs, stage: "failed", error: String(err) }));
    app.exit(1);
  }
});
