/**
 * desktop/electron/preload.cjs — 桌面壳窄接口。
 *
 * 只暴露用户明确需要的能力；渲染层拿不到 ipcRenderer、fs、child_process，
 * 也没有任意 channel 的 invoke 入口。P0 先提供原生文件选择和在资源管理器显示。
 */

const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld("maxmaDesktop", {
  platform: process.platform,
  pickPath: (kind) => invoke("maxma:pick-path", kind),
  revealPath: (pathValue) => invoke("maxma:reveal-path", pathValue),
  openPath: (pathValue) => invoke("maxma:open-path", pathValue),
  notify: (payload) => invoke("maxma:notify", payload),
  browser: {
    show: (bounds) => invoke("maxma:browser:show", bounds),
    hide: () => invoke("maxma:browser:hide"),
    setBounds: (bounds) => invoke("maxma:browser:set-bounds", bounds),
    getState: () => invoke("maxma:browser:get-state"),
    navigate: (url) => invoke("maxma:browser:navigate", url),
    newTab: (url) => invoke("maxma:browser:new-tab", url),
    selectTab: (tabId) => invoke("maxma:browser:select-tab", tabId),
    closeTab: (tabId) => invoke("maxma:browser:close-tab", tabId),
    back: () => invoke("maxma:browser:back"),
    forward: () => invoke("maxma:browser:forward"),
    reload: () => invoke("maxma:browser:reload"),
    stop: () => invoke("maxma:browser:stop"),
    external: () => invoke("maxma:browser:external"),
    capture: () => invoke("maxma:browser:capture"),
    pickElement: () => invoke("maxma:browser:pick-element"),
    setPolicy: (policy) => invoke("maxma:browser:set-policy", policy),
    revealDownload: (id) => invoke("maxma:browser:reveal-download", id),
    clearData: () => invoke("maxma:browser:clear-data"),
    onState: (callback) => {
      ipcRenderer.on("maxma:browser-event", (_event, state) => callback(state));
    },
    offState: () => {
      ipcRenderer.removeAllListeners("maxma:browser-event");
    },
  },
});
