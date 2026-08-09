/**
 * rpc.ts — JSON-RPC 通信原语与 BridgeIo 接口。
 *
 * 注意：defaultIo 定义在 bridge.ts（它需要 getSharedAuthStorage/ensureSettings，
 * 放这里会与 bridge.ts 形成循环依赖）。
 */
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import type { AuthStorage, Settings } from "./omp-compat";
/** 写入 JSON-RPC 成功响应到 stdout。 */
export function send(id: number | null, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

/** 写入 JSON-RPC 错误响应到 stdout。 */
export function sendError(id: number | null, message: string): void {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { message } }) + "\n",
  );
}

/** 写入 JSON-RPC 事件通知到 stdout。 */
export function sendEvent(sessionId: string, event: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "event",
      params: { session_id: sessionId, event },
    }) + "\n",
  );
}

/**
 * RPC handler 的依赖注入面——测试可传入自定义实现接管输出与外部依赖。
 */
export interface BridgeIo {
  send(id: number | null, result: unknown): void;
  sendError(id: number | null, message: string): void;
  sendEvent(sessionId: string, event: Record<string, unknown>): void;
  getSharedAuthStorage(): Promise<AuthStorage>;
  ensureSettings(): Promise<Settings>;
  /** Injectable session factory — defaults to OMP createAgentSession. */
  createAgentSession?: typeof import("@oh-my-pi/pi-coding-agent").createAgentSession;
}
