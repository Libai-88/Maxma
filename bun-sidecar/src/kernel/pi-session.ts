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
  createMcpExtension,
  getAgentDir,
  type AgentSession,
  type InlineExtension,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";

import { createMaxmaApprovalExtension } from "./extensions/maxma-approval";
import { createMaxmaBlockerExtension } from "./extensions/maxma-blocker";
import type { ApprovalGate, MaxmaPermissionMode, MaxmaSessionOptions } from "./types";

export type { MaxmaPermissionMode } from "./types";

/** 判定是否需要装配审批扩展：模式非 auto 且提供了门。 */
export function approvalExtensionFor(
  mode: MaxmaPermissionMode,
  gate?: ApprovalGate,
): InlineExtension | undefined {
  if (!gate || mode === "auto") return undefined;
  return createMaxmaApprovalExtension(gate);
}

/**
 * 创建 Maxma 会话（pi 承载）。
 * 返回原始 AgentSession——迁移期内 bridge 仍需会话细节（messages/undo 等），
 * 逐 handler 迁移完成后收敛为更窄的 MaxmaSession 门面。
 */
export async function createMaxmaSession(opts: MaxmaSessionOptions): Promise<AgentSession> {
  const cwd = opts.cwd ?? process.cwd();
  const agentDir = getAgentDir();

  // 会话承载：官方两型——持久化（JSONL 树）与内存（inMemory）。
  const sessionManager = opts.inMemory ? SessionManager.inMemory() : SessionManager.create(cwd);

  // 内联扩展（官方 DefaultResourceLoaderOptions.extensionFactories: InlineExtension[]）：
  //   1) MaxmaBlocker 拒止锚（与权限无关，恒装配；官方 tool_call 钩子执行前 block）
  //   2) 审批扩展（read_only/ask/operate 三档需要；auto 不装）
  //   3) MCP 扩展（官方 createMcpExtension，loadConfig 注入 Maxma 的 mcp_servers.yaml 清单；
  //      未提供清单时不装配——SDK 会话默认不加载任何内置扩展，官方文档明示）
  const extensionFactories: InlineExtension[] = [createMaxmaBlockerExtension()];
  const approval = approvalExtensionFor(opts.permissionMode ?? "ask", opts.approvalGate);
  if (approval) extensionFactories.push(approval);
  if (opts.mcpServers && opts.mcpServers.length > 0) {
    const servers = opts.mcpServers.map((s) => ({
      name: s.name,
      config: s.config,
      source: s.source ?? "maxma:mcp_servers.yaml",
      scope: "extension" as const,
    }));
    extensionFactories.push(
      createMcpExtension({
        // 官方 McpExtensionOptions.loadConfig：覆盖默认 mcp.json 发现，
        // 返回官方 LoadedMcpConfig 形状（servers/errors 必填）。
        loadConfig: () => ({ servers, errors: [] }),
      }),
    );
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    extensionFactories,
    // 官方选项：整体替换 / 追加系统提示词（直映 create_session RPC 的
    // system_prompt / append_system_prompt 参数）。
    ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
    ...(opts.appendSystemPrompt !== undefined && opts.appendSystemPrompt.length > 0
      ? { appendSystemPrompt: opts.appendSystemPrompt }
      : {}),
  });

  const { session } = await createAgentSession({
    cwd,
    sessionManager,
    resourceLoader,
    // 官方选项：auth/model 运行时（kernel/model.ts resolvePiModel 产物——
    // 含 setRuntimeApiKey / registerProvider 注册的自定义 provider）
    ...(opts.modelRuntime !== undefined ? { modelRuntime: opts.modelRuntime } : {}),
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
    // 官方选项：工具白名单（未提供时启用默认内置工具 read/bash/edit/write）
    ...(opts.tools !== undefined && opts.tools.length > 0 ? { tools: opts.tools } : {}),
    ...(opts.customTools !== undefined && opts.customTools.length > 0
      ? { customTools: opts.customTools }
      : {}),
  });

  // 官方文档要求：MCP 扩展在 session_start 时连接服务器，需 bindExtensions 触发。
  // ExtensionBindings 字段全可选，v1 传空对象（UI 上下文在审批桥接期接入）。
  await session.bindExtensions({});

  return session;
}
