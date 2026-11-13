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

describe("文档现行性契约", () => {
  /**
   * `docs/` 只放**现行规范**（当前架构、品牌、安全契约、contracts/*）。
   * 历史决策记录放 `dev_docs/adr/`，构建事实放 `dev_docs/build-and-artifacts.md`。
   *
   * 本仓栽过两次：
   *   1. 三份 2026-08 的 @oh-my-pi 升级文档与现行文档并排躺在 `docs/` 下，
   *      引用的脚本/文件/报 issue 地址全指向不存在的对象，被当成现行规范引用。
   *   2. Python 后端下线后，`security-contract.md` 仍写着 `Status: Active` 并把
   *      路径白名单的执行方指到已删除的 `security_adapter.py` —— 一份自称现行、
   *      实则描述已删子系统的安全文档，比没有文档更危险。
   *
   * 判据一（原地贴告示 = 该删）：`docs/` 下的 markdown 全文不得出现
   * "已废弃/已过期/勿据以操作/不再适用/DEPRECATED"。废弃内容直接删除，
   * 历史用 `git log --diff-filter=D -- <路径>` 取回，不留存档副本。
   * 扫全文而不是只看开头：告示块可能贴在文件任何位置。
   *
   * 判据二（悬空引用）：`docs/` 与 `dev_docs/` 下 markdown 里的相对链接
   * 必须指向真实存在的文件。删文档不改引用是同一类事故的第二次发生。
   */
  const DOCS = path.join(REPO, "docs");
  const STALE_MARKERS = [/已废弃/, /已过期/, /勿据以操作/, /不再适用/, /DEPRECATED/];

  test("docs/ 下的文档不得自称废弃（废弃请直接删除，历史交给 git）", () => {
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
      `这些文档自称已废弃却仍留在 docs/（现行规范目录）——请删除并更新引用，` +
        `否则会被当成现行规范：\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  test("文档内的相对链接不得悬空", () => {
    const offenders: string[] = [];
    const roots = ["docs", "dev_docs"];
    // 根目录文档（README / PROJECT_INDEX / HANDOFF）同样必须无悬空链接
    const files = [
      ...roots.flatMap((r) => filesWithExt(path.join(REPO, r), ".md")),
      ...["README.md", "PROJECT_INDEX.md", "HANDOFF.md", "PRODUCT.md", "CLAUDE.md"]
        .map((f) => path.join(REPO, f))
        .filter((f) => fs.existsSync(f)),
    ];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      const rel = path.relative(REPO, file);
      // markdown 链接 [x](target)：相对于所在文件解析
      for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)) {
        const target = m[1];
        if (!target || /^(https?:|mailto:|data:|#)/.test(target)) continue;
        if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
          offenders.push(`${rel} -> ${target}`);
        }
      }
      // 行内代码里的仓库路径 `docs/…md`：从仓库根解析
      for (const m of text.matchAll(/`((?:docs|dev_docs)\/[\w\-./\u4e00-\u9fff]+\.md)`/g)) {
        const target = m[1];
        if (!target) continue;
        if (!fs.existsSync(path.join(REPO, target))) {
          offenders.push(`${rel} -> ${target}`);
        }
      }
    }
    expect(offenders, `这些文档引用指向不存在的文件：\n  ${offenders.join("\n  ")}`).toEqual([]);
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

describe("界面验证脚本的钩子契约", () => {
  /**
   * 事故形状：`scripts/_ui-chat-driver.cjs` 用 `.input-area` / `.btn-send` 找元素，
   * 那是 Vue 时代的类名。2026-11-11 前端重写为 React + shadcn 后这些类全没了，
   * 脚本永远停在「输入框始终没出现」——而它被 HANDOFF 当作**现役**的真实验证手段。
   * 失效近两周无人察觉，因为没有任何闸门/CI 调用它，也没有任何测试断言它引用的钩子存在。
   *
   * 本锁只查一件事：驱动脚本里写死的选择器，必须在 web/src 里真的能找到。
   * 它不替代真跑（`verify-ui-*.mjs`），但能在界面重命名钩子时**立刻**变红，
   * 而不是等到有人手动跑一遍才发现。
   */
  const drivers = ["scripts/_ui-chat-driver.cjs", "scripts/_ui-capabilities-driver.cjs"];
  const webSrc = filesWithExt(path.join(REPO, "web", "src"), ".tsx")
    .concat(filesWithExt(path.join(REPO, "web", "src"), ".ts"))
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");

  test("两个界面驱动脚本都在（防空转）", () => {
    for (const rel of drivers) {
      expect(fs.existsSync(path.join(REPO, rel)), `缺少界面驱动脚本：${rel}`).toBe(true);
    }
  });

  test("驱动脚本里的 data-slot / aria-label 选择器必须存在于 web/src", () => {
    const offenders: string[] = [];
    for (const rel of drivers) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      // 只取选择器字符串里最有辨识度的两个钩子形态。
      for (const m of src.matchAll(/data-slot="([a-z-]+)"/g)) {
        const slot = m[1]!;
        if (!webSrc.includes(`data-slot="${slot}"`) && !webSrc.includes(`"${slot}"`)) {
          offenders.push(`${rel}: data-slot="${slot}" 在 web/src 里找不到`);
        }
      }
      for (const m of src.matchAll(/aria-label="([^"]+)"/g)) {
        const label = m[1]!;
        // 驱动脚本里也有自己的 UI 文案，只校验像钩子的短英文标签。
        if (!/^[A-Z][A-Za-z ]{2,20}$/.test(label)) continue;
        if (!webSrc.includes(label)) {
          offenders.push(`${rel}: aria-label="${label}" 在 web/src 里找不到`);
        }
      }
    }
    expect(
      offenders,
      "界面驱动脚本引用了前端已不存在的钩子——脚本会静默失效（找不到元素就超时）：\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  test("驱动脚本不许再用 Vue 时代的样式类名当钩子", () => {
    const offenders: string[] = [];
    for (const rel of drivers) {
      // 剥注释再扫：驱动脚本的头部注释**故意**记着这几个死类名（解释事故历史），
      // 不剥的话这条锁会被自己的说明文字判红。
      const src = fs
        .readFileSync(path.join(REPO, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      // 这些是已删除的 Vue 组件类名；出现即说明有人照旧模板改了脚本。
      //
      // ⚠️ 不能只查 `querySelector('...')` 这种调用形态：第一版就是这么写的，
      // 实测把选择器挪进 `SEL = { input: '.input-area' }` 常量表后**测试仍全绿**——
      // 判据绑在了写法上，而不是"脚本里是否还存在这个死钩子"。
      // 现在扫的是「类名是否作为 CSS 选择器字面量出现」，与它被放在哪儿无关。
      for (const ghost of [".input-area", ".btn-send", ".chat-connection-error-text"]) {
        const asSelector = new RegExp(`['"\`]${ghost.replace(/\./g, "\\.")}['"\`]`);
        if (asSelector.test(src)) {
          offenders.push(`${rel}: 仍在用 ${ghost}`);
        }
      }
    }
    expect(offenders, `Vue 时代的样式类名已不存在，请改用语义钩子：\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
