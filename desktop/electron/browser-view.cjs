/**
 * browser-view.cjs — 桌面内置浏览器的原生控制器。
 *
 * 页面跑在独立 WebContentsView 里，和主界面不是同一个 webContents：
 * 远程页面拿不到主界面的 DOM、preload 或本地文件能力。main.cjs 与 UI 验收
 * 驱动共用这一份实现，避免测试验证的是另一套 IPC。
 *
 * 多页签：每个页签独立 WebContentsView/CDP 实例，共享同一个隔离 session；
 * 同一时间只有一个页签可见，后台页签仍可被 Agent 定向读取/操作。
 */

const { WebContentsView, session: electronSession, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCdpBrowser } = require("./browser-cdp.cjs");
const {
  DEFAULT_POLICY,
  normalizePolicy,
  isHostAllowed,
  isUrlAllowedByPolicy,
  policySummary,
  readPolicy,
  writePolicy,
} = require("./browser-net-policy.cjs");
const {
  MAX_DOWNLOAD_BYTES,
  exceedsDownloadLimit,
  sanitizeDownloadName,
  uniqueDownloadPath,
} = require("./browser-downloads.cjs");

const MAX_TABS = 8;
const MAX_BLOCKED_RECORDS = 20;
const MAX_DOWNLOAD_RECORDS = 20;

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

function hostOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function createBrowserController({
  getWindow,
  isTrustedSender,
  openExternal,
  partition = "persist:maxma-browser",
  downloadsDir,
  policyPath,
  maxDownloads = MAX_DOWNLOAD_RECORDS,
  maxDownloadBytes = MAX_DOWNLOAD_BYTES,
}) {
  let browserSession = null;
  let tabs = [];
  let activeTabId = null;
  let tabSeq = 0;
  let visible = false;
  let destroying = false;
  let lastBounds = { x: 0, y: 0, width: 1200, height: 900 };
  let netPolicy = readPolicy(policyPath);
  const blocked = [];
  let blockedTimer = null;
  let downloads = [];
  let downloadSeq = 0;
  const downloadItems = new Map();
  const downloadDir = downloadsDir || path.join(os.tmpdir(), "maxma-browser-downloads");

  function emit() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send("maxma:browser-event", state());
    } catch {
      // Window is tearing down; state events have no receiver.
    }
  }

  function emitBlockedSoon() {
    if (blockedTimer) return;
    blockedTimer = setTimeout(() => {
      blockedTimer = null;
      emit();
    }, 120);
    blockedTimer.unref?.();
  }

  function emitDownloadsSoon() {
    if (blockedTimer) return;
    blockedTimer = setTimeout(() => {
      blockedTimer = null;
      emit();
    }, 120);
    blockedTimer.unref?.();
  }

  function assertNetworkAllowed(url) {
    if (!isUrlAllowedByPolicy(url, netPolicy)) {
      const host = hostOf(url) || "(无法解析)";
      throw new Error(`网络 allowlist 拒绝访问 ${host}；当前只允许 ${policySummary(netPolicy).domains.join(", ") || "（空列表）"}`);
    }
  }

  function tabState(tab) {
    let contents = null;
    try {
      contents = tab.view?.webContents;
    } catch {
      contents = null;
    }
    if (!contents || contents.isDestroyed()) {
      return { id: tab.id, url: "", title: "", loading: false, canGoBack: false, canGoForward: false, active: tab.id === activeTabId, visible: Boolean(tab.visible) };
    }
    return {
      id: tab.id,
      url: contents.getURL() ?? "",
      title: contents.getTitle() ?? "",
      loading: contents.isLoading() ?? false,
      canGoBack: contents.navigationHistory?.canGoBack?.() ?? contents.canGoBack?.() ?? false,
      canGoForward: contents.navigationHistory?.canGoForward?.() ?? contents.canGoForward?.() ?? false,
      active: tab.id === activeTabId,
      visible: Boolean(tab.visible),
      error: tab.lastError || undefined,
    };
  }

  function state(extra = {}) {
    const active = getActiveTab();
    const activeState = active ? tabState(active) : null;
    return {
      url: activeState?.url ?? "",
      title: activeState?.title ?? "",
      loading: activeState?.loading ?? false,
      canGoBack: activeState?.canGoBack ?? false,
      canGoForward: activeState?.canGoForward ?? false,
      visible,
      error: active?.lastError || undefined,
      tabs: tabs.map(tabState),
      activeTabId: activeTabId,
      downloads: downloads.slice(0, maxDownloads),
      network: {
        ...policySummary(netPolicy),
        blocked: blocked.slice(0, MAX_BLOCKED_RECORDS),
      },
      ...extra,
    };
  }

  function getActiveTab() {
    return tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  }

  function findTab(tabId) {
    if (typeof tabId !== "string" || !tabId) return null;
    return tabs.find((tab) => tab.id === tabId) ?? null;
  }

  function refreshVisibility() {
    const active = getActiveTab();
    for (const tab of tabs) {
      const shouldShow = Boolean(visible && active && tab.id === active.id);
      tab.visible = shouldShow;
      try {
        tab.view.setVisible(shouldShow);
        tab.view.setBounds(lastBounds);
      } catch {
        // A teardown can destroy the view between the state read and this call.
      }
    }
  }

  function setActiveTab(tabId) {
    const tab = findTab(tabId);
    if (!tab) throw new Error(`页签不存在：${tabId}`);
    activeTabId = tab.id;
    refreshVisibility();
    emit();
    return tab;
  }

  function ensureBrowserSession() {
    if (browserSession) return browserSession;
    browserSession = electronSession.fromPartition(partition);
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    browserSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (details, callback) => {
        const host = hostOf(details.url);
        if (host && isHostAllowed(host, netPolicy)) {
          callback({});
          return;
        }
        blocked.unshift({
          host: host || "(unknown)",
          url: String(details.url ?? "").slice(0, 500),
          tabId: tabForWebContents(details.webContentsId),
          at: Date.now(),
        });
        if (blocked.length > MAX_BLOCKED_RECORDS) blocked.length = MAX_BLOCKED_RECORDS;
        emitBlockedSoon();
        callback({ cancel: true });
      },
    );
    browserSession.on("will-download", onWillDownload);
    return browserSession;
  }

  function tabForWebContents(webContentsOrId) {
    const id = typeof webContentsOrId === "number" ? webContentsOrId : webContentsOrId?.id;
    if (!id) return undefined;
    return tabs.find((tab) => tab.view?.webContents?.id === id)?.id;
  }

  function onWillDownload(event, item, webContents) {
    try {
      fs.mkdirSync(downloadDir, { recursive: true });
      const id = `dl-${++downloadSeq}`;
      const filename = sanitizeDownloadName(item.getFilename());
      const target = uniqueDownloadPath(downloadDir, filename);
      item.setSavePath(target);
      const record = {
        id,
        filename,
        path: target,
        state: "progressing",
        receivedBytes: 0,
        totalBytes: Math.max(0, Number(item.getTotalBytes?.() ?? 0) || 0),
        tabId: tabForWebContents(webContents),
        url: String(item.getURL?.() ?? "").slice(0, 800),
        startedAt: Date.now(),
      };
      downloads.unshift(record);
      if (downloads.length > maxDownloads) downloads.length = maxDownloads;
      downloadItems.set(id, item);
      emitDownloadsSoon();

      let cancelledByLimit = false;
      item.on("updated", (_updateEvent, downloadState) => {
        record.state = downloadState === "interrupted" ? "interrupted" : "progressing";
        record.receivedBytes = Math.max(0, Number(item.getReceivedBytes?.() ?? 0) || 0);
        record.totalBytes = Math.max(0, Number(item.getTotalBytes?.() ?? 0) || 0);
        if (exceedsDownloadLimit(record.receivedBytes, maxDownloadBytes) && !cancelledByLimit) {
          cancelledByLimit = true;
          record.state = "cancelled";
          record.error = `超过单文件大小上限 ${Math.round(maxDownloadBytes / (1024 * 1024))} MiB`;
          try { item.cancel(); } catch { /* already finished */ }
        }
        emitDownloadsSoon();
      });
      item.once("done", (_doneEvent, downloadState) => {
        downloadItems.delete(id);
        record.state = cancelledByLimit ? "cancelled" : String(downloadState || "completed");
        record.receivedBytes = Math.max(0, Number(item.getReceivedBytes?.() ?? 0) || 0);
        record.totalBytes = Math.max(0, Number(item.getTotalBytes?.() ?? 0) || 0);
        if (record.state !== "completed") {
          try {
            if (fs.existsSync(target)) fs.rmSync(target, { force: true });
          } catch {
            // A partial file left behind is less harmful than failing the download report.
          }
        }
        emitDownloadsSoon();
      });
    } catch (error) {
      emit({ downloadError: error instanceof Error ? error.message : String(error) });
    }
  }

  function setupContents(tab) {
    const contents = tab.view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (!isAllowedBrowserUrl(url)) return { action: "deny" };
      try {
        if (tabs.length < MAX_TABS) {
          const next = createTab({ activate: true });
          void loadUrl(next, url).catch((error) => {
            next.lastError = { code: -20, description: String(error?.message ?? error), url };
            emit();
          });
        } else {
          openExternal(url);
        }
      } catch {
        openExternal(url);
      }
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!isAllowedBrowserUrl(url)) {
        event.preventDefault();
        tab.lastError = { code: -20, description: "只允许 http/https 地址", url };
        emit();
        return;
      }
      if (!isUrlAllowedByPolicy(url, netPolicy)) {
        event.preventDefault();
        tab.lastError = { code: -20, description: `网络 allowlist 拒绝访问 ${hostOf(url) || "该地址"}`, url };
        emit();
      }
    });
    // 服务端 30x 不经过 will-navigate；单独拦住跳到 file:/custom-protocol 的重定向。
    contents.on("will-redirect", (event, url) => {
      if (!isAllowedBrowserUrl(url)) {
        event.preventDefault();
        tab.lastError = { code: -20, description: "只允许 http/https 地址", url };
        emit();
        return;
      }
      if (!isUrlAllowedByPolicy(url, netPolicy)) {
        event.preventDefault();
        tab.lastError = { code: -20, description: `网络 allowlist 拒绝访问 ${hostOf(url) || "该地址"}`, url };
        emit();
      }
    });
    contents.on("did-start-loading", () => {
      tab.lastError = null;
      emit();
    });
    contents.on("did-stop-loading", () => emit());
    contents.on("did-navigate", () => emit());
    contents.on("did-navigate-in-page", () => emit());
    contents.on("page-title-updated", () => emit());
    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        tab.lastError = { code: errorCode, description: errorDescription, url: validatedURL };
        emit();
      }
    });
    contents.on("destroyed", () => {
      const index = tabs.indexOf(tab);
      if (index < 0) return;
      tabs.splice(index, 1);
      try { tab.cdp.detach(); } catch { /* already detached */ }
      if (activeTabId === tab.id) {
        activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
      }
      if (!destroying) {
        refreshVisibility();
        emit();
      }
    });
  }

  function createTab({ activate = false } = {}) {
    if (tabs.length >= MAX_TABS) throw new Error(`最多同时打开 ${MAX_TABS} 个页签`);
    const win = getWindow();
    if (!win || win.isDestroyed()) throw new Error("主窗口尚未就绪");
    const session = ensureBrowserSession();
    const view = new WebContentsView({
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor("#ffffff");
    view.setBounds(lastBounds);
    view.setVisible(false);
    win.contentView.addChildView(view);
    const tab = {
      id: `tab-${++tabSeq}`,
      view,
      cdp: createCdpBrowser(() => view),
      lastError: null,
      createdAt: Date.now(),
    };
    tabs.push(tab);
    if (activate || !activeTabId) activeTabId = tab.id;
    setupContents(tab);
    refreshVisibility();
    emit();
    return tab;
  }

  function ensureTab() {
    return getActiveTab() ?? createTab({ activate: true });
  }

  async function loadUrl(tab, url) {
    if (!isAllowedBrowserUrl(url)) throw new Error("只允许 http/https 地址");
    assertNetworkAllowed(url);
    tab.lastError = null;
    try {
      await tab.view.webContents.loadURL(url);
      return tab;
    } catch (error) {
      // 下载导航（Content-Disposition: attachment）在 Chromium 里会以
      // ERR_ABORTED/ERR_FAILED 结束 loadURL，但 will-download 已经接管并落盘。
      // 不能把“成功触发下载”误报成页面加载失败。
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (downloads.some((record) => record.tabId === tab.id && record.url === url)) {
          tab.lastError = null;
          return tab;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw error;
    }
  }

  function newTab({ url = "about:blank", activate = true } = {}) {
    const tab = createTab({ activate });
    if (url && url !== "about:blank") {
      void loadUrl(tab, url).catch((error) => {
        tab.lastError = { code: -20, description: String(error?.message ?? error), url };
        emit();
      });
    }
    return tab;
  }

  function showBrowser(value) {
    if (value) ensureTab();
    visible = Boolean(value);
    refreshVisibility();
    emit();
    return state();
  }

  function setBounds(bounds) {
    lastBounds = normalizeBounds(bounds);
    refreshVisibility();
  }

  function closeTab(tabId) {
    const tab = findTab(tabId ?? activeTabId);
    if (!tab) return state();
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);
    try {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.contentView.removeChildView(tab.view);
    } catch {
      // Window already gone; still close the webContents.
    }
    try { tab.cdp.detach(); } catch { /* already detached */ }
    try { tab.view.webContents.close(); } catch { /* already closed */ }
    if (activeTabId === tab.id) {
      activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
    }
    if (!tabs.length) createTab({ activate: true });
    refreshVisibility();
    emit();
    return state();
  }

  function destroy() {
    destroying = true;
    for (const item of downloadItems.values()) {
      try { item.cancel(); } catch { /* already finished */ }
    }
    downloadItems.clear();
    for (const tab of tabs) {
      try { tab.cdp.detach(); } catch { /* already detached */ }
      try {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.contentView.removeChildView(tab.view);
      } catch { /* window gone */ }
      try { tab.view.webContents.close(); } catch { /* already closed */ }
    }
    tabs = [];
    activeTabId = null;
    visible = false;
    destroying = false;
  }

  async function captureTabImage(tab) {
    if (!tab) throw new Error("浏览器尚未创建");
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const image = await tab.view.webContents.capturePage();
        if (image.toPNG().length > 0) return image;
      } catch (error) {
        lastError = error;
      }
      // A freshly navigated WebContentsView can briefly have no compositor
      // frame; nudge it and retry instead of reporting a real page as broken.
      try { tab.view.webContents.invalidate(); } catch { /* view may be closing */ }
      await new Promise((resolve) => setTimeout(resolve, 160));
    }
    throw lastError ?? new Error("浏览器页面尚未产生可截图帧");
  }

  async function capturePage(tab = getActiveTab()) {
    return captureTabImage(tab);
  }

  async function captureData(tab = getActiveTab()) {
    const image = await captureTabImage(tab);
    const size = image.getSize();
    return { dataUrl: image.toDataURL(), width: size.width, height: size.height };
  }

  /** 页面内点选元素：高亮悬停目标，点击/Escape 结束，返回可复用的 CSS 选择器。 */
  async function pickElement(tab = getActiveTab()) {
    if (!tab) throw new Error("浏览器尚未创建");
    return tab.view.webContents.executeJavaScript(`(async () => {
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
    const tab = getActiveTab();
    return tab?.view?.getBounds() ?? lastBounds;
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

  function resolveAgentTab(args) {
    const tabId = args?.tab_id ?? args?.tabId;
    if (typeof tabId === "string" && tabId) {
      const tab = findTab(tabId);
      if (!tab) throw new Error(`页签不存在：${tabId}`);
      return tab;
    }
    return ensureTab();
  }

  function tabResult(tab, extra = {}) {
    return {
      ...state(),
      ...tabState(tab),
      tabId: tab.id,
      action: extra.action,
      ...extra,
    };
  }

  /**
   * Agent 控制入口（P3）：返回普通 JSON，不暴露 Electron 对象。
   * 只有 http(s) 导航；页面文本都截断，避免把整站内容塞进模型上下文。
   */
  async function agentExecute(action, args = {}) {
    if (action === "tabs") {
      return { action, tabs: tabs.map(tabState), activeTabId, network: state().network };
    }
    if (action === "downloads") {
      return { action, downloads: downloads.slice(0, maxDownloads), directory: downloadDir };
    }
    if (action === "close_tab") {
      const target = resolveAgentTab(args);
      const closed = target.id;
      return { ...closeTab(closed), action, closedTabId: closed };
    }
    if (action === "open") {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!isAllowedBrowserUrl(url)) throw new Error("只允许 http/https 地址");
      assertNetworkAllowed(url);
      let tab;
      if (args.new_tab || args.newTab) {
        tab = createTab({ activate: false });
      } else {
        tab = resolveAgentTab(args);
      }
      await loadUrl(tab, url);
      await waitForLoad(tab.view.webContents);
      return tabResult(tab, { action, tabId: tab.id });
    }
    const tab = resolveAgentTab(args);
    const contents = tab.view.webContents;
    if (action === "act") {
      // 用户刚在地址栏/主界面停留时，原生 view 可能没有系统焦点；
      // CDP 鼠标能落到页面，但键盘事件必须先把 webContents 拉回焦点。
      try {
        contents.focus();
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch { /* view may be closing */ }
    }
    if (action === "snapshot") {
      // CDP 无障碍树给每个可操作节点一个本次快照内稳定的 ref；正文仍走
      // 页面 innerText，避免模型面对一堆重复的 inline text 节点。
      const snapshot = await tab.cdp.snapshot();
      return tabResult(tab, { action, ...snapshot });
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
      return tabResult(tab, { action, selector, items: extracted });
    }
    if (action === "screenshot") {
      try {
        const image = await captureTabImage(tab);
        return tabResult(tab, { action, mime: "image/png", data: image.toPNG().toString("base64") });
      } catch (error) {
        const bounds = (() => {
          try { return tab.view.getBounds?.() ?? null; } catch { return null; }
        })();
        const win = getWindow();
        throw new Error(`截图失败（${error instanceof Error ? error.message : String(error)}；tab=${tab.id} active=${activeTabId} tabVisible=${Boolean(tab.visible)} pageVisible=${visible} bounds=${JSON.stringify(bounds)} winVisible=${Boolean(win?.isVisible?.())} winMinimized=${Boolean(win?.isMinimized?.())}）`);
      }
    }
    if (action === "act") {
      const result = await tab.cdp.act(args);
      return tabResult(tab, { action, ...result });
    }
    if (action === "console") {
      const result = await tab.cdp.console({ clear: args.clear === true });
      return tabResult(tab, { action, ...result });
    }
    if (action === "scroll") {
      const dx = Math.max(-5000, Math.min(5000, Number(args.dx) || 0));
      const dy = Math.max(-100000, Math.min(100000, Number(args.dy) || 0));
      const position = await contents.executeJavaScript(`(() => {
        window.scrollBy(${dx}, ${dy});
        return { x: window.scrollX, y: window.scrollY, height: document.body.scrollHeight };
      })()`, true);
      return tabResult(tab, { action, ...position });
    }
    if (action === "back" || action === "forward") {
      if (action === "back") {
        if (contents.navigationHistory?.canGoBack?.()) contents.navigationHistory.goBack();
        else contents.goBack?.();
      } else if (contents.navigationHistory?.canGoForward?.()) contents.navigationHistory.goForward();
      else contents.goForward?.();
      await waitForLoad(contents);
      return tabResult(tab, { action });
    }
    throw new Error(`未知浏览器动作：${action}`);
  }

  function assertTrusted(event) {
    if (!isTrustedSender(event)) throw new Error("拒绝来自非应用页面的浏览器请求");
  }

  function setNetworkPolicy(raw) {
    const next = writePolicy(policyPath, raw);
    netPolicy = next;
    blocked.length = 0;
    emit();
    return state();
  }

  function revealDownload(id) {
    const record = downloads.find((item) => item.id === id);
    if (!record) throw new Error(`下载不存在：${id}`);
    const root = path.resolve(downloadDir);
    const target = path.resolve(record.path);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("拒绝打开下载目录以外的路径");
    if (!fs.existsSync(target)) throw new Error("下载文件不存在");
    shell.showItemInFolder(target);
  }

  function registerIpc(ipcMain) {
    ipcMain.handle("maxma:browser:show", async (event, bounds) => {
      assertTrusted(event);
      ensureTab();
      setBounds(scaleBounds(bounds, event.sender.getZoomFactor()));
      return showBrowser(true);
    });

    ipcMain.handle("maxma:browser:set-bounds", async (event, bounds) => {
      assertTrusted(event);
      setBounds(scaleBounds(bounds, event.sender.getZoomFactor()));
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
      assertNetworkAllowed(url);
      const tab = ensureTab();
      showBrowser(true);
      await loadUrl(tab, url);
      return state();
    });

    ipcMain.handle("maxma:browser:new-tab", async (event, url) => {
      assertTrusted(event);
      if (url !== undefined && (typeof url !== "string" || !isAllowedBrowserUrl(url))) throw new Error("只允许 http/https 地址");
      const tab = createTab({ activate: true });
      if (url && url !== "about:blank") await loadUrl(tab, url);
      if (visible) showBrowser(true);
      return state();
    });

    ipcMain.handle("maxma:browser:select-tab", async (event, tabId) => {
      assertTrusted(event);
      setActiveTab(tabId);
      return state();
    });

    ipcMain.handle("maxma:browser:close-tab", async (event, tabId) => {
      assertTrusted(event);
      return closeTab(tabId);
    });

    ipcMain.handle("maxma:browser:back", async (event) => {
      assertTrusted(event);
      const contents = getActiveTab()?.view.webContents;
      if (contents?.navigationHistory?.canGoBack?.()) contents.navigationHistory.goBack();
      else contents?.goBack?.();
      setTimeout(() => emit(), 80);
      return state();
    });

    ipcMain.handle("maxma:browser:forward", async (event) => {
      assertTrusted(event);
      const contents = getActiveTab()?.view.webContents;
      if (contents?.navigationHistory?.canGoForward?.()) contents.navigationHistory.goForward();
      else contents?.goForward?.();
      setTimeout(() => emit(), 80);
      return state();
    });

    ipcMain.handle("maxma:browser:reload", async (event) => {
      assertTrusted(event);
      getActiveTab()?.view.webContents.reload();
    });

    ipcMain.handle("maxma:browser:stop", async (event) => {
      assertTrusted(event);
      getActiveTab()?.view.webContents.stop();
    });

    ipcMain.handle("maxma:browser:external", async (event) => {
      assertTrusted(event);
      const url = getActiveTab()?.view.webContents.getURL();
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

    ipcMain.handle("maxma:browser:set-policy", async (event, policy) => {
      assertTrusted(event);
      return setNetworkPolicy(policy);
    });

    ipcMain.handle("maxma:browser:reveal-download", async (event, id) => {
      assertTrusted(event);
      revealDownload(id);
    });

    ipcMain.handle("maxma:browser:clear-data", async (event) => {
      assertTrusted(event);
      const session = ensureBrowserSession();
      await session.clearStorageData();
      await session.clearCache();
      return state();
    });
  }

  return {
    registerIpc,
    destroy,
    state,
    ensure: ensureTab,
    capturePage,
    captureData,
    pickElement,
    getBounds,
    agentExecute,
    setNetworkPolicy,
    closeTab,
    newTab,
  };
}

module.exports = {
  createBrowserController,
  isAllowedBrowserUrl,
  hostOf,
};
