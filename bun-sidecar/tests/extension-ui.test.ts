/**
 * tests/extension-ui.test.ts — 扩展 UI 桥（EXT-UI-001）。
 *
 * ## 为什么这组测试重要
 *
 * 此前 `bindExtensions({})` 传空对象，`ExtensionRunner` 回落到 `noOpUIContext`，
 * 而它的 **`confirm` 恒返回 `false`**（`dist/core/extensions/runner.js`）。
 * 后果不是"少个弹窗"，是**行为错误**：pi 官方示例 `confirm-destructive.ts`
 * 在 Maxma 里会静默拒绝一切操作，不报错、不留痕。
 *
 * 所以这里锁三件事：
 *   1. 对话框真的走 WS 往返（不是直接返回默认值）；
 *   2. 超时按**官方默认值**回填（confirm→false，其余→cancelled），与审批门的
 *      "超时默认拒绝"是两套语义，不能混；
 *   3. 完整实现 24 个方法——TUI 专属方法给安全 no-op，不能是 undefined
 *      （扩展调 `ui.getAllThemes()` 拿到 undefined 再 `.length` 会当场崩）。
 */

import { describe, expect, test } from "bun:test";

import { createExtensionUiBridge } from "../src/kernel/extension-ui";

interface Emitted {
  type: string;
  payload: Record<string, unknown>;
}

function makeBridge(timeoutMs?: number) {
  const emitted: Emitted[] = [];
  const bridge = createExtensionUiBridge({
    emit: (event) => emitted.push(event as Emitted),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  return { bridge, emitted };
}

/** 微任务排空：ask() 里有 await 续体。 */
const drain = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("扩展 UI 桥", () => {
  test("confirm 走 WS 往返：发出 extension_ui_request，收到 true 才返回 true", async () => {
    const { bridge, emitted } = makeBridge();
    const p = bridge.uiContext.confirm("删除前确认", "要删除 3 个文件吗？");
    await drain();

    expect(emitted).toHaveLength(1);
    const req = emitted[0]!;
    expect(req.type).toBe("extension_ui_request");
    expect(req.payload.method).toBe("confirm");
    expect(req.payload.title).toBe("删除前确认");
    expect(req.payload.message).toBe("要删除 3 个文件吗？");
    expect(typeof req.payload.id).toBe("string");

    // 关键：没应答前 promise 不能自己 resolve（这正是 noOp 版的病）
    expect(bridge.pendingCount()).toBe(1);

    expect(bridge.resolve(req.payload.id as string, { confirmed: true })).toBe(true);
    expect(await p).toBe(true);
    expect(bridge.pendingCount()).toBe(0);
  });

  test("confirm 回 false 时返回 false（不是 undefined）", async () => {
    const { bridge, emitted } = makeBridge();
    const p = bridge.uiContext.confirm("确认", "继续？");
    await drain();
    bridge.resolve(emitted[0]!.payload.id as string, { confirmed: false });
    expect(await p).toBe(false);
  });

  test("select 返回选中的值；cancelled 时返回 undefined", async () => {
    const { bridge, emitted } = makeBridge();
    const p = bridge.uiContext.select("选一个", ["甲", "乙"]);
    await drain();
    expect(emitted[0]!.payload.options).toEqual(["甲", "乙"]);
    bridge.resolve(emitted[0]!.payload.id as string, { value: "乙" });
    expect(await p).toBe("乙");

    const p2 = bridge.uiContext.select("再选", ["丙"]);
    await drain();
    bridge.resolve(emitted[1]!.payload.id as string, { cancelled: true });
    expect(await p2).toBeUndefined();
  });

  test("input / editor 携带 placeholder 与 prefill", async () => {
    const { bridge, emitted } = makeBridge();
    const pi = bridge.uiContext.input("输入名字", "张三");
    await drain();
    expect(emitted[0]!.payload.placeholder).toBe("张三");
    bridge.resolve(emitted[0]!.payload.id as string, { value: "李四" });
    expect(await pi).toBe("李四");

    const pe = bridge.uiContext.editor("编辑正文", "预填内容");
    await drain();
    expect(emitted[1]!.payload.prefill).toBe("预填内容");
    bridge.resolve(emitted[1]!.payload.id as string, { value: "改过的" });
    expect(await pe).toBe("改过的");
  });

  test("notify 是 fire-and-forget：立即返回、不产生在途请求", async () => {
    const { bridge, emitted } = makeBridge();
    bridge.uiContext.notify("装好了", "info");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.payload.method).toBe("notify");
    expect(emitted[0]!.payload.notify_type).toBe("info");
    expect(bridge.pendingCount()).toBe(0);
  });

  test("超时按官方默认值回填：confirm→false，select/input/editor→undefined", async () => {
    const { bridge } = makeBridge(30);

    // confirm：超时 → false（官方语义）
    const c = bridge.uiContext.confirm("确认", "继续？");
    expect(await c).toBe(false);

    // select：超时 → undefined
    const s = bridge.uiContext.select("选", ["a"]);
    expect(await s).toBeUndefined();

    // input：超时 → undefined
    const i = bridge.uiContext.input("输入");
    expect(await i).toBeUndefined();

    expect(bridge.pendingCount()).toBe(0);
  });

  test("rejectAll 清空在途对话框（会话销毁/取消时防 promise 泄漏）", async () => {
    const { bridge } = makeBridge();
    const p1 = bridge.uiContext.confirm("一", "1");
    const p2 = bridge.uiContext.select("二", ["x"]);
    await drain();
    expect(bridge.pendingCount()).toBe(2);

    bridge.rejectAll();
    expect(bridge.pendingCount()).toBe(0);
    expect(await p1).toBe(false);
    expect(await p2).toBeUndefined();
  });

  test("未命中 id 的应答返回 false，不抛错（超时后迟到的应答属正常竞争）", () => {
    const { bridge } = makeBridge();
    expect(bridge.resolve("no-such-id", { value: "x" })).toBe(false);
  });

  test("TUI 专属方法是安全 no-op，不是 undefined", () => {
    const { bridge } = makeBridge();
    const ui = bridge.uiContext;

    // 这些若返回 undefined，扩展调 `.length` / `.map` 会当场崩。
    expect(Array.isArray(ui.getAllThemes())).toBe(true);
    expect(ui.getAllThemes()).toEqual([]);
    expect(typeof ui.getEditorText()).toBe("string");
    expect(ui.getToolsExpanded()).toBe(false);
    expect(ui.getEditorComponent()).toBeUndefined();
    expect(ui.getTheme("whatever")).toBeUndefined();
    expect(ui.setTheme("dark")).toEqual({ success: false, error: expect.any(String) });
    expect(typeof ui.onTerminalInput(() => ({}))).toBe("function");
    // theme 必须可读（扩展取色时会访问），且不能是 undefined
    expect(ui.theme).toBeDefined();
    expect(typeof ui.theme.name).toBe("string");
  });
});
