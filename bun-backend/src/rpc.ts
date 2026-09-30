/**
 * rpc.ts — JSON-RPC 通信原语（与 bun-sidecar/src/rpc.ts 同构，阶段二 2.0）。
 * 事件以 notifications（method: "event"）推送到 stdout，Python WS 层转发前端。
 */

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
