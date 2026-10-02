/**
 * kernel/bridge-pi.ts — pi 引擎会话的 RPC 桥（阶段一 §6.2 任务 4）。
 *
 * 职责：create_session(engine="pi") 建会话并装配订阅/审批门；为核心 RPC 子集
 * 提供 pi 实现（prompt/cancel/destroy/get_health/user_response）；其余 RPC
 * 显式 unsupported（逐个迁移中，见 docs/contracts/agent-rpc.md §9）。
 *
 * 与 OMP 路径的关系：两引擎并存于 bridgeState（sessions / piSessions 两个 map），
 * dispatcher 按 session_id 命中分流；OMP 路径零改动。
 */

import { randomUUID } from "node:crypto";
import type { AgentSession as PiAgentSession } from "@earendil-works/pi-coding-agent";

import { createMaxmaSession } from "./pi-session";
import { createMaxmaApprovalGate, type MaxmaApprovalGate } from "./approval-gate";
import { mapPiAgentEventToMaxma, type PiDoneGuard } from "./events";
import { orchestratePiPrompt, handlePiCancelGuard } from "./prompt";
import { loadMaxmaMcpEntries } from "./mcp";
import { resolvePiModel } from "./model";
import { loadPersonaSystemPrompt } from "./persona-prompt";
import { buildPiCustomTools } from "./tools";
import {
  createSubmitPlanTool,
  PI_PLAN_MODE_DIRECTIVE,
  rejectPendingPiPlansForSession,
  resolvePiPlanAction,
  type PiPendingPlan,
} from "./plan";
import { applyGoalAction, emptyGoalState, goalReminder, goalUpdatedEvent, restoreGoalState, type PiGoalState } from "./goal";
import type { MaxmaPermissionMode, MaxmaSessionOptions } from "./types";
import { maxmaProjectRoot } from "./project-paths";

/** 与 src/events.ts MAX_TOOL_CALLS_PER_TURN 同值——引擎隔离各自持镜像，切换期单源收敛。 */
export const MAX_TOOL_CALLS_PER_TURN = 50;

/** pi 引擎会话记录（与 OMP SessionRecord 平行，不混用）。 */
export interface PiSessionRecord {
  engine: "pi";
  session: PiAgentSession;
  unsubscribe: () => void;
  promptQueue: Promise<void>;
  currentGuard: PiDoneGuard | null;
  toolCallCount: number;
  permissionMode: MaxmaPermissionMode;
  approvalGate: MaxmaApprovalGate;
  /** 计划模式（§6.2 任务 4 自建：submit_plan 工具 + followUp 指令） */
  planMode: boolean;
  /** 目标模式状态（§6.2 任务 4 自建：官方 custom entry 持久化） */
  goalState: PiGoalState;
  /** 闲置回顾等旁路 prompt 进行中：订阅层丢弃事件（RECAP-SILENT-001） */
  suppressEvents: boolean;
  modelRequestStartedAt: number | null;
  modelPriceStatus: "catalog_estimate" | "unknown";
  modelCacheStatus: "catalog" | "unknown";
}

export interface PiBridgeIo {
  send: (id: number | null, result: unknown) => void;
  sendError: (id: number | null, message: string) => void;
  sendEvent: (sessionId: string, event: { type: string; payload: Record<string, unknown> }) => void;
}

export interface PiBridgeDeps {
  io: PiBridgeIo;
  sessions: Map<string, PiSessionRecord>;
  /** 在途计划审批（与 OMP 路径共用 bridgeState.pendingPlans；形状结构等价）。 */
  pendingPlans: Map<string, PiPendingPlan>;
}

const PI_PERMISSION_MODES: readonly MaxmaPermissionMode[] = ["read_only", "ask", "operate", "auto"];

/** 从官方 Settings 对象解析点路径（如 "compaction.thresholdPercent"）。 */
function readDottedPath(root: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

/** 点路径 → 嵌套覆盖对象（官方 applyOverrides 需要 Partial<Settings> 形状）。 */
function buildNestedOverride(dotted: string, value: unknown): Record<string, unknown> {
  const keys = dotted.split(".").filter((k) => k.length > 0);
  let node: Record<string, unknown> = { [keys[keys.length - 1]!]: value };
  for (let i = keys.length - 2; i >= 0; i--) {
    node = { [keys[i]!]: node };
  }
  return node;
}

/**
 * 订阅 pi 会话事件流：镜像 OMP 版 subscribeSession 的安全护栏
 * （TOOL-LOOP-GUARD-001 计数终止），映射走 kernel 事件桥。
 * Blocker（MaxmaBlocker 拒止锚）在 pi 引擎上的落点为官方 tool_call 钩子，
 * 于 §6.2 任务 3 接入；本版本 pi 会话暂无拒止锚拦截。
 */
export function subscribePiSession(
  sessionId: string,
  record: PiSessionRecord,
  io: PiBridgeIo,
): () => void {
  return record.session.subscribe((event: unknown) => {
    // RECAP-SILENT-001：旁路 prompt（闲置回顾）期间丢弃事件——
    // 回顾结果经 RPC 返回，不应以流式事件/done 泄漏给前端。
    const incoming = event as { type?: string; entry?: { type?: string; kind?: string } };
    const usageMustBeTracked = incoming.type === "message_end"
      || (incoming.type === "entry_appended" && incoming.entry?.type === "usage" && incoming.entry.kind === "cache_warm");
    if (record.suppressEvents && !usageMustBeTracked) return;
    const eventType = (event as { type?: string })?.type;
    if (eventType === "message_start") record.modelRequestStartedAt = performance.now();
    const requestDurationMs = eventType === "message_end" && record.modelRequestStartedAt !== null
      ? Math.max(0, performance.now() - record.modelRequestStartedAt)
      : null;

    if (eventType === "tool_execution_start") {
      record.toolCallCount += 1;
      if (record.toolCallCount > MAX_TOOL_CALLS_PER_TURN) {
        const guard = record.currentGuard;
        if (guard && !guard.done) {
          guard.done = true;
          io.sendEvent(sessionId, {
            type: "error",
            payload: {
              code: "TOOL_LOOP_LIMIT",
              message: `工具调用次数超过上限（${MAX_TOOL_CALLS_PER_TURN}），已终止本轮`,
            },
          });
          io.sendEvent(sessionId, { type: "done", payload: {} });
          void record.session.abort().catch(() => {});
        }
        return; // 丢弃超限后的多余工具事件
      }
    }
    const currentModel = record.session.model;
    const entry = incoming.entry as { provider?: string; model?: string } | undefined;
    const usageMetadataMatches = eventType === "entry_appended" && entry?.provider === currentModel?.provider && entry?.model === currentModel?.id;
    const mapped = mapPiAgentEventToMaxma(event, record.currentGuard, requestDurationMs, {
      priceStatus: usageMetadataMatches ? record.modelPriceStatus : "unknown",
      cacheStatus: usageMetadataMatches ? record.modelCacheStatus : "unknown",
    });
    if (mapped) {
      io.sendEvent(sessionId, mapped);
      if (eventType === "message_end") record.modelRequestStartedAt = null;
    }
  });
}

/**
 * create_session(engine="pi")：建 pi 会话 + 审批门 + 订阅，登记入 deps.sessions。
 * v1 参数面：cwd / system_prompt / append_system_prompt / tools / permission_mode；
 * model/provider 覆写与 MCP 清单在 §6.2 任务 7/6 接入（当前用 pi 默认模型）。
 */
export async function handlePiCreateSession(
  deps: PiBridgeDeps,
  params: Record<string, any>,
  id: number | null,
): Promise<void> {
  const io = deps.io;
  const cwd: string = params?.cwd ?? maxmaProjectRoot();
  const systemPrompt: string | undefined = params?.system_prompt;
  const appendSystemPrompt: string | undefined = params?.append_system_prompt;
  const tools: string[] | undefined = Array.isArray(params?.tools) ? params.tools : undefined;
  const rawMode = params?.permission_mode as string | undefined;
  const permissionMode: MaxmaPermissionMode =
    rawMode && PI_PERMISSION_MODES.includes(rawMode as MaxmaPermissionMode)
      ? (rawMode as MaxmaPermissionMode)
      : "ask";

  // session_id 契约：对齐 Python `uuid.uuid4().hex`（32 位小写 hex，无连字符）——
  // 前端 useChat.ts 以 /^[0-9a-f]{32}$/i 校验并据此建立 WS，带连字符会被拒绝。
  const sessionId = randomUUID().replace(/-/g, "");
  // record 先行占位（gate 经闭包读 record.permissionMode，set_auto_approve 运行时切换）
  const record = {
    engine: "pi",
    session: undefined as unknown as PiAgentSession,
    unsubscribe: () => {},
    promptQueue: Promise.resolve(),
    currentGuard: null,
    toolCallCount: 0,
    permissionMode,
    approvalGate: undefined as unknown as MaxmaApprovalGate,
    planMode: false,
    goalState: emptyGoalState(),
    suppressEvents: false,
    modelRequestStartedAt: null,
    modelPriceStatus: "unknown",
    modelCacheStatus: "unknown",
  } as PiSessionRecord;

  const approvalGate = createMaxmaApprovalGate({
    emit: (event) => io.sendEvent(sessionId, event),
    mode: () => record.permissionMode,
  });
  record.approvalGate = approvalGate;

  // 计划模式（§6.2 任务 4 自建）：submit_plan 官方自定义工具
  const submitPlanTool = createSubmitPlanTool({
    sessionId,
    isPlanMode: () => record.planMode,
    onApproved: () => {
      record.planMode = false;
    },
    emit: (event) => io.sendEvent(sessionId, event),
    pendingPlans: deps.pendingPlans,
  });

  // MCP 清单：mcp_servers.yaml → 官方 McpServerEntry（createMcpExtension loadConfig 注入）
  const mcp = loadMaxmaMcpEntries();

  // 模型与凭据（官方 ModelRuntime：示例 09 setRuntimeApiKey / registerProvider）
  const resolved = await resolvePiModel({
    model: params?.model ?? "openai/gpt-4o",
    provider: params?.provider || undefined,
    baseUrl: params?.base_url || undefined,
    apiKey: params?.api_key || undefined,
    providerType: params?.provider_type || undefined,
    contextWindow: Number.isFinite(Number(params?.context_window))
      ? Number(params.context_window)
      : undefined,
    // MAXTOKENS-END2END-001：用户输出上限（与 OMP 路径同参数同上限）
    maxTokens: Number.isFinite(Number(params?.max_tokens)) && Number(params.max_tokens) > 0
      ? Math.min(Number(params.max_tokens), 262_144)
      : undefined,
  });
  record.modelPriceStatus = resolved.priceStatus;
  record.modelCacheStatus = resolved.cacheStatus;

  const thinkingLevel = params?.thinking_level as MaxmaSessionOptions["thinkingLevel"] | undefined;

  const options: MaxmaSessionOptions = {
    cwd,
    permissionMode,
    approvalGate,
    modelRuntime: resolved.modelRuntime,
    model: resolved.model,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(mcp && mcp.entries.length > 0 ? { mcpServers: mcp.entries } : {}),
    // Maxma 特色能力层（§6.2 任务 5：4 个工具 + 计划模式 submit_plan）
    customTools: [...buildPiCustomTools(), submitPlanTool],
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    skillsEnabled: params?.skills_enabled !== false,
    appendSystemPrompt: [
      ...(appendSystemPrompt !== undefined ? [appendSystemPrompt] : []),
      loadPersonaSystemPrompt(),
    ],
    ...(tools !== undefined ? { tools } : {}),
    inMemory: params?.in_memory === true,
  };

  let session: PiAgentSession;
  try {
    session = await createMaxmaSession(options);
  } catch (error) {
    io.sendError(id, `pi create_session failed: ${String(error)}`);
    return;
  }
  record.session = session;
  record.goalState = restoreGoalState(
    session.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>,
  );
  record.unsubscribe = subscribePiSession(sessionId, record, io);
  deps.sessions.set(sessionId, record);

  io.send(id, { session_id: sessionId });
}

/**
 * pi 会话的 RPC 分发（dispatcher 检测到 piSessions 命中后进入）。
 * 支持：prompt / cancel / destroy_session / get_health / user_response /
 * set_auto_approve / reload_mcp_for_session（重建会话语义）。
 * 其余方法显式 unsupported——不允许静默黑洞。
 */
export async function handlePiSessionRpc(
  deps: PiBridgeDeps,
  method: string,
  sessionId: string,
  params: Record<string, any>,
  id: number | null,
): Promise<void> {
  const io = deps.io;
  const record = deps.sessions.get(sessionId);
  if (!record) {
    io.sendError(id, `pi session not found: ${sessionId}`);
    return;
  }

  if (method === "prompt") {
    const message: string = params?.message as string;
    if (!message) {
      io.sendError(id, "Missing required parameter: message");
      return;
    }
    // 队列串行（与 OMP 版同语义：并发 prompt 排队，事件经订阅层转发）
    record.promptQueue = record.promptQueue.then(async () => {
      const guard: PiDoneGuard = { done: false };
      record.currentGuard = guard;
      record.toolCallCount = 0;
      try {
        await orchestratePiPrompt(record.session, message, guard, (event) =>
          io.sendEvent(sessionId, event),
        );
      } finally {
        if (record.currentGuard === guard) record.currentGuard = null;
      }
    });
    io.send(id, { ok: true });
    return;
  }

  if (method === "cancel") {
    handlePiCancelGuard(record.currentGuard, (event) => io.sendEvent(sessionId, event));
    // 官方 abort()：停止活动操作并等待 idle；同时拒绝全部在途审批防挂起
    record.approvalGate.rejectAll("cancelled");
    await record.session.abort().catch(() => {});
    io.send(id, { ok: true });
    return;
  }

  if (method === "destroy_session") {
    record.unsubscribe();
    record.approvalGate.rejectAll("session destroyed");
    rejectPendingPiPlansForSession(deps.pendingPlans, sessionId);
    try {
      record.session.dispose();
    } catch {
      // best-effort
    }
    deps.sessions.delete(sessionId);
    io.send(id, { ok: true });
    return;
  }

  if (method === "get_health") {
    io.send(id, {
      ok: true,
      engine: "pi",
      streaming: record.session.isStreaming,
      pending_approvals: record.approvalGate.pendingCount(),
    });
    return;
  }

  if (method === "user_response") {
    const interactionId: string = params?.interaction_id as string;
    const response = params?.response as string | string[] | undefined;
    if (!interactionId || response === undefined) {
      io.sendError(id, "Missing required parameters: interaction_id, response");
      return;
    }
    record.approvalGate.resolveUserApproval(interactionId, response);
    io.send(id, { ok: true });
    return;
  }

  if (method === "set_auto_approve") {
    // 与 OMP 版同语义：true → 全自动（yolo / pi "auto"），false → 逐次审批（"ask"）
    const autoApprove = params?.auto_approve === true;
    record.permissionMode = autoApprove ? "auto" : "ask";
    io.send(id, { ok: true, permission_mode: record.permissionMode });
    return;
  }

  if (method === "reload_mcp_for_session") {
    // 官方语义：MCP 扩展在 session_start 连接服务器，配置变更后需重建会话
    // （与 OMP 版 reload_mcp 的原始语义一致，非热重载）
    io.send(id, { status: "noop", detail: "pi 引擎修改 MCP 配置后请重建会话" });
    return;
  }

  if (method === "undo") {
    // 官方会话语义：会话 append-only（条目不可改/删），"回退"= 官方分支操作
    // ——把叶指针移到更早条目（branch(parentId) / resetLeaf()），后续追加形成新分支。
    // 契约形状保持 OMP 版 { removed, turns_removed }：removed 为离开上下文的条目数。
    const steps: number = Math.max(1, Number(params?.steps) || 1);
    const sm = record.session.sessionManager;
    const branch = sm.getBranch() as Array<{ id?: string; type?: string; parentId?: string | null; message?: { role?: string } }>;
    let turns = 0;
    let targetParentId: string | null | undefined;
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i]!;
      if (entry.type === "message" && entry.message?.role === "user") {
        turns += 1;
        if (turns >= steps) {
          targetParentId = entry.parentId ?? null;
          break;
        }
      }
    }
    if (targetParentId === undefined) {
      io.send(id, { removed: 0, turns_removed: 0, detail: "no turns to undo" });
      return;
    }
    const before = sm.getBranch().length;
    if (targetParentId === null) sm.resetLeaf(); // 官方：回到首条用户消息之前
    else sm.branch(targetParentId);
    const after = sm.getBranch().length;
    io.send(id, { removed: Math.max(0, before - after), turns_removed: turns });
    return;
  }

  if (method === "get_settings") {
    // 官方 SettingsManager 为类型化对象（无点路径 API）：从 getSettings()
    // 解析点路径；未知路径静默跳过（与 OMP 版行为一致）。
    const paths: string[] = Array.isArray(params?.paths) ? params.paths : [];
    const settings = record.session.settingsManager.getSettings();
    const result: Record<string, unknown> = {};
    for (const p of paths) {
      const value = readDottedPath(settings, p);
      if (value !== undefined) result[p] = value;
    }
    io.send(id, { settings: result });
    return;
  }

  if (method === "set_settings") {
    const path: string = params?.path as string;
    const value: unknown = params?.value;
    if (!path) {
      io.sendError(id, "Missing required parameter: path");
      return;
    }
    try {
      // 官方 applyOverrides（在现有设置之上叠加）+ flush（落盘挂起写入）
      const overrides = buildNestedOverride(path, value);
      record.session.settingsManager.applyOverrides(overrides as never);
      await record.session.settingsManager.flush();
      io.send(id, { ok: true });
    } catch (err) {
      io.sendError(id, `Failed to set setting: ${String(err)}`);
    }
    return;
  }

  if (method === "checkpoint_action") {
    // 官方机制落点：pi 会话树自带 label（书签）条目——save = 给当前叶子打标签
    // （appendLabelChange），restore = branch() 回到该条目重新展开分支。
    // 取代 OMP 版的"追加指令消息让 agent 调 checkpoint/rewind 工具"——
    // 无需额外 LLM 回合，且条目原样保留（append-only）。
    const action: string = params?.action as string;
    if (action !== "save" && action !== "restore") {
      io.sendError(id, `Unknown checkpoint action: ${action}`);
      return;
    }
    const sm = record.session.sessionManager;
    if (action === "save") {
      const leafId = sm.getLeafId();
      if (!leafId) {
        io.sendError(id, "No conversation entries to checkpoint");
        return;
      }
      const label = (params?.goal as string) || "user-requested checkpoint";
      sm.appendLabelChange(leafId, label);
      io.sendEvent(sessionId, {
        type: "notice",
        payload: { level: "info", message: `检查点已保存：${label}`, source: "checkpoint" },
      });
      io.send(id, { ok: true, action, entry_id: leafId, label });
      return;
    }
    // restore：找最近一个带 label 的条目（从当前分支末尾向前）
    const branch = sm.getBranch() as Array<{ id?: string; type?: string }>;
    let targetId: string | undefined;
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i]!;
      if (entry.type === "label") {
        // label 条目的 targetId 才是被标记的会话条目
        const targetIdRaw = (entry as unknown as { targetId?: string }).targetId;
        if (targetIdRaw) {
          targetId = targetIdRaw;
          break;
        }
      }
    }
    if (!targetId) {
      io.send(id, { ok: true, action, restored: false, detail: "没有可恢复的检查点" });
      return;
    }
    sm.branch(targetId);
    io.sendEvent(sessionId, {
      type: "notice",
      payload: { level: "info", message: "已恢复到最近检查点", source: "checkpoint" },
    });
    io.send(id, { ok: true, action, restored: true, entry_id: targetId });
    return;
  }

  if (method === "set_plan_mode") {
    // 自建计划模式（§6.2 任务 4）：enabled=true → 置位 + followUp 注入指令
    // （官方排队语义：空闲时随下一轮到达，流式中则按 followUpMode 处理）；
    // enabled=false → 退出计划态（在途审批由 submit_plan 的 planMode 检查兜底）。
    const enabled = params?.enabled === true;
    record.planMode = enabled;
    if (enabled) {
      record.promptQueue = record.promptQueue.then(async () => {
        await record.session.followUp(PI_PLAN_MODE_DIRECTIVE).catch(() => {});
      });
    }
    io.send(id, { ok: true, enabled });
    return;
  }

  if (method === "plan_action") {
    const planId: string = params?.plan_id as string;
    const action: string = params?.action as string;
    if (!planId || !["approve", "reject", "modify"].includes(action)) {
      io.sendError(id, "Missing/invalid required parameters: plan_id, action");
      return;
    }
    const matched = resolvePiPlanAction(deps.pendingPlans, planId, {
      action: action as "approve" | "reject" | "modify",
      modifiedPlan: params?.modified_plan as string | undefined,
      reason: params?.reason as string | undefined,
    });
    io.send(id, { ok: true, matched });
    return;
  }

  if (method === "goal_action") {
    // 目标模式（§6.2 任务 4 自建）：状态机 + goal_updated 事件（契约不变）+
    // 官方 custom entry 持久化（跨重启恢复）+ followUp 注入目标提醒。
    const action: string = params?.action as string;
    if (!["set", "replace", "pause", "resume", "drop"].includes(action)) {
      io.sendError(id, `Unknown goal action: ${action}`);
      return;
    }
    if ((action === "set" || action === "replace") && !String(params?.objective ?? "").trim()) {
      io.sendError(id, "Goal objective is required");
      return;
    }
    record.goalState = applyGoalAction(record.goalState, action, {
      objective: params?.objective as string | undefined,
      token_budget: params?.token_budget,
    });
    // 官方 custom entry 持久化（append-only 树内，不参与 LLM 上下文）
    try {
      record.session.sessionManager.appendCustomEntry("maxma:goal", record.goalState);
    } catch {
      // 持久化失败不阻断状态更新（内存态仍生效）
    }
    io.sendEvent(sessionId, goalUpdatedEvent(record.goalState));
    const reminder = goalReminder(record.goalState);
    if (reminder) {
      record.promptQueue = record.promptQueue.then(async () => {
        await record.session.followUp(reminder).catch(() => {});
      });
    }
    io.send(id, {
      ok: true,
      action,
      state: {
        enabled: record.goalState.enabled,
        mode: record.goalState.mode,
        goal: record.goalState.goal,
      },
    });
    return;
  }

  if (method === "get_goal_state") {
    io.send(id, { state: record.goalState.enabled ? record.goalState : null });
    return;
  }

  if (method === "set_permission_mode") {
    // 4 档权限模式运行时切换（AG-PERM-001：read_only/ask/operate/auto）
    const mode = params?.permission_mode as MaxmaPermissionMode;
    if (!PI_PERMISSION_MODES.includes(mode)) {
      io.sendError(id, `不支持的权限模式: ${String(mode)}`);
      return;
    }
    record.permissionMode = mode;
    io.send(id, { ok: true, permission_mode: mode });
    return;
  }

  if (method === "clear_messages") {
    // UX-CLEAR-001（Bun 直译）：清空会话上下文 = 官方 resetLeaf()——
    // 叶指针回到根，后续追加形成全新分支（条目不删除，append-only）。
    record.session.sessionManager.resetLeaf();
    io.sendEvent(sessionId, { type: "notice", payload: { level: "info", message: "会话已清空", source: "session" } });
    io.send(id, { status: "cleared" });
    return;
  }

  if (method === "get_messages") {
    // 契约形状与 OMP 版一致：{ messages: [{role, content}], total }（limit<=0 → 空）
    const limit: number = (params?.limit as number) ?? 50;
    const messages = record.session.messages as Array<{ role?: string; content?: unknown }>;
    const total = messages.length;
    const sliced = limit <= 0 ? [] : messages.slice(-Math.min(limit, total));
    const result = sliced.map((m) => {
      let content = "";
      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content
          .filter((b: unknown): b is { type: string; text?: string } => (b as { type?: string })?.type === "text")
          .map((b) => b.text ?? "")
          .join("");
      }
      return { role: m.role ?? "unknown", content };
    });
    io.send(id, { messages: result, total });
    return;
  }

  if (method === "compact") {
    // 官方 AgentSession.compact()：LLM 生成摘要条目替换旧上下文（非消息截断）。
    // 契约保持 { compressed, removed_count, detail }；pi 语义下消息不删除，
    // removed_count 恒 0，摘要在 detail 中体现。
    try {
      const customInstructions = params?.custom_instructions as string | undefined;
      const result = await record.session.compact(customInstructions);
      io.send(id, {
        compressed: true,
        removed_count: 0,
        detail: `压缩完成（tokensBefore ${result?.tokensBefore ?? "?"}）`,
      });
    } catch (err) {
      io.sendError(id, `compact failed: ${String(err)}`);
    }
    return;
  }

  if (method === "session_recap") {
    // 会话闲置回顾（GAP-B3-001，Maxma 应用层触发器）：官方
    // getLastAssistantText() 捕获答案（取代 OMP 版独立订阅捕获）。
    // 30s 兜底超时——超时返回空内容（前端对空回顾静默跳过）。
    // RECAP-SILENT-001：回顾 prompt 走官方 prompt，但其流式事件/done 不应
    // 泄漏给前端（OMP synthetic:true 同语义）——suppressEvents 期间订阅层丢弃。
    const record0 = record;
    record0.suppressEvents = true;
    try {
      const answer = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve(""), 30_000);
        record0.promptQueue = record0.promptQueue
          .catch(() => {})
          .then(async () => {
            try {
              await record0.session.prompt("请简要回顾当前对话：进展、已确认的事实与待办事项，80 字以内。");
              await record0.session.waitForIdle();
              clearTimeout(timer);
              resolve(record0.session.getLastAssistantText() ?? "");
            } catch {
              clearTimeout(timer);
              resolve("");
            }
          });
      });
      io.send(id, { recap: answer });
    } finally {
      record0.suppressEvents = false;
    }
    return;
  }

  if (method === "execute_workflow_step") {
    // Workflow 步骤执行（Phase 3.5 保留功能）：与 OMP 版同构——
    // step 转 prompt 直调（事件经订阅层流给前端展示进度），step 起止事件契约不变。
    const stepDefinition = (params?.step_definition ?? {}) as Record<string, unknown>;
    const toolName: string = (stepDefinition.tool as string) ?? "";
    const toolArgs: Record<string, unknown> = (stepDefinition.args as Record<string, unknown>) ?? {};
    const stepId: string = (stepDefinition.step_id as string) ?? "unknown";
    io.sendEvent(sessionId, {
      type: "workflow_step_start",
      payload: { step_id: stepId, tool_name: toolName },
    });
    try {
      const promptMsg = `Execute the following step:\nTool: ${toolName}\nArgs: ${JSON.stringify(toolArgs)}\n\nReturn the result.`;
      await record.session.prompt(promptMsg);
      await record.session.waitForIdle();
      io.sendEvent(sessionId, {
        type: "workflow_step_end",
        payload: { step_id: stepId, tool_name: toolName, status: "done" },
      });
      io.send(id, { ok: true, step_id: stepId });
    } catch (err) {
      io.sendEvent(sessionId, {
        type: "workflow_step_error",
        payload: { step_id: stepId, error: String(err) },
      });
      io.sendError(id, `Workflow step failed: ${String(err)}`);
    }
    return;
  }

  io.sendError(id, `pi engine: method "${method}" not yet migrated (see docs/contracts/agent-rpc.md §8)`);
}
