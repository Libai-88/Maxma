import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const {
  buildA11ySnapshot,
  normalizePoint,
  normalizeUploadPaths,
  parseKeyChord,
  truncateJson,
} = require("../../desktop/electron/browser-cdp.cjs");

function ax(role: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    ignored: false,
    role: { type: "role", value: role },
    name: { type: "computedString", value: name },
    backendDOMNodeId: 101,
    properties: [],
    ...extra,
  };
}

describe("CDP 无障碍快照", () => {
  test("只保留可操作/可聚焦节点，生成连续 ref 并跳过 inlineTextBox", () => {
    const nodes = [
      ax("button", "提交", { backendDOMNodeId: 201 }),
      ax("inlineTextBox", "提交"),
      ax("textbox", "姓名", { backendDOMNodeId: 202, value: { type: "string", value: "" } }),
      ax("checkbox", "记住我", {
        backendDOMNodeId: 203,
        properties: [
          { name: "checked", value: { type: "boolean", value: true } },
          { name: "disabled", value: { type: "boolean", value: false } },
        ],
      }),
      ax("generic", "自定义可聚焦区域", {
        backendDOMNodeId: 204,
        properties: [{ name: "focusable", value: { type: "boolean", value: true } }],
      }),
      { ignored: false, role: { value: "paragraph" }, backendDOMNodeId: 205 },
    ];
    const snapshot = buildA11ySnapshot(nodes, { epoch: "7" });
    expect(snapshot.epoch).toBe("7");
    expect(snapshot.elements).toEqual([
      { ref: "e1", role: "button", name: "提交" },
      { ref: "e2", role: "textbox", name: "姓名" },
      { ref: "e3", role: "checkbox", name: "记住我", checked: true, disabled: false },
      { ref: "e4", role: "generic", name: "自定义可聚焦区域" },
    ]);
    expect([...snapshot.refs.values()]).toEqual([201, 202, 203, 204]);
  });

  test("没有 backendDOMNodeId 或 ignored 的节点不占用 ref，旧 ref 不会错位", () => {
    const snapshot = buildA11ySnapshot([
      ax("button", "无句柄", { backendDOMNodeId: undefined }),
      { ignored: true, role: { value: "button" }, name: { value: "隐藏" }, backendDOMNodeId: 300 },
      ax("link", "文档", { backendDOMNodeId: 301 }),
    ]);
    expect(snapshot.elements).toEqual([{ ref: "e1", role: "link", name: "文档" }]);
    expect(snapshot.refs.get("e1")).toBe(301);
  });

  test("根节点和容器节点不算可操作元素，避免 ref 浪费在 WebArea 上", () => {
    const snapshot = buildA11ySnapshot([
      ax("RootWebArea", "Maxma Native Gate", {
        backendDOMNodeId: 500,
        properties: [{ name: "focusable", value: { type: "boolean", value: true } }],
      }),
      ax("button", "提交", { backendDOMNodeId: 501 }),
    ]);
    expect(snapshot.elements).toEqual([{ ref: "e1", role: "button", name: "提交" }]);
    expect(snapshot.refs.get("e1")).toBe(501);
  });

  test("元素数封顶，避免整站 AX 树撑爆上下文", () => {
    const nodes = Array.from({ length: 130 }, (_, index) =>
      ax("button", `按钮 ${index}`, { backendDOMNodeId: 400 + index }),
    );
    const snapshot = buildA11ySnapshot(nodes, { maxElements: 3 });
    expect(snapshot.elements.map((item: { ref: string }) => item.ref)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("原生按键解析", () => {
  test("普通字母、组合键与特殊键", () => {
    expect(parseKeyChord("A")).toMatchObject({ key: "a", code: "KeyA", windowsVirtualKeyCode: 65, text: "a" });
    expect(parseKeyChord("Control+A")).toMatchObject({ key: "a", code: "KeyA", modifiers: 2, text: "" });
    expect(parseKeyChord("Shift+Tab")).toMatchObject({ key: "Tab", code: "Tab", modifiers: 8 });
    expect(parseKeyChord("Enter")).toMatchObject({ key: "Enter", code: "Enter", text: "\r" });
    expect(parseKeyChord("ArrowDown")).toMatchObject({ key: "ArrowDown", windowsVirtualKeyCode: 40 });
  });

  test("未知键返回 null，不静默发错键", () => {
    expect(parseKeyChord("Hyper+Whatever")).toBeNull();
    expect(parseKeyChord("")).toBeNull();
    expect(parseKeyChord("Control+")).toBeNull();
  });
});

test("truncateJson 对循环引用也不抛", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(typeof truncateJson(cyclic)).toBe("string");
});

describe("浏览器视觉坐标与上传路径", () => {
  test("坐标归一：四舍五入、拒绝负数与非有限值", () => {
    expect(normalizePoint(10.4, 20.6)).toEqual({ x: 10, y: 21 });
    expect(normalizePoint(10.4, 20.6, 5, 5)).toEqual({ x: 5, y: 5 });
    expect(normalizePoint(-1, 20)).toBeNull();
    expect(normalizePoint("abc", 20)).toBeNull();
    expect(normalizePoint(Number.NaN, 20)).toBeNull();
  });

  test("上传路径：绝对、存在、普通文件，去重且最多 10 个", () => {
    const root = mkdtempSync(join(tmpdir(), "maxma-cdp-upload-"));
    try {
      const file = join(root, "a.txt");
      writeFileSync(file, "upload", "utf8");
      expect(normalizeUploadPaths([file, file])).toEqual([file]);
      expect(() => normalizeUploadPaths(["relative.txt"])).toThrow("绝对路径");
      expect(() => normalizeUploadPaths([join(root, "missing.txt")])).toThrow("不存在");
      expect(() => normalizeUploadPaths([root])).toThrow("不是普通文件");
      expect(() => normalizeUploadPaths([])).toThrow("files 数组");
      expect(() => normalizeUploadPaths(Array.from({ length: 11 }, (_, index) => join(root, `${index}.txt`)))).toThrow("最多上传 10 个");
      expect(basename(normalizeUploadPaths([file])[0])).toBe("a.txt");
      mkdirSync(join(root, "sub"));
      expect(() => normalizeUploadPaths([join(root, "sub")])).toThrow("不是普通文件");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

