/**
 * path-actions.cjs — 主进程文件动作的纯校验（不依赖 Electron）。
 *
 * `shell.openPath` 不是"预览"，它会让系统用默认程序打开文件；对 .exe/.bat
 * 就是一条执行链。P1 只允许从文件面板打开 HTML，因此把校验抽出来，
 * 主进程和 UI 验收驱动共用同一份规则，也能用普通测试覆盖。
 */

const fs = require("node:fs");
const path = require("node:path");

const OPENABLE_EXTENSIONS = new Set([".html", ".htm"]);

function assertOpenableHtml(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\x00")) {
    throw new Error("无效路径");
  }
  if (!fs.existsSync(filePath)) throw new Error("路径不存在");
  if (!OPENABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new Error("只允许从文件面板打开 HTML 文件");
  }
  if (!fs.statSync(filePath).isFile()) throw new Error("路径不是文件");
  return true;
}

module.exports = { assertOpenableHtml, OPENABLE_EXTENSIONS };
