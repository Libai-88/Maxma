/**
 * omp-compat.ts — 集中 OMP 类型/运行时适配层。
 *
 * 升级 @oh-my-pi 时只改本文件。纪律：
 *   - 所有 import 必须走 OMP package.json `exports` 声明的公开路径
 *     （如 `./utils/event-bus`、`./extensibility/extensions`），
 *     禁止 `.../src/...` 内部路径（内部结构不属于公共 API，升级即碎）。
 *   - 类型断言（as）集中在这里，业务代码保持类型干净。
 */

import type { Settings, AuthStorage } from "@oh-my-pi/pi-coding-agent";
import type {
  ExtensionActions,
  ExtensionContextActions,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import type { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import type { SettingPath } from "@oh-my-pi/pi-coding-agent/config/settings-schema";
import type { GeneratedProvider } from "@oh-my-pi/pi-catalog";

export type { Settings, EventBus, AuthStorage, SettingPath, GeneratedProvider };

/**
 * OMP 工具对象——MCP/内置工具的最小形状。OMP 内部工具类型结构庞大且随版本
 * 演进，这里只取 sidecar 过滤逻辑用到的字段。
 */
export interface OmpTool {
  name?: string;
  mcpServerName?: string;
  mcpToolName?: string;
}

/** getBundledModel 的 provider 参数类型（字符串联合，动态值需断言）。 */

/** Settings 路径类型——动态字符串路径需要此断言。 */

/** createAgentSession 的返回值——只取 sidecar 用到的字段。 */
export interface LocalSessionHandle {
  session: import("@oh-my-pi/pi-coding-agent").AgentSession;
  setToolUIContext: (uiContext: import("@oh-my-pi/pi-coding-agent").ExtensionUIContext, hasUI: boolean) => void;
  eventBus?: EventBus;
}

/** createAgentSession 的入参（未用到的字段可缺省）。 */
export type LocalCreateSessionOptions = import("@oh-my-pi/pi-coding-agent").CreateAgentSessionOptions;

/**
 * 动态路径写设置。OMP 的 `Settings.set<P extends SettingPath>` 泛型对
 * 运行时字符串会推导出 `SettingValue<P> = never`，此处以窄接口包装绕开
 * 泛型限制（运行时行为不变，升级 OMP 只需修这一处）。
 */
export function setSetting(settings: Settings, path: string, value: unknown): void {
  (settings as unknown as { set(p: string, v: unknown): void }).set(path, value);
}

// ---------------------------------------------------------------------------
// OMP 生态查询窄接口（skills / extensions / plugins）
// 动态 import 的模块结构随 OMP 版本演进，此处只声明 RPC 用到的字段。
// ---------------------------------------------------------------------------

export interface OmpSkillEntry {
  name?: string;
  description?: string;
  source?: string;
}

export interface OmpPluginInfo {
  name?: string;
  version?: string;
  description?: string;
  enabled?: boolean;
  features?: unknown[];
  homepage?: string;
  author?: string;
  repository?: string;
  tags?: string[];
  category?: string;
  license?: string;
  installed_at?: string;
  last_updated?: string;
  readme?: string;
  config_schema?: unknown;
}

export interface PluginManagerLike {
  list(): Promise<OmpPluginInfo[]>;
  install(spec: string): Promise<unknown>;
  uninstall(name: string): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
}

/** 动态加载 OMP PluginManager（窄接口，类型集中在此）。 */
export async function loadPluginManager(): Promise<PluginManagerLike> {
  const mod = (await import("@oh-my-pi/pi-coding-agent/extensibility/plugins")) as unknown as {
    PluginManager: new () => PluginManagerLike;
  };
  return new mod.PluginManager();
}

/** 动态发现 OMP skills（窄接口）。 */
export async function loadDiscoveredSkills(): Promise<OmpSkillEntry[]> {
  const { discoverSkills } = await import("@oh-my-pi/pi-coding-agent");
  const result = (await discoverSkills()) as unknown as { skills?: OmpSkillEntry[] };
  return result.skills ?? [];
}

/** 无 UI stub 动作——sidecar 无 TUI/命令，仅满足 extensionRunner.initialize 签名。 */
export function noopExtensionActions(): ExtensionActions {
  return {
    sendMessage: () => {},
    sendUserMessage: () => {},
    appendEntry: () => {},
    setLabel: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: async () => {},
    getCommands: () => [],
    setModel: async () => true,
    getThinkingLevel: () => undefined,
    setThinkingLevel: () => {},
    getSessionName: () => undefined,
    setSessionName: async () => {},
  };
}

/** 无 UI stub 运行时上下文——同上面向 initialize 的第二个参数。 */
export function noopExtensionContextActions(): ExtensionContextActions {
  return {
    getModel: () => undefined,
    isIdle: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: async () => {},
    getSystemPrompt: () => [],
  };
}
