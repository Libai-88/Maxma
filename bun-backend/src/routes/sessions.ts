/**
 * routes/sessions.ts — 会话 REST 门面（api/routes/sessions.py 的 Bun 直译，
 * 阶段二 2.2e）。
 *
 * 架构差异（与 Python 版的本质区别）：Python 层通过 pi_bridge 跨进程调
 * sidecar；Bun 后端 **in-process 直调 kernel**（handlePiCreateSession /
 * handlePiSessionRpc），无 JSON-RPC 管道、无 SessionMap 映射层——
 * pi 会话的 JSONL 持久化取代 SessionMap 角色。
 *
 * 契约保持：端点路径与响应形状逐字段对齐 Python 版（含 role 映射
 * user→human / assistant→ai、source:"sidecar" 标记、审计记录）。
 */

import { Hono } from "hono";

import {
  handlePiCreateSession,
  handlePiSessionRpc,
  type PiBridgeIo,
  type PiSessionRecord,
  type PiPendingPlan,
} from "../../../bun-sidecar/src/kernel/bridge-pi";
import type { MaxmaPermissionMode } from "../../../bun-sidecar/src/kernel/types";
import { MAXMA_PERMISSION_MODES } from "../../../bun-sidecar/src/kernel/pi-contract";
import { handleDeletePersistedSession, handleListPersistedSessions } from "../../../bun-sidecar/src/kernel/session-catalog-rpc";
import { normalizeSessionId } from "../../../bun-sidecar/src/kernel/session-catalog";

import { engineSettingsForNewSession, getSettingValue } from "../settings-global";

/** Bun 后端的会话注册表（kernel 桥经 deps 注入）。 */
export interface SessionHub {
  io: PiBridgeIo;
  sessions: Map<string, PiSessionRecord>;
  pendingPlans: Map<string, PiPendingPlan>;
}

export interface SessionsDeps {
  hub: SessionHub;
  /** 审计记录回调（对齐 Python _audit_record，写入共享 audit_log.json）。 */
  audit?: (type: string, target: string, targetId: string, detail: string) => void;
  version: string;
}

const ROLE_MAP: Record<string, string> = { user: "human", assistant: "ai" };

/**
 * 档位清单**不在这里声明**：单源是 `bun-sidecar/src/kernel/pi-contract.ts` 的
 * `MAXMA_PERMISSION_MODES`，本路由运行时 import 它（先例：
 * `routes/capabilities.ts:29` 同样跨 workspace 取 kernel 常量，不属
 * `@earendil-works/*`，无需 `engine-boundary.test.ts` 的 allowlist 登记）。
 * 以前这里另抄一份、`bridge-pi.ts` 再抄一份（模块私有未导出，REST 面拿不到），
 * 四处副本靠对账测试兜着；现在 kernel 校验、REST 返回、类型三者同源，
 * "REST 说可用而 kernel 判非法"这类漂移在源码层就不可能出现。
 * 顺序即 UI 展示顺序（限制由强到弱），前端 `web/src/components/chat/PermissionModeControl.tsx` 按它渲染。
 *
 * GET/PUT 共用的响应形状。字段名即前后端契约：`available_permission_modes`
 * 非空 = 该会话可用权限模式，前端据此决定控件是否可交互、并逐项渲染选项。
 * 没有 feature flag——四档在 kernel 里恒生效（见 dev_docs/permission-modes.md），
 * 所以不再返回那个恒为 true 的 `enabled`，也不 reintroduce 布尔开关。
 */
function permissionModeView(sessionId: string, mode: MaxmaPermissionMode) {
  return {
    session_id: sessionId,
    permission_mode: mode,
    // 展开一份：清单本身是模块级 readonly 常量，不许把它的可变副本交给调用方。
    available_permission_modes: [...MAXMA_PERMISSION_MODES],
  };
}

/** RPC 调用 helper：kernel 的 io 回调 → Promise 结果（单请求作用域）。 */
function callRpc<T>(
  deps: SessionsDeps,
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const io: PiBridgeIo = {
      send: (id, result) => resolve({ ok: true, result: result as T }),
      sendError: (_id, message) => resolve({ ok: false, error: message }),
      sendEvent: (sessionId, event) => deps.hub.io.sendEvent(sessionId, event),
    };
    const sid = params.session_id as string | undefined;
    if (method === "list_sessions") {
      handleListPersistedSessions({ io }, params, 0);
      return;
    }
    if (method === "delete_persisted_session") {
      handleDeletePersistedSession({ io }, params, 0);
      return;
    }
    if (method === "create_session") {
      void handlePiCreateSession({ io, sessions: deps.hub.sessions, pendingPlans: deps.hub.pendingPlans }, params, 0);
      return;
    }
    if (sid && deps.hub.sessions.has(sid)) {
      void handlePiSessionRpc({ io, sessions: deps.hub.sessions, pendingPlans: deps.hub.pendingPlans }, method, sid, params, 0);
      return;
    }
    resolve({ ok: false, error: `Session not found: ${sid ?? "(missing)"}` });
  });
}

import { getPanel } from "./settings-panels";
export function createSessionsRoutes(deps: SessionsDeps): Hono {
  const app = new Hono();

  /**
   * create_session 的统一出口：新会话与恢复会话的参数面只差 `resume_session_id`，
   * 复制两份必然漂移（skills/subagent/settings 任何一处改动都要记得改两遍）。
   */
  async function createSessionViaKernel(extra: Record<string, unknown> = {}) {
    const skillsEnabled = getSettingValue("skills.enabled") !== false;
    const subagentPanel = getPanel("sub_agents") as Record<string, unknown>;
    return callRpc<{ session_id: string; resumed?: boolean }>(deps, "create_session", {
      skills_enabled: skillsEnabled,
      settings: engineSettingsForNewSession(),
      subagent: {
        enabled: subagentPanel.enabled === true,
        max_concurrent: Number(subagentPanel.max_concurrent ?? 4),
        timeout_seconds: Number(subagentPanel.timeout_seconds ?? 300),
      },
      ...extra,
    });
  }

  // ── 创建 ──
  app.post("/api/sessions", async (c) => {
    // 让 kernel 使用 Maxma 项目根目录；bun-backend 的 cwd 通常是子目录。
    // skills.enabled 走应用层参数（显式覆盖优先，缺省视为开启）；其余"归引擎消费"
    // 的显式改动经 settings 下发，由 kernel 在新会话上 applyOverrides。
    // 见 bun-backend/src/settings-global.ts 头注释——旧实现在这里直接读那个
    // in-memory 单例，所以面板改了也不生效。
    // 子 Agent：pi SDK 的进程内会话（kernel/subagent.ts）。开关与并发/超时来自
    // 设置面板（panel_configs.json 的 sub_agents），在会话创建时随工具一起装配——
    // 面板改完对新会话生效，与「归引擎消费」的设置同一套时序。
    const created = await createSessionViaKernel();
    if (!created.ok) return c.json({ detail: created.error }, 500);
    const record = deps.hub.sessions.get(created.result.session_id);
    return c.json({
      session_id: created.result.session_id,
      created_at: new Date().toISOString(),
      engine: record?.engine ?? "pi",
    });
  });

  // ── 历史（磁盘）──
  /**
   * 重启后内存会话表清空，但 pi 的 JSONL 还在磁盘上。这里列出"可见的历史"，
   * 并标记哪些已经在本进程里活着——前端把两份合并成一个列表。
   * 只读、只列 pi 官方 session 目录：不扫任意路径，`file` 字段也不外泄。
   */
  app.get("/api/sessions/history", async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw !== undefined ? Number(limitRaw) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return c.json({ detail: "limit 必须在 1-200 之间" }, 400);
    }
    const result = await callRpc<{ sessions: Array<{ session_id: string } & Record<string, unknown>> }>(
      deps,
      "list_sessions",
      { limit },
    );
    if (!result.ok) return c.json({ detail: result.error }, 502);
    const live = deps.hub.sessions;
    return c.json({
      sessions: result.result.sessions.map((session) => ({
        ...session,
        active: live.has(session.session_id),
      })),
    });
  });

  // ── 恢复 ──
  /**
   * 把磁盘历史会话接回内核，id 沿用原 id（前端缓存/WS 都以 id 为键）。
   * 已在 hub 中的会话直接返回成功——UI 的"点击历史会话"可能手抖点两次。
   */
  app.post("/api/sessions/:sessionId/resume", async (c) => {
    const sid = normalizeSessionId(c.req.param("sessionId"));
    if (!sid) return c.json({ detail: "会话 id 必须是 32 位十六进制" }, 400);
    if (deps.hub.sessions.has(sid)) {
      return c.json({ session_id: sid, resumed: true, active: true });
    }
    const result = await createSessionViaKernel({ session_id: sid, resume_session_id: sid });
    if (!result.ok) {
      const notFound = result.error.includes("Persisted session not found");
      return c.json({ detail: "历史会话不存在或已损坏" }, notFound ? 404 : 500);
    }
    deps.audit?.("session", "resume", sid, "恢复历史会话");
    return c.json({ session_id: result.result.session_id, resumed: true, active: true });
  });

  // ── 列表 ──
  app.get("/api/sessions", (c) => {
    const sessions = [...deps.hub.sessions.entries()].map(([sid, record]) => ({
      session_id: sid,
      message_count: record.session.messages.length,
      created_at: new Date().toISOString(),
      has_active_agent: record.currentGuard !== null,
      is_const: false,
      const_name: "",
      engine: record.engine,
    }));
    return c.json({ sessions });
  });

  // ── 详情 ──
  app.get("/api/sessions/:sessionId", (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    return c.json({
      session_id: sid,
      message_count: record.session.messages.length,
      created_at: new Date().toISOString(),
      has_active_agent: record.currentGuard !== null,
      is_const: false,
      const_name: "",
      engine: record.engine,
    });
  });

  // ── 权限模式（4 档，AG-PERM-001）──
  // 响应形状的唯一出口是 permissionModeView()：字段名与 web/src/types/session.ts
  // 的 SessionPermissionModeResponse 由 tests/permission-mode-contract.test.ts 对账。
  app.get("/api/sessions/:sessionId/permission-mode", (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    return c.json(permissionModeView(sid, record.permissionMode));
  });

  app.put("/api/sessions/:sessionId/permission-mode", async (c) => {
    const sid = c.req.param("sessionId");
    const body = (await c.req.json().catch(() => ({}))) as { permission_mode?: string };
    const result = await callRpc<{ ok: boolean; permission_mode: string }>(
      deps,
      "set_permission_mode",
      { session_id: sid, permission_mode: body.permission_mode },
    );
    if (!result.ok) return c.json({ detail: result.error }, result.error.includes("Session not found") ? 404 : 422);
    // 回读 hub 记录而不是 RPC 里那个 string：kernel 在应答前已把
    // record.permissionMode 改成新模式（bridge-pi.ts 的 set_permission_mode 分支），
    // 记录本身是类型化的 MaxmaPermissionMode，省掉一次"字符串再当枚举用"的裸转。
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话已不存在" }, 404);
    return c.json(permissionModeView(sid, record.permissionMode));
  });

  // ── 消息（role 映射 user→human / assistant→ai，契约对齐 Python）──
  app.get("/api/sessions/:sessionId/messages", async (c) => {
    const sid = c.req.param("sessionId");
    const limitRaw = c.req.query("limit");
    const limit = limitRaw !== undefined ? Number(limitRaw) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      return c.json({ detail: "limit 必须在 1-500 之间" }, 400);
    }
    const result = await callRpc<{ messages: Array<Record<string, unknown>>; total: number }>(
      deps,
      "get_messages",
      { session_id: sid, limit },
    );
    if (!result.ok) return c.json({ detail: result.error }, 404);
    const normalized = result.result.messages.map((m) => ({
      ...m,
      role: ROLE_MAP[String(m.role ?? "")] ?? String(m.role ?? ""),
    }));
    return c.json({
      session_id: sid,
      messages: normalized,
      total: result.result.total,
      source: "sidecar", // CACHE-RECONCILE-001：前端据此做缓存校准
    });
  });

  // ── 撤回（UNDO-BUSY-001：运行中拒绝）──
  app.post("/api/sessions/:sessionId/undo", async (c) => {
    const sid = c.req.param("sessionId");
    const n = Number(c.req.query("n") ?? 1);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      return c.json({ detail: "n 必须在 1-100 之间" }, 400);
    }
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后撤回" }, 409);
    }
    const result = await callRpc<{ removed: number }>(deps, "undo", { session_id: sid, steps: n });
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "undo", sid, `撤回 ${n} 轮`);
    return c.json({ deleted_count: result.result.removed });
  });

  // ── 闲置回顾 ──
  app.post("/api/sessions/:sessionId/recap", async (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后再回顾" }, 409);
    }
    const result = await callRpc<{ recap: string }>(deps, "session_recap", { session_id: sid });
    if (!result.ok) return c.json({ detail: result.error }, 503);
    const answer = String(result.result.recap ?? "").trim();
    return c.json({ answer, status: answer ? "completed" : "empty" });
  });

  // ── 压缩（pi 为摘要式压缩，keep_last 参数在 pi 语义下不适用——契约字段保持）──
  app.post("/api/sessions/:sessionId/compact", async (c) => {
    const sid = c.req.param("sessionId");
    const keepLast = Number(c.req.query("keep_last") ?? 20);
    if (!Number.isFinite(keepLast) || keepLast < 1 || keepLast > 500) {
      return c.json({ detail: "keep_last 必须在 1-500 之间" }, 400);
    }
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后压缩" }, 409);
    }
    const result = await callRpc<{ compressed: boolean; removed_count: number; detail: string }>(
      deps,
      "compact",
      { session_id: sid, keep_last: keepLast },
    );
    if (!result.ok) return c.json({ detail: result.error }, 503);
    return c.json({
      compressed: result.result.compressed,
      removed_count: result.result.removed_count,
      detail: result.result.detail,
    });
  });

  // ── 上下文用量（字符粗估，对齐 Python 语义）──
  app.get("/api/sessions/:sessionId/context-usage", async (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);

    // CTX-USAGE-001：优先用引擎权威值（session.getContextUsage()）。
    // 只有引擎说"不可知"（压缩后到下一次 assistant 响应前，官方语义）时，
    // 才回落到字符估算——此前无条件用估算，中文场景偏差很大。
    const engine = await callRpc<{
      usage?: { tokens?: number | null; contextWindow?: number | null; percent?: number | null } | null;
      known?: boolean;
    }>(deps, "get_context_usage", { session_id: sid });
    const u = engine.ok ? engine.result.usage : null;
    if (engine.ok && engine.result.known && u && typeof u.tokens === "number") {
      const window = typeof u.contextWindow === "number" && u.contextWindow > 0 ? u.contextWindow : 256_000;
      return c.json({
        estimated_tokens: Math.round(u.tokens),
        max_tokens: window,
        percentage: Math.min(100, Math.round((u.tokens / window) * 1000) / 10),
        message_count: 0,
        model_name: "",
        session_id: sid,
        source: "engine",
      });
    }

    const result = await callRpc<{ messages: Array<Record<string, unknown>> }>(
      deps,
      "get_messages",
      { session_id: sid, limit: 200 },
    );
    const messages = result.ok ? result.result.messages : [];
    const totalChars = messages.reduce((acc, m) => acc + String(m.content ?? "").length, 0);
    const maxTokens = 256_000;
    const estimatedTokens = Math.floor(totalChars / 2);
    return c.json({
      estimated_tokens: estimatedTokens,
      max_tokens: maxTokens,
      percentage: Math.min(100, Math.floor((estimatedTokens / Math.max(maxTokens, 1)) * 100)),
      message_count: messages.length,
      model_name: "",
      session_id: sid,
      // 让前端/排查者一眼看出这是估算值而不是引擎给的
      source: "estimate",
    });
  });

  // ── 清空（UX-CLEAR-001：官方 resetLeaf 语义，Bun 后端直调 kernel RPC）──
  // ── 会话树（TREE-001）──
  /**
   * 返回整棵会话树。pi 把会话存成 append-only entry 树 + 活动 leaf，
   * 但此前 Maxma 只暴露过"当前分支"（消息列表），用户看不到"这段对话分过哪些支"。
   * 只读，形状由 kernel 投影（不透传原始 entry，见 bridge-pi 的 get_tree）。
   */
  app.get("/api/sessions/:sessionId/tree", async (c) => {
    const sid = c.req.param("sessionId");
    const result = await callRpc<Record<string, unknown>>(deps, "get_tree", { session_id: sid });
    if (!result.ok) return c.json({ detail: result.error }, 404);
    return c.json(result.result);
  });

  // ── 树内导航（TREE-002）──
  /**
   * 把 leaf 移到某个 entry。`summarize=true` 时对离开的分支生成摘要（pi 原生）。
   * **不删除任何条目**——append-only，只是移动活动指针。
   */
  app.post("/api/sessions/:sessionId/tree/navigate", async (c) => {
    const sid = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const targetId = typeof body.target_id === "string" ? body.target_id : "";
    if (!targetId) return c.json({ detail: "缺少 target_id" }, 400);
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后再切换分支" }, 409);
    }
    const result = await callRpc<Record<string, unknown>>(deps, "navigate_tree", {
      session_id: sid,
      target_id: targetId,
      summarize: body.summarize === true,
      ...(typeof body.custom_instructions === "string" ? { custom_instructions: body.custom_instructions } : {}),
    });
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "navigate_tree", sid, `切换到 entry ${targetId.slice(0, 8)}`);
    return c.json(result.result);
  });

  // ── 分叉（TREE-003）──
  /**
   * 从某条 entry 分出新会话。kernel 建好磁盘文件后，这里立刻把它 resume 成活会话，
   * 返回新 session_id——前端可以直接切过去。
   */
  app.post("/api/sessions/:sessionId/tree/fork", async (c) => {
    const sid = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const entryId = typeof body.entry_id === "string" ? body.entry_id : "";
    if (!entryId) return c.json({ detail: "缺少 entry_id" }, 400);

    const forked = await callRpc<{ session_id: string; session_file: string | null; entry_count: number }>(
      deps,
      "fork_session",
      { session_id: sid, entry_id: entryId },
    );
    if (!forked.ok) return c.json({ detail: forked.error }, 503);
    if (!forked.result.session_id) return c.json({ detail: "分叉失败：未生成新会话" }, 500);

    // 把新会话文件变成活会话（复用既有恢复路径，不另造一套）。
    const resumed = await createSessionViaKernel({ resume_session_id: forked.result.session_id });
    if (!resumed.ok) {
      return c.json({ detail: `分叉已落盘但恢复失败：${resumed.error}`, session_id: forked.result.session_id }, 500);
    }
    deps.audit?.("session", "fork", sid, `从 entry ${entryId.slice(0, 8)} 分叉 → ${forked.result.session_id}`);
    return c.json({
      session_id: forked.result.session_id,
      source_session_id: sid,
      entry_id: entryId,
      entry_count: forked.result.entry_count,
    });
  });

  // ── 会话重命名（TREE-004）──
  app.put("/api/sessions/:sessionId/name", async (c) => {
    const sid = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
    const result = await callRpc<{ ok: boolean; name: string | null }>(deps, "set_session_name", {
      session_id: sid,
      name,
    });
    if (!result.ok) return c.json({ detail: result.error }, 404);
    return c.json({ session_id: sid, name: result.result.name });
  });

  // ── 取消压缩（ABORT-COMPACT-001）──
  /**
   * 取消正在进行的压缩/分支摘要。压缩要调模型生成摘要，provider 卡住时会长时间
   * 挂着——此前只有「开始压缩」没有「取消」。
   */
  app.post("/api/sessions/:sessionId/compact/abort", async (c) => {
    const sid = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const result = await callRpc<{ ok: boolean; aborted: string; compacting: boolean }>(
      deps,
      "abort_compaction",
      { session_id: sid, ...(body.what === "branch_summary" ? { what: "branch_summary" } : {}) },
    );
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "abort_compaction", sid, result.result.aborted);
    return c.json({ session_id: sid, ...result.result });
  });

  // ── 思考档位能力（THINKING-CAP-001）──
  /**
   * 当前模型**实际支持**的思考档位（pi 按模型裁剪）。界面据此标注不支持的项，
   * 而不是让用户选一个会被静默钳掉的档位。
   */
  app.get("/api/sessions/:sessionId/thinking-levels", async (c) => {
    const sid = c.req.param("sessionId");
    const result = await callRpc<{ available: string[]; current: string }>(
      deps,
      "get_thinking_levels",
      { session_id: sid },
    );
    if (!result.ok) return c.json({ detail: result.error }, 404);
    return c.json({ session_id: sid, ...result.result });
  });

  // ── 资源热重载（RELOAD-001）──
  /**
   * 重新加载扩展/技能/提示词模板/主题，**不重建会话**（历史与分支都保留）。
   * 用户装了新技能或放了新模板后，不必再新建会话来让它生效。
   */
  app.post("/api/sessions/:sessionId/reload", async (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后再重载" }, 409);
    }
    const result = await callRpc<{ ok: boolean; templates: number; tools: number }>(
      deps,
      "reload_session_resources",
      { session_id: sid },
    );
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "reload", sid, `templates=${result.result.templates} tools=${result.result.tools}`);
    return c.json({ session_id: sid, ...result.result });
  });

  // ── 上下文编辑（CTX-EDIT-001）──
  /**
   * 把某条 entry 从**未来模型上下文**中移除（pi 的 `appendContextEdit`）。
   * 不删除原始历史、不改界面、不改计费——是"这条别让模型再看到"的正确做法。
   */
  app.post("/api/sessions/:sessionId/context-edit", async (c) => {
    const sid = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const targetId = typeof body.target_id === "string" ? body.target_id : "";
    if (!targetId) return c.json({ detail: "缺少 target_id" }, 400);
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后再改上下文" }, 409);
    }
    const omit = body.omit !== false;
    const result = await callRpc<{ ok: boolean; edit_id: string; target_id: string; omitted: boolean }>(
      deps,
      "context_edit",
      {
        session_id: sid,
        target_id: targetId,
        omit,
        ...(omit ? {} : { replacement: String(body.replacement ?? "") }),
      },
    );
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "context_edit", sid, `${omit ? "移除" : "替换"} entry ${targetId.slice(0, 8)}`);
    return c.json(result.result);
  });

  // ── 会话状态（STATE-001）──
  /**
   * pi 的会话只读状态：选中模型、**虚拟模型路由后的实际模型**、思考档位、是否空闲。
   * `routed_model` 只在虚拟模型被选中且已有成功应答时非空。
   */
  app.get("/api/sessions/:sessionId/state", async (c) => {
    const sid = c.req.param("sessionId");
    const result = await callRpc<Record<string, unknown>>(deps, "get_session_state", { session_id: sid });
    if (!result.ok) return c.json({ detail: result.error }, 404);
    return c.json({ session_id: sid, ...result.result });
  });

  // ── Prompt templates（PROMPT-TPL-001）──
  /**
   * 列出 pi 发现的提示词模板（`~/.pi/agent/prompts/*.md` 与 `.pi/prompts/`）。
   * 每个模板的文件名即斜杠命令名，前端据此补全。
   */
  app.get("/api/sessions/:sessionId/prompt-templates", async (c) => {
    const sid = c.req.param("sessionId");
    const result = await callRpc<{ templates: Array<Record<string, unknown>> }>(
      deps,
      "list_prompt_templates",
      { session_id: sid },
    );
    if (!result.ok) return c.json({ detail: result.error }, 404);
    return c.json({ session_id: sid, templates: result.result.templates });
  });

  // ── 会话统计（TREE-004）──
  // pi 的 getSessionStats 覆盖**全部** entry（含被压缩掉的历史），
  // 所以 token/cost 反映真实计费，而不是当前上下文。
  app.get("/api/sessions/:sessionId/stats", async (c) => {
    const sid = c.req.param("sessionId");
    const result = await callRpc<{ stats: Record<string, unknown> }>(deps, "get_session_stats", { session_id: sid });
    if (!result.ok) return c.json({ detail: result.error }, 404);
    return c.json({ session_id: sid, ...result.result.stats });
  });

  // ── 导出 JSONL（EXPORT-002）──
  // 与 HTML 导出的差别：JSONL 是 pi 的**原始会话格式**，可被 /import 读回，
  // 也适合程序处理；HTML 只用于人看。
  app.post("/api/sessions/:sessionId/export/jsonl", async (c) => {
    const sid = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const outputPath = typeof body.output_path === "string" ? body.output_path : undefined;
    const result = await callRpc<{ ok: boolean; path: string | null }>(deps, "export_session_jsonl", {
      session_id: sid,
      ...(outputPath !== undefined ? { output_path: outputPath } : {}),
    });
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "export_jsonl", sid, result.result.path ?? "");
    return c.json({ session_id: sid, path: result.result.path });
  });

  // ── 导出 HTML（TREE-004）──
  app.post("/api/sessions/:sessionId/export", async (c) => {
    const sid = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const outputPath = typeof body.output_path === "string" ? body.output_path : undefined;
    const result = await callRpc<{ ok: boolean; path: string | null }>(deps, "export_session_html", {
      session_id: sid,
      ...(outputPath !== undefined ? { output_path: outputPath } : {}),
    });
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "export", sid, result.result.path ?? "");
    return c.json({ session_id: sid, path: result.result.path });
  });

  app.delete("/api/sessions/:sessionId/messages", async (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后清空" }, 409);
    }
    const result = await callRpc<{ status: string }>(deps, "clear_messages", { session_id: sid });
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "clear", sid, "清空会话消息");
    return c.json({ status: "cleared", cleared_turns: 0 });
  });

  // ── 删除 / 批量删除 / 清理临时 ──
  app.delete("/api/sessions/:sessionId", async (c) => {
    const raw = c.req.param("sessionId");
    const sid = normalizeSessionId(raw) ?? raw;
    const record = deps.hub.sessions.get(sid);
    if (record) {
      await callRpc(deps, "destroy_session", { session_id: sid });
      // 内存会话销毁后，磁盘 JSONL 还在——不删就会在历史列表里"复活"
      // （用户视角：删掉的会话重启后又出现了）。best-effort：从未落盘的会话没有文件。
      await callRpc(deps, "delete_persisted_session", { session_id: sid });
      deps.audit?.("session", "delete", sid, "会话删除");
      return c.json({ status: "deleted" });
    }
    // 磁盘历史会话（重启后、未恢复到 hub）：删文件本身。
    const removed = await callRpc<{ deleted: boolean }>(deps, "delete_persisted_session", { session_id: sid });
    if (!removed.ok) return c.json({ detail: "会话不存在" }, 404);
    deps.audit?.("session", "delete", sid, "历史会话删除");
    return c.json({ status: "deleted", persisted: true });
  });

  app.post("/api/sessions/batch-delete", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { session_ids?: string[] };
    const deleted: string[] = [];
    for (const sid of body.session_ids ?? []) {
      if (deps.hub.sessions.has(sid)) {
        await callRpc(deps, "destroy_session", { session_id: sid });
        deleted.push(sid);
      }
    }
    return c.json({ deleted, count: deleted.length });
  });

  app.post("/api/sessions/clear-temp", async (c) => {
    const deleted: string[] = [];
    for (const sid of [...deps.hub.sessions.keys()]) {
      await callRpc(deps, "destroy_session", { session_id: sid });
      deleted.push(sid);
    }
    return c.json({ deleted, count: deleted.length });
  });

  return app;
}

// 保持 path 引用（供 2.6 合并时定位）
