/**
 * tests/code-patch.test.ts — C4 多文件事务式编辑的失败路径。
 *
 * 重点是“预检失败不落盘、后续失败回滚”，而不是只测 happy path。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { applyPatchTool } from "../src/tools/patch";

let cwd = "";

function write(relative: string, content: string): string {
  const absolute = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
  return absolute;
}

async function apply(params: Record<string, unknown>) {
  return applyPatchTool(cwd).execute("call-1", params);
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-patch-"));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("code_apply_patch", () => {
  test("多文件精确替换成功，内容真实落盘", async () => {
    const a = write("a.ts", "const alpha = 1;\n");
    const b = write("b.ts", "const beta = 2;\n");
    const result = await apply({
      edits: [
        { path: "a.ts", old_string: "alpha = 1", new_string: "alpha = 10" },
        { path: "b.ts", old_string: "beta = 2", new_string: "beta = 20" },
      ],
    });
    expect((result.details as { ok: boolean }).ok).toBe(true);
    expect(fs.readFileSync(a, "utf8")).toContain("alpha = 10");
    expect(fs.readFileSync(b, "utf8")).toContain("beta = 20");
  });

  test("歧义匹配拒绝，且两个文件都不落盘", async () => {
    const a = write("a.ts", "const x = 1;\nconst x = 1;\n");
    const b = write("b.ts", "const y = 2;\n");
    const beforeA = fs.readFileSync(a, "utf8");
    const beforeB = fs.readFileSync(b, "utf8");
    const result = await apply({
      edits: [
        { path: "a.ts", old_string: "const x = 1;", new_string: "const x = 9;" },
        { path: "b.ts", old_string: "const y = 2;", new_string: "const y = 9;" },
      ],
    });
    expect((result.details as { ok: boolean }).ok).toBe(false);
    expect(fs.readFileSync(a, "utf8")).toBe(beforeA);
    expect(fs.readFileSync(b, "utf8")).toBe(beforeB);
  });

  test("创建需 allow_create；整体覆盖需 allow_overwrite；越界路径拒绝", async () => {
    const missing = await apply({ edits: [{ path: "new.ts", content: "export const n = 1;\n" }] });
    expect((missing.details as { ok: boolean }).ok).toBe(false);
    expect(fs.existsSync(path.join(cwd, "new.ts"))).toBe(false);

    write("existing.ts", "old\n");
    const overwrite = await apply({ edits: [{ path: "existing.ts", content: "new\n" }] });
    expect((overwrite.details as { ok: boolean }).ok).toBe(false);
    expect(fs.readFileSync(path.join(cwd, "existing.ts"), "utf8")).toBe("old\n");

    const escaped = await apply({ edits: [{ path: "../outside.ts", content: "x" }], allow_create: true });
    expect((escaped.details as { ok: boolean }).ok).toBe(false);
    expect(fs.existsSync(path.join(cwd, "..", "outside.ts"))).toBe(false);
  });

  test("同一次调用重复编辑同一文件被拒绝", async () => {
    write("one.ts", "a\nb\n");
    const result = await apply({
      edits: [
        { path: "one.ts", old_string: "a", new_string: "A" },
        { path: "one.ts", old_string: "b", new_string: "B" },
      ],
    });
    expect((result.details as { ok: boolean }).ok).toBe(false);
    expect(fs.readFileSync(path.join(cwd, "one.ts"), "utf8")).toBe("a\nb\n");
  });
});
