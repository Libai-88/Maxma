/**
 * tests/extensions-visibility.test.ts — EXT-VISIBLE-001 / EXT-TOGGLE-001 的回归锁。
 *
 * 背景：`createMaxmaSession` 以前只解构 `{ session }`，把官方
 * `extensionsResult`（extensions/errors/warnings）整个丢掉。结果：
 *   - 用户自己放进 `<agentDir>/extensions/` 的扩展在跑，界面看不见；
 *   - 扩展语法错误/加载失败零提示（沉默，而非报错）。
 *
 * 这里用**真实 pi 资源加载**（DefaultResourceLoader + 临时 agentDir）验证，
 * 不 mock 官方：只有真实加载才能证明"我们拿到的就是引擎看到的"。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildExtensionsSnapshot,
  extensionIdentity,
  filterDisabledExtensions,
  getLastExtensionsSnapshot,
  resetExtensionsSnapshotForTests,
  type ExtensionsSnapshot,
} from "../src/kernel/extensions";
import {
  createMaxmaSessionWithExtensions,
  probeExtensionsSnapshot,
} from "../src/kernel/pi-session";

let agentDir = "";

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-ext-"));
  const extDir = path.join(agentDir, "extensions");
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(path.join(extDir, "hello.ts"), "export default function (pi) {}\n");
  fs.writeFileSync(path.join(extDir, "broken.ts"), "export default function ( {\n");
  resetExtensionsSnapshotForTests();
});

afterEach(() => {
  fs.rmSync(agentDir, { recursive: true, force: true });
  resetExtensionsSnapshotForTests();
});

function byId(snapshot: ExtensionsSnapshot, id: string) {
  return snapshot.extensions.find((e) => e.id === id);
}

describe("extensionIdentity：来源判定只依赖官方路径形状", () => {
  test("用户扩展 → 相对 extensions 目录的 posix 路径，可禁用", () => {
    const p = path.join(agentDir, "extensions", "team", "tool.ts");
    expect(extensionIdentity(p, agentDir)).toEqual({ id: "team/tool.ts", scope: "user" });
  });

  test("内联工厂与内置扩展不可禁用", () => {
    expect(extensionIdentity("<inline:maxma-approval>", agentDir)).toEqual({
      id: "<inline:maxma-approval>",
      scope: "inline",
    });
    expect(extensionIdentity("builtin:mcp", agentDir)).toEqual({ id: "builtin:mcp", scope: "builtin" });
  });

  test("extensions 目录之外的文件不当作可禁用用户扩展", () => {
    const p = path.join(agentDir, "other", "sneaky.ts");
    expect(extensionIdentity(p, agentDir)).toEqual({ id: p, scope: "other" });
  });
});

describe("真实加载：清单与错误都可见", () => {
  test("probe 能列出用户扩展，并把加载失败的扩展放进 errors", async () => {
    const snapshot = await probeExtensionsSnapshot({ agentDir, cwd: agentDir });

    expect(byId(snapshot, "hello.ts")?.enabled).toBe(true);
    expect(byId(snapshot, "hello.ts")?.scope).toBe("user");
    expect(byId(snapshot, "hello.ts")?.disablable).toBe(true);

    // 语法错误必须被上报，而不是静默消失
    expect(snapshot.errors.length).toBeGreaterThan(0);
    expect(snapshot.errors.some((e) => e.path.endsWith("broken.ts"))).toBe(true);

    // Maxma 拒止扩展是内联的：在清单里，但不可禁用
    expect(byId(snapshot, "<inline:maxma-blocker>")?.disablable).toBe(false);
    expect(snapshot.agent_dir).toBe(agentDir);
    expect(snapshot.extensions_dir).toBe(path.join(agentDir, "extensions"));
  });

  test("probe 结果写入进程内缓存，GET 侧读到的就是同一份", async () => {
    const snapshot = await probeExtensionsSnapshot({ agentDir, cwd: agentDir });
    const cached = getLastExtensionsSnapshot();
    expect(cached).not.toBeNull();
    expect(cached!.loaded_at).toBe(snapshot.loaded_at);
    expect(cached!.extensions.map((e) => e.id).sort()).toEqual(snapshot.extensions.map((e) => e.id).sort());
  });

  test("建会话同样会记录快照（createAgentSession 的 extensionsResult 不再被丢弃）", async () => {
    const { session, extensions } = await createMaxmaSessionWithExtensions({
      inMemory: true,
      agentDir,
      cwd: agentDir,
      permissionMode: "auto",
    });
    expect(extensions.extensions.some((e) => e.id === "hello.ts")).toBe(true);
    expect(getLastExtensionsSnapshot()!.loaded_at).toBe(extensions.loaded_at);
    session.dispose();
  });
});

describe("禁用：只过滤用户扩展，安全扩展原样保留", () => {
  test("禁用后用户扩展仍出现在清单里，但标记为未启用", async () => {
    const snapshot = await probeExtensionsSnapshot({
      agentDir,
      cwd: agentDir,
      disabledExtensions: ["hello.ts"],
    });
    const hello = byId(snapshot, "hello.ts");
    expect(hello).toBeDefined();
    expect(hello!.enabled).toBe(false);
    expect(snapshot.disabled_applied).toEqual(["hello.ts"]);
    // 拒止扩展照常装配
    expect(byId(snapshot, "<inline:maxma-blocker>")?.enabled).toBe(true);
  });

  test("filterDisabledExtensions 对内联扩展的 id 一律不放行", () => {
    const base = {
      extensions: [
        { path: "<inline:maxma-approval>" },
        { path: path.join(agentDir, "extensions", "hello.ts") },
      ],
      errors: [],
      runtime: {} as never,
    } as never;
    const filtered = filterDisabledExtensions(base, ["<inline:maxma-approval>"], agentDir);
    expect(filtered.extensions).toHaveLength(2);
  });

  test("空禁用列表不改变加载结果（原样返回同一对象）", () => {
    const base = { extensions: [], errors: [], runtime: {} as never } as never;
    expect(filterDisabledExtensions(base, [], agentDir)).toBe(base);
  });

  test("多条禁用时只有命中项被移除", () => {
    const base = {
      extensions: [
        { path: path.join(agentDir, "extensions", "hello.ts") },
        { path: path.join(agentDir, "extensions", "keep.ts") },
      ],
      errors: [],
      runtime: {} as never,
    } as never;
    const filtered = filterDisabledExtensions(base, ["hello.ts", "nope.ts"], agentDir);
    expect(filtered.extensions.map((e: { path: string }) => path.basename(e.path))).toEqual(["keep.ts"]);
  });
});

describe("快照组装：不重复、不虚构", () => {
  test("同一扩展同时出现在 loaded 与 discovered 时只保留一条（enabled=true）", () => {
    const extPath = path.join(agentDir, "extensions", "hello.ts");
    const ext = { path: extPath, hidden: false } as never;
    const snapshot = buildExtensionsSnapshot({
      loaded: { extensions: [ext], errors: [], runtime: {} as never } as never,
      discovered: { extensions: [ext], errors: [], runtime: {} as never } as never,
      agentDir,
      disabledIds: [],
    });
    expect(snapshot.extensions.filter((e) => e.id === "hello.ts")).toHaveLength(1);
    expect(byId(snapshot, "hello.ts")!.enabled).toBe(true);
  });

  test("过滤前存在、过滤后消失的用户扩展显示为已禁用，而不是凭空消失", () => {
    const extPath = path.join(agentDir, "extensions", "hello.ts");
    const snapshot = buildExtensionsSnapshot({
      loaded: { extensions: [], errors: [], runtime: {} as never } as never,
      discovered: { extensions: [{ path: extPath, hidden: false } as never], errors: [], runtime: {} as never } as never,
      agentDir,
      disabledIds: ["hello.ts"],
    });
    expect(byId(snapshot, "hello.ts")?.enabled).toBe(false);
    expect(byId(snapshot, "hello.ts")?.name).toBe("hello");
  });

  test("内联扩展的展示名去掉 `<inline:…>` 两端，不能显示成 `name>`", () => {
    const snapshot = buildExtensionsSnapshot({
      loaded: {
        extensions: [{ path: "<inline:maxma-blocker>", hidden: false } as never],
        errors: [],
        runtime: {} as never,
      } as never,
      agentDir,
      disabledIds: [],
    });
    const item = byId(snapshot, "<inline:maxma-blocker>");
    expect(item?.name).toBe("maxma-blocker");
    expect(item?.scope).toBe("inline");
    expect(item?.disablable).toBe(false);
  });
});
