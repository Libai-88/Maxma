/**
 * kernel/goal.ts — Maxma 目标模式的 pi 自建（阶段一 §6.2 任务 4）。
 *
 * pi 无 goal 运行时（官方无等价导出，spike 已确认），按方案用官方机制自建：
 *   - 状态承载：PiSessionRecord.goalState（运行时）+ SessionManager.appendCustomEntry
 *     （官方 custom entry，会话持久化，goal 模式跨重启恢复）
 *   - 状态变化 → goal_updated 事件（契约 payload 与 OMP 版一致：{goal, state}）
 *   - set/pause/resume/drop → followUp 注入目标提醒（官方排队语义），agent 每轮可见
 * 契约形状对齐 OMP getGoalModeState()：{enabled, mode, goal: {id, objective, status, ...}}
 */

import type { MaxmaEventLike } from "./events";

type GoalEntry = { type?: string; customType?: string; data?: unknown };

export interface PiGoal {
  id: string;
  objective: string;
  status: "active" | "paused";
  tokenBudget?: number;
  tokensUsed?: number;
}

export interface PiGoalState {
  enabled: boolean;
  mode: "active" | "paused" | null;
  goal: PiGoal | null;
}

export interface GoalActionInput {
  objective?: string;
  token_budget?: unknown;
}

/** 目标提醒注入文本（followUp 官方排队语义，随下一轮到达）。 */
export function goalReminder(state: PiGoalState): string | null {
  if (!state.enabled || !state.goal) return null;
  const status = state.goal.status === "paused" ? "（已暂停）" : "";
  const budget = state.goal.tokenBudget ? `（预算 ${state.goal.tokenBudget} tokens）` : "";
  return `[目标模式]\n当前目标${status}: ${state.goal.objective}${budget}\n所有决策与执行都应对齐该目标；目标未完成前不要偏离。`;
}

export function emptyGoalState(): PiGoalState {
  return { enabled: false, mode: null, goal: null };
}

/** Recover the latest persisted goal entry from a pi session tree. */
export function restoreGoalState(entries: readonly GoalEntry[]): PiGoalState {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== "custom" || entry.customType !== "maxma:goal") continue;
    const data = entry.data;
    if (!data || typeof data !== "object") return emptyGoalState();
    const value = data as Partial<PiGoalState>;
    if (typeof value.enabled !== "boolean" || !(value.mode === "active" || value.mode === "paused" || value.mode === null)) {
      return emptyGoalState();
    }
    const goal = value.goal;
    if (goal === null || goal === undefined) return { enabled: value.enabled, mode: value.mode, goal: null };
    if (typeof goal !== "object") return emptyGoalState();
    const candidate = goal as Partial<PiGoal>;
    if (typeof candidate.id !== "string" || typeof candidate.objective !== "string" || !(candidate.status === "active" || candidate.status === "paused")) {
      return emptyGoalState();
    }
    return {
      enabled: value.enabled,
      mode: value.mode,
      goal: {
        id: candidate.id,
        objective: candidate.objective,
        status: candidate.status,
        ...(typeof candidate.tokenBudget === "number" ? { tokenBudget: candidate.tokenBudget } : {}),
        ...(typeof candidate.tokensUsed === "number" ? { tokensUsed: candidate.tokensUsed } : {}),
      },
    };
  }
  return emptyGoalState();
}

export function applyGoalAction(
  state: PiGoalState,
  action: string,
  input: GoalActionInput,
  uuidFn: () => string = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `g-${Date.now()}-${Math.random().toString(16).slice(2)}`,
): PiGoalState {
  const objective = typeof input.objective === "string" ? input.objective.trim() : "";
  const budget = Number(input.token_budget);
  const tokenBudget = Number.isFinite(budget) && budget > 0 ? budget : undefined;

  switch (action) {
    case "set":
    case "replace": {
      if (!objective) return state; // 调用方负责校验并发错误
      return {
        enabled: true,
        mode: "active",
        goal: { id: uuidFn(), objective, status: "active", tokenBudget },
      };
    }
    case "pause":
      if (!state.goal) return state;
      return { ...state, mode: "paused", goal: { ...state.goal, status: "paused" } };
    case "resume":
      if (!state.goal) return state;
      return { ...state, enabled: true, mode: "active", goal: { ...state.goal, status: "active" } };
    case "drop":
      return emptyGoalState();
    default:
      return state;
  }
}

/** goal_updated 事件（契约 payload：{goal, state}，goal 为 null 表示目标已放弃）。 */
export function goalUpdatedEvent(state: PiGoalState): MaxmaEventLike {
  return {
    type: "goal_updated",
    payload: {
      goal: state.goal ?? null,
      state: state.enabled ? { enabled: true, mode: state.mode ?? "active" } : { enabled: false, mode: null },
    },
  };
}
