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
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession as PiAgentSession } from "@earendil-works/pi-coding-agent";

import { MAXMA_DEFAULT_PI_TOOLS, createMaxmaSession } from "./pi-session";
import { powershellFallbackNote, probeBash, probePowerShell } from "./shell-health";
import { createMaxmaApprovalGate, type MaxmaApprovalGate } from "./approval-gate";
import { createExtensionUiBridge, type ExtensionUiBridge } from "./extension-ui";
import { mapPiAgentEventToMaxma, type PiDoneGuard } from "./events";
import { createRequestFingerprintEpoch, createRequestFingerprintSecret, type RequestTelemetry } from "./request-telemetry";
import { orchestratePiPrompt, handlePiCancelGuard } from "./prompt";
import { loadMaxmaMcpEntries } from "./mcp";
import { resolvePiModel } from "./model";
import { loadPersonaSystemPrompt } from "./persona-prompt";
import { buildPiCustomTools } from "./tools";
import { createSubagentTool, type SubagentLimits } from "./subagent";
import {
  createSubmitPlanTool,
  PI_PLAN_MODE_DIRECTIVE,
  rejectPendingPiPlansForSession,
  resolvePiPlanAction,
  type PiPendingPlan,
} from "./plan";
import { applyGoalAction, emptyGoalState, goalReminder, goalUpdatedEvent, restoreGoalState, type PiGoalState } from "./goal";

/**
 * 再导出：bun-backend 的 server.ts / routes/sessions.ts 需要这个类型来构造
 * hubPlans。此前它们直接 `import { type PiPendingPlan } from ".../bridge-pi"`，
 * 而 bridge-pi 只是**内部 import** 了它 —— 后端 tsc 因此报 TS2459（声明了但未导出）。
 */
export type { PiPendingPlan } from "./plan";
import type { MaxmaPermissionMode, MaxmaSessionOptions } from "./types";
import { MAXMA_PERMISSION_MODES } from "./pi-contract";
import { maxmaProjectRoot } from "./project-paths";
import { findPersistedSession, normalizeSessionId } from "./session-catalog";

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
  latestRequestTelemetry: RequestTelemetry | null;
  requestFingerprintSecret: Uint8Array;
  requestFingerprintEpoch: string;
  /** 扩展 UI 桥（EXT-UI-001）：扩展的 select/confirm/input 经它转成前端对话框。 */
  extensionUi: ExtensionUiBridge;
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
    const incoming = event as {
      type?: string;
      entry?: { type?: string; kind?: string };
      message?: { role?: string };
    };
    const eventType = incoming.type;
    const isAssistantMessage = incoming.message?.role === "assistant";
    const isAssistantEnd = eventType === "message_end" && isAssistantMessage;
    const isCacheWarm = eventType === "entry_appended" && incoming.entry?.type === "usage" && incoming.entry.kind === "cache_warm";

    if (eventType === "message_start" && isAssistantMessage) {
      record.modelRequestStartedAt = performance.now();
      record.latestRequestTelemetry = null;
    }

    // Idle recap calls contribute to usage but must never leak generated content or tool events.
    if (record.suppressEvents) {
      if (!isAssistantEnd && !isCacheWarm) return;
      const durationMs = isAssistantEnd && record.modelRequestStartedAt !== null
        ? Math.max(0, performance.now() - record.modelRequestStartedAt)
        : null;
      const currentModel = record.session.model;
      const entry = incoming.entry as { provider?: string; model?: string } | undefined;
      const usageMetadataMatches = isCacheWarm && entry?.provider === currentModel?.provider && entry?.model === currentModel?.id;
      const mapped = mapPiAgentEventToMaxma(event, record.currentGuard, durationMs, {
        priceStatus: usageMetadataMatches ? record.modelPriceStatus : "unknown",
        cacheStatus: usageMetadataMatches ? record.modelCacheStatus : "unknown",
        requestTelemetry: isAssistantEnd ? record.latestRequestTelemetry : null,
      });
      if (mapped?.type === "answer") {
        io.sendEvent(sessionId, {
          type: "llm_usage",
          payload: {
            kind: "model_request",
            usage_source: "pi_message_end",
            usage: mapped.payload.usage ?? null,
            provider: mapped.payload.provider ?? null,
            model: mapped.payload.model ?? null,
            request_duration_ms: mapped.payload.request_duration_ms ?? null,
            price_status: record.modelPriceStatus,
            cache_status: record.modelCacheStatus,
            request_shape_hash: mapped.payload.request_shape_hash ?? null,
            prefix_fingerprint: mapped.payload.prefix_fingerprint ?? null,
            fingerprint_epoch: mapped.payload.fingerprint_epoch ?? null,
          },
        });
      } else if (mapped?.type === "llm_usage") {
        io.sendEvent(sessionId, mapped);
      }
      if (isAssistantEnd) {
        record.modelRequestStartedAt = null;
        record.latestRequestTelemetry = null;
      }
      return;
    }

    if (eventType === "message_end" && !isAssistantMessage) return;
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
        return;
      }
    }
    const durationMs = isAssistantEnd && record.modelRequestStartedAt !== null
      ? Math.max(0, performance.now() - record.modelRequestStartedAt)
      : null;
    const currentModel = record.session.model;
    const entry = incoming.entry as { provider?: string; model?: string } | undefined;
    const usageMetadataMatches = isCacheWarm && entry?.provider === currentModel?.provider && entry?.model === currentModel?.id;
    const mapped = mapPiAgentEventToMaxma(event, record.currentGuard, durationMs, {
      priceStatus: usageMetadataMatches ? record.modelPriceStatus : "unknown",
      cacheStatus: usageMetadataMatches ? record.modelCacheStatus : "unknown",
      requestTelemetry: isAssistantEnd ? record.latestRequestTelemetry : null,
    });
    if (mapped) io.sendEvent(sessionId, mapped);
    if (isAssistantEnd) {
      record.modelRequestStartedAt = null;
      record.latestRequestTelemetry = null;
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
    MAXMA_PERMISSION_MODES.includes(rawMode as MaxmaPermissionMode)
      ? (rawMode as MaxmaPermissionMode)
      : "ask";

  // session_id 契约：对齐 Python `uuid.uuid4().hex`（32 位小写 hex，无连字符）——
  // 前端 useChat.ts 以 /^[0-9a-f]{32}$/i 校验并据此建立 WS，带连字符会被拒绝。
  //
  // 恢复（P1）：`resume_session_id` 指向磁盘上的历史会话，id 沿用原 id ——
  // 前端 localStorage 的会话选择与 turns 缓存都按 id 索引，换 id 等于丢上下文。
  // 已在 hub 里的会话直接回成功，重复恢复不产生第二个 record。
  const requestedSessionId = normalizeSessionId(params?.session_id);
  const resumeSessionId = normalizeSessionId(params?.resume_session_id);
  if ((resumeSessionId ?? requestedSessionId) && deps.sessions.has((resumeSessionId ?? requestedSessionId)!)) {
    io.send(id, { session_id: resumeSessionId ?? requestedSessionId, resumed: true });
    return;
  }
  const resume = resumeSessionId ? findPersistedSession(resumeSessionId, cwd) : null;
  if (resumeSessionId && !resume) {
    io.sendError(id, `Persisted session not found: ${resumeSessionId}`);
    return;
  }
  const sessionId = resumeSessionId ?? requestedSessionId ?? randomUUID().replace(/-/g, "");
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
    latestRequestTelemetry: null,
    requestFingerprintSecret: createRequestFingerprintSecret(),
    requestFingerprintEpoch: createRequestFingerprintEpoch(),
    extensionUi: undefined as unknown as ExtensionUiBridge,
  } as PiSessionRecord;

  const approvalGate = createMaxmaApprovalGate({
    emit: (event) => io.sendEvent(sessionId, event),
    mode: () => record.permissionMode,
  });
  record.approvalGate = approvalGate;

  // 扩展 UI 桥（EXT-UI-001）：与审批门同构但语义不同——审批超时默认拒绝，
  // 扩展对话框超时按官方默认值回填。两者不合并，见 extension-ui.ts 头注释。
  const extensionUi = createExtensionUiBridge({
    emit: (event) => io.sendEvent(sessionId, event),
  });
  record.extensionUi = extensionUi;

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

  // 子 Agent 工具的装配条件与面板契约：
  //   - 后端在 create_session 里传 `subagent: { enabled, max_concurrent, timeout_seconds }`
  //   - 未传视为不启用（老客户端/测试不受影响）
  const subagentCfg = params?.subagent as
    | { enabled?: boolean; max_concurrent?: number; timeout_seconds?: number }
    | undefined;
  const subagentTool = subagentCfg?.enabled === true
    ? createSubagentTool({
        cwd,
        ...(resolved.modelRuntime ? { modelRuntime: resolved.modelRuntime } : {}),
        ...(resolved.model ? { model: resolved.model } : {}),
        limits: {
          ...(Number.isFinite(Number(subagentCfg.max_concurrent)) ? { maxConcurrent: Number(subagentCfg.max_concurrent) } : {}),
          ...(Number.isFinite(Number(subagentCfg.timeout_seconds)) ? { timeoutMs: Number(subagentCfg.timeout_seconds) * 1000 } : {}),
        } satisfies Partial<SubagentLimits>,
        ...(params?.model ? { parentModel: String(params.model) } : {}),
      })
    : undefined;

  // Windows 上 bash 可能因目录/ACL 直接起不来（P2）。探测一次：失败时把官方
  // powershell 工具加进本会话，并把原因写进系统提示，模型不必撞墙后猜。
  let effectiveTools = tools;
  const fallbackPrompts: string[] = [];
  if (process.platform === "win32") {
    const bash = probeBash();
    if (!bash.ok) {
      const ps = probePowerShell();
      console.warn(
        `[shell] bash 无法启动（${bash.shell || "未找到"}）：${bash.detail.slice(0, 160)}；` +
        `powershell ${ps.ok ? "可用 → 本会话启用回退" : `不可用（${ps.detail.slice(0, 120)}）`}`,
      );
      if (ps.ok) {
        const base = tools ?? [...MAXMA_DEFAULT_PI_TOOLS];
        effectiveTools = base.includes("powershell") ? base : [...base, "powershell"];
        fallbackPrompts.push(powershellFallbackNote(bash));
      }
    }
  }

  const options: MaxmaSessionOptions = {
    cwd,
    permissionMode,
    approvalGate,
    // EXT-UI-001：扩展的 ctx.ui 必须有真实落点，否则 runner 回落 noOpUIContext。
    uiContext: extensionUi.uiContext,
    modelRuntime: resolved.modelRuntime,
    model: resolved.model,
    requestFingerprintSecret: record.requestFingerprintSecret,
    requestFingerprintEpoch: record.requestFingerprintEpoch,
    onRequestTelemetry: (telemetry) => {
      if (record.modelRequestStartedAt !== null) record.latestRequestTelemetry = telemetry;
    },
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(mcp && mcp.entries.length > 0 ? { mcpServers: mcp.entries } : {}),
    // Maxma 特色能力层（记忆、规则、办公读取 + 计划模式）
    // 子 Agent：pi SDK 的进程内会话（docs/sdk.md + examples/extensions/subagent），
    // 复用本会话已解析的 ModelRuntime/凭据，不 spawn 外部进程。
    // 面板值（启用/并行数/超时）由后端在 create_session 的 `subagent` 参数里下发。
    customTools: [
      ...buildPiCustomTools(cwd, subagentTool === undefined ? [] : [subagentTool]),
      submitPlanTool,
    ],
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    skillsEnabled: params?.skills_enabled !== false,
    appendSystemPrompt: [
      ...(appendSystemPrompt !== undefined ? [appendSystemPrompt] : []),
      loadPersonaSystemPrompt(),
      ...fallbackPrompts,
    ],
    ...(effectiveTools !== undefined ? { tools: effectiveTools } : {}),
    inMemory: params?.in_memory === true,
    sessionId,
    ...(resume ? { sessionFile: resume.file } : {}),
  };

  let session: PiAgentSession;
  try {
    session = await createMaxmaSession(options);
  } catch (error) {
    io.sendError(id, `pi create_session failed: ${String(error)}`);
    return;
  }
  record.session = session;

  // 全局设置的引擎侧生效：create_session 带入"用户显式改过、且归引擎消费"的键。
  // 会话的 SettingsManager 由 pi 自行装配，与后端那个全局单例不是同一个对象，
  // 所以必须在这里显式下发——否则设置面板改完对实际运行毫无影响（见
  // bun-backend/src/settings-global.ts 的头注释）。失败不阻断建会话：会话退回
  // 引擎默认值，并由后端把原因记进日志。
  const sessionSettings = params?.settings as Record<string, unknown> | undefined;
  if (sessionSettings && typeof sessionSettings === "object" && Object.keys(sessionSettings).length > 0) {
    try {
      session.settingsManager.applyOverrides(sessionSettings as never);
      await session.settingsManager.flush();
    } catch (error) {
      console.warn(`[kernel] create_session 应用全局设置失败（本会话按引擎默认值运行）: ${String(error)}`);
    }
  }

  record.goalState = restoreGoalState(
    session.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>,
  );
  record.unsubscribe = subscribePiSession(sessionId, record, io);
  deps.sessions.set(sessionId, record);

  io.send(id, { session_id: sessionId, resumed: resume !== null });
}

/**
 * 权限模式的**唯一写入点**（PERM-ANNOUNCE-001）。
 *
 * `record.permissionMode` 有两个写入方，语义还不一样：`set_permission_mode` 四档任选，
 * `set_auto_approve` 只有两态（开 → auto，关 → ask）。以前两条链各自只回自己的 RPC
 * 结果，谁都不广播——于是拨完「自动执行」开关，权限选择器仍按自己 GET 到的旧值渲染，
 * 显示的是内核并不在的档位（同一会话的另一个标签页同样看不见）。现在两条写入路径都
 * 经这里，**每次写入广播一次 `permission_mode_updated`**，前端以事件为唯一收敛点。
 */
function writePermissionMode(
  record: PiSessionRecord,
  io: PiBridgeIo,
  sessionId: string,
  mode: MaxmaPermissionMode,
): void {
  record.permissionMode = mode;
  // 切到自动执行时，之前挂起的审批必须一起放行：模型在上一张卡被批准后
  // 立刻可能发起下一次 tool_call（审批门按旧档位问了一次），如果只改档位，
  // 这张卡永远等不到答复——用户看到「已切自动执行，却还卡着一张批准卡」。
  if (mode === "auto") {
    try {
      const released = record.approvalGate.approveAllPending();
      if (released > 0) {
        console.log(`[approval] auto mode released ${released} pending approval(s)`);
      }
    } catch {
      /* gate 可能未装配 */
    }
  }
  io.sendEvent(sessionId, {
    type: "permission_mode_updated",
    payload: { permission_mode: mode },
  });
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

  if (method === "steer" || method === "follow_up") {
    const message = typeof params?.message === "string" ? params.message.trim().slice(0, 4000) : "";
    if (!message) {
      io.sendError(id, "Missing required parameter: message");
      return;
    }
    const disposition = method === "steer"
      ? await record.session.steer(message)
      : await record.session.followUp(message);
    io.send(id, { ok: true, disposition });
    return;
  }

  if (method === "cancel") {
    handlePiCancelGuard(record.currentGuard, (event) => io.sendEvent(sessionId, event));
    // 官方 abort()：停止活动操作并等待 idle；同时拒绝全部在途审批防挂起
    record.approvalGate.rejectAll("cancelled");
    // 扩展对话框同理：不清会让扩展 handler 的 promise 永远悬着。
    record.extensionUi.rejectAll();
    await record.session.abort().catch(() => {});
    io.send(id, { ok: true });
    return;
  }

  if (method === "destroy_session") {
    record.unsubscribe();
    record.approvalGate.rejectAll("session destroyed");
    record.extensionUi.rejectAll();
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

  // ── 会话状态（STATE-001）──
  //
  // pi 的 `AgentSession` 暴露了一组"当前是什么状态"的只读视图：选中模型、
  // **虚拟模型路由后的实际模型**（`routedModel`）、思考档位、是否空闲、是否在压缩。
  // 此前 Maxma 一个都没读——界面上「模型」显示的是它自己记的那个 id，
  // 引擎实际用谁回的话完全不可见。
  //
  // `routedModel` 尤其重要：选中虚拟模型时（扩展通过 `pi.registerVirtualModel`
  // 注册），`model` 是虚拟选择，`routedModel` 才是**最近一次真正应答的物理模型**。
  // 不暴露它，用户就永远不知道自动路由把他发给了谁。
  if (method === "get_session_state") {
    const session = record.session;
    const current = session.model;
    const routed = session.routedModel;
    io.send(id, {
      model: current ? { provider: current.provider, id: current.id, name: current.name } : null,
      // 只有虚拟模型被选中、且已有成功应答时才非空。
      routed_model: routed?.model
        ? { provider: routed.model.provider, id: routed.model.id, name: routed.model.name, thinking_level: routed.thinkingLevel ?? null }
        : null,
      thinking_level: session.thinkingLevel,
      is_streaming: session.isStreaming,
      is_idle: session.isIdle,
      session_name: session.sessionManager.getSessionName() ?? null,
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

  // EXT-UI-001：扩展对话框的应答（select/confirm/input/editor）。
  // 与 user_response 分开：那条走审批门（超时默认拒绝），这条走扩展 UI 桥
  // （超时按官方默认值回填）。混用会让两类超时语义互相污染。
  if (method === "extension_ui_response") {
    const uiId: string = params?.id as string;
    if (!uiId) {
      io.sendError(id, "Missing required parameter: id");
      return;
    }
    const hit = record.extensionUi.resolve(uiId, {
      ...(typeof params?.value === "string" ? { value: params.value } : {}),
      ...(typeof params?.confirmed === "boolean" ? { confirmed: params.confirmed } : {}),
      ...(params?.cancelled === true ? { cancelled: true } : {}),
    });
    // 未命中不报错：对话框可能已超时或被 abort 撤下，前端迟到的应答属正常竞争。
    io.send(id, { ok: true, matched: hit });
    return;
  }

  if (method === "set_auto_approve") {
    // 与 OMP 版同语义：true → 全自动（yolo / pi "auto"），false → 逐次审批（"ask"）。
    // 两态覆盖四档是**有意**的：它是"自动执行"开关的链路，改写已选的
    // read_only / operate 就是它的语义（见 dev_docs/permission-modes.md）。
    // 区别只在于现在改完会广播，UI 不再停留在旧档位上自说自话。
    const autoApprove = params?.auto_approve === true;
    writePermissionMode(record, io, sessionId, autoApprove ? "auto" : "ask");
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

  // ── 会话树（TREE-001）──
  //
  // pi 把会话存成**树**（append-only entry + 活动 leaf），但此前 Maxma 只用过
  // `getBranch()`（取当前分支）与 `getLeafId()`（checkpoint），从未把整棵树暴露出来。
  // 用户看不到"这段对话分过哪些支"，也就用不上 pi 的分支能力。
  //
  // 这里只做**只读投影**：把官方 SessionTreeNode 压成前端能直接渲染的形状。
  // 不透传原始 entry——里面含 usage/自定义 entry 等前端不消费的字段，
  // 且形状随 pi 版本变（engine-boundary 的纪律：前端只认 Maxma 契约）。
  if (method === "get_tree") {
    const sm = record.session.sessionManager;
    const leafId = sm.getLeafId();

    // 官方 `SessionTreeNode` 是判别联合（SessionEntry 各成员形状不同），
    // 直接当 Record 转会被 tsc 拒绝（TS2352）。这里用 unknown 过渡后按字段读——
    // 我们只取 id/type/timestamp/message.role 这些**所有成员共有**的字段。
    type RawEntry = { id?: string; parentId?: string | null; type?: string; timestamp?: string; message?: { role?: string; content?: unknown } };

    /** 从 entry 里抽一段人类可读预览。 */
    const previewOf = (entry: RawEntry): string => {
      const type = String(entry.type ?? "");
      if (type === "message") {
        const role = String(entry.message?.role ?? "unknown");
        let text = "";
        const content = entry.message?.content;
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          text = content
            .map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text"
              ? String((c as { text?: unknown }).text ?? "")
              : ""))
            .join(" ");
        }
        const flat = text.replace(/\s+/g, " ").trim();
        return `${role}: ${flat.length > 80 ? `${flat.slice(0, 80)}…` : flat}`;
      }
      if (type === "compaction") return "(上下文压缩摘要)";
      if (type === "branch_summary") return "(分支摘要)";
      if (type === "model_change") return "(切换模型)";
      if (type === "thinking_level_change") return "(切换思考档位)";
      if (type === "label") return "(书签)";
      return `(${type || "entry"})`;
    };

    interface TreeOut {
      id: string;
      parentId: string | null;
      type: string;
      role: string | null;
      preview: string;
      timestamp: string | null;
      label: string | null;
      isLeaf: boolean;
      children: TreeOut[];
    }

    const project = (node: { entry?: unknown; children?: unknown[]; label?: string }): TreeOut => {
      const entry = (node.entry ?? {}) as RawEntry;
      const id = String(entry.id ?? "");
      return {
        id,
        parentId: entry.parentId ?? null,
        type: String(entry.type ?? ""),
        role: entry.message?.role ? String(entry.message.role) : null,
        preview: previewOf(entry),
        timestamp: entry.timestamp ?? null,
        label: node.label ?? null,
        isLeaf: id === leafId,
        children: (node.children ?? []).map((c) => project(c as never)),
      };
    };

    const rawTree = sm.getTree() as unknown as Array<{ entry?: unknown; children?: unknown[]; label?: string }>;
    io.send(id, {
      session_id: sessionId,
      leaf_id: leafId,
      session_name: sm.getSessionName() ?? null,
      entry_count: sm.getEntryCount(),
      tree: rawTree.map(project),
    });
    return;
  }

  // ── 树内导航（TREE-002）──
  //
  // 官方 `navigateTree(targetId, {summarize})`：把 leaf 移到某个 entry，
  // 可选对离开的分支生成 LLM 摘要。**不删除任何条目**（append-only）。
  if (method === "navigate_tree") {
    const targetId = params?.target_id as string | undefined;
    if (!targetId) {
      io.sendError(id, "Missing required parameter: target_id");
      return;
    }
    const summarize = params?.summarize === true;
    const customInstructions = typeof params?.custom_instructions === "string"
      ? params.custom_instructions
      : undefined;
    try {
      const result = await record.session.navigateTree(targetId, {
        ...(summarize ? { summarize: true } : {}),
        ...(customInstructions !== undefined ? { customInstructions } : {}),
      });
      io.send(id, {
        cancelled: result.cancelled,
        aborted: result.aborted === true,
        leaf_id: record.session.sessionManager.getLeafId(),
        ...(result.summaryEntry ? { summary: true } : {}),
        ...(result.editorText !== undefined ? { editor_text: result.editorText } : {}),
      });
    } catch (error) {
      io.sendError(id, `navigateTree failed: ${String(error)}`);
    }
    return;
  }

  // ── 分叉（TREE-003）──
  //
  // 从某条 entry 分出新会话。实现路径**实测选定**（见 pi-shell-capability-plan.md §二.3）：
  //   `SessionManager.forkFrom(src, cwd)` 复制整个会话 → `branch(targetId)` 收窄到分叉点。
  // 不走 `AgentSessionRuntime.fork`：那需要改 `record` 的会话持有结构与生命周期，风险高。
  //
  // 注意：fork 出的是**磁盘上的新会话文件**，调用方（后端）负责用它的路径走
  // `create_session(resume_session_id)` 把它变成活会话。这里只建文件、返回 id。
  if (method === "fork_session") {
    const entryId = params?.entry_id as string | undefined;
    if (!entryId) {
      io.sendError(id, "Missing required parameter: entry_id");
      return;
    }
    const sm = record.session.sessionManager;
    const sourceFile = sm.getSessionFile();
    if (!sourceFile) {
      // 内存会话（inMemory）没有磁盘文件可复制。
      io.sendError(id, "当前会话未持久化，无法分叉");
      return;
    }
    // 分叉点必须是本会话里真实存在的 entry，否则 branch() 会静默落到根。
    if (!sm.getEntry(entryId)) {
      io.sendError(id, `找不到分叉点 entry: ${entryId}`);
      return;
    }
    // 空会话没有有效 JSONL（pi 在首次追加内容时才落盘），fork 会被引擎拒绝。
    // 提前给出可读原因，而不是把引擎的技术性异常原样抛给界面。
    if (sm.getEntryCount() === 0) {
      io.sendError(id, "这个会话还没有内容，无法分叉");
      return;
    }
    try {
      const forked = SessionManager.forkFrom(sourceFile, sm.getCwd());
      // 收窄到分叉点：forkFrom 复制了整个会话，branch 把 leaf 移过去。
      forked.branch(entryId);
      io.send(id, {
        session_id: forked.getSessionId(),
        session_file: forked.getSessionFile() ?? null,
        entry_id: entryId,
        entry_count: forked.getEntryCount(),
      });
    } catch (error) {
      io.sendError(id, `分叉失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  // ── 会话重命名 / 统计 / 导出（TREE-004）──
  //
  // 都是 pi 的 AgentSession 直接能力，此前一个都没接。
  // ── 取消压缩 / 分支摘要（ABORT-COMPACT-001）──
  //
  // 压缩要调用模型生成摘要。provider 挂了或网络卡住时，压缩会长时间挂着，
  // 而此前 Maxma 只有一个「开始压缩」没有「取消」——用户只能干等或杀进程。
  // pi 有 `abortCompaction()` / `abortBranchSummary()`，接上即可。
  if (method === "abort_compaction") {
    const what = params?.what === "branch_summary" ? "branch_summary" : "compaction";
    try {
      if (what === "branch_summary") record.session.abortBranchSummary();
      else record.session.abortCompaction();
      io.send(id, { ok: true, aborted: what, compacting: record.session.isCompacting });
    } catch (error) {
      io.sendError(id, `取消压缩失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  // ── 思考档位能力（THINKING-CAP-001）──
  //
  // pi 按**当前模型**裁剪可用思考档位（`getAvailableThinkingLevels()`），
  // 不支持的档位会被静默钳到最接近的值。此前 Maxma 的档位选择器无条件列出
  // 全部 7 档——用户选 `max`、实际跑的是 `medium`，界面上没有任何提示。
  if (method === "get_thinking_levels") {
    io.send(id, {
      available: record.session.getAvailableThinkingLevels(),
      current: record.session.thinkingLevel,
    });
    return;
  }

  // ── 上下文用量（CTX-USAGE-001）──
  //
  // pi 有**权威**的 `getContextUsage()`，返回 `{tokens, contextWindow, percent}`
  // （压缩后到下一次 assistant 响应前 tokens/percent 为 null，这是官方语义）。
  //
  // 此前 Maxma 没用它：后端拿 `get_messages` 自己按"字符数/2"估——
  // 中文场景下这个比例与真实分词差得很远，用户看到的上下文环（与"快满了会压缩"
  // 的提示）其实不是引擎认为的数字。这条 RPC 把权威值透出来，后端优先用它。
  if (method === "get_context_usage") {
    const usage = record.session.getContextUsage();
    io.send(id, {
      usage: usage ?? null,
      // 引擎返回 undefined 表示"当前不可知"（如压缩进行中），调用方据此决定是否回落。
      known: usage !== undefined,
    });
    return;
  }

  // ── 资源热重载（RELOAD-001）──
  //
  // `session.reload()` 重新加载扩展、技能、提示词模板、主题与上下文文件，
  // **不重建会话**（历史与活动分支都保留）。此前 Maxma 只能靠"新建会话"让
  // 新装的技能/模板生效——而新建会话意味着丢上下文。
  //
  // 与既有的 `reload_mcp_for_session` 不是一回事：那条只针对 MCP 且恒 noop
  // （MCP 清单由后端在 create_session 时装配），这条是引擎级的全量资源重载。
  if (method === "reload_session_resources") {
    try {
      await record.session.reload();
      const templates = record.session.promptTemplates.length;
      const tools = record.session.getAllTools().length;
      io.send(id, { ok: true, templates, tools });
    } catch (error) {
      io.sendError(id, `资源重载失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  // ── 上下文编辑（CTX-EDIT-001）──
  //
  // pi 的 `appendContextEdit(targetId, replacement)` 是**只影响未来模型上下文**的
  // 附录式修改：`replacement: null` 让该条 entry 从此不进入模型上下文，
  // 但不删除原始历史、不改界面、不改计费。这是"这条别让模型再看到了"的正确做法，
  // 比真删消息安全得多。
  if (method === "context_edit") {
    const targetId = params?.target_id as string | undefined;
    if (!targetId) {
      io.sendError(id, "Missing required parameter: target_id");
      return;
    }
    const sm = record.session.sessionManager;
    if (!sm.getEntry(targetId)) {
      io.sendError(id, `找不到目标 entry: ${targetId}`);
      return;
    }
    try {
      // 两种形态：omit=true 从上下文移除；否则按文本替换。
      // ⚠️ 替换值的形状是 `{ content: [...] }`，不是裸字符串——
      // 官方校验只接受 null 或含 string/array content 的对象（实测踩过，
      // 传裸字符串会抛 "must be null or contain string/array content"）。
      const omit = params?.omit !== false;
      const replacement = omit
        ? null
        : { content: [{ type: "text" as const, text: String(params?.replacement ?? "") }] };
      const editId = sm.appendContextEdit(targetId, replacement as never);
      io.send(id, { ok: true, edit_id: editId, target_id: targetId, omitted: omit });
    } catch (error) {
      io.sendError(id, `context_edit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  if (method === "set_session_name") {
    const name = typeof params?.name === "string" ? params.name.trim() : "";
    // 空串 = 清除名称（官方语义：写 undefined）。
    record.session.setSessionName(name);
    io.send(id, { ok: true, name: name || null });
    return;
  }

  // ── Prompt templates（PROMPT-TPL-001）──
  //
  // pi 的 ResourceLoader 本来就会扫 `~/.pi/agent/prompts/*.md` 与 `.pi/prompts/`，
  // `session.promptTemplates` 直接可读。此前 Maxma 既没暴露清单，前端斜杠补全
  // 也只认 10 条硬编码命令——用户放进去的模板等于不存在。
  if (method === "list_prompt_templates") {
    const templates = record.session.promptTemplates.map((t) => ({
      name: t.name,
      description: t.description,
      ...(t.argumentHint ? { argument_hint: t.argumentHint } : {}),
      // 不外泄绝对路径：只给来源标签（user/project/package），与技能发现同口径。
      source: (t.sourceInfo as { source?: string } | undefined)?.source ?? "unknown",
    }));
    io.send(id, { templates });
    return;
  }

  if (method === "get_session_stats") {
    const stats = record.session.getSessionStats();
    io.send(id, { stats });
    return;
  }

  if (method === "export_session_html") {
    const outputPath = typeof params?.output_path === "string" ? params.output_path : undefined;
    try {
      const path = await record.session.exportToHtml(outputPath);
      io.send(id, { ok: true, path: path ?? outputPath ?? null });
    } catch (error) {
      io.sendError(id, `export_session_html failed: ${String(error)}`);
    }
    return;
  }

  if (method === "set_permission_mode") {
    // 4 档权限模式运行时切换（AG-PERM-001：read_only/ask/operate/auto）
    const mode = params?.permission_mode as MaxmaPermissionMode;
    if (!MAXMA_PERMISSION_MODES.includes(mode)) {
      io.sendError(id, `不支持的权限模式: ${String(mode)}`);
      return;
    }
    writePermissionMode(record, io, sessionId, mode);
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
    const messages = record.session.messages as Array<{
      role?: string;
      content?: unknown;
      usage?: unknown;
      provider?: unknown;
      model?: unknown;
      timestamp?: unknown;
    }>;
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
      // pi 的 assistant 消息本来就带 usage/provider/model/timestamp
      // （`pi-ai/dist/types.d.ts: AssistantMessage`）。此前只映射 {role, content}，
      // 于是"每轮用了多少 token、哪个模型"在历史里永久丢失——清掉 localStorage
      // 缓存后脚注就没了。这里原样带上，字段保持可选：老客户端与既有测试不受影响。
      const out: Record<string, unknown> = { role: m.role ?? "unknown", content };
      if (m.usage && typeof m.usage === "object" && !Array.isArray(m.usage)) out.usage = m.usage;
      if (typeof m.provider === "string" && m.provider) out.provider = m.provider;
      if (typeof m.model === "string" && m.model) out.model = m.model;
      if (typeof m.timestamp === "number" && Number.isFinite(m.timestamp)) out.timestamp = m.timestamp;
      return out;
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

  io.sendError(id, `pi engine: method "${method}" not yet migrated (see docs/contracts/agent-rpc.md §8)`);
}
