/**
 * kernel/extensions.ts — 扩展清单与加载结果（EXT-VISIBLE-001）。
 *
 * 背景：Maxma 的使命是"pi 的能力完整保留并在 Maxma 上充分发挥"，其中一条纪律是
 * **界面不撒谎**。此前 `createMaxmaSession` 只解构 `{ session }`，把官方
 * `CreateAgentSessionResult.extensionsResult`（含 `extensions` / `errors` / `warnings`）
 * 整个丢掉：用户自己放进 `<agentDir>/extensions/` 的扩展明明在跑，加载失败也零提示，
 * 界面上既看不到"有哪些扩展"，也看不到"哪个炸了"。
 *
 * 本模块只做三件事，全部围绕官方结构，不自创机制：
 *   1. 把官方 LoadExtensionsResult 归一成可序列化的清单（含来源、是否可禁用）；
 *   2. 提供 `extensionsOverride` 用的过滤函数（禁用用户扩展）；
 *   3. 缓存"最近一次加载"的结果，供后端只读接口与前端展示。
 *
 * 边界（写进 UI 文案，避免"禁用"被理解成沙箱隔离）：
 *   - 只有 `<agentDir>/extensions` 下的用户扩展可禁用；内联扩展（Maxma 审批/拒止/
 *     遥测）硬拒——禁用审批扩展等于静默关掉审批门，是安全回归。
 *   - 禁用走 `extensionsOverride`：该扩展不参与会话的 handler/tool 注册，
 *     但模块代码在加载期仍会被 import（顶层副作用仍会执行）。
 */

import * as path from "node:path";

import { getAgentDir, type Extension, type LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

/** pi 的 agent 目录（`~/.pi/agent`），用户扩展与设置都基于它。 */
export function defaultAgentDir(): string {
  return getAgentDir();
}

export type ExtensionScope = "user" | "inline" | "builtin" | "other";

export interface ExtensionInfo {
  /** 稳定标识：用户扩展为相对 extensions 目录的 posix 路径，内联为 `<inline:name>`。 */
  id: string;
  /** 展示名：内联取 name，文件取相对路径去扩展名。 */
  name: string;
  /** 官方 Extension.path（加载时使用的路径）。 */
  path: string;
  scope: ExtensionScope;
  /** 是否参与当前/最近一次会话。被禁用或加载失败时为 false。 */
  enabled: boolean;
  /** 只有用户扩展可禁用（内置安全扩展硬拒）。 */
  disablable: boolean;
  hidden: boolean;
}

export interface ExtensionLoadError {
  path: string;
  error: string;
}

export interface ExtensionLoadWarning {
  path: string;
  warning: string;
}

export interface ExtensionsSnapshot {
  loaded_at: number;
  agent_dir: string;
  extensions_dir: string;
  extensions: ExtensionInfo[];
  errors: ExtensionLoadError[];
  warnings: ExtensionLoadWarning[];
  /** 本次加载实际被过滤掉的扩展 id（空数组=没有应用禁用）。 */
  disabled_applied: string[];
}

/** `<agentDir>/extensions` —— pi 的用户扩展目录（cli 与 Maxma 共用同一份）。 */
export function extensionsDirFor(agentDir: string): string {
  return path.join(agentDir, "extensions");
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * 官方 `Extension.path` → Maxma 侧 id / scope。
 *
 * 实测（pi 1.5.0 dist/core/resource-loader.js + 真实加载探针）：
 *   - 内联工厂：`<inline:name>`（sourceInfo.source="inline"）
 *   - 用户扩展：绝对路径，位于 `<agentDir>/extensions` 下（sourceInfo.scope="user"）
 *   - 内置：`builtin:name`
 */
export function extensionIdentity(
  extensionPath: string,
  agentDir: string,
): { id: string; scope: ExtensionScope } {
  const raw = String(extensionPath ?? "");
  if (raw.startsWith("<inline:")) return { id: raw, scope: "inline" };
  if (raw.startsWith("builtin:")) return { id: raw, scope: "builtin" };
  if (path.isAbsolute(raw) && isInside(extensionsDirFor(agentDir), raw)) {
    return { id: path.relative(extensionsDirFor(agentDir), raw).split(path.sep).join("/"), scope: "user" };
  }
  return { id: raw, scope: "other" };
}

function displayName(id: string, scope: ExtensionScope): string {
  // 内联扩展的 id 形状是 `<inline:name>`，**两端**都要去掉；只去前缀会让界面上
  // 显示成 `maxma-blocker>`（实测于 2026-11-18 的真实界面验证）。
  if (scope === "inline") return id.replace(/^<inline:/, "").replace(/>$/, "");
  if (scope === "builtin") return id.replace(/^builtin:/, "");
  if (scope === "user") {
    const rel = id.replace(/\/index\.(ts|js|mts|cts|cjs|mjs)$/i, "");
    return rel.replace(/\.(ts|js|mts|cts|cjs|mjs)$/i, "");
  }
  return id;
}

function toInfo(extension: Extension, agentDir: string, enabled: boolean): ExtensionInfo {
  const { id, scope } = extensionIdentity(extension.path, agentDir);
  return {
    id,
    name: displayName(id, scope),
    path: extension.path,
    scope,
    enabled,
    disablable: scope === "user",
    hidden: extension.hidden === true,
  };
}

/**
 * 组装快照。`loaded` 是官方最终结果（已过 override）；`discovered` 是过滤前的
 * 结果——两者都有时，差集就是"被禁用的用户扩展"，界面据此显示"已禁用"而不是
 * 假装它不存在（这也是"界面不撒谎"的一部分）。
 */
export function buildExtensionsSnapshot(args: {
  loaded: LoadExtensionsResult;
  discovered?: LoadExtensionsResult;
  agentDir: string;
  disabledIds?: string[];
  now?: number;
}): ExtensionsSnapshot {
  const { loaded, discovered, agentDir } = args;
  const disabledIds = args.disabledIds ?? [];
  const entries: ExtensionInfo[] = loaded.extensions
    .filter((e) => e.hidden !== true)
    .map((e) => toInfo(e, agentDir, true));

  const knownIds = new Set(entries.map((e) => e.id));
  for (const e of discovered?.extensions ?? []) {
    if (e.hidden === true) continue;
    const info = toInfo(e, agentDir, false);
    if (knownIds.has(info.id)) continue;
    // 只在启用列表里缺失的"用户扩展"标记为已禁用；其它来源不猜状态。
    if (info.scope !== "user") continue;
    const wasDisabled = disabledIds.includes(info.id);
    entries.push({ ...info, enabled: false, name: wasDisabled ? info.name : `${info.name}（未加载）` });
    knownIds.add(info.id);
  }

  return {
    loaded_at: args.now ?? Date.now(),
    agent_dir: agentDir,
    extensions_dir: extensionsDirFor(agentDir),
    extensions: entries,
    errors: (loaded.errors ?? []).map((e) => ({ path: e.path, error: e.error })),
    warnings: (loaded.warnings ?? []).map((w) => ({ path: w.path, warning: w.warning })),
    disabled_applied: disabledIds.filter((id) => discovered?.extensions.some((e) => extensionIdentity(e.path, agentDir).id === id)),
  };
}

/**
 * EXT-TOGGLE-001：把后端下发的禁用清单归一成 `string[] | undefined`。
 * 放在这里而不是 bridge 里，是为了让 bridge 的 options 组装保持单行（体量棘轮 1262 行）。
 */
export function normalizeDisabledExtensionIds(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.filter((x): x is string => typeof x === "string");
}

/**
 * `DefaultResourceLoaderOptions.extensionsOverride` 的实现：
 * 只丢掉"用户扩展 + 命中禁用列表"的条目，其余（含 Maxma 内联安全扩展）原样保留。
 */
export function filterDisabledExtensions(
  base: LoadExtensionsResult,
  disabledIds: string[],
  agentDir: string,
): LoadExtensionsResult {
  if (disabledIds.length === 0) return base;
  const removed = new Set<string>();
  const extensions = base.extensions.filter((extension) => {
    const { id, scope } = extensionIdentity(extension.path, agentDir);
    if (scope !== "user" || !disabledIds.includes(id)) return true;
    removed.add(id);
    return false;
  });
  return removed.size === 0 ? base : { ...base, extensions };
}

// ── 最近一次加载结果（进程内缓存，供只读接口展示）────────────────────

let lastSnapshot: ExtensionsSnapshot | null = null;

export function recordExtensionsSnapshot(snapshot: ExtensionsSnapshot): void {
  lastSnapshot = snapshot;
}

export function getLastExtensionsSnapshot(): ExtensionsSnapshot | null {
  return lastSnapshot;
}

/** 测试用：清空缓存，避免用例间串场。 */
export function resetExtensionsSnapshotForTests(): void {
  lastSnapshot = null;
}
