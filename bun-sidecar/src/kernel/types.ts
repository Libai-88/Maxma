/**
 * kernel/types.ts — Maxma Agent 内核接口。
 *
 * 设计纪律：
 *   - 本目录是唯一允许 import `@earendil-works/*` 的地方，
 *     越界 import 必须在 engine-boundary.test.ts 登记理由。
 *   - 全部能力只用 pi 官方 API（官方 SDK 文档 + 已安装版本的类型声明），不自创机制。
 */

/**
 * `Model` 属 **pi-ai**，不由 pi-coding-agent 根面再导出——此前从后者 import 它，
 * 因为它是纯类型（编译期被擦除）所以运行时不报错，`tsc` 却一直红着（TS2305）。
 * 引擎侧"从哪个包拿哪个类型"由 pi-contract.ts 登记，tests/pi-contract.test.ts 对账。
 */
import type { McpServerEntry, ToolDefinition, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { RequestTelemetry } from "./request-telemetry";

/**
 * Maxma 权限模式 4 档：档位清单与类型都单源在 `pi-contract.ts`
 * （`MAXMA_PERMISSION_MODES`，类型由它派生），这里只做 kernel 面的再导出——
 * 全仓的 `MaxmaPermissionMode` 都指向那一份，改名不可能两处各漂各的。
 * 语义（哪一档审批什么工具）见 `approval-gate.ts` 的 `needsApprovalForMode`
 * 与 dev_docs/permission-modes.md。
 */
import type { MaxmaPermissionMode } from "./pi-contract";

export type { MaxmaPermissionMode };

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
   * MCP 服务器清单：直接用官方 `McpServerEntry`，不在我方再造一个
   * `{ config: Record<string, unknown> }` 的松散镜像——官方 config 是**可判别联合**
   * （stdio 必须有 command、http 必须有 url），压成 Record 会丢掉这层约束，
   * 也让 `createMcpExtension({ loadConfig })` 的返回类型对不上（实测 tsc 红）。
   * 由 bridge 从 api/data/mcp_servers.yaml 转换；缺省时不装配 MCP 扩展。
   */
  mcpServers?: McpServerEntry[];
  /** 不落盘会话（官方 SessionManager.inMemory()），测试与临时会话用。 */
  inMemory?: boolean;
  /** 官方 auth/model 运行时（kernel/model.ts resolvePiModel 产物）。 */
  modelRuntime?: ModelRuntime;
  /** 官方 Model 对象（registry 查找或自定义 provider 注册结果）。 */
  model?: Model<Api>;
  /** 思考级别（官方 ThinkingLevel，pi-ai types）。 */
  thinkingLevel?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  /** Provider 请求前的无正文结构摘要与短期前缀指纹。 */
  requestFingerprintSecret?: Uint8Array;
  requestFingerprintEpoch?: string;
  onRequestTelemetry?: (telemetry: RequestTelemetry) => void;
}
