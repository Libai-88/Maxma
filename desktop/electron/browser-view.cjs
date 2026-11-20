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
    contents.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
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
    if (!view) return null;
    return view.webContents.capturePage();
  }

  function getBounds() {
    return view?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
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

    ipcMain.handle("maxma:browser:clear-data", async (event) => {
      assertTrusted(event);
      const browserSession = electronSession.fromPartition(partition);
      await browserSession.clearStorageData();
      await browserSession.clearCache();
      return state();
    });
  }

  return { registerIpc, destroy, state, ensure, capturePage, getBounds };
}

module.exports = { createBrowserController, isAllowedBrowserUrl };
