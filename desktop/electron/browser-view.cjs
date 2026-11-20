/**
 * browser-view.cjs — 桌面内置浏览器的原生控制器。
 *
 * 页面跑在独立 WebContentsView 里，和主界面不是同一个 webContents：
 * 远程页面拿不到主界面的 DOM、preload 或本地文件能力。main.cjs 与 UI 验收
 * 驱动共用这一份实现，避免测试验证的是另一套 IPC。
 */

const { WebContentsView, session: electronSession } = require("electron");

function isAllowedBrowserUrl(url) {
  if (url === "about:blank") return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeBounds(value) {
  const number = (input, fallback) =>
    typeof input === "number" && Number.isFinite(input) ? Math.round(input) : fallback;
  return {
    x: Math.max(0, number(value?.x, 0)),
    y: Math.max(0, number(value?.y, 0)),
    width: Math.max(0, number(value?.width, 0)),
    height: Math.max(0, number(value?.height, 0)),
  };
}

function scaleBounds(value, factor) {
  const bounds = normalizeBounds(value);
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return bounds;
  return {
    x: Math.round(bounds.x * factor),
    y: Math.round(bounds.y * factor),
    width: Math.round(bounds.width * factor),
    height: Math.round(bounds.height * factor),
  };
}

function createBrowserController({
  getWindow,
  isTrustedSender,
  openExternal,
  partition = "persist:maxma-browser",
}) {
  let view = null;
  let visible = false;

  function state(extra = {}) {
    const contents = view?.webContents;
    return {
      url: contents?.getURL() ?? "",
      title: contents?.getTitle() ?? "",
      loading: contents?.isLoading() ?? false,
      canGoBack: contents?.navigationHistory?.canGoBack?.() ?? contents?.canGoBack?.() ?? false,
      canGoForward: contents?.navigationHistory?.canGoForward?.() ?? contents?.canGoForward?.() ?? false,
      visible,
      ...extra,
    };
  }

  function emit(extra = {}) {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send("maxma:browser-event", state(extra));
    } catch {
      // Window is tearing down; state events have no receiver.
    }
  }

  /** history 的 canGoBack/canGoForward 在 did-navigate 时可能还没更新。 */
  function scheduleEmit(delay = 80) {
    setTimeout(() => {
      if (view) emit();
    }, delay);
  }

  function ensure() {
    if (view) return view;
    const win = getWindow();
    if (!win || win.isDestroyed()) throw new Error("主窗口尚未就绪");
    const browserSession = electronSession.fromPartition(partition);
    view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor("#ffffff");
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    win.contentView.addChildView(view);

    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedBrowserUrl(url)) openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!isAllowedBrowserUrl(url)) event.preventDefault();
    });
    // 服务端 30x 不经过 will-navigate；单独拦住跳到 file:/custom-protocol 的重定向。
    contents.on("will-redirect", (event, url) => {
      if (!isAllowedBrowserUrl(url)) event.preventDefault();
    });
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    contents.on("did-start-loading", () => emit());
    contents.on("did-stop-loading", () => emit());
    contents.on("did-navigate", () => emit());
    contents.on("did-navigate-in-page", () => emit());
    contents.on("page-title-updated", () => emit());
    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) emit({ error: { code: errorCode, description: errorDescription, url: validatedURL } });
    });
    contents.on("destroyed", () => {
      view = null;
      visible = false;
      emit();
    });
    return view;
  }

  function showBrowser(value) {
    if (!view) return state();
    visible = value;
    view.setVisible(value);
    emit();
    return state();
  }

  function destroy() {
    if (!view) return;
    const current = view;
    view = null;
    visible = false;
    try {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.contentView.removeChildView(current);
    } catch {
      // Window already gone; closing the webContents is still required.
    }
    try { current.webContents.close(); } catch { /* already closed */ }
  }

  async function capturePage() {
    if (!view) throw new Error("浏览器尚未创建");
    return view.webContents.capturePage();
  }

  async function captureData() {
    if (!view) throw new Error("浏览器尚未创建");
    const image = await view.webContents.capturePage();
    const size = image.getSize();
    return { dataUrl: image.toDataURL(), width: size.width, height: size.height };
  }

  /** 页面内点选元素：高亮悬停目标，点击/Escape 结束，返回可复用的 CSS 选择器。 */
  async function pickElement() {
    if (!view) throw new Error("浏览器尚未创建");
    return view.webContents.executeJavaScript(`(async () => {
      if (window.__maxmaPickCleanup) window.__maxmaPickCleanup();
      const cssEscape = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : value);
      const selectorOf = (node) => {
        if (!(node instanceof Element)) return "";
        if (node.id) return "#" + cssEscape(node.id);
        const parts = [];
        let current = node;
        while (current && current.nodeType === 1 && current !== document.documentElement) {
          let part = current.tagName.toLowerCase();
          if (current.classList && current.classList.length) {
            part += "." + Array.from(current.classList).slice(0, 2).map(cssEscape).join(".");
          }
          let same = 0;
          for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
            if (sibling.tagName === current.tagName) same += 1;
          }
          part += ":nth-of-type(" + (same + 1) + ")";
          parts.unshift(part);
          current = current.parentElement;
        }
        return parts.join(" > ");
      };
      return await new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.setAttribute("data-maxma-pick", "1");
        overlay.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.12);border-radius:4px;transition:all .05s ease;";
        const hint = document.createElement("div");
        hint.textContent = "点击选择元素 · Esc 取消";
        hint.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;background:#111827;color:#fff;padding:6px 12px;border-radius:8px;font:12px/1.4 system-ui,sans-serif;";
        document.documentElement.appendChild(overlay);
        document.documentElement.appendChild(hint);
        let hovered = null;
        let finished = false;
        const cleanup = () => {
          if (finished) return;
          finished = true;
          document.removeEventListener("mousemove", onMove, true);
          document.removeEventListener("click", onClick, true);
          document.removeEventListener("keydown", onKey, true);
          overlay.remove();
          hint.remove();
          window.__maxmaPickCleanup = null;
        };
        const finish = (value) => { cleanup(); resolve(value); };
        const onMove = (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          hovered = target;
          const rect = target.getBoundingClientRect();
          overlay.style.left = rect.left + "px";
          overlay.style.top = rect.top + "px";
          overlay.style.width = rect.width + "px";
          overlay.style.height = rect.height + "px";
        };
        const onClick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          const target = hovered || event.target;
          if (!(target instanceof Element)) { finish(null); return; }
          finish({
            selector: selectorOf(target),
            tag: target.tagName.toLowerCase(),
            text: (target.innerText || target.textContent || "").trim().slice(0, 500),
            href: target.getAttribute("href") || "",
          });
        };
        const onKey = (event) => {
          if (event.key === "Escape") { event.preventDefault(); finish(null); }
        };
        window.__maxmaPickCleanup = () => finish(null);
        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKey, true);
        setTimeout(() => finish(null), 60000);
      });
    })()`, true);
  }

  function getBounds() {
    return view?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  function waitForLoad(contents, timeoutMs = 8000) {
    if (!contents.isLoading()) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        contents.removeListener("did-stop-loading", finish);
        contents.removeListener("did-fail-load", finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      contents.once("did-stop-loading", finish);
      contents.once("did-fail-load", finish);
    });
  }

  /**
   * Agent 控制入口（P3）：返回普通 JSON，不暴露 Electron 对象。
   * 只有 http(s) 导航；页面文本都截断，避免把整站内容塞进模型上下文。
   */
  async function agentExecute(action, args = {}) {
    // Agent 可能先于 UI 使用浏览器：创建一个隐藏的 view 即可加载/读取/截图，
    // 不自动显示，避免原生层突然盖住聊天区；用户切到浏览器 tab 时才由 UI 显示。
    if (!view) ensure();
    if (!view) throw new Error("浏览器尚未创建；请先在“浏览器”标签打开页面");
    const bounds = view.getBounds();
    if (bounds.width < 2 || bounds.height < 2) {
      view.setBounds({ x: 0, y: 0, width: 1200, height: 900 });
    }
    const contents = view.webContents;
    const current = () => state();
    if (action === "open") {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!isAllowedBrowserUrl(url)) throw new Error("只允许 http/https 地址");
      await contents.loadURL(url);
      await waitForLoad(contents);
      return { ...current(), action };
    }
    if (action === "snapshot") {
      const snapshot = await contents.executeJavaScript(`(() => {
        const text = (document.body && document.body.innerText || "").slice(0, 12000);
        const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 50).map((a) => ({
          text: (a.innerText || "").trim().slice(0, 80),
          href: a.href,
        }));
        const controls = Array.from(document.querySelectorAll("input,textarea,button,select")).slice(0, 50).map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || "",
          name: el.getAttribute("name") || "",
          label: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().slice(0, 80),
        }));
        return { url: location.href, title: document.title, text, links, controls };
      })()`, true);
      return { ...current(), action, ...snapshot };
    }
    if (action === "extract") {
      const selector = typeof args.selector === "string" ? args.selector.slice(0, 500) : "";
      if (!selector) throw new Error("extract 需要 selector");
      const extracted = await contents.executeJavaScript(`(() => {
        const selector = ${JSON.stringify(selector)};
        const limit = Math.max(1, Math.min(50, ${Number(args.limit) || 20}));
        let nodes;
        try { nodes = Array.from(document.querySelectorAll(selector)).slice(0, limit); }
        catch (error) { throw new Error("selector 非法: " + error.message); }
        return nodes.map((node) => ({
          text: (node.innerText || node.textContent || "").trim().slice(0, 2000),
          href: node.getAttribute && node.getAttribute("href") || "",
          src: node.getAttribute && node.getAttribute("src") || "",
        }));
      })()`, true);
      return { ...current(), action, selector, items: extracted };
    }
    if (action === "screenshot") {
      const image = await contents.capturePage();
      return { ...current(), action, mime: "image/png", data: image.toPNG().toString("base64") };
    }
    if (action === "scroll") {
      const dx = Math.max(-5000, Math.min(5000, Number(args.dx) || 0));
      const dy = Math.max(-100000, Math.min(100000, Number(args.dy) || 0));
      const position = await contents.executeJavaScript(`(() => {
        window.scrollBy(${dx}, ${dy});
        return { x: window.scrollX, y: window.scrollY, height: document.body.scrollHeight };
      })()`, true);
      return { ...current(), action, ...position };
    }
    if (action === "back" || action === "forward") {
      if (action === "back") {
        if (contents.navigationHistory?.canGoBack?.()) contents.navigationHistory.goBack();
        else contents.goBack?.();
      } else if (contents.navigationHistory?.canGoForward?.()) contents.navigationHistory.goForward();
      else contents.goForward?.();
      await waitForLoad(contents);
      return { ...current(), action };
    }
    throw new Error(`未知浏览器动作：${action}`);
  }

  function assertTrusted(event) {
    if (!isTrustedSender(event)) throw new Error("拒绝来自非应用页面的浏览器请求");
  }

  function registerIpc(ipcMain) {
    ipcMain.handle("maxma:browser:show", async (event, bounds) => {
      assertTrusted(event);
      const target = ensure();
      target.setBounds(scaleBounds(bounds, event.sender.getZoomFactor()));
      return showBrowser(true);
    });

    ipcMain.handle("maxma:browser:set-bounds", async (event, bounds) => {
      assertTrusted(event);
      if (view) view.setBounds(scaleBounds(bounds, event.sender.getZoomFactor()));
    });

    ipcMain.handle("maxma:browser:hide", async (event) => {
      assertTrusted(event);
      return showBrowser(false);
    });

    ipcMain.handle("maxma:browser:get-state", async (event) => {
      assertTrusted(event);
      return state();
    });

    ipcMain.handle("maxma:browser:navigate", async (event, url) => {
      assertTrusted(event);
      if (typeof url !== "string" || !isAllowedBrowserUrl(url)) throw new Error("只允许 http/https 地址");
      const target = ensure();
      showBrowser(true);
      await target.webContents.loadURL(url);
      return state();
    });

    ipcMain.handle("maxma:browser:back", async (event) => {
      assertTrusted(event);
      const contents = view?.webContents;
      if (contents?.navigationHistory?.canGoBack?.()) contents.navigationHistory.goBack();
      else contents?.goBack?.();
      scheduleEmit();
      return state();
    });

    ipcMain.handle("maxma:browser:forward", async (event) => {
      assertTrusted(event);
      const contents = view?.webContents;
      if (contents?.navigationHistory?.canGoForward?.()) contents.navigationHistory.goForward();
      else contents?.goForward?.();
      scheduleEmit();
      return state();
    });

    ipcMain.handle("maxma:browser:reload", async (event) => {
      assertTrusted(event);
      view?.webContents.reload();
    });

    ipcMain.handle("maxma:browser:stop", async (event) => {
      assertTrusted(event);
      view?.webContents.stop();
    });

    ipcMain.handle("maxma:browser:external", async (event) => {
      assertTrusted(event);
      const url = view?.webContents.getURL();
      if (url && isAllowedBrowserUrl(url)) openExternal(url);
    });

    ipcMain.handle("maxma:browser:pick-element", async (event) => {
      assertTrusted(event);
      return pickElement();
    });

    ipcMain.handle("maxma:browser:capture", async (event) => {
      assertTrusted(event);
      return captureData();
    });

    ipcMain.handle("maxma:browser:clear-data", async (event) => {
      assertTrusted(event);
      const browserSession = electronSession.fromPartition(partition);
      await browserSession.clearStorageData();
      await browserSession.clearCache();
      return state();
    });
  }

  return { registerIpc, destroy, state, ensure, capturePage, captureData, pickElement, getBounds, agentExecute };
}

module.exports = { createBrowserController, isAllowedBrowserUrl };
