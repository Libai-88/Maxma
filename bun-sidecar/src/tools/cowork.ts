/**
 * Cowork 专用工具：任务步骤上报。
 *
 * 只负责把“计划中的第 N 步现在处于什么状态”送到任务事件流；不写文件、不改任务表。
 * 任务表由 orchestrator 收到事件后落库，UI 只读任务表/事件，不信任模型自报为完成。
 */

import type { MaxmaToolDescriptor, MaxmaToolResult } from "./descriptor";

export interface CoworkStepToolContext {
  sessionId: string;
  sendEvent: (sessionId: string, event: { type: string; payload: Record<string, unknown> }) => void;
}

const STEP_STATUSES = new Set(["pending", "running", "completed", "failed", "skipped"]);

function result(text: string, details?: unknown): MaxmaToolResult {
  return { content: [{ type: "text", text }], details };
}

export function coworkUpdateStepsTool(ctx: CoworkStepToolContext): MaxmaToolDescriptor {
  return {
    name: "cowork_update_steps",
    label: "Update Cowork Steps",
    description:
      "更新当前任务的步骤状态。用于让用户看到真实进度；只上报步骤，不代替实际文件产出，也不要把未执行的步骤标成 completed。",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              seq: { type: "integer", minimum: 1, maximum: 100 },
              label: { type: "string", minLength: 1, maxLength: 200 },
              status: { type: "string", enum: ["pending", "running", "completed", "failed", "skipped"] },
              detail: { type: "string", maxLength: 1000 },
            },
            required: ["seq", "label", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["steps"],
      additionalProperties: false,
    },
    approval: "read",
    async execute(_toolCallId, params) {
      const rawSteps = Array.isArray(params.steps) ? params.steps : [];
      if (rawSteps.length === 0 || rawSteps.length > 20) {
        return result("steps 必须包含 1–20 项。", { ok: false });
      }
      const steps: Array<{ seq: number; label: string; status: string; detail: string }> = [];
      for (const raw of rawSteps) {
        if (!raw || typeof raw !== "object") continue;
        const record = raw as Record<string, unknown>;
        const seq = Number(record.seq);
        const label = String(record.label ?? "").trim();
        const status = String(record.status ?? "");
        if (!Number.isInteger(seq) || seq < 1 || seq > 100 || !label || !STEP_STATUSES.has(status)) continue;
        steps.push({
          seq,
          label: label.slice(0, 200),
          status,
          detail: String(record.detail ?? "").slice(0, 1000),
        });
      }
      if (steps.length === 0) return result("没有合法的步骤可更新。", { ok: false });
      ctx.sendEvent(ctx.sessionId, {
        type: "cowork.steps.updated",
        payload: { steps },
      });
      return result(`已更新 ${steps.length} 个步骤。`, { ok: true, steps });
    },
  };
}
