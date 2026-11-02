/**
 * _helpers/tmp.ts — 跨平台的一次性数据目录。
 *
 * 为什么不各测试自己 `mkdtemp("D:\\MaxmaTemp")`：那是开发机上的私人路径。
 * CI 的 runner 是 ubuntu-latest，`D:` 根本不存在，`mkdtempSync` 直接
 * ENOENT —— 后端测试在 CI 上长期红，就是这个写法（与代码对错无关）。
 * 用 `os.tmpdir()`：Windows 上解析到 %TEMP%，Linux 上解析到 /tmp，
 * 两边都能建；目录不存在时先建出来，避免 CI 上 TEMP 指向未创建的盘符。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** 在系统临时目录下开一个专属空目录，返回绝对路径。 */
export function makeTempDataDir(prefix: string): string {
  const root = path.join(os.tmpdir(), prefix.replace(/[^A-Za-z0-9._-]/g, "-"));
  fs.mkdirSync(root, { recursive: true });
  const made = fs.mkdtempSync(path.join(root, "run-"));
  return fs.realpathSync(made);
}

/** 用完即删；删不掉也不让测试因此误红。 */
export function removeTempDataDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 进程被强杀时可能残留；.gitignore 已用 .tmp-* 兜底，不让它污染 git status。
  }
}
