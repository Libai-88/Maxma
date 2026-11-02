/**
 * settings-global.ts — 全局设置存储（pi SettingsManager 视图 + Maxma 自有持久化）。
 *
 * ## 这里原来缺的是什么（2026-10-27 实测）
 *
 * 旧实现只有一个 `SettingsManager.inMemory()` 单例，`PUT /api/settings` 往它
 * `applyOverrides()` 然后回 `{ok:true}`。in-memory 意味着两件事：
 *
 *   1. **不落盘**：重启后所有面板改动消失；
 *   2. **不进会话**：会话的 SettingsManager 由 pi 自己创建（`createAgentSession`
 *      内部装配），跟这个单例不是同一个对象——除了 `skills.enabled` 被
 *      `routes/sessions.ts` 显式读出转成 `create_session` 参数之外，
 *      `compaction.enabled` / `retry.*` / `thinkingBudgets.*` / `steeringMode`
 *      这些**引擎真实存在**的键，用户拨完对实际运行毫无影响。
 *
 * 再叠上旧实现不校验键是否存在：`applyOverrides` 对未知键宽容，于是
 * 「上一代引擎遗留的那些键」拨动后照样返回成功——UI 报"已保存"，什么都不发生。
 *
 * ## 现在的行为
 *
 * - 写：先按 `pi-contract.ts` 的登记表判定归属。`consumer: "none"`（无人消费）
 *   与未登记的键**一律拒绝**并给出原因，不再假装成功。
 * - 存：显式改动持久化到 `api/data/settings_overrides.json`（Maxma 自己的文件，
 *   不依赖 pi 的磁盘格式），原子 tmp+rename，损坏文件拒绝覆盖（沿用
 *   PANEL-CORRUPT-001 的做法）。
 * - 生效：`engineSettingsForNewSession()` 把 `consumer: "pi"` 的显式改动交给
 *   kernel，在 `create_session` 时 `applyOverrides` 到新会话——**只转发用户真正
 *   改过的键**，没碰过的项保持 pi 默认值，避免一次改动把整套默认覆盖掉。
 * - 读：显式覆盖优先，其次 pi 单例的默认值；`skills.enabled` 沿用"缺省视为开启"。
 *
 * 不变量由 `bun-sidecar/tests/engine-boundary.test.ts` 守：登记表、面板键清单、
 * 后端键清单三者不许各写各的。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { SettingsManager } from "@earendil-works/pi-coding-agent";

import {
  MAXMA_SETTINGS_KEYS,
  type SettingsConsumer,
} from "../../bun-sidecar/src/kernel/pi-contract";
import { getApiDataDir } from "./app-paths";

export type SettingEntry = (typeof MAXMA_SETTINGS_KEYS)[number];

/** 拒绝写入时抛出的结构化错误（路由据此回 409/422/503，不再是笼统 500）。 */
export class SettingRejectedError extends Error {
  readonly status: number;
  readonly code: "unregistered" | "no_consumer" | "corrupt_store";
  readonly settingPath: string;

  constructor(message: string, status: number, code: SettingRejectedError["code"], settingPath: string) {
    super(message);
    this.name = "SettingRejectedError";
    this.status = status;
    this.code = code;
    this.settingPath = settingPath;
  }
}

const ENTRY_BY_PATH = new Map<string, SettingEntry>(
  MAXMA_SETTINGS_KEYS.map((entry) => [entry.path, entry]),
);

/** 显式改动持久化文件（Maxma 自有格式，与 pi 的 settings.json 无关）。 */
function overridesFile(): string {
  return path.join(getApiDataDir(), "settings_overrides.json");
}

function readOverrides(): Record<string, unknown> {
  const file = overridesFile();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (err) {
    // 只读侧降级：坏文件不影响服务启动，但写侧会拒绝覆盖（见 writeOverrides）。
    console.warn(`[settings] overrides 文件解析失败，本次按空覆盖运行: ${String(err)}`);
    return {};
  }
}

function writeOverrides(next: Record<string, unknown>): void {
  const file = overridesFile();
  if (fs.existsSync(file)) {
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      throw new SettingRejectedError(
        `设置文件已损坏，为保护现有配置已拒绝写入，请检查 ${file}`,
        503,
        "corrupt_store",
        "*",
      );
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/** 点路径 → 嵌套对象（官方 applyOverrides 需要 Partial<Settings> 形状）。 */
function buildNestedOverride(dotted: string, value: unknown): Record<string, unknown> {
  const keys = dotted.split(".").filter((k) => k.length > 0);
  let node: Record<string, unknown> = { [keys[keys.length - 1]!]: value };
  for (let i = keys.length - 2; i >= 0; i--) node = { [keys[i]!]: node };
  return node;
}

/** 从 Settings 对象解析点路径。 */
export function readDottedPath(root: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

let singleton: SettingsManager | null = null;
let hydrated = false;

/**
 * 全局 SettingsManager 单例（供 GET 视图与 settings-panels 共用，签名保持不变）。
 * 首次访问时把持久化的显式覆盖灌进去，这样进程内读到的值与磁盘一致。
 */
export function getGlobalSettingsSingleton(): SettingsManager {
  if (!singleton) singleton = SettingsManager.inMemory();
  if (!hydrated) {
    hydrated = true;
    const manager = singleton;
    for (const [p, value] of Object.entries(readOverrides())) {
      const entry = ENTRY_BY_PATH.get(p);
      if (!entry || entry.consumer === "none") continue;
      try {
        manager.applyOverrides(buildNestedOverride(p, value) as never);
      } catch (err) {
        console.warn(`[settings] 启动时应用覆盖 ${p} 失败（跳过）: ${String(err)}`);
      }
    }
  }
  return singleton;
}

export function settingEntry(settingPath: string): SettingEntry | undefined {
  return ENTRY_BY_PATH.get(settingPath);
}

/** 该键是否由引擎真实存在（登记表已按已安装 pi 的类型核对过）。 */
export function isEngineSettingPath(settingPath: string): boolean {
  return ENTRY_BY_PATH.get(settingPath)?.engineReal === true;
}

/**
 * 写一个设置项。校验 → 持久化 → 灌入单例。
 * 未登记的键与无人消费的键抛 `SettingRejectedError`，绝不返回假成功。
 */
export function setSettingValue(settingPath: string, value: unknown): SettingEntry {
  const entry = ENTRY_BY_PATH.get(settingPath);
  if (!entry) {
    throw new SettingRejectedError(
      `未登记的设置项：${settingPath}。新增配置项必须先在 bun-sidecar/src/kernel/pi-contract.ts 的 MAXMA_SETTINGS_KEYS 里登记它由谁消费。`,
      422,
      "unregistered",
      settingPath,
    );
  }
  if (entry.consumer === "none") {
    throw new SettingRejectedError(
      `${settingPath} 当前没有任何实现方（${entry.note}）。此开关属于上一代引擎遗留或从未接线的能力，保存不会生效，因此被拒绝。`,
      409,
      "no_consumer",
      settingPath,
    );
  }

  const next = { ...readOverrides(), [settingPath]: value };
  writeOverrides(next);
  getGlobalSettingsSingleton().applyOverrides(buildNestedOverride(settingPath, value) as never);
  return entry;
}

/**
 * 读一个设置项：显式覆盖优先，其次引擎默认值。
 * `skills.enabled` 保持"缺省视为开启"的既有语义（旧配置文件可能没有该节点）。
 */
export function getSettingValue(settingPath: string): unknown {
  const overrides = readOverrides();
  if (Object.prototype.hasOwnProperty.call(overrides, settingPath)) return overrides[settingPath];
  const value = readDottedPath(getGlobalSettingsSingleton().getSettings(), settingPath);
  if (value === undefined && settingPath === "skills.enabled") return true;
  return value;
}

/**
 * 新建会话时要下发的引擎设置：**只含用户显式改过、且归引擎消费的键**。
 * 没被拨过的项保持 pi 默认值，避免把默认配置整体覆盖成 Maxma 侧的猜测值。
 */
export function engineSettingsForNewSession(): Record<string, unknown> {
  const overrides = readOverrides();
  const nested: Record<string, unknown> = {};
  for (const [p, value] of Object.entries(overrides)) {
    const entry = ENTRY_BY_PATH.get(p);
    if (!entry || entry.consumer !== "pi") continue;
    Object.assign(nested, buildNestedOverride(p, value));
  }
  return nested;
}

/**
 * 每个登记键的支持状态，供前端把"拨了没反应"的开关**标出来而不是摆在那里**。
 * GET /api/settings/schema。
 */
export function settingsSupportView(): Array<{
  path: string;
  consumer: SettingsConsumer;
  engineReal: boolean;
  supported: boolean;
  reason: string | null;
}> {
  return MAXMA_SETTINGS_KEYS.map((entry) => ({
    path: entry.path,
    consumer: entry.consumer,
    engineReal: entry.engineReal,
    supported: entry.consumer !== "none",
    reason: entry.consumer === "none" ? entry.note : null,
  }));
}
