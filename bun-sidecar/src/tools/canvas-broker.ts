/**
 * 画布命令的进程内回执表：Agent 工具发出 canvas_command 后挂起，
 * 前端跑完真实画布操作再经 WS 回 canvas_agent_result，唤醒对应 Promise。
 *
 * 这张表只存在 sidecar 内存里——画布命令无法跨进程/跨重启恢复是正确的：
 * 它操作的是活着的 React/Konva 实例，进程死了就没有可恢复的目标。
 */
import crypto from "node:crypto";

export interface CanvasCommandReply {
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface PendingCanvasCommand {
  sessionId: string;
  resolve: (reply: CanvasCommandReply) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class CanvasCommandBroker {
  private readonly pending = new Map<string, PendingCanvasCommand>();

  /** 发命令并等回执；超时/没有前端连接都返回可读错误，不 reject。 */
  request(
    sessionId: string,
    action: "read" | "apply" | "export",
    args: Record<string, unknown>,
    sendEvent: (sessionId: string, event: { type: string; payload: Record<string, unknown> }) => void,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<CanvasCommandReply> {
    const requestId = crypto.randomUUID().replace(/-/g, "");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          ok: false,
          error:
            `画布命令 ${action} 超时（${Math.round(timeoutMs / 1000)}s）。` +
            "请确认 Maxma 窗口已打开、当前会话的右侧工作台可用后重试。",
        });
      }, timeoutMs);
      this.pending.set(requestId, { sessionId, resolve, timer });
      try {
        sendEvent(sessionId, {
          type: "canvas_command",
          payload: { request_id: requestId, action, args },
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({ ok: false, error: `画布命令发送失败：${String(error)}` });
      }
    });
  }

  /** 前端回执入口；request_id 或 session 对不上时静默丢弃（防跨会话串台）。 */
  resolve(sessionId: string, payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    const record = payload as { request_id?: unknown; result?: unknown; error?: unknown };
    if (typeof record.request_id !== "string" || !record.request_id) return false;
    const pending = this.pending.get(record.request_id);
    if (!pending || pending.sessionId !== sessionId) return false;
    this.pending.delete(record.request_id);
    clearTimeout(pending.timer);
    if (typeof record.error === "string" && record.error) {
      pending.resolve({ ok: false, error: record.error.slice(0, 4_000) });
    } else {
      pending.resolve({ ok: true, result: record.result });
    }
    return true;
  }

  /** 会话销毁时清账，避免旧定时器长时间占内存。 */
  cancelSession(sessionId: string): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.sessionId !== sessionId) continue;
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: "会话已结束，画布命令取消" });
      this.pending.delete(requestId);
    }
  }

  get size(): number {
    return this.pending.size;
  }
}

export const canvasCommandBroker = new CanvasCommandBroker();
