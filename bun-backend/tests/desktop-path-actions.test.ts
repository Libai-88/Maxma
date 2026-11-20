/**
 * tests/desktop-path-actions.test.ts — shell.openPath 的 P1 白名单。
 *
 * 校验函数不依赖 Electron，因此可以在 Bun 里直接测；主进程和 UI 驱动
 * 调用的是同一份实现。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { assertOpenableHtml } = require("../../desktop/electron/path-actions.cjs") as {
  assertOpenableHtml: (value: unknown) => boolean;
};

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-open-path-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("desktop openPath 白名单", () => {
  test("HTML/HTM 文件允许", () => {
    fs.writeFileSync(path.join(dir, "page.html"), "<h1>ok</h1>", "utf8");
    fs.writeFileSync(path.join(dir, "legacy.htm"), "<h1>ok</h1>", "utf8");
    expect(assertOpenableHtml(path.join(dir, "page.html"))).toBe(true);
    expect(assertOpenableHtml(path.join(dir, "legacy.htm"))).toBe(true);
  });

  test("非 HTML 文件、目录、缺失路径、NUL 都拒绝", () => {
    fs.writeFileSync(path.join(dir, "note.md"), "not html", "utf8");
    fs.mkdirSync(path.join(dir, "folder.html"));

    expect(() => assertOpenableHtml(path.join(dir, "note.md"))).toThrow("只允许从文件面板打开 HTML 文件");
    expect(() => assertOpenableHtml(path.join(dir, "folder.html"))).toThrow("路径不是文件");
    expect(() => assertOpenableHtml(path.join(dir, "missing.html"))).toThrow("路径不存在");
    expect(() => assertOpenableHtml(path.join(dir, "page\0.html"))).toThrow("无效路径");
    expect(() => assertOpenableHtml("")).toThrow("无效路径");
    expect(() => assertOpenableHtml(null)).toThrow("无效路径");
  });
});
