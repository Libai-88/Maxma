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
  browser: {
    show: (bounds) => invoke("maxma:browser:show", bounds),
    hide: () => invoke("maxma:browser:hide"),
    setBounds: (bounds) => invoke("maxma:browser:set-bounds", bounds),
    getState: () => invoke("maxma:browser:get-state"),
    navigate: (url) => invoke("maxma:browser:navigate", url),
    back: () => invoke("maxma:browser:back"),
    forward: () => invoke("maxma:browser:forward"),
    reload: () => invoke("maxma:browser:reload"),
    stop: () => invoke("maxma:browser:stop"),
    external: () => invoke("maxma:browser:external"),
    clearData: () => invoke("maxma:browser:clear-data"),
    onState: (callback) => {
      ipcRenderer.on("maxma:browser-event", (_event, state) => callback(state));
    },
    offState: () => {
      ipcRenderer.removeAllListeners("maxma:browser-event");
    },
  },
});
