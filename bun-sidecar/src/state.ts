/**
 * state.ts — sidecar 共享可变状态与核心类型。
 *
 * 可变状态集中在 bridgeState 容器中导出，生产代码通过模块别名访问，
 * 测试可 reset/inject（见 session-bridge.*.test.ts）。
 */
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp";
import type { MCPServerConfig } from "@oh-my-pi/pi-coding-agent/mcp";
import type { EventBus, Settings } from "./omp-compat";

export interface SessionRecord {
  session: AgentSession;
  unsubscribe: () => void;
  unsubLifecycle?: () => void;  // Phase 3.4: EventBus sub-agent lifecycle subscription
  eventBus?: EventBus;  // Phase 3.4: Shared EventBus
  promptQueue: Promise<void>;  // serializes concurrent prompt calls
  currentGuard: DoneGuard | null;  // active per-prompt done sentinel
  /** 当前 prompt 的工具调用计数（TOOL-LOOP-GUARD-001），prompt 开始时重置 */
  toolCallCount: number;
  mcpManager?: MCPManager;
  mcpConfigs?: Record<string, MCPServerConfig>;
  mcpAllowBlock?: Record<string, { allow?: string[]; block?: string[] }>;
  mcpToolNames?: string[];
  settings?: Settings;
}

export interface DoneGuard {
  done: boolean;
}

export interface PendingApproval {
  resolve: (choice: string | undefined) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** PLAN-BRIDGE-001：计划审批的在途条目（plan-bridge.ts 写入，plan_action RPC 兑现）。 */
export interface PendingPlan {
  resolve: (decision: PlanDecision) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 归属的 sidecar session id，destroy_session 时按此清理 */
  sessionId: string;
}

export interface PlanDecision {
  action: "approve" | "reject" | "modify";
  modifiedPlan?: string;
  reason?: string;
}

/** 审批超时——超时自动拒绝（deny by default）。 */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

/** 计划审批超时——计划修订成本高，给 10 分钟。 */
export const PLAN_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

/**
 * Mutable bridge state, exported for testability. Production code keeps the
 * module-level aliases below; tests can reset/inject via this container.
 */
export const bridgeState = {
  sessions: new Map<string, SessionRecord>(),
  pendingApprovals: new Map<string, PendingApproval>(),
  pendingPlans: new Map<string, PendingPlan>(),
  toolStartTimestamps: new Map<string, number>(),
};
