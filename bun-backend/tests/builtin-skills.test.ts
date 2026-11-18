/**
 * tests/builtin-skills.test.ts — 随包技能的"格式 + 打包"双守卫。
 *
 * 三类容易静默腐烂的东西：
 *   1. frontmatter 的 name 与目录名不一致 → 技能永远选不中，但界面看不出来；
 *   2. 技能写得太薄（没有步骤/边界）→ 模型读了等于没读；
 *   3. 新增技能只进了 `.maxma/skills`，忘了两个打包脚本的清单 → 包里没有，
 *      或者进了包却没有任何校验。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dir, "../..");
const SKILLS_ROOT = path.join(REPO, ".maxma", "skills");

function skillDirs(): string[] {
  return fs
    .readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function readSkill(name: string): string {
  return fs.readFileSync(path.join(SKILLS_ROOT, name, "SKILL.md"), "utf8");
}

function frontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const m = /^([a-z_]+):\s*(.+)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

describe("随包技能：格式", () => {
  test("每个技能都有合法 frontmatter，name 等于目录名", () => {
    for (const dir of skillDirs()) {
      const fm = frontmatter(readSkill(dir));
      expect(fm.name).toBe(dir);
      const description = fm.description ?? "";
      expect(description.length).toBeGreaterThan(8);
      // 描述是模型选择的唯一依据，太长会被截断、太短说不清场景。
      expect(description.length).toBeLessThanOrEqual(90);
    }
  });

  test("技能有可执行结构：≥2 个二级标题、正文 ≥250 字", () => {
    for (const dir of skillDirs()) {
      const content = readSkill(dir).replace(/^---\n[\s\S]*?\n---\n/, "");
      const headings = content.match(/^## /gm) ?? [];
      expect(headings.length).toBeGreaterThanOrEqual(2);
      expect(content.trim().length).toBeGreaterThanOrEqual(250);
    }
  });
});

describe("随包技能：打包清单一致", () => {
  const dirs = skillDirs();
  const desktopScript = fs.readFileSync(path.join(REPO, "build-desktop-portable.ps1"), "utf8");
  const webScript = fs.readFileSync(path.join(REPO, "build-portable.bat"), "utf8");

  test("build-desktop-portable.ps1 的 $BundledSkillNames 覆盖全部技能", () => {
    for (const dir of dirs) expect(desktopScript).toContain(`"${dir}"`);
  });

  test("build-portable.bat 的校验清单覆盖全部技能", () => {
    for (const dir of dirs) {
      // 批处理里是空格分隔的裸名字；用词边界避免 "coding-starter" 命中 "coding-starter-x"。
      expect(webScript).toMatch(new RegExp(`(^|[\\s(])${dir}([\\s)]|$)`, "m"));
    }
  });

  test("新增技能后，README / 开发文档的入口仍然有效", () => {
    expect(fs.existsSync(path.join(REPO, "docs", "plugin-development.md"))).toBe(true);
    expect(fs.readFileSync(path.join(REPO, "README.md"), "utf8")).toContain(
      "docs/plugin-development.md",
    );
    expect(fs.readFileSync(path.join(REPO, "PROJECT_INDEX.md"), "utf8")).toContain(
      "docs/plugin-development.md",
    );
  });
});
