import { describe, expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";

import { discoverMaxmaSkills, maxmaSkillPaths } from "../src/kernel/skills";

describe("kernel: Maxma skills", () => {
  test("includes the read-only bundled skills directory", () => {
    const cwd = path.join(os.tmpdir(), "maxma-skill-test-project");
    const paths = maxmaSkillPaths(cwd);

    expect(paths).toContain(path.join(cwd, ".agents", "skills"));
    expect(paths).toContain(path.join(os.homedir(), ".agents", "skills"));
    expect(paths).toContain(path.join(process.env.MAXMA_BUNDLE_DIR ?? path.resolve(import.meta.dir, "../.."), ".maxma", "skills"));
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("returns no paths when Skills are disabled", () => {
    expect(maxmaSkillPaths(path.join(os.tmpdir(), "maxma-skill-test-project"), false)).toEqual([]);
  });

  test("bundled Skills only reference tools available in Maxma Pi sessions", () => {
    // 目录即真源：新增技能不必再回来改这份清单（改漏了这条守卫会静默漏检）。
    const bundledRoot = maxmaSkillPaths(path.join(os.tmpdir(), "maxma-skill-test-project"))[2]!;
    const skillFiles = require("node:fs")
      .readdirSync(bundledRoot, { withFileTypes: true })
      .filter((e: { isDirectory: () => boolean }) => e.isDirectory())
      .map((e: { name: string }) => path.join(bundledRoot, e.name, "SKILL.md"));
    const forbiddenToolNames = ["glob", "web_search", "ast_grep", "ast_edit", "lsp", "manage_skill"];
    for (const file of skillFiles) {
      const content = require("node:fs").readFileSync(file, "utf8") as string;
      for (const name of forbiddenToolNames) expect(content).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
  test("discovers bundled skills without requiring a project-local .agents directory", () => {
    const result = discoverMaxmaSkills(path.join(os.tmpdir(), "maxma-skill-test-project"));
    const names = new Set(result.skills.map((skill) => skill.name));

    expect(names).toContain("coding-starter");
    expect(names).toContain("office-starter");
    expect(names).toContain("debugging-starter");
    expect(names).toContain("document-starter");
    expect(names).toContain("spreadsheet-starter");
    expect(names).toContain("mcp-starter");
    expect(names).toContain("execution-playbook");
    expect(names).toContain("cost-aware");
    expect(names).toContain("research-evidence");
    expect(names).toContain("document-quality");
    expect(names).toContain("security-review");
    expect(names).toContain("clarify-before-action");
    // 2026-11-18：补齐"开箱即用"的四条常用工作流。
    expect(names).toContain("repo-onboarding");
    expect(names).toContain("release-notes");
    expect(names).toContain("meeting-notes");
    expect(names).toContain("writing-polish");
  });
});
