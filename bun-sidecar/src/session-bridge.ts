/**
 * session-bridge.ts — JSON-RPC server wrapping createAgentSession.
 *
 * RPC Methods:
 *   create_session({ model, system_prompt?, cwd? }) → { session_id }
 *   prompt({ session_id, message })               → { ok: true }
 *   cancel({ session_id })                         → { ok: true }
 *   destroy_session({ session_id })                → { ok: true }
 *   undo({ session_id, steps? })                   → { removed }
 *   get_messages({ session_id, limit? })           → { messages, total }
 *   get_settings({ paths? })                       → { settings }
 *   set_settings({ path, value })                  → { ok: true }
 *
 * Events are forwarded as JSON-RPC notifications (method: "event").
 */

import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createAgentSession, discoverAuthStorage, Settings } from "@oh-my-pi/pi-coding-agent";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp";
import type { MCPServerConfig } from "@oh-my-pi/pi-coding-agent/mcp";
import { TASK_SUBAGENT_LIFECYCLE_CHANNEL } from "@oh-my-pi/pi-coding-agent/task";
import type {
  AgentSession,
  ExtensionUIContext,
} from "@oh-my-pi/pi-coding-agent";
import type { Model } from "@oh-my-pi/pi-ai";
import { registerCustomTools } from "./tools/index";
import type { RpcRequest } from "./rpc-types";
import type { EventBus, LocalCreateSessionOptions, AuthStorage, SettingPath } from "./omp-compat";
import { noopExtensionActions, noopExtensionContextActions, setSetting, loadPluginManager, loadDiscoveredSkills, type OmpSkillEntry, type OmpPluginInfo } from "./omp-compat";
import * as fs from "node:fs";
import * as path from "node:path";
import { bridgeState, type DoneGuard, type PendingApproval, type SessionRecord } from "./state";
import { send, sendError, sendEvent, type BridgeIo } from "./rpc";
import { createConfiguredMcp, filterMcpTools, wireMcpToolsChanged, mcpReloadUnsupportedResponse, loadConfiguredMcp, mcpConfigPath } from "./mcp";
import { parseModel } from "./model";
import { mapPiEventToMaxma, createDoneGuard, orchestratePrompt, handleCancelGuard, computeUndoTurnCut, compactMessages, resolveUserResponse, MAX_TOOL_CALLS_PER_TURN } from "./events";
import { createApprovalUiContext, parseApprovalTitle } from "./approval";
import { checkToolBlocked } from "./blocker";

// Re-export public API so existing imports (tests, rpc_client) keep working.
export {
  loadConfiguredMcp,
  filterMcpTools,
  createConfiguredMcp,
  mcpReloadUnsupportedResponse,
  parseModel,
  mapPiEventToMaxma,
  createDoneGuard,
  orchestratePrompt,
  handleCancelGuard,
  computeUndoTurnCut,
  compactMessages,
  resolveUserResponse,
  parseApprovalTitle,
  createApprovalUiContext,
  bridgeState,
  type BridgeIo,
  type DoneGuard,
  type PendingApproval,
  type SessionRecord,
};
export type { MaxmaEvent } from "./rpc-types";

// ---------------------------------------------------------------------------
// Session orchestration
// ---------------------------------------------------------------------------

export async function buildCreateSessionOptions(
  input: {
    model: Model;
    cwd: string;
    authStorage: AuthStorage;
    systemPrompt?: string;
    appendSystemPrompt?: string;
    tools?: string[];
    permissionMode?: string;
    thinkingLevel?: string;
    temperature?: number;
  },
  createMcp: typeof createConfiguredMcp = createConfiguredMcp,
): Promise<{
  options: LocalCreateSessionOptions;
  needsApproval: boolean;
  mcpManager?: MCPManager;
  mcpConfigs?: Record<string, MCPServerConfig>;
  mcpAllowBlock?: Record<string, { allow?: string[]; block?: string[] }>;
  mcpToolNames?: string[];
}> {
  // 集中断言：OMP 的 customTools 等字段类型精确，业务层不逐字段对齐，
  // 升级 OMP 时若签名变化，只需在这里修一处。
  const createOptions = {
    model: input.model,
    cwd: input.cwd,
    authStorage: input.authStorage,
  } as unknown as LocalCreateSessionOptions;
  // THINKING-WIRE-001：思考开关端到端接线——前端 Thinking 开关 →
  // chat.py → create_session thinking_level → OMP thinkingLevel。
  // 此前 ModelSettingsPanel 从未挂载、payload 字段无消费方，开关零效果。
  if (input.thinkingLevel !== undefined) {
    createOptions.thinkingLevel = input.thinkingLevel as never;
  }
  // systemPrompt 与 appendSystemPrompt 互斥：前者整体替换 OMP 原生 prompt，
  // 后者追加到原生 prompt 之后。两者同时传入时 OMP 会以 systemPrompt 整体替换。
  if (input.systemPrompt !== undefined) createOptions.systemPrompt = input.systemPrompt;
  else if (input.appendSystemPrompt !== undefined) createOptions.appendSystemPrompt = input.appendSystemPrompt;
  if (input.tools !== undefined && input.tools.length > 0) createOptions.toolNames = input.tools;
  // Base settings: always disable advisor (OMP SDK warns on 401 even when disabled)
  // Memory backend is pinned to "off": the compiled sidecar does not bundle
  // fastembed/onnxruntime, so memory.backend="mnemopi" would fail at runtime.
  // Maxma's own memory (persona memory.yaml) is independent of OMP's memory
  // subsystem, so disabling it loses nothing.
  // CHECKPOINT-DEFAULT-001：checkpoint.enabled 钉为 true——tools.py 清单向用户
  // 宣告 checkpoint/rewind 两个工具，OMP 默认 false 会让工具实际未注册
  // （模型 schema 中不存在、调用必失败），清单与运行时事实不符。git 仓库
  // 上下文里该工具才真正生效（OMP 工具自身按 repo 探测），非 git 项目零副作用。
  createOptions.settings = Settings.isolated({"advisor.enabled": false, "memory.backend": "off", "checkpoint.enabled": true});

  // ── 权限模式 4 档 → OMP approvalMode 3 档真实映射（AG-PERM-001） ──
  // 此前 read_only/ask/operate/auto 只映射成 needsApproval 布尔：operate/auto
  // 与 yolo 完全等效、read_only 只是"每次确认"而非承诺的"拒写"。OMP 原生支持
  // always-ask（读自动、写/执行需确认）/ write（读+写自动、执行需确认）/
  // yolo（全部自动）三档，直接映射即可获得真实语义差异：
  //   read_only → always-ask（写入必须逐次确认，符合"只读优先"承诺）
  //   ask       → always-ask
  //   operate   → write（读+写自动批准，bash/launch 等执行类需确认）
  //   auto      → yolo
  // permission_modes_enabled 关闭时由调用方传 "yolo"（旧行为）。
  const permissionMode = input.permissionMode ?? "ask";
  const approvalMode =
    permissionMode === "operate" ? "write"
    : permissionMode === "auto" ? "yolo"
    : "always-ask"; // read_only / ask / 未知值
  const needsApproval = approvalMode !== "yolo";

  // ── 继承全局运行时配置（AG-COMPACTION-001） ──
  // 此前 yolo 路径 Settings.isolated({advisor,memory}) 是空壳，用户调好的
  // 压缩阈值/重试策略在默认模式（yolo）下完全不生效。统一读取全局配置，
  // always-ask 路径只额外覆盖 approvalMode（旧行为本就如此）。
  const globalPaths = [
    "compaction.enabled", "compaction.strategy", "compaction.thresholdPercent",
    "retry.enabled", "retry.maxRetries", "retry.modelFallback",
    "tools.discoveryMode",
    "steeringMode", "interruptMode", "followUpMode",
    "thinkingBudgets.minimal", "thinkingBudgets.low", "thinkingBudgets.medium",
    "thinkingBudgets.high", "thinkingBudgets.xhigh", "thinkingBudgets.max",
    "skills.enabled", "bash.enabled", "lsp.enabled", "git.enabled",
    "edit.mode", "read.summarize.enabled",
    "todo.enabled", "glob.enabled", "grep.enabled", "browser.enabled",
    "github.enabled", "checkpoint.enabled", "inspect_image.enabled",
    "launch.enabled", "debug.enabled",
    "astGrep.enabled", "astEdit.enabled",
    "web_search.enabled", "ask.enabled",
    // GAP-FEATURE-001：差距分析新增能力透传——计划模式（默认关闭，用户可在
    // 会话菜单手动开启）、网页抓取（read 工具 URL 能力）、模型 fallback 链、
    // 上下文提升（溢出时升级到大上下文模型而非压缩）。
    // 均在 OMP schema 内，未设置时回退 schema 默认值。
    // 注：generate_image 不入列——文生图依赖 provider 图像能力（OpenAI/Gemini/
    // xAI 等均为付费 API），按产品原则（不要求用户额外配置付费 API）砍掉。
    "plan.enabled", "plan.defaultOnStartup",
    "fetch.enabled",
    "retry.fallbackChains",
    "contextPromotion.enabled",
    // "memory.backend" intentionally excluded: mnemopi requires the
    // un-bundled embedding deps (fastembed/onnxruntime). Maxma's own
    // memory lives in its persona memory.yaml, not OMP's memory subsystem.
    "autolearn.enabled",
  ];
  const globalOverrides: Record<string, unknown> = {};
  try {
    const global = await ensureSettings();
    for (const p of globalPaths) {
      // CONFIG-INHERIT-001：只继承"显式配置过"的值。此前直接拷贝
      // global.get(p)——未配置时 get() 返回 schema 默认值（如
      // checkpoint.enabled 默认 false），会把我们想要的非默认值
      // （checkpoint.enabled=true，见 CHECKPOINT-DEFAULT-001）覆盖掉，
      // 导致清单宣告的 checkpoint/rewind 工具实际未注册。isConfigured()
      // 区分"用户显式配置"与"schema 默认值"，未配置时交由下方
      // Settings.isolated 的 schema 默认回退处理（语义不变）。
      try {
        if (global.isConfigured(p as SettingPath)) {
          const v = global.get(p as SettingPath);
          if (v !== undefined) globalOverrides[p] = v;
        }
      } catch { /* skip */ }
    }
  } catch { /* global not available */ }

  // CHECKPOINT-DEFAULT-001：globalOverrides 未显式配置时默认注册
  // checkpoint/rewind 工具（与 tools.py 宣告一致）；用户显式关闭则尊重。
  const checkpointEnabled = globalOverrides["checkpoint.enabled"] ?? true;

  createOptions.autoApprove = !needsApproval;
  if (needsApproval) {
    createOptions.hasUI = true;
    createOptions.settings = Settings.isolated({
      ...globalOverrides,
      "tools.approvalMode": approvalMode,
      "advisor.enabled": false,
      "memory.backend": "off",
      "checkpoint.enabled": checkpointEnabled,
    });
  } else {
    createOptions.settings = Settings.isolated({
      ...globalOverrides,
      "tools.approvalMode": "yolo",
      "advisor.enabled": false,
      "memory.backend": "off",
      "checkpoint.enabled": checkpointEnabled,
    });
  }

  // TEMP-END2END-001：用户设置的采样温度端到端生效（OMP settings.temperature，
  // -1 为 provider 默认）。此前前端发送、后端丢弃、sidecar 不传，控件纯假。
  if (input.temperature !== undefined && Number.isFinite(input.temperature) && input.temperature >= 0) {
    setSetting(createOptions.settings, "temperature", input.temperature);
  }

  const customTools = registerCustomTools();
  if (customTools.length > 0) createOptions.customTools = customTools;

  const configuredMcp = await createMcp(input.cwd, input.authStorage);
  if (configuredMcp) {
    createOptions.mcpManager = configuredMcp.manager;
    // OMP 的 customTools 字段是 ToolDefinition/CustomTool[]，此处把 MCP 工具
    // 并入同一列表，类型在协议边界集中断言。
    type CustomTools = NonNullable<LocalCreateSessionOptions["customTools"]>;
    const existingTools = Array.isArray(createOptions.customTools) ? createOptions.customTools as unknown as CustomTools : [];
    createOptions.customTools = [
      ...existingTools,
      ...filterMcpTools(configuredMcp.tools, configuredMcp.allowBlock, input.tools),
    ] as unknown as CustomTools;
  }

  return {
    options: createOptions,
    needsApproval,
    mcpManager: configuredMcp?.manager,
    mcpConfigs: configuredMcp?.configs,
    mcpAllowBlock: configuredMcp?.allowBlock,
    mcpToolNames: input.tools,
  };
}

/** OMP skips this callback when the manager is supplied by the caller. */
const sessions = bridgeState.sessions;
const rl = createInterface({ input: process.stdin });
let authStoragePromise: ReturnType<typeof discoverAuthStorage> | null = null;
let settingsInitPromise: Promise<Settings> | null = null;

/** Ensure the global Settings singleton is initialized before use. */
async function ensureSettings(): Promise<Settings> {
  if (!settingsInitPromise) {
    settingsInitPromise = Settings.init()
      .then(() => Settings.instance)
      .catch((err) => {
        settingsInitPromise = null; // 重置缓存，允许下次重试
        throw err;
      });
  }
  return settingsInitPromise;
}

// ── Tool approval state ───────────────────────────────────
// Pending approval promises keyed by interaction_id. Resolved by the
// user_response RPC handler when the frontend replies.
const pendingApprovals = bridgeState.pendingApprovals;

const _toolStartTimestamps = bridgeState.toolStartTimestamps;

async function getSharedAuthStorage() {
  if (!authStoragePromise) authStoragePromise = discoverAuthStorage();
  return authStoragePromise;
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

export function subscribeSession(
  sessionId: string,
  session: AgentSession,
  record: SessionRecord,
): () => void {
  return session.subscribe((event: unknown) => {
    // BLOCKER-ENFORCE-001：MaxmaBlocker 拒止锚执行拦截——文件类工具
    // 执行开始时检查参数路径是否命中 .maxma_blocker 标记，命中即
    // error + done + abort（此前拒止锚只有 REST 检查无执行拦截）。
    if ((event as { type?: string })?.type === "tool_execution_start") {
      const toolEvent = event as { toolName?: string; args?: unknown };
      const blocked = checkToolBlocked(toolEvent.toolName ?? "", toolEvent.args);
      if (blocked) {
        const guard = record.currentGuard;
        if (guard && !guard.done) {
          guard.done = true;
        }
        sendEvent(sessionId, {
          type: "error",
          payload: {
            code: "PATH_BLOCKED",
            message: `路径被 MaxmaBlocker 拒止锚保护（${blocked.blockerPath}），已中断工具调用（${blocked.toolPath}）`,
          },
        });
        sendEvent(sessionId, { type: "done", payload: {} });
        try {
          session.agent.abort("MaxmaBlocker path blocked");
        } catch {
          // best-effort abort
        }
        return; // 丢弃被阻断工具的事件
      }
    }
    // 修复 TOOL-LOOP-GUARD-001：按 tool_start 计数，超限终止本轮。
    // OMP 循环无计数上限（仅 600s 墙钟兜底），模型在 tool_error 后反复
    // 调用工具时会产生无界副作用与费用。计数在订阅层（事件实际流经此处）。
    if ((event as { type?: string })?.type === "tool_start") {
      record.toolCallCount += 1;
      if (record.toolCallCount > MAX_TOOL_CALLS_PER_TURN) {
        const guard = record.currentGuard;
        if (guard && !guard.done) {
          guard.done = true;
          sendEvent(sessionId, {
            type: "error",
            payload: {
              code: "TOOL_LOOP_LIMIT",
              message: `工具调用次数超过上限（${MAX_TOOL_CALLS_PER_TURN}），已终止本轮`,
            },
          });
          sendEvent(sessionId, { type: "done", payload: {} });
          try {
            session.agent.abort("Tool loop limit reached");
          } catch {
            // best-effort abort
          }
        }
        return; // 丢弃超限后的多余工具事件
      }
    }
    const mapped = mapPiEventToMaxma(event as Record<string, unknown>, record.currentGuard);
    if (mapped) {
      sendEvent(sessionId, mapped);
    }
  });
}

// ---------------------------------------------------------------------------
// Tool approval UI context
// ---------------------------------------------------------------------------

/**
 * Build a minimal ExtensionUIContext for `setToolUIContext`. Only `select` is
 * real — it emits an `ask_user` event and awaits the matching `user_response`
 * RPC. All other methods are no-ops because the sidecar has no TUI.
 *
 * The oh-my-pi approval wrapper calls
 *   `ctx.select(formatApprovalPrompt(tool, args, reason), ["Approve", "Deny"])`
 * and treats `choice === "Approve"` as approved; anything else (including
 * `undefined` from timeout/throw) is treated as denied.
 */
/**
 * Parse the OMP approval title to extract structured tool input and risk level.
 *
 * OMP formats the title as:
 *   "Allow tool: {toolName}\n\nArgs:\n{jsonArgs}\n\nReason: {reason}"
 *
 * Returns extracted tool_input object and a risk_level estimate.
 */
async function shutdown() {
  for (const [_sid, record] of sessions) {
    try {
      record.unsubscribe();
      await record.session.dispose();
    } catch {
      // best-effort cleanup
    } finally {
      await record.mcpManager?.disconnectAll().catch(() => {});
    }
  }
  sessions.clear();
  rl.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// RPC handler (extracted for testability)
// ---------------------------------------------------------------------------

export const defaultIo: BridgeIo = {
  send,
  sendError,
  sendEvent,
  getSharedAuthStorage: () => getSharedAuthStorage(),
  ensureSettings: () => ensureSettings(),
};

export async function handleRpcRequest(req: RpcRequest, io: BridgeIo = defaultIo): Promise<void> {
  const { method, id } = req;
  // JSON-RPC 协议边界的参数是运行时动态的（未知形状），在此放宽一次类型。
  const params = (req.params ?? {}) as Record<string, any>;
  // 局部别名：handler 体内原有 send/sendError/sendEvent 引用无需改动，
  // 测试时传入自定义 io 即可接管输出。
  const send = io.send;
  const sendError = io.sendError;
  const sendEvent = io.sendEvent;

    try {
      if (method === "create_session") {
        const modelStr: string = params?.model ?? "openai/gpt-4o";
        const provider: string | undefined = params?.provider || undefined;
        const apiKey: string | undefined = params?.api_key || undefined;
        const authStorage = await io.getSharedAuthStorage();
        if (provider && apiKey) authStorage.setRuntimeApiKey(provider, apiKey);
        const model = parseModel(modelStr, {
          provider,
          baseUrl: params?.base_url,
          providerType: params?.provider_type,
          contextWindow: params?.context_window as number | undefined,
        });
        // MAXTOKENS-END2END-001：用户设置的输出上限端到端生效。
        // 前端 max_tokens → chat.py → create_session；覆写 Model.maxTokens
        // （OMP 按模型 maxTokens 发 max_tokens 参数）。此前该设置被忽略。
        const requestedMaxTokens = Number(params?.max_tokens);
        if (Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0) {
          model.maxTokens = Math.min(requestedMaxTokens, 262144);
        }
        const cwd: string = params?.cwd ?? process.cwd();
        const systemPrompt: string | undefined = params?.system_prompt;
        const appendSystemPrompt: string | undefined = params?.append_system_prompt;
        const tools: string[] | undefined = params?.tools as string[] | undefined;
        const permissionMode: string = (params?.permission_mode as string) ?? "ask";
        // THINKING-WIRE-001：思考级别（"off"/"high" 等，来自前端 Thinking 开关）
        const thinkingLevel: string | undefined = params?.thinking_level as string | undefined;
        // TEMP-END2END-001：采样温度（-1 表示 provider 默认，不覆盖）
        const temperature = Number(params?.temperature);

        const { options: createOptions, needsApproval, mcpManager, mcpConfigs, mcpAllowBlock, mcpToolNames } = await buildCreateSessionOptions({
          model,
          cwd,
          authStorage,
          systemPrompt,
          appendSystemPrompt,
          tools: Array.isArray(tools) ? tools : undefined,
          permissionMode,
          thinkingLevel,
          temperature: Number.isFinite(temperature) ? temperature : undefined,
        });

        const sessionId = randomUUID();
        let session: AgentSession;
        let setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
        let eventBus: EventBus | undefined;
        try {
          ({ session, setToolUIContext, eventBus } = await (io.createAgentSession ?? createAgentSession)(createOptions));
        } catch (error) {
          await mcpManager?.disconnectAll().catch(() => {});
          throw error;
        }
        if (mcpManager) wireMcpToolsChanged(session, mcpManager, mcpAllowBlock ?? {}, mcpToolNames);
        if (needsApproval) {
          const approvalCtx = createApprovalUiContext(sessionId);
          // setToolUIContext only writes to ToolContextStore (for tool-level
          // hasUI checks). The approval wrapper checks runner.hasUI() which
          // reads from ExtensionRunner.#uiContext — set via initialize().
          // We call initialize() with stub actions (sidecar has no TUI/commands)
          // purely to install our UI context so hasUI() returns true.
          const runner = session.extensionRunner;
          if (runner) {
            runner.initialize(
              noopExtensionActions(),
              noopExtensionContextActions(),
              undefined,
              approvalCtx,
            );
          }
          if (setToolUIContext) {
            setToolUIContext(approvalCtx, true);
          }
        }

        const record: SessionRecord = {
          session,
          unsubscribe: () => {},
          promptQueue: Promise.resolve(),
          currentGuard: null,
          toolCallCount: 0,
          mcpManager,
          mcpConfigs,
          mcpAllowBlock,
          mcpToolNames,
          settings: session.settings,
        };
        record.unsubscribe = subscribeSession(sessionId, session, record);

        // Phase 3.4: 通过 EventBus 订阅子 Agent 生命周期事件
        // AG-SUBAGENT-001：此前所有 lifecycle 事件一律映射为 sub_session_created，
        // 前端据此 ensureConnected+switchSession 创建"全新空会话"——但真实子
        // Agent 在父会话内部运行，事件不会发到那个空会话（用户看到空白聊天，
        // 无进度、无完成回调，deferred 状态机也永远收不到数据）。现在按状态分流：
        //   started  → sub_session_created（父会话内提示子任务启动）
        //   completed/failed/aborted → deferred_subagent_submitted（带真实状态，
        //     Python deferred_runs 状态机 + 前端 SubAgentCard 轮询展示）
        if (eventBus) {
          record.eventBus = eventBus;
          record.unsubLifecycle = eventBus.on(TASK_SUBAGENT_LIFECYCLE_CHANNEL, (raw: unknown) => {
            const data = raw as { id?: string; description?: string; task?: string; agent?: string; status?: string };
            const subId = data.id ?? "";
            const status = data.status ?? "started";
            if (status === "started") {
              sendEvent(sessionId, {
                type: "sub_session_created",
                payload: {
                  sub_session_id: subId,
                  parent_session_id: sessionId,
                  task: data.description ?? data.task ?? "",
                  name: data.agent ?? "subagent",
                },
              });
            } else {
              sendEvent(sessionId, {
                type: "deferred_subagent_submitted",
                payload: {
                  run_id: subId,
                  parent_session_id: sessionId,
                  status, // completed / failed / aborted
                  task: data.description ?? data.task ?? "",
                  name: data.agent ?? "subagent",
                },
              });
            }
          });
        }

        sessions.set(sessionId, record);

        send(id, { session_id: sessionId });
        return;
      }

      if (method === "prompt") {
        const sessionId: string = params?.session_id;
        const message: string = params?.message ?? "";
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        // Serialize: chain onto the previous prompt so they run sequentially.
        // A failed prompt does not block the next one (.catch resets the chain).
        // orchestratePrompt guarantees the `done` event is emitted exactly once
        // on every path (natural agent_end, error, abort, or 600s timeout).
        record.promptQueue = record.promptQueue
          .catch(() => {})
          .then(async () => {
            const guard = createDoneGuard();
            record.currentGuard = guard;
            record.toolCallCount = 0;  // TOOL-LOOP-GUARD-001：每轮重置计数
            try {
              await orchestratePrompt(
                record.session,
                message,
                guard,
                (e) => sendEvent(sessionId, e),
              );
            } finally {
              if (record.currentGuard === guard) {
                record.currentGuard = null;
              }
            }
          })
          // 链尾兜底：若无后续 prompt 重置链，此处 rejection 即 unhandled
          // rejection → Bun 默认 exit(1)，sidecar 进程中途退出。catch 后
          // 链保持 resolved，错误已由 orchestratePrompt 的 done 机制上报。
          .catch((err) => {
            console.error("[prompt] unhandled error in promptQueue:", err);
          });

        send(id, { ok: true });
        return;
      }

      if (method === "cancel") {
        const sessionId: string = params?.session_id;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        // 修复 CANCEL-SCOPE-001：改用 AgentSession.abort 而非底层 agent.abort。
        // 底层 abort 只打断当前 run，无法打断 retry 退避睡眠、排队中的 prompt
        // 与审批等待——cancel 后工具仍可能被继续执行（重复副作用）。
        // AgentSession.abort 会 abortRetry + abortCompaction + abortBash 并清
        // post-prompt 任务；goalReason=interrupted 使其带用户中断语义。
        try {
          await record.session.abort({ goalReason: "interrupted", reason: "Interrupted by user" });
        } catch {
          // 兜底：session.abort 不可用时退回底层 abort
          record.session.agent.abort("Cancelled by user");
        }
        // The active prompt's finally block would also emit done via the guard,
        // but we mark + emit here so cancel is resolved promptly even if the
        // abort does not propagate synchronously.
        handleCancelGuard(record.currentGuard, (e) => sendEvent(sessionId, e));

        send(id, { ok: true });
        return;
      }

      if (method === "destroy_session") {
        const sessionId: string = params?.session_id;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        record.unsubscribe();
        record.unsubLifecycle?.();  // Phase 3.4: clean up EventBus lifecycle subscription
        try {
          await record.session.dispose();
        } finally {
          await record.mcpManager?.disconnectAll().catch(() => {});
          sessions.delete(sessionId);
        }
        // Pending approvals are keyed by interaction_id (not session-scoped),
        // so the 5min timeout handles any orphaned promises.

        send(id, { ok: true });
        return;
      }

      if (method === "get_health") {
        // UX-HEALTH-001：probe=true 时做真实可用性探测（此前忽略 probe 直接
        // 返回 ok，模型/provider 挂了前端永远显示"就绪"）。探测内容：
        // 默认模型对应的 provider 是否已配置 API key（零配额消耗）。
        const probe = params?.probe === true;
        if (!probe) {
          send(id, { status: "ok", message: "sidecar running" });
          return;
        }
        try {
          const authStorage = await io.getSharedAuthStorage();
          const defaultModel = process.env.MAXMA_DEFAULT_MODEL ?? "";
          const slashIdx = defaultModel.indexOf("/");
          const provider = slashIdx >= 0 ? defaultModel.slice(0, slashIdx) : "";
          let status = "ok";
          let message = `sidecar running (${sessions.size} sessions)`;
          if (provider) {
            const key = await Promise.race([
              authStorage.getApiKey(provider).catch(() => undefined),
              new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000)),
            ]);
            if (!key) {
              status = "degraded";
              message = `Provider ${provider} 未配置 API key`;
            }
          }
          send(id, { status, message, sessions: sessions.size });
        } catch (err) {
          send(id, { status: "error", message: `Health probe failed: ${String(err)}` });
        }
        return;
      }

      if (method === "reload_mcp") {
        const sessionId: string = params?.session_id;
        if (!sessions.has(sessionId)) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }
        // The Python API currently returns 409 for reload because it cannot
        // identify every live sidecar session. Keep this RPC explicit rather
        // than claiming a YAML write refreshed existing sessions.
        send(id, mcpReloadUnsupportedResponse());
        return;
      }

      if (method === "undo") {
        const sessionId: string = params?.session_id as string;
        const steps: number = (params?.steps as number) ?? 1;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        // Walk backwards counting complete `user → assistant` turns.
        // An assistant turn may include trailing `tool`/`function` messages,
        // so a turn boundary is the position just before a `user` message
        // that itself follows a complete assistant turn. We cut at the
        // boundary that drops exactly `steps` user-initiated turns without
        // leaving dangling tool_call/tool_result pairs.
        const messages = record.session.state.messages;
        const originalLen = messages.length;
        // BC-002: mirror compact's hasLeadingSystem preservation. A leading
        // system message must always survive an undo; replaceMessages([])
        // must never be called (silent state wipe).
        const { cutIndex, turnsRemoved, canUndo } = computeUndoTurnCut(messages, steps);
        // No-op when (a) we couldn't find `steps` user turns to remove, or
        // (b) the cut would land at/before index 0 with no leading system
        // message to keep — both cases previously produced
        // replaceMessages([]), silently wiping all conversation state.
        if (!canUndo) {
          send(id, { removed: 0, turns_removed: 0, detail: "no turns to undo" });
          return;
        }
        const remaining = messages.slice(0, cutIndex);
        const removed = originalLen - remaining.length;
        try {
          record.session.agent.replaceMessages(remaining);
        } catch (err) {
          sendError(id, `undo failed: ${err}`);
          return;
        }
        send(id, { removed, turns_removed: turnsRemoved });
        return;
      }

      if (method === "compact") {
        const sessionId: string = params?.session_id as string;
        const keepLast: number = (params?.keep_last as number) ?? 20;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        // Compact: truncate message history to the last `keepLast` entries,
        // always preserving a leading system message if present. The LLM
        // provider APIs require the first message to be `system` (when
        // present), so we keep it regardless of `keepLast`.
        const messages = record.session.state.messages;
        const originalLen = messages.length;
        const { remaining, removed } = compactMessages(messages, keepLast);
        if (removed > 0) {
          try {
            record.session.agent.replaceMessages(remaining);
          } catch (err) {
            sendError(id, `compact failed: ${err}`);
            return;
          }
        }
        send(id, {
          compressed: removed > 0,
          removed_count: removed,
          detail: removed > 0 ? "压缩完成" : "无需压缩",
        });
        return;
      }

      if (method === "get_messages") {
        const sessionId: string = params?.session_id as string;
        const limit: number = (params?.limit as number) ?? 50;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        const messages = record.session.state.messages;
        const total = messages.length;
        // A4: limit<=0 应返回空（探活语义）。slice(-0)===slice(0) 会返回全量，
        // 后端用 limit=0 探活时每次搬运整段历史，与零成本探活意图相悖。
        const sliced = limit <= 0 ? [] : messages.slice(-Math.min(limit, total));
        const result = sliced.map((m: { role?: string; content?: unknown }) => {
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
        send(id, { messages: result, total });
        return;
      }

      if (method === "user_response") {
        const interactionId: string = params?.interaction_id;
        const response: string | string[] = params?.response;
        const pending = pendingApprovals.get(interactionId);
        if (!pending) {
          // Stale or unknown — respond ok so the frontend doesn't hang.
          send(id, { ok: true });
          return;
        }
        pendingApprovals.delete(interactionId);
        // Frontend sends "yes" (approve) / "no" (deny). Map to the choice the
        // oh-my-pi wrapper expects: "Approve" / anything-else-as-deny.
        const choice = response === "yes" ? "Approve" : "Deny";
        pending.resolve(choice);
        send(id, { ok: true });
        return;
      }

      // ── Runtime Auto-Approve ──────────────────────────────
      if (method === "set_auto_approve") {
        const sessionId: string = params?.session_id as string;
        const autoApprove: boolean = params?.auto_approve === true;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }
        try {
          // 修复 APPROVAL-UI-MISSING-001：yolo 会话切到 always-ask 前必须安装
          // approval UI。此前 yolo 会话从未调用 runner.initialize/setToolUIContext，
          // 切回询问模式后 OMP 审批 wrapper 检查 runner.hasUI()=false 直接 throw
          // → 写类工具一律 tool_error，用户永远看不到审批弹窗。
          if (!autoApprove) {
            const runner = record.session.extensionRunner;
            if (runner && !runner.hasUI()) {
              runner.initialize(
                noopExtensionActions(),
                noopExtensionContextActions(),
                undefined,
                createApprovalUiContext(sessionId),
              );
              console.info(`[auto_approve] Session ${sessionId.slice(0, 8)}: approval UI installed on switch to ask mode`);
            }
          }
          setSetting(record.settings!, "tools.approvalMode", autoApprove ? "yolo" : "always-ask");
          console.error(`[auto_approve] Session ${sessionId.slice(0, 8)} approvalMode set to ${autoApprove ? "yolo" : "always-ask"}`);
          send(id, { ok: true });
        } catch (err) {
          sendError(id, `Failed to set auto_approve: ${String(err)}`);
        }
        return;
      }

      // ── Plan Action ────────────────────────────────────────
      if (method === "plan_action") {
        const sessionId: string = params?.session_id as string;
        const action: string = params?.action as string;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }
        try {
          const planId: string = (params?.plan_id as string) ?? "";
          const modifiedPlan: string | undefined = params?.modified_plan as string | undefined;
          if (action === "approve") {
            setSetting(record.settings!, "plan.enabled", true);
            console.error(`[plan] Session ${sessionId.slice(0, 8)} plan approved (plan_id=${planId})`);
            // Inject approved plan context into the agent's next turn
            if (modifiedPlan) {
              // Append the approved plan as a system context message
              // The agent will pick it up on the next prompt
              const msg = {
                role: "user" as const,
                content: `[Plan Approved]\nThe following plan has been approved. Execute it step by step:\n\n${modifiedPlan}`,
                timestamp: Date.now(),
              };
              record.session.agent.appendMessage(msg);
            } else {
              const msg = {
                role: "user" as const,
                content: "[Plan Approved]\nThe plan has been approved. Please proceed with execution.",
                timestamp: Date.now(),
              };
              record.session.agent.appendMessage(msg);
            }
          } else if (action === "reject") {
            console.error(`[plan] Session ${sessionId.slice(0, 8)} plan rejected (plan_id=${planId})`);
            const msg = {
              role: "user" as const,
              content: "[Plan Rejected]\nThe proposed plan has been rejected. Please revise your approach.",
              timestamp: Date.now(),
            };
            record.session.agent.appendMessage(msg);
          } else if (action === "modify") {
            console.error(`[plan] Session ${sessionId.slice(0, 8)} plan modified (plan_id=${planId})`);
            if (modifiedPlan) {
              const msg = {
                role: "user" as const,
                content: `[Plan Modified]\nThe plan has been modified. Please execute the revised plan:\n\n${modifiedPlan}`,
                timestamp: Date.now(),
              };
              record.session.agent.appendMessage(msg);
            }
          }
          send(id, { ok: true });
        } catch (err) {
          sendError(id, `Failed to handle plan_action: ${String(err)}`);
        }
        return;
      }

      // ── Plan Mode Toggle (GAP-A6：计划模式开关) ──────────────────────
      // 与 plan_action（审批已产出的计划）不同，本 RPC 是用户显式切换会话
      // 的"计划模式"状态。启用 = OMP CLI /plan 命令等价物：
      //   setPlanModeState({enabled, planFilePath, workflow}) 让会话进入
      //   只读规划态（后续轮次先产出计划再执行，计划事件照常流入 plan_* 通道）；
      //   ensureActiveTool("resolve") 是 plan mode 提交计划所需工具，缺失时
      //   计划永远无法进入审批（OMP CLI 进入 plan mode 时同样补 resolve/write）。
      // 停用 = setPlanModeState(undefined)（与 CLI /plan 再次切换一致）。
      if (method === "set_plan_mode") {
        const sessionId: string = params?.session_id as string;
        const enabled: boolean = params?.enabled === true;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }
        try {
          const session = record.session;
          if (enabled) {
            setSetting(record.settings!, "plan.enabled", true);
            const active = session.getActiveToolNames();
            if (!active.includes("resolve")) {
              await session.setActiveToolsByName([...new Set([...active, "resolve"])]);
            }
            session.setPlanModeState({
              enabled: true,
              planFilePath: "local://PLAN.md",
              workflow: "parallel",
            });
            // 会话空闲时立即下发 plan-mode 上下文（流式中由 OMP 自行处理）
            if (typeof session.sendPlanModeContext === "function" && !session.isStreaming) {
              session.sendPlanModeContext({ deliverAs: "steer" }).catch(() => {});
            }
          } else {
            session.setPlanModeState(undefined);
          }
          send(id, { ok: true, enabled });
        } catch (err) {
          sendError(id, `Failed to set plan mode: ${String(err)}`);
        }
        return;
      }

      // ── Checkpoint Action (GAP-A7：检查点/回退用户入口) ──────────────
      // checkpoint/rewind 是 agent 工具，无直接 session API；以显式指令消息
      // 追加到会话（与 plan_action 注入 [Plan Approved] 同机制），下一轮
      // prompt 时 agent 会调用 checkpoint({goal}) / rewind({report})。
      // git 仓库上下文外工具自身探测后不生效（OMP 工具级行为，零副作用）。
      if (method === "checkpoint_action") {
        const sessionId: string = params?.session_id as string;
        const action: string = params?.action as string; // "save" | "restore"
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }
        try {
          const goal: string = (params?.goal as string) ?? "user-requested checkpoint";
          const content = action === "restore"
            ? "[Rewind Request]\nThe user asked to restore the most recent checkpoint. Use the rewind tool (report: user-requested restore) and confirm what was rewound."
            : `[Checkpoint Request]\nThe user asked to save a checkpoint of the current conversation state. Use the checkpoint tool (goal: ${goal}) and confirm the checkpoint was created.`;
          record.session.agent.appendMessage({
            role: "user",
            content,
            timestamp: Date.now(),
          });
          send(id, { ok: true, action });
        } catch (err) {
          sendError(id, `Failed to enqueue checkpoint action: ${String(err)}`);
        }
        return;
      }

      // ── MCP Reload for Session ─────────────────────────────
      if (method === "reload_mcp_for_session") {
        const sessionId: string = params?.session_id as string;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }
        try {
          const loaded = loadConfiguredMcp();
          if (!loaded || Object.keys(loaded.configs).length === 0) {
            send(id, { status: "noop", detail: "No MCP configuration found" });
            return;
          }
          // Disconnect old MCP if any
          if (record.mcpManager) {
            await record.mcpManager.disconnectAll().catch(() => {});
          }
          // Create new MCP manager and connect
          const cwd = process.env.MAXMA_PROJECT_ROOT ?? process.cwd();
          const newManager = new MCPManager(cwd);
          const authStorage = await io.getSharedAuthStorage();
          newManager.setAuthStorage(authStorage);
          const sourcePath = mcpConfigPath();
          const sources = Object.fromEntries(Object.keys(loaded.configs).map((name) => [name, {
            provider: "maxma",
            providerName: "Maxma MCP configuration",
            path: sourcePath,
            level: "project" as const,
          }]));
          const result = await newManager.connectServers(loaded.configs, sources);
          for (const [name, message] of result.errors) {
            console.error(`[mcp] ${name}: ${message}`);
          }
          const filteredTools = filterMcpTools(result.tools, loaded.allowBlock, record.mcpToolNames);
          // Update session with new MCP tools
          await record.session.refreshMCPTools(filteredTools as unknown as Parameters<AgentSession["refreshMCPTools"]>[0]);
          // Wire tools changed callback
          wireMcpToolsChanged(record.session, newManager, loaded.allowBlock, record.mcpToolNames);
          // Update record
          record.mcpManager = newManager;
          record.mcpConfigs = loaded.configs;
          record.mcpAllowBlock = loaded.allowBlock;
          console.error(`[mcp] Session ${sessionId.slice(0, 8)} MCP reloaded: ${Object.keys(loaded.configs).length} server(s), ${filteredTools.length} tool(s)`);
          send(id, { status: "reloaded", server_count: Object.keys(loaded.configs).length, tool_count: filteredTools.length });
        } catch (err) {
          sendError(id, `Failed to reload MCP: ${String(err)}`);
        }
        return;
      }

      // ── Execute Workflow Step ─────────────────────────────
      if (method === "execute_workflow_step") {
        const sessionId: string = params?.session_id as string;
        const stepDefinition: Record<string, unknown> = params?.step_definition as Record<string, unknown>;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }
        try {
          const toolName: string = (stepDefinition?.tool as string) ?? "";
          const toolArgs: Record<string, unknown> = (stepDefinition?.args as Record<string, unknown>) ?? {};
          const stepId: string = (stepDefinition?.step_id as string) ?? "unknown";
          // Emit step start event
          sendEvent(sessionId, {
            type: "workflow_step_start",
            payload: { step_id: stepId, tool_name: toolName },
          });
          // Execute the step via the agent
          const promptMsg = `Execute the following step:\nTool: ${toolName}\nArgs: ${JSON.stringify(toolArgs)}\n\nReturn the result.`;
          await record.session.prompt(promptMsg);
          // Emit step end event
          sendEvent(sessionId, {
            type: "workflow_step_end",
            payload: { step_id: stepId, tool_name: toolName, status: "done" },
          });
          send(id, { ok: true, step_id: stepId });
        } catch (err) {
          sendEvent(sessionId, {
            type: "workflow_step_error",
            payload: { step_id: (stepDefinition?.step_id as string) ?? "unknown", error: String(err) },
          });
          sendError(id, `Workflow step failed: ${String(err)}`);
        }
        return;
      }

      // ── Settings RPC ──────────────────────────────────────

      if (method === "get_settings") {
        const targetSessionId: string | undefined = params?.session_id;
        const record = targetSessionId ? sessions.get(targetSessionId) : undefined;
        const settings = record?.settings ?? await io.ensureSettings();
        const paths: string[] = params?.paths ?? [];
        const result: Record<string, unknown> = {};
        for (const p of paths) {
          try { result[p] = settings.get(p as SettingPath); } catch { /* skip invalid path */ }
        }
        send(id, { settings: result });
        return;
      }

      if (method === "set_settings") {
        const targetSessionId: string | undefined = params?.session_id;
        const record = targetSessionId ? sessions.get(targetSessionId) : undefined;
        const settings = record?.settings ?? await io.ensureSettings();
        const settingPath: string = params?.path;
        const value: unknown = params?.value;
        if (!settingPath) {
          sendError(id, "Missing required parameter: path");
          return;
        }
        try {
          setSetting(settings, settingPath, value);
          send(id, { ok: true });
        } catch (err) {
          sendError(id, `Failed to set setting: ${String(err)}`);
        }
        return;
      }

      // ── Capabilities RPC ──────────────────────────────────────

      if (method === "get_discovered_mcp") {
        // Return MCP server info from all active sessions
        const discovered: Array<{ name: string; transport: string; tool_count: number; status: string }> = [];
        for (const [sid, record] of sessions) {
          if (record.mcpConfigs) {
            for (const [name, cfg] of Object.entries(record.mcpConfigs)) {
              discovered.push({
                name,
                transport: (cfg as { type?: string }).type ?? "unknown",
                tool_count: record.mcpToolNames?.length ?? 0,
                status: "connected",
              });
            }
          }
        }
        send(id, discovered);
        return;
      }

      if (method === "get_discovered_skills") {
        try {
          const skills = await loadDiscoveredSkills();
          send(id, skills.map((s: OmpSkillEntry) => ({
            name: s.name ?? "unknown",
            description: s.description ?? "",
            source: s.source ?? "auto",
          })));
        } catch {
          send(id, []);
        }
        return;
      }

      if (method === "get_discovered_extensions") {
        try {
          const { discoverExtensions } = await import("@oh-my-pi/pi-coding-agent");
          const result = await discoverExtensions();
          send(id, { loaded: (result as { loaded?: number }).loaded ?? 0, extensions: [] });
        } catch {
          send(id, { loaded: 0, extensions: [] });
        }
        return;
      }

      // ── Plugin RPC ──────────────────────────────────────────

      if (method === "list_plugins") {
        try {
          const pm = await loadPluginManager();
          const list = await pm.list();
          send(id, list.map((p: OmpPluginInfo) => ({
            name: p.name ?? "",
            version: p.version ?? "",
            description: p.description ?? "",
            enabled: p.enabled !== false,
            features: p.features ?? [],
            homepage: p.homepage ?? "",
          })));
        } catch {
          send(id, []);
        }
        return;
      }

      if (method === "install_plugin") {
        try {
          const spec: string = params?.spec ?? "";
          if (!spec) { sendError(id, "Missing required parameter: spec"); return; }
          const pm = await loadPluginManager();
          const result = await pm.install(spec);
          send(id, { ok: true, plugin: result ?? null });
        } catch (e: unknown) {
          sendError(id, `Install failed: ${(e as Error)?.message ?? String(e)}`);
        }
        return;
      }

      if (method === "uninstall_plugin") {
        try {
          const name: string = params?.name ?? "";
          if (!name) { sendError(id, "Missing required parameter: name"); return; }
          const pm = await loadPluginManager();
          await pm.uninstall(name);
          send(id, { ok: true });
        } catch (e: unknown) {
          sendError(id, `Uninstall failed: ${(e as Error)?.message ?? String(e)}`);
        }
        return;
      }

      if (method === "set_plugin_enabled") {
        try {
          const name: string = params?.name ?? "";
          const enabled: boolean = params?.enabled !== false;
          if (!name) { sendError(id, "Missing required parameter: name"); return; }
          const pm = await loadPluginManager();
          await pm.setEnabled(name, enabled);
          send(id, { ok: true });
        } catch (e: unknown) {
          sendError(id, `Failed to toggle plugin: ${(e as Error)?.message ?? String(e)}`);
        }
        return;
      }

      if (method === "get_plugin_detail") {
        try {
          const name: string = params?.name ?? "";
          if (!name) { sendError(id, "Missing required parameter: name"); return; }
          const pm = await loadPluginManager();
          const list = await pm.list();
          const plugin = list.find((p: OmpPluginInfo) => p.name === name);
          if (!plugin) { sendError(id, `Plugin not found: ${name}`); return; }
          send(id, {
            name: plugin.name ?? "",
            version: plugin.version ?? "",
            description: plugin.description ?? "",
            enabled: plugin.enabled !== false,
            features: plugin.features ?? [],
            homepage: plugin.homepage ?? "",
            author: plugin.author ?? "",
            repository: plugin.repository ?? "",
            tags: plugin.tags ?? [],
            category: plugin.category ?? "other",
            license: plugin.license ?? "",
            installed_at: plugin.installed_at ?? "",
            last_updated: plugin.last_updated ?? "",
            readme: plugin.readme ?? "",
            config_schema: plugin.config_schema ?? null,
          });
        } catch (e: unknown) {
          sendError(id, `Failed to get plugin detail: ${(e as Error)?.message ?? String(e)}`);
        }
        return;
      }

      // Plugin config path: ~/.maxma/plugins_config.json
      const pluginsConfigPath = path.join(
        process.env.HOME || process.env.USERPROFILE || ".",
        ".maxma",
        "plugins_config.json",
      );

      if (method === "get_plugin_config") {
        try {
          const name: string = params?.name ?? "";
          if (!name) { sendError(id, "Missing required parameter: name"); return; }
          let config: Record<string, any> = {};
          try {
            const raw = fs.readFileSync(pluginsConfigPath, "utf-8");
            const all = JSON.parse(raw);
            config = all[name] ?? {};
          } catch {}
          send(id, { config });
        } catch (e: unknown) {
          sendError(id, `Failed to get plugin config: ${(e as Error)?.message ?? String(e)}`);
        }
        return;
      }

      if (method === "update_plugin_config") {
        try {
          const name: string = params?.name ?? "";
          const config: Record<string, any> = params?.config ?? {};
          if (!name) { sendError(id, "Missing required parameter: name"); return; }
          const dir = path.dirname(pluginsConfigPath);
          fs.mkdirSync(dir, { recursive: true });
          let all: Record<string, any> = {};
          try {
            const raw = fs.readFileSync(pluginsConfigPath, "utf-8");
            all = JSON.parse(raw);
          } catch {}
          all[name] = config;
          fs.writeFileSync(pluginsConfigPath, JSON.stringify(all, null, 2), "utf-8");
          send(id, { ok: true });
        } catch (e: unknown) {
          sendError(id, `Failed to update plugin config: ${(e as Error)?.message ?? String(e)}`);
        }
        return;
      }

      if (method === "headless_prompt") {
        try {
          const message: string = params?.message ?? "";
          if (!message) { sendError(id, "Missing required parameter: message"); return; }
          const maxTokens = Number(params?.max_tokens);
          const createSessionFn = io.createAgentSession
            ?? (await import("@oh-my-pi/pi-coding-agent")).createAgentSession;
          // 修复 HEADLESS-LEAK-001：错误路径必须清理订阅与 session。
          // 此前 session.prompt/waitForIdle 抛错时 unsub/dispose 被跳过，
          // AgentSession（EventBus/磁盘 session 文件）泄漏；且 headless 不走
          // orchestratePrompt 无 600s 超时——automation 调度下泄漏会累积。
          // HEADLESS-TIMEOUT-001：显式 300s 超时 + abort，模型挂起时 RPC
          // 不再无限挂起（调用方 120s 兜底期间自动化任务一直显示"运行中"）。
          const { session } = await createSessionFn({
            hasUI: false,
            autoApprove: true,
            model: params?.model ?? process.env.MAXMA_DEFAULT_MODEL,
            authStorage: params?.authStorage ?? await io.getSharedAuthStorage(),
            ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {}),
          });
          let answer = "";
          const unsub = session.subscribe((raw: unknown) => {
            const event = raw as { type?: string; payload?: { content?: string }; content?: string };
            if (event.type === "answer") {
              answer = event.payload?.content ?? event.content ?? answer;
            }
          });
          const TIMEOUT_MS = 300_000;
          const timeout = new Promise<never>((_, reject) => {
            const t = setTimeout(() => {
              reject(new Error(`Headless prompt timed out after ${TIMEOUT_MS / 1000}s`));
            }, TIMEOUT_MS);
            (t as unknown as { unref?: () => void }).unref?.();
          });
          try {
            await Promise.race([
              (async () => {
                await session.prompt(message);
                await session.waitForIdle();
              })(),
              timeout,
            ]);
          } finally {
            unsub();
            await session.dispose().catch(() => {});
          }
          send(id, { answer, status: "completed" });
        } catch (e: unknown) {
          sendError(id, `Headless prompt failed: ${(e as Error)?.message ?? String(e)}`);
        }
        return;
      }

      sendError(id, `Unknown method: ${method}`);
    } catch (err) {
      sendError(id, String(err));
    }
}

// bun build --compile 下 import.meta.main 恒为 false(入口被 oh-my-pi 模块图间接引用)。
// 开发模式(bun run)仍以 import.meta.main 判定;编译模式由 MAXMA_SIDECAR_COMPILED 注入。
if (import.meta.main || process.env.MAXMA_SIDECAR_COMPILED === "1") {
  rl.on("line", async (line: string) => {
    let req: RpcRequest;
    try {
      req = JSON.parse(line) as RpcRequest;
    } catch {
      sendError(null, "Parse error");
      return;
    }
    try {
      await handleRpcRequest(req);
    } catch (err) {
      sendError(req?.id ?? null, String(err));
    }
  });

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
