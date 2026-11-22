/**
 * 工具结束后的产物登记。
 *
 * 单独拆出只为让 orchestrator 保持在体量棘轮内；行为与原来完全一致：
 * 先写工具完成事件，再由工具输出推断 staging 产物并登记。
 */
import { artifactFromToolResult } from "./cowork-artifacts";
import type { CoworkStore } from "./cowork-store";

export function recordToolCompletion(
  store: CoworkStore,
  taskId: string,
  runId: string,
  payload: Record<string, unknown>,
  input: string,
): void {
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
  store.appendEvent(taskId, runId, "cowork.tool.completed", {
    tool_name: toolName,
    tool_call_id: typeof payload.tool_call_id === "string" ? payload.tool_call_id : "",
    elapsed: payload.elapsed ?? null,
  });
  const task = store.getTask(taskId);
  const artifact = artifactFromToolResult(toolName, payload.output, input, task.staging_root);
  if (!artifact) return;
  store.addArtifact({
    taskId,
    runId,
    path: artifact.path,
    kind: artifact.kind,
    status: "staged",
    sources: [taskId],
  });
}
