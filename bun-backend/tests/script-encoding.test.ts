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

describe("文档归档契约", () => {
  /**
   * `docs/` 是**活跃规范目录**（当前架构、品牌、安全契约、contracts/*）。
   * 已废弃的文档必须移进 `docs/archive/`：留在原地会被当成现行规范引用——
   * 本仓已经栽过：`docs/omp-upgrade-guide.md` 等三份是 2026-08 的 @oh-my-pi 基线，
   * 里面引用的脚本、文件、报 issue 地址全都指向不存在的对象，
   * 却和现行文档并排躺在 `docs/` 下。
   *
   * 判据：`docs/`（不含 archive）下的 markdown **全文**不得出现"已废弃/已过期/
   * 勿据以操作/不再适用/DEPRECATED"这类字样——一旦废弃就该归档，而不是原地贴告示。
   * 扫全文而不是只看开头：告示块可能贴在文件任何位置。
   */
  const DOCS = path.join(REPO, "docs");
  const STALE_MARKERS = [/已废弃/, /已过期/, /勿据以操作/, /不再适用/, /DEPRECATED/];

  test("docs/ 下的活跃文档不得自称废弃（废弃请移入 docs/archive/）", () => {
    const offenders: string[] = [];
    if (fs.existsSync(DOCS)) {
      for (const e of fs.readdirSync(DOCS, { withFileTypes: true })) {
        if (!e.isFile() || !e.name.endsWith(".md")) continue;
        const text = fs.readFileSync(path.join(DOCS, e.name), "utf8");
        if (STALE_MARKERS.some((re) => re.test(text))) offenders.push(`docs/${e.name}`);
      }
    }
    expect(
      offenders,
      `这些文档自称已废弃却仍在 docs/（活跃规范目录）下——请 git mv 到 docs/archive/ ` +
        `并更新引用，否则会被当成现行规范：\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  test("归档文档的引用不得指向已移走的旧路径（防空链）", () => {
    const archived = ["omp-upgrade-guide", "omp-upgrade-runbook", "omp-capability-gap"];
    const staleRefs: string[] = [];
    const scan = (file: string) => {
      const text = fs.readFileSync(file, "utf8");
      for (const name of archived) {
        // 允许 docs/archive/<name>，不允许裸 docs/<name>
        const re = new RegExp(`docs/(?!archive/)${name}\\.md`, "g");
        for (const m of text.matchAll(re)) staleRefs.push(`${path.relative(REPO, file)}: ${m[0]}`);
      }
    };
    for (const rel of ["HANDOFF.md", "dev_docs/pi-migration-plan.md"]) {
      const abs = path.join(REPO, rel);
      if (fs.existsSync(abs)) scan(abs);
    }
    for (const name of archived) {
      const abs = path.join(DOCS, "archive", `${name}.md`);
      if (fs.existsSync(abs)) scan(abs);
    }
    expect(staleRefs, `这些引用指向已归档文档的旧路径：\n  ${staleRefs.join("\n  ")}`).toEqual([]);
  });
});

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
