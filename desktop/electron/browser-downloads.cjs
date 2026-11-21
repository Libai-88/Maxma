/**
 * browser-downloads.cjs — 下载落盘的安全路径与文件名（纯函数）。
 *
 * 下载永远写进 Maxma 数据目录下的 downloads/，绝不使用页面提供的路径；
 * 文件名只取 basename、清洗 Windows 非法字符、预留文件自动改名，并由
 * BrowserController 限制总大小。这里不依赖 Electron，方便单测覆盖边界。
 */

const fs = require("node:fs");
const path = require("node:path");

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_NAME_LENGTH = 180;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function sanitizeDownloadName(raw) {
  let name = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  name = name
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!name || name === "." || name === "..") name = "download";
  if (RESERVED.test(name)) name = `_${name}`;
  if (name.length > MAX_NAME_LENGTH) {
    const ext = path.extname(name).slice(0, 24);
    const base = name.slice(0, Math.max(1, MAX_NAME_LENGTH - ext.length));
    name = `${base}${ext}`;
  }
  return name;
}

/** 目标目录里已有同名文件时，改用「name (1).ext」，最多尝试 9999 次。 */
function uniqueDownloadPath(dir, rawName, exists = fs.existsSync) {
  const safe = sanitizeDownloadName(rawName);
  const target = path.join(dir, safe);
  if (!exists(target)) return target;
  const ext = path.extname(safe);
  const base = ext ? safe.slice(0, -ext.length) : safe;
  for (let index = 1; index <= 9999; index += 1) {
    const candidate = path.join(dir, `${base} (${index})${ext}`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error("下载目录里同名文件过多");
}

function exceedsDownloadLimit(bytes, limit = MAX_DOWNLOAD_BYTES) {
  if (!Number.isFinite(Number(bytes))) return false;
  return Number(bytes) > limit;
}

module.exports = {
  MAX_DOWNLOAD_BYTES,
  MAX_NAME_LENGTH,
  sanitizeDownloadName,
  uniqueDownloadPath,
  exceedsDownloadLimit,
};
