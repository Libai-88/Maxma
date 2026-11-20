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
});
