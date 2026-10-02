/**
 * kernel/types.ts — Maxma Agent 内核接口（阶段一 §6.2）。
 *
 * 设计纪律（dev_docs/pi-migration-plan.md §6）：
 *   - 本目录是唯一允许 import `@earendil-works/*` 的地方（迁移完成后约束生效）。
 *   - 全部能力只用 pi 官方 API（官方 SDK 文档 + 0.99.0 类型声明），不自创机制。
 *   - session-bridge.ts 的 RPC handlers 逐步迁移到只依赖本目录接口。
 */

import type { ToolDefinition, Model, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api } from "@earendil-works/pi-ai";

/**
 * Maxma 权限模式 4 档（与现 sidecar session-bridge.ts AG-PERM-001 同名同义）。
 * pi 无内置权限系统（官方 README/Security 明示），落点为官方 tool_call 钩子：
 *   - read_only / ask → 非只读工具逐次审批（write/edit/bash 等需确认）
 *   - operate         → 读写自动批准，执行类（bash/PowerShell）逐次审批
 *   - auto            → 全部自动批准（yolo）
 */
export type MaxmaPermissionMode = "read_only" | "ask" | "operate" | "auto";

/** 工具注解（官方 Tool.annotations：readOnlyHint/destructiveHint/openWorldHint）。 */
export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
} & Record<string, unknown>;

/** 一次待审批的工具调用（官方 ToolCallEvent 的 Maxma 侧投影）。 */
export interface ApprovalRequest {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/** 审批决定。approved=false 时以 block: true + reason 拒绝（官方 ToolCallEventResult）。 */
export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

/**
 * 审批门 —— 由 bridge 层实现（对接 ask_user WS 事件 + user_response RPC）。
 * 拆成两个方法：needsApproval 按权限模式与注解判定（同步、无 IO），
 * decide 等待用户应答（异步、可超时，超时默认拒绝——沿用现有 APPROVAL_TIMEOUT_MS 语义）。
 */
export interface ApprovalGate {
  needsApproval(req: Pick<ApprovalRequest, "toolName" | "annotations">): boolean;
  decide(req: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface MaxmaSessionOptions {
  /** 工作目录（官方 CreateAgentSessionOptions.cwd）。 */
  cwd?: string;
  /** 整体替换系统提示词（官方 DefaultResourceLoader.systemPrompt）。 */
  systemPrompt?: string;
  /** 追加系统提示词（官方 DefaultResourceLoader.appendSystemPrompt）。 */
  appendSystemPrompt?: string[];
  /** 是否加载 Agent Skills；默认启用。 */
  skillsEnabled?: boolean;
  /** 工具白名单（官方 CreateAgentSessionOptions.tools）。 */
  tools?: string[];
  /** 权限模式，默认 "ask"。 */
  permissionMode?: MaxmaPermissionMode;
  /** 审批门；不提供时视为全部自动批准（等效 auto）。 */
  approvalGate?: ApprovalGate;
  /** 自定义工具（官方 CreateAgentSessionOptions.customTools，ToolDefinition）。 */
  customTools?: ToolDefinition[];
  /**
   * MCP 服务器清单（官方 McpServerEntry 形状，name/config/source）。
   * 由 bridge 从 api/data/mcp_servers.yaml 转换；缺省时不装配 MCP 扩展。
   */
  mcpServers?: Array<{
    name: string;
    config: Record<string, unknown>;
    source?: string;
  }>;
  /** 不落盘会话（官方 SessionManager.inMemory()），测试与临时会话用。 */
  inMemory?: boolean;
  /** 官方 auth/model 运行时（kernel/model.ts resolvePiModel 产物）。 */
  modelRuntime?: ModelRuntime;
  /** 官方 Model 对象（registry 查找或自定义 provider 注册结果）。 */
  model?: Model<Api>;
  /** 思考级别（官方 ThinkingLevel，pi-ai types）。 */
  thinkingLevel?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}
