/**
 * plugins/registry.ts — Maxma 插件注册表（PLUGIN-001）。
 *
 * 取代此前的 REST 桩（`routes/plugins.ts` 恒 501）。这里的「插件」是**Maxma 的
 * 插件**：Maxma 决定它启不启用、配置是什么、管理界面在哪；插件内部用什么实现
 * （DSH/Cordis 契约、纯 Node 模块…）由 `kind` 决定，对用户不可见。
 *
 * 两级概念，务必区分：
 *   - **描述符**（`PluginDescriptor`）：代码里写死的清单，随包分发，用户不能改；
 *   - **状态**（`PluginStateEntry`）：用户数据，落在 `<数据目录>/plugins/registry.json`，
 *     记录启用开关与用户配置。注册表把两者合并成界面要看的 `PluginRecord`。
 *
 * ⚠️ 启用/停用**不热生效**：插件在宿主装配时按启用清单加载（见 `plugins/dsh/index.ts`），
 * 改动要重启后端才生效。这是刻意的 —— 插件的定时器、回环端口、浏览器子进程无法
 * 在卸载后保证干净收尾，热插拔会把「关掉了但还在跑」变成常态。`restart_required`
 * 字段会把这件事如实告诉前端，而不是假装已经生效。
 */

import { readJsonSafe, writeJsonAtomic } from "../yaml-store";
import { getPluginsRegistryPath } from "../app-paths";

/** 插件实现类型。`dsh` = 走进程内 DSH 兼容宿主（Cordis 契约）。 */
export type PluginKind = "dsh";

/** 插件分类（与 `web/src/types/plugin.ts` 的 `PluginCategory` 对齐）。 */
export type PluginCategory =
  | "productivity"
  | "development"
  | "ai-assistant"
  | "integration"
  | "utility"
  | "other";

/** 界面可渲染的 JSON Schema 子集（`PluginConfigPanel.vue` 只认这几种）。 */
export interface PluginConfigPropertySpec {
  type: "string" | "number" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export interface PluginConfigSchemaSpec {
  type: "object";
  properties: Record<string, PluginConfigPropertySpec>;
  required?: string[];
}

/** 随包分发的插件描述符（代码事实，非用户数据）。 */
export interface PluginDescriptor {
  /** 稳定标识，同时是 REST 的 `:name`。 */
  id: string;
  kind: PluginKind;
  /** 动态 import 用的模块说明符。 */
  specifier: string;
  /** 展示名。 */
  label: string;
  description: string;
  /** 随包分发（不可卸载）。 */
  builtin: boolean;
  /** 首次运行（注册表里没有状态）时的默认启用值。 */
  enabledByDefault: boolean;
  author?: string;
  homepage?: string;
  repository?: string;
  category?: PluginCategory;
  /** 该插件带来的能力标签，供界面展示。 */
  features?: string[];
  /** 用户可配置项；缺省表示无配置。 */
  configSchema?: PluginConfigSchemaSpec;
}

/** 用户态（落 `registry.json`）。 */
export interface PluginStateEntry {
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt?: string;
  updatedAt?: string;
}

/** 描述符 + 用户态，即 REST 面返回的形状。 */
export interface PluginRecord extends PluginDescriptor, PluginStateEntry {}

interface RegistryDocument {
  version: 1;
  plugins: Record<string, PluginStateEntry>;
}

/**
 * 内置插件清单。
 *
 * 目前只有一个：把 `dsh-codearts-auth`（Jet Hub）适配进 Maxma —— 它是「多账号
 * 登录 + 多提供商模型接入」插件，宿主侧逻辑复用其已验证的协议实现，模型则经
 * pi 的 `registerProvider({ streamSimple })` 接进 Maxma 的模型选择器。
 */
export const BUILTIN_PLUGINS: readonly PluginDescriptor[] = [
  {
    id: "codearts-auth",
    kind: "dsh",
    specifier: "dsh-codearts-auth",
    label: "Jet Hub",
    description:
      "统一登录与管理多个 AI 编程服务账号，并把它们的模型接入 Maxma 模型选择器。含多账号池、凭据静默续期、积分查询与一键领取、本机 OpenAI 兼容网关、Token 用量账本。",
    builtin: true,
    enabledByDefault: true,
    author: "iJetLi",
    homepage: "https://gitee.com/iJetLi/deepseek-harness-codearts",
    repository: "https://gitee.com/iJetLi/deepseek-harness-codearts",
    category: "integration",
    features: [
      "多账号池",
      "凭据静默续期",
      "积分查询与领取",
      "模型目录",
      "用量徽标",
      "Token 账本",
      "本机 OpenAI 网关",
      "账号备份与迁移",
    ],
    configSchema: {
      type: "object",
      properties: {
        // 插件的 Config 只有 providers（且注释标注无消费者），故配置面保持最小、
        // 不虚构并不存在的开关。
        providers: {
          type: "object",
          title: "渠道覆盖",
          description: "按渠道覆盖插件默认值（键为渠道 id，值为任意对象）。留空即用插件默认。",
          default: {},
        },
        // ⚠️ 这一项不是插件的配置项，而是 **Maxma 宿主策略**：插件自带一个本机
        // OpenAI 兼容网关（默认 127.0.0.1:8326），供其它客户端复用已登录账号。
        // Maxma 默认把它关掉，避免与自己的端口规划打架；要开就必须重启后端
        // （宿主在装配时按这个值设置 DSH_OPENAI_GATEWAY_ENABLED）。
        gatewayEnabled: {
          type: "boolean",
          title: "本机 OpenAI 网关",
          description: "允许插件监听本机端口，把已登录账号以 OpenAI 兼容接口暴露给其它客户端。改动需重启后端生效。",
          default: false,
        },
      },
    },
  },
];

function loadDocument(): RegistryDocument {
  const parsed = readJsonSafe<Partial<RegistryDocument>>(getPluginsRegistryPath());
  return {
    version: 1,
    plugins: parsed && typeof parsed.plugins === "object" && parsed.plugins ? { ...parsed.plugins } : {},
  };
}

function saveDocument(doc: RegistryDocument): void {
  writeJsonAtomic(getPluginsRegistryPath(), doc);
}

function defaultState(descriptor: PluginDescriptor): PluginStateEntry {
  return { enabled: descriptor.enabledByDefault, config: {} };
}

/** 合并描述符与用户态；缺失状态按默认值补齐（不回写，读操作不产生副作用）。 */
function merge(descriptor: PluginDescriptor, state: PluginStateEntry | undefined): PluginRecord {
  const effective = state ?? defaultState(descriptor);
  return {
    ...descriptor,
    enabled: effective.enabled === true,
    config: effective.config && typeof effective.config === "object" ? { ...effective.config } : {},
    installedAt: effective.installedAt,
    updatedAt: effective.updatedAt,
  };
}

/** 全部插件的合并视图（内置清单顺序即界面顺序）。 */
export function listPlugins(): PluginRecord[] {
  const doc = loadDocument();
  return BUILTIN_PLUGINS.map((descriptor) => merge(descriptor, doc.plugins[descriptor.id]));
}

/** 单个插件；不存在返回 undefined。 */
export function getPlugin(id: string): PluginRecord | undefined {
  const descriptor = BUILTIN_PLUGINS.find((item) => item.id === id);
  if (!descriptor) return undefined;
  return merge(descriptor, loadDocument().plugins[descriptor.id]);
}

/** 启用/停用（持久化；重启后生效）。 */
export function setPluginEnabled(id: string, enabled: boolean): PluginRecord | undefined {
  const descriptor = BUILTIN_PLUGINS.find((item) => item.id === id);
  if (!descriptor) return undefined;
  const doc = loadDocument();
  const current = doc.plugins[id] ?? defaultState(descriptor);
  doc.plugins[id] = {
    ...current,
    enabled: enabled === true,
    installedAt: current.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveDocument(doc);
  return merge(descriptor, doc.plugins[id]);
}

/** 写配置（整体替换；持久化）。 */
export function setPluginConfig(id: string, config: Record<string, unknown>): PluginRecord | undefined {
  const descriptor = BUILTIN_PLUGINS.find((item) => item.id === id);
  if (!descriptor) return undefined;
  const doc = loadDocument();
  const current = doc.plugins[id] ?? defaultState(descriptor);
  doc.plugins[id] = {
    ...current,
    config: config && typeof config === "object" && !Array.isArray(config) ? { ...config } : {},
    updatedAt: new Date().toISOString(),
  };
  saveDocument(doc);
  return merge(descriptor, doc.plugins[id]);
}

/** 卸载：只允许非内置插件（内置插件的文件随包分发，删不掉也不该删）。 */
export function uninstallPlugin(id: string): { ok: true } | { ok: false; reason: string } {
  const descriptor = BUILTIN_PLUGINS.find((item) => item.id === id);
  if (!descriptor) return { ok: false, reason: `插件 '${id}' 不存在` };
  if (descriptor.builtin) {
    return { ok: false, reason: `插件 '${id}' 随 Maxma 内置分发，不能卸载（可停用）` };
  }
  const doc = loadDocument();
  delete doc.plugins[id];
  saveDocument(doc);
  return { ok: true };
}

/**
 * 当前应装配的 DSH 插件说明符（供 `plugins/dsh/index.ts` 在启动时读取）。
 *
 * ⚠️ 读的是**持久化状态**，所以「停用 → 重启」真的不会加载它。
 */
export function enabledDshSpecifiers(): string[] {
  const doc = loadDocument();
  return BUILTIN_PLUGINS.filter(
    (descriptor) => descriptor.kind === "dsh" && merge(descriptor, doc.plugins[descriptor.id]).enabled,
  ).map((descriptor) => descriptor.specifier);
}
