/**
 * tests/path-policy.test.ts — M1/T2 路径策略的负例矩阵。
 *
 * 每个用例都从 PathPolicy 的公开入口 check/checkCommand 取证；不直接断言内部字段。
 * symlink/junction 用例在 Windows 无权限创建时跳过，不把环境限制伪装成通过。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PathPolicy, validatePathSyntax } from "../src/kernel/path-policy";
import { createMaxmaPathPolicyExtension, MAXMA_PATH_POLICY_EXTENSION_NAME } from "../src/kernel/extensions/maxma-path-policy";

let root = "";
let outside = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-path-root-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-path-outside-"));
  fs.writeFileSync(path.join(root, "inside.txt"), "inside\n", "utf8");
  fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "nested", "file.ts"), "export const x = 1;\n", "utf8");
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret\n", "utf8");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

function policy(): PathPolicy {
  return new PathPolicy({ roots: [root], cwd: root });
}

describe("PathPolicy 负例", () => {
  test("绝对越界、盘符、UNC、设备命名空间、ADS、NUL、控制字符全部拒绝", () => {
    const p = policy();
    const outsideFile = path.join(outside, "secret.txt");
    const cases: Array<{ label: string; raw: string; code: string }> = [
      { label: "绝对越界", raw: outsideFile, code: "PATH_OUTSIDE_ROOT" },
      { label: "盘符相对", raw: "C:secret.txt", code: "PATH_INVALID" },
      { label: "盘符绝对（Windows 字符串）", raw: "C:\\Windows\\win.ini", code: "PATH_INVALID|PATH_OUTSIDE_ROOT" },
      { label: "UNC", raw: "\\\\server\\share\\secret.txt", code: "PATH_INVALID" },
      { label: "设备命名空间", raw: "\\\\?\\C:\\Windows\\win.ini", code: "PATH_INVALID" },
      { label: "ADS", raw: "inside.txt:secret", code: "PATH_INVALID" },
      { label: "NUL 字节", raw: "inside.txt\u0000.jpg", code: "PATH_INVALID" },
      { label: "控制字符", raw: "inside\u0001.txt", code: "PATH_INVALID" },
      { label: "空路径", raw: "", code: "PATH_INVALID" },
      { label: "home 展开", raw: "~/secret.txt", code: "PATH_INVALID" },
      { label: "环境变量", raw: "%USERPROFILE%\\secret.txt", code: "PATH_INVALID" },
      { label: "父目录穿越", raw: "../outside/secret.txt", code: "PATH_INVALID" },
      { label: "夹层穿越", raw: "src/../../outside/secret.txt", code: "PATH_INVALID" },
      { label: "反斜杠穿越", raw: "..\\outside\\secret.txt", code: "PATH_INVALID" },
    ];
    for (const item of cases) {
      const decision = p.check(item.raw, "read");
      expect(decision.allowed, `${item.label} 应被拒绝`).toBe(false);
      const allowedCodes = item.code.split("|");
      expect(allowedCodes, `${item.label} 的错误码`).toContain(decision.code);
    }
  });

  test("读取不存在的路径返回 PATH_NOT_FOUND，不把缺失当成放行", () => {
    const decision = policy().check("missing.txt", "read");
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("PATH_NOT_FOUND");
  });

  test("写入目标可以不存在，但父目录越界仍拒绝", () => {
    const p = policy();
    expect(p.check("src/new-file.ts", "write").allowed).toBe(true);
    const outsideTarget = path.join(outside, "new-file.ts");
    const decision = p.check(outsideTarget, "write");
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("PATH_OUTSIDE_ROOT");
  });

  test("读取目录允许；读取非普通文件/目录拒绝", () => {
    const p = policy();
    expect(p.check("src", "read").allowed).toBe(true);
    // Windows 的设备路径不在根内，会被越界拒绝；这里只断言不会误放行。
    expect(p.check("\\\\?\\C:\\", "read").allowed).toBe(false);
  });

  test("逐段 symlink/junction 拒绝（无权限创建时跳过，不伪造通过）", () => {
    let linked = false;
    try {
      fs.symlinkSync(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
      linked = true;
    } catch {
      // Windows 普通用户可能没有创建 junction 的权限。
    }
    if (!linked) return;
    const decision = policy().check("escape/secret.txt", "read");
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("PATH_SYMLINK");
  });

  test("合法路径：相对、绝对根内、深层嵌套、大小写变体", () => {
    const p = policy();
    expect(p.check("inside.txt", "read").allowed).toBe(true);
    expect(p.check(path.join(root, "inside.txt"), "read").allowed).toBe(true);
    expect(p.check("src/nested/file.ts", "read").allowed).toBe(true);
    const upper = process.platform === "win32" ? "INSIDE.TXT" : "inside.txt";
    expect(p.check(upper, "read").allowed).toBe(true);
  });
});

describe("PathPolicy 命令守卫", () => {
  test("普通命令放行；明显越界路径、..、家目录展开拒绝", () => {
    const p = policy();
    expect(p.checkCommand("bun test").allowed).toBe(true);
    expect(p.checkCommand("git status --short").allowed).toBe(true);
    expect(p.checkCommand("node -e \"console.log(1)\"").allowed).toBe(true);

    for (const command of [
      "cat C:\\Windows\\win.ini",
      "dir ..\\outside",
      "cd ..",
      "cat $HOME/secret.txt",
      "cat %USERPROFILE%\\secret.txt",
      "powershell -Command \"Get-Content C:/Windows/win.ini\"",
      "cat \\\\server\\share\\secret.txt",
    ]) {
      const decision = p.checkCommand(command);
      expect(decision.allowed, command).toBe(false);
      expect(decision.code).toBe("PATH_COMMAND_ESCAPE");
    }
  });

  test("URL 中的 :// 不被误判为盘符路径", () => {
    expect(policy().checkCommand("curl https://example.com/api").allowed).toBe(true);
  });
});

describe("validatePathSyntax", () => {
  test("语法层拒绝项与错误码稳定", () => {
    const cases = [
      ["", "路径不能为空"],
      ["a\u0000b", "路径包含控制字符"],
      ["~/x", "不允许家目录展开路径"],
      ["C:foo", "不允许盘符相对路径"],
      ["\\\\server\\share", "不允许 UNC 网络路径"],
      ["a/b:ads", "路径包含非法冒号（Win32 ADS）"],
    ] as const;
    for (const [raw, message] of cases) {
      expect(validatePathSyntax(raw)).toBe(message);
    }
    expect(validatePathSyntax("src/nested/file.ts")).toBeNull();
  });
});

describe("Maxma PathPolicy extension", () => {
  function handlerFor(p: PathPolicy) {
    const ext = createMaxmaPathPolicyExtension(p, root) as { name: string; factory: (pi: unknown) => void };
    let handler: ((event: unknown) => Promise<unknown>) | undefined;
    ext.factory({
      on: (_event: string, h: (event: unknown) => Promise<unknown>) => {
        handler = h;
        return () => {};
      },
    });
    return { ext, handler: handler! };
  }

  test("扩展名稳定；根内 read 放行、越界 read block", async () => {
    const { ext, handler } = handlerFor(policy());
    expect(ext.name).toBe(MAXMA_PATH_POLICY_EXTENSION_NAME);
    const inside = await handler({ toolName: "read", toolCallId: "p1", input: { file_path: "inside.txt" } });
    expect(inside).toBeUndefined();
    const outsidePath = path.join(outside, "secret.txt");
    const outsideRead = await handler({ toolName: "read", toolCallId: "p2", input: { file_path: outsidePath } });
    expect(outsideRead).toMatchObject({ block: true });
    expect((outsideRead as { reason: string }).reason).toContain("不要重试同一路径");
  });

  test("bash 命令逃逸在工具开跑前 block；放行命令会重建环境", async () => {
    const { handler } = handlerFor(policy());
    const blocked = await handler({
      toolName: "bash",
      toolCallId: "p3",
      input: { command: "cat C:\\Windows\\win.ini" },
    });
    expect(blocked).toMatchObject({ block: true });
    expect((blocked as { reason: string }).reason).toContain("命令被安全策略拒绝");
    const input = { command: "bun test" };
    expect(await handler({ toolName: "bash", toolCallId: "p4", input })).toBeUndefined();
    expect(input.command).toContain("export HOME=");
    expect(input.command).toContain("MAXMA_COMMAND_SANDBOX");
    expect(input.command.endsWith("bun test")).toBe(true);
  });

  test("多文件编辑：嵌套 edits 的每个 path 都过 PathPolicy", async () => {
    const { handler } = handlerFor(policy());
    const inside = await handler({
      toolName: "code_apply_patch",
      toolCallId: "p5",
      input: { edits: [{ path: "src/new-file.ts", content: "export const ok = 1;" }] },
    });
    expect(inside).toBeUndefined();

    const outsideEdit = await handler({
      toolName: "code_apply_patch",
      toolCallId: "p6",
      input: { edits: [{ path: path.join(outside, "escape.ts"), content: "x" }] },
    });
    expect(outsideEdit).toMatchObject({ block: true });
    expect((outsideEdit as { reason: string }).reason).toContain("多文件编辑路径被拒绝");

    const missingPath = await handler({
      toolName: "code_apply_patch",
      toolCallId: "p7",
      input: { edits: [{ content: "x" }] },
    });
    expect(missingPath).toMatchObject({ block: true });
  });
});
