/**
 * session-bridge.ts — Maxma sidecar 进程入口（pi 内核，引擎迁移完成态）。
 *
 * stdin 逐行收 JSON-RPC 请求，分发到 kernel（@earendil-works/pi-coding-agent
 * 官方 API）；事件以 JSON-RPC notifications（method: "event"）推送 stdout。
 *
 * 旧内核（OMP 系列包）依赖已完全移除（§6.3.1）：
 *   - 全部 RPC 由 src/kernel/* 承载（bridge-pi.ts 分发 + 各官方机制实现）
 *   - MAXMA_AGENT_ENGINE 回退开关与 OMP 引擎代码一并删除；如需回滚用 git
 *
 * 契约：docs/contracts/agent-rpc.md / ws-events.md；快照 tests/__snapshots__/。
 */

import { createInterface } from "node:readline";

import { send, sendError, sendEvent } from "./rpc";
import { handlePiCreateSession, handlePiSessionRpc, type PiSessionRecord } from "./kernel/bridge-pi";
import { rejectPendingPiPlansForSession, type PiPendingPlan } from "./kernel/plan";
import type { RpcRequest } from "./rpc-types";

/** 会话表与在途计划审批（kernel 桥经 deps 注入；测试可经 handleRpcRequest 覆盖）。 */
const piSessions = new Map<string, PiSessionRecord>();
const pendingPlans = new Map<string, PiPendingPlan>();

function bridgeDeps() {
  return {
    io: { send, sendError, sendEvent },
    sessions: piSessions,
    pendingPlans,
  };
}

export async function handleRpcRequest(req: RpcRequest): Promise<void> {
  const { method, id } = req;
  const params = (req.params ?? {}) as Record<string, any>;

  if (method === "create_session") {
    // 引擎：pi（唯一）。MAXMA_AGENT_ENGINE 回退开关已随 OMP 移除；如需
    // 回滚旧内核请使用 git 历史中的双引擎版本。
    await handlePiCreateSession(bridgeDeps(), params, id);
    return;
  }

  const sessionId = params?.session_id as string | undefined;
  if (sessionId && piSessions.has(sessionId)) {
    await handlePiSessionRpc(bridgeDeps(), method, sessionId, params, id);
    return;
  }

  if (
    method === "prompt" ||
    method === "cancel" ||
    method === "destroy_session" ||
    method === "get_health" ||
    method === "user_response" ||
    method === "undo" ||
    method === "compact" ||
    method === "get_messages" ||
    method === "get_settings" ||
    method === "set_settings" ||
    method === "set_auto_approve" ||
    method === "set_plan_mode" ||
    method === "plan_action" ||
    method === "checkpoint_action" ||
    method === "goal_action" ||
    method === "get_goal_state" ||
    method === "reload_mcp_for_session" ||
    method === "execute_workflow_step"
  ) {
    sendError(id, `Session not found: ${sessionId ?? "(missing)"}`);
    return;
  }

  sendError(id, `Unknown method: ${method}`);
}

function shutdown() {
  for (const [sid, record] of piSessions) {
    try {
      record.unsubscribe();
      record.approvalGate.rejectAll("shutdown");
      rejectPendingPiPlansForSession(pendingPlans, sid);
      record.session.dispose();
    } catch {
      // best-effort cleanup
    }
  }
  piSessions.clear();
  rl.close();
  process.exit(0);
}

const rl = createInterface({ input: process.stdin });

// bun build --compile 下 import.meta.main 恒为 false(入口被模块图间接引用)。
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
