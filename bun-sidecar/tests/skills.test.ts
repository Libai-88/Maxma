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
    const skillFiles = ["coding-starter", "debugging-starter", "office-starter", "document-starter", "spreadsheet-starter", "mcp-starter"]
      .map((name) => path.join(maxmaSkillPaths(path.join(os.tmpdir(), "maxma-skill-test-project"))[2], name, "SKILL.md"));
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
  });
});
