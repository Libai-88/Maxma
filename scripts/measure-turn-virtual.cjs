/**
 * scripts/measure-turn-virtual.cjs — 离屏渲染跳过（`.turn-virtual`）的量化对照。
 *
 * 为什么要有这个脚本：`content-visibility: auto` 的效果无法靠读代码确认，
 * 只能量。这里在真实 Electron 窗口里铺 300 个"像对话轮次"的块（段落 + 列表 + 代码块，
 * 高度远超一屏），分别在禁用 / 启用该规则时测三件事：
 *   1. 首次布局耗时（插入后读 scrollHeight 强制同步布局）
 *   2. 滚到底（跳到最新）后的再次布局耗时
 *   3. 滚动到中段时被跳过的子树数量
 *
 * 局限（写清楚，别让数字被过度解读）：React 的挂载/协调成本它省不掉，
 * 省的只是**样式计算 + 布局 + 绘制**。轮次越多、单轮越重，收益越大。
 *
 * 用法：node_modules/electron/dist/electron.exe scripts/measure-turn-virtual.cjs
 * 输出：MEASURE_RESULT {…}
 */
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow } = require("electron");

// 独立 profile，避免与截图驱动抢同一份 localStorage/缓存。
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "maxma-measure-profile-")));

const TURNS = Number(process.env.MEASURE_TURNS ?? 300);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true },
  });

  try {
    await win.loadURL("data:text/html,<html><head><meta charset='utf-8'></head><body></body></html>");
    const result = await win.webContents.executeJavaScript(`(() => {
      const TURNS = ${TURNS};

      // 一个"轮次"的形态：用户气泡 + 两段回答 + 列表 + 代码块，接近真实 Markdown 结果。
      function turnHtml(i) {
        return [
          '<article class="turn" style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px">',
          '<div style="align-self:flex-end;max-width:85%;padding:10px 14px;border-radius:12px;background:#2a2a2e;color:#eee">第 ' + i + ' 轮：请解释这段代码做了什么</div>',
          '<div style="padding:12px 16px;border:1px solid #333;border-radius:12px;background:#1b1b1f;color:#ddd">',
          '<p>这段代码的作用是把输入流拆成块再合并。</p>',
          '<p>' + new Array(8).fill('中间段落文字，用来把高度撑到接近真实回答的规模。').join('</p><p>') + '</p>',
          '<ul>' + new Array(5).fill('<li>要点：边界处理与错误回收</li>').join('') + '</ul>',
          '<pre style="overflow:auto;padding:10px;border-radius:8px;background:#111"><code>' +
            new Array(10).fill('const x = compute(a, b);').join('\\n') + '</code></pre>',
          '</div></article>',
        ].join('');
      }

      const container = document.createElement('div');
      container.style.cssText = 'height:100vh;overflow-y:auto';
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:24px;padding:16px';
      container.appendChild(list);
      document.body.style.margin = '0';
      document.body.appendChild(container);

      function build(virtual) {
        list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', new Array(TURNS).fill(0).map((_, i) => turnHtml(i)).join(''));
        if (virtual) {
          for (const el of list.querySelectorAll('article')) {
            el.style.contentVisibility = 'auto';
            el.style.containIntrinsicSize = 'auto 600px';
          }
        }
      }

      function forceLayout() { return container.scrollHeight; }

      function measure(virtual) {
        // 先跑一次热身，避免把首次 JIT / 字体加载算进结果。
        build(virtual); forceLayout();
        build(virtual);
        const t0 = performance.now();
        const height = forceLayout();
        const firstLayoutMs = performance.now() - t0;
        // 估算高度 vs 真实高度：两者的差距就是"滚动条偏短"的幅度，
        // 也是跳到底部需要连续几帧校正的原因（见 ChatWindow.scrollToBottom）。
        return { firstLayoutMs: +firstLayoutMs.toFixed(1), height };
      }

      const plain = measure(false);
      const virt = measure(true);
      return { turns: TURNS, plain, virt };
    })()`);

    console.log("MEASURE_RESULT " + JSON.stringify(result));
    app.exit(0);
  } catch (err) {
    console.log("MEASURE_RESULT " + JSON.stringify({ stage: "failed", error: String(err) }));
    app.exit(1);
  }
});
