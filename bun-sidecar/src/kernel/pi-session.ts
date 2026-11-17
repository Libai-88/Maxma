/**
 * kernel/pi-session.ts — Maxma 会话内核的 pi 实现（阶段一 §6.2 任务 1）。
 *
 * 全部使用 pi 官方 API（0.99.0 类型声明，spike 实测通过，见方案 §6.0）：
 *   - createAgentSession(CreateAgentSessionOptions)          ← core/sdk.ts
 *   - SessionManager.create / inMemory                       ← 官方两种会话承载
 *   - DefaultResourceLoader({ extensionFactories })          ← 官方内联扩展注入点
 *   - createMcpExtension({ loadConfig })                     ← 官方 MCP 扩展 + 配置注入钩子
 *   - systemPrompt / appendSystemPrompt / tools              ← 官方会话选项直映 RPC 参数
 *
 * 会话创建后必须 bindExtensions()（官方文档：MCP 扩展在 session_start 连接服务器，
 * 需 bindExtensions 触发；ExtensionBindings 字段全可选，v1 传 {}）。
 */

import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  getAgentDir,
  type AgentSession,
  type InlineExtension,
  type LoadExtensionsResult,
  type McpServerEntry,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";

import { createMaxmaApprovalExtension } from "./extensions/maxma-approval";
import { MAXMA_ENABLED_DEFAULT_TOOLS } from "./pi-contract";
import { createMaxmaBlockerExtension } from "./extensions/maxma-blocker";
import {
  buildExtensionsSnapshot,
  filterDisabledExtensions,
  recordExtensionsSnapshot,
  type ExtensionsSnapshot,
} from "./extensions";
import { maxmaSkillPaths } from "./skills";
import { createRequestTelemetryExtension } from "./request-telemetry";
import type { ApprovalGate, MaxmaPermissionMode, MaxmaSessionOptions } from "./types";

export type { MaxmaPermissionMode } from "./types";

/**
 * 默认给会话启用的工具集。清单的**唯一来源是 `pi-contract.ts`**（那里还登记了
 * 引擎实际提供的全部内置工具，含本表未启用的 powershell）——此前两处各写各的，
 * 引擎改工具名时会静默没有工具。
 */
export const MAXMA_DEFAULT_PI_TOOLS = MAXMA_ENABLED_DEFAULT_TOOLS;

/** 判定是否需要装配审批扩展：模式非 auto 且提供了门。 */
export function approvalExtensionFor(
  mode: MaxmaPermissionMode,
  gate?: ApprovalGate,
): InlineExtension | undefined {
  if (!gate || mode === "auto") return undefined;
  return createMaxmaApprovalExtension(gate);
}

/**
 * 内联扩展清单（官方 DefaultResourceLoaderOptions.extensionFactories）：
 *   1) MaxmaBlocker 拒止锚（与权限无关，恒装配；官方 tool_call 钩子执行前 block）
 *   2) 审批扩展（read_only/ask/operate 三档需要；auto 不装）
 *   3) 遥测扩展（提供指纹 secret + epoch + 回调时）
 *   4) MCP 扩展（官方 createMcpExtension，loadConfig 注入 Maxma 的 mcp_servers.yaml
 *      清单；未提供清单时不装配——SDK 会话默认不加载任何内置扩展，官方文档明示）
 *
 * 这四项**不接受禁用**：审批/拒止是安全机制，关掉等于静默降级；遥测只在显式
 * 配置指纹时装配。禁用接口在 `kernel/extensions.ts` 里按 scope 硬拒。
 */
export function buildExtensionFactories(opts: MaxmaSessionOptions): InlineExtension[] {
  const extensionFactories: InlineExtension[] = [createMaxmaBlockerExtension()];
  if (opts.requestFingerprintSecret && opts.requestFingerprintEpoch && opts.onRequestTelemetry) {
    extensionFactories.push(createRequestTelemetryExtension(
      opts.requestFingerprintSecret,
      opts.requestFingerprintEpoch,
      opts.onRequestTelemetry,
    ));
  }
  const approval = approvalExtensionFor(opts.permissionMode ?? "ask", opts.approvalGate);
  if (approval) extensionFactories.push(approval);
  if (opts.mcpServers && opts.mcpServers.length > 0) {
    const servers: McpServerEntry[] = opts.mcpServers.map((s) => ({
      name: s.name,
      config: s.config,
      source: s.source,
      scope: "extension" as const,
    }));
    extensionFactories.push(createCodemodeExtension());
    extensionFactories.push(
      createMcpExtension({
        // 官方 McpExtensionOptions.loadConfig：覆盖默认 mcp.json 发现，
        // 返回官方 LoadedMcpConfig 形状（servers/errors 必填）。
        loadConfig: () => ({ servers, errors: [] }),
      }),
    );
  }
  return extensionFactories;
}

/** 归一禁用列表：只认非空字符串，去重（后端已做过白名单校验，这里不做二次裁决）。 */
function normalizeDisabledIds(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/**
 * 构建资源加载器。`onDiscovered` 拿到过滤前的官方结果——那是"用户装了但被禁用"
 * 的唯一证据（`extensionsOverride` 之后再无痕迹）。
 */
function buildResourceLoader(
  opts: MaxmaSessionOptions,
  agentDir: string,
  onDiscovered: (base: LoadExtensionsResult) => void,
): DefaultResourceLoader {
  const cwd = opts.cwd ?? process.cwd();
  const disabledIds = normalizeDisabledIds(opts.disabledExtensions);
  const loaderOptions: ConstructorParameters<typeof DefaultResourceLoader>[0] = {
    cwd,
    agentDir,
    extensionFactories: buildExtensionFactories(opts),
    additionalSkillPaths: maxmaSkillPaths(cwd, opts.skillsEnabled !== false),
    ...(opts.skillsEnabled === false ? { noSkills: true } : {}),
    // 官方选项：整体替换 / 追加系统提示词（直映 create_session RPC 的
    // system_prompt / append_system_prompt 参数）。
    ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
    ...(opts.appendSystemPrompt !== undefined && opts.appendSystemPrompt.length > 0
      ? { appendSystemPromptOverride: (base: string[]) => [...base, ...opts.appendSystemPrompt!] }
      : {}),
  };
  if (disabledIds.length > 0) {
    // EXT-TOGGLE-001：唯一的禁用挂点。官方在 load 完成后调用它，
    // 被过滤掉的扩展不进入 bindExtensions，handler/tool 一律不注册。
    loaderOptions.extensionsOverride = (base) => {
      onDiscovered(base);
      return filterDisabledExtensions(base, disabledIds, agentDir);
    };
  }
  return new DefaultResourceLoader(loaderOptions);
}

export interface MaxmaSessionResult {
  session: AgentSession;
  /** 本次加载的扩展快照（清单 + 错误 + 警告），同时写入进程内缓存。 */
  extensions: ExtensionsSnapshot;
}

/**
 * 创建 Maxma 会话（pi 承载），并同时返回扩展加载结果。
 * `createMaxmaSession` 是它的窄化包装（老调用方只要 session）。
 */
export async function createMaxmaSessionWithExtensions(
  opts: MaxmaSessionOptions,
): Promise<MaxmaSessionResult> {
  const cwd = opts.cwd ?? process.cwd();
  const agentDir = opts.agentDir ?? getAgentDir();
  const disabledIds = normalizeDisabledIds(opts.disabledExtensions);

  // 会话承载：官方三态——内存（inMemory）/ 从磁盘恢复（sessionFile）/ 新建持久化。
  // 恢复时传 cwd 覆盖：便携包可能被整体搬目录，跟着旧 header 的绝对路径会指向
  // 不存在的位置；以当前 cwd 为准，历史消息本身不受影响。
  const sessionManager = opts.inMemory
    ? SessionManager.inMemory()
    : opts.sessionFile
      ? SessionManager.open(opts.sessionFile, undefined, cwd)
      : SessionManager.create(cwd, undefined, opts.sessionId ? { id: opts.sessionId } : undefined);

  let discovered: LoadExtensionsResult | undefined;
  const resourceLoader = buildResourceLoader(opts, agentDir, (base) => {
    discovered = base;
  });
  await resourceLoader.reload();

  const defaultTools = [
    ...MAXMA_DEFAULT_PI_TOOLS,
    ...(opts.customTools ?? []).map((tool) => tool.name),
  ];

  const { session, extensionsResult } = await createAgentSession({
    cwd,
    sessionManager,
    resourceLoader,
    // 官方选项：auth/model 运行时（kernel/model.ts resolvePiModel 产物——
    // 含 setRuntimeApiKey / registerProvider 注册的自定义 provider）
    ...(opts.modelRuntime !== undefined ? { modelRuntime: opts.modelRuntime } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
    // 官方选项：工具白名单（未提供时启用 Maxma 的默认文件与代码工具集）
    tools: opts.tools ?? defaultTools,
    ...(opts.customTools !== undefined && opts.customTools.length > 0
      ? { customTools: opts.customTools }
      : {}),
  });

  // 官方文档要求：MCP 扩展在 session_start 时连接服务器，需 bindExtensions 触发。
  //
  // EXT-UI-001：**必须传 uiContext**。此前传的是空对象，ExtensionRunner 于是回落到
  // `noOpUIContext`——它的 `confirm` 恒返回 false（dist/core/extensions/runner.js），
  // 任何用 ctx.ui 的扩展都会静默失效：pi 官方示例 confirm-destructive（删除前确认）
  // 在 Maxma 里会静默拒绝一切操作，不报错也不留痕。
  // mode 用 "rpc"：官方文档说该模式下 hasUI=true、对话框可用，TUI 专属方法降级为 no-op。
  await session.bindExtensions({
    ...(opts.uiContext ? { uiContext: opts.uiContext, mode: "rpc" as const } : {}),
  });
  if (opts.tools === undefined) {
    session.setActiveToolsByName(session.getAllTools().map((tool) => tool.name));
  }

  // EXT-VISIBLE-001：官方返回的 extensionsResult 此前被整个丢掉——用户扩展
  // "在跑但看不见"、加载失败"零提示"。现在归一成快照写入进程内缓存，
  // 由 GET /api/extensions 暴露给界面。
  const loaded = extensionsResult ?? resourceLoader.getExtensions();
  const snapshot = buildExtensionsSnapshot({
    loaded,
    ...(discovered !== undefined ? { discovered } : {}),
    agentDir,
    disabledIds,
  });
  recordExtensionsSnapshot(snapshot);

  return { session, extensions: snapshot };
}

/**
 * 创建 Maxma 会话（pi 承载）。
 * 返回原始 AgentSession——迁移期内 bridge 仍需会话细节（messages/undo 等），
 * 逐 handler 迁移完成后收敛为更窄的 MaxmaSession 门面。
 */
export async function createMaxmaSession(opts: MaxmaSessionOptions): Promise<AgentSession> {
  const { session } = await createMaxmaSessionWithExtensions(opts);
  return session;
}

/**
 * 只加载扩展、不建会话：供 `POST /api/extensions/refresh` 显式探测用。
 * 装配面刻意收窄（只有拒止锚 + 用户扩展，不含审批/遥测/MCP），
 * 结果会标记为 probe，避免界面把"探测清单"误当成某个活会话的状态。
 */
export async function probeExtensionsSnapshot(opts: MaxmaSessionOptions = {}): Promise<ExtensionsSnapshot> {
  const cwd = opts.cwd ?? process.cwd();
  const agentDir = opts.agentDir ?? getAgentDir();
  const disabledIds = normalizeDisabledIds(opts.disabledExtensions);
  let discovered: LoadExtensionsResult | undefined;
  const resourceLoader = buildResourceLoader(
    { ...opts, mcpServers: undefined, permissionMode: "auto", requestFingerprintSecret: undefined },
    agentDir,
    (base) => {
      discovered = base;
    },
  );
  await resourceLoader.reload();
  const loaded = resourceLoader.getExtensions();
  const snapshot = buildExtensionsSnapshot({
    loaded,
    ...(discovered !== undefined ? { discovered } : {}),
    agentDir,
    disabledIds,
  });
  recordExtensionsSnapshot(snapshot);
  return snapshot;
}
