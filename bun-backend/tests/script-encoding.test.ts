/**
 * tests/script-encoding.test.ts — 构建脚本的编码契约。
 *
 * 缘由（2026-10-27 实测踩过）：`build/portable-smoke-test.ps1` 是
 * **UTF-8 with BOM + LF**。编辑工具重写文件时把 BOM 剥掉了，Windows PowerShell 5.1
 * 无 BOM 就按 ANSI(GBK) 解码整个脚本，于是脚本里的中文注释被解成一堆垃圾 token，
 * 报 `MissingExpressionAfterToken` 之类的**解析错误，位置还在文件前几行**——
 * 看起来像脚本本身坏了，实际是编码问题；而失败方式还是"退出码 1 + 乱码"，
 * 排查成本极高。
 *
 * 规则：含非 ASCII 字符的 .ps1 必须带 UTF-8 BOM（Windows PowerShell 才按 UTF-8 读）。
 * .bat 另有规则（必须 CRLF，见 portable-packaging.test.ts），两者不要混为一谈。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dir, "../..");

function filesWithExt(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesWithExt(p, ext));
    else if (e.name.toLowerCase().endsWith(ext)) out.push(p);
  }
  return out;
}

describe("构建脚本编码契约", () => {
  const scriptDirs = ["build", "scripts"].flatMap((d) => filesWithExt(path.join(REPO, d), ".ps1"));

  test("仓库里确实扫到了 .ps1（防空转）", () => {
    expect(scriptDirs.length).toBeGreaterThan(0);
  });

  test("含非 ASCII 的 .ps1 必须保留 UTF-8 BOM", () => {
    const offenders: string[] = [];
    for (const file of scriptDirs) {
      const bytes = fs.readFileSync(file);
      const hasNonAscii = [...bytes].some((b) => b > 0x7f);
      const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      if (hasNonAscii && !hasBom) {
        offenders.push(path.relative(REPO, file));
      }
    }
    expect(
      offenders,
      `这些 .ps1 含中文但没有 UTF-8 BOM —— Windows PowerShell 会按 GBK 解码并抛出` +
        `位置误导性的解析错误（不是编码错误）：\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
