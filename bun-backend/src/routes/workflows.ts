/**
 * routes/workflows.ts — 工作流运行时（api/routes/workflows.py 的 Bun 直译，
 * 阶段二 2.2h）。
 *
 * 定义：PROJECT_ROOT/workflows/*.yaml（name + steps[]）。
 * 运行时：内存 _runs + TTL 清理（MAX_RUNS 1000 / STALE_TTL 3600s）。
 * 执行：simple 模式（sleep/log/set_var）；sidecar 模式经 kernel 的
 * execute_workflow_step RPC。后台执行 = fire-and-forget Promise；
 * 取消 = 布尔标志（asyncio.Event 同语义）。
 * WS 事件：经 eventSink 注入（2.3 chat WS 层接线；当前记录到 hub io）。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { bundleDir } from "../app-paths";
import { BunYamlSafeParse } from "../yaml-store";

// ── 工作流定义 ──

function workflowsDir(): string {
  return path.join(bundleDir(), "workflows");
}

function loadWorkflowDefinitions(): Record<string, Record<string, unknown>> {
  const definitions: Record<string, Record<string, unknown>> = {};
  const dir = workflowsDir();
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return definitions;
  for (const fname of fs.readdirSync(dir)) {
    if (!fname.endsWith(".yaml") && !fname.endsWith(".yml")) continue;
    try {
      const data = BunYamlSafeParse(fs.readFileSync(path.join(dir, fname), "utf8")) as
        | Record<string, unknown>
        | null;
      if (data && typeof data === "object" && data.name) {
        definitions[path.basename(fname, path.extname(fname))] = data;
      }
    } catch (err) {
      console.warn(`[workflow] Failed to load ${fname}: ${String(err)}`);
    }
  }
  return definitions;
}

// ── 运行时状态 ──

export interface WorkflowStepState {
  step_id: string;
  position: number;
  status: string;
  attempts: number;
  checkpoint: null;
}

export class WorkflowRunState {
  run_id: string;
  workflow_id: string;
  workflow_version: number;
  status = "queued";
  parent_turn_id: string | null;
  current_step_id: string | null = null;
  failure_code: string | null = null;
  cancel_reason: string | null = null;
  created_at: number;
  updated_at: number;
  steps: WorkflowStepState[];
  private workflowDef: Record<string, unknown>;
  cancelled = false;

  constructor(
    runId: string,
    workflowId: string,
    workflowDef: Record<string, unknown>,
    parentTurnId: string | null = null,
  ) {
    this.run_id = runId;
    this.workflow_id = workflowId;
    this.workflow_version = Number(workflowDef.version ?? 1);
    this.parent_turn_id = parentTurnId;
    this.created_at = Date.now() / 1000;
    this.updated_at = this.created_at;
    const defs = Array.isArray(workflowDef.steps) ? workflowDef.steps : [];
    this.steps = defs.map((s, i) => {
      const def = (s ?? {}) as Record<string, unknown>;
      return {
        step_id: String(def.step_id ?? `step_${i}`),
        position: i,
        status: "queued",
        attempts: 0,
        checkpoint: null,
      };
    });
    this.workflowDef = workflowDef;
  }

  toDict(): Record<string, unknown> {
    return {
      run_id: this.run_id,
      parent_turn_id: this.parent_turn_id,
      workflow_id: this.workflow_id,
      workflow_version: this.workflow_version,
      status: this.status,
      current_step_id: this.current_step_id,
      failure_code: this.failure_code,
      cancel_reason: this.cancel_reason,
      created_at: this.created_at,
      updated_at: this.updated_at,
      steps: this.steps,
    };
  }

  getDef(): Record<string, unknown> {
    return this.workflowDef;
  }

  markStepRunning(i: number): void {
    if (i >= 0 && i < this.steps.length) {
      this.steps[i]!.status = "running";
      this.steps[i]!.attempts += 1;
      this.current_step_id = this.steps[i]!.step_id;
      this.updated_at = Date.now() / 1000;
    }
  }

  markStepDone(i: number): void {
    if (i >= 0 && i < this.steps.length) {
      this.steps[i]!.status = "succeeded";
      this.updated_at = Date.now() / 1000;
    }
  }

  markStepFailed(i: number, error: string): void {
    if (i >= 0 && i < this.steps.length) {
      this.steps[i]!.status = "failed";
      this.failure_code = error;
      this.updated_at = Date.now() / 1000;
    }
  }
}

const MAX_RUNS = 1000;
const STALE_RUN_TTL = 3600;

const runs = new Map<string, WorkflowRunState>();

function cleanupStaleRuns(): number {
  const now = Date.now() / 1000;
  const staleIds: string[] = [];
  for (const [runId, run] of runs) {
    if (["succeeded", "failed", "cancelled"].includes(run.status) && now - run.updated_at > STALE_RUN_TTL) {
      staleIds.push(runId);
    }
  }
  const remaining = runs.size - staleIds.length;
  if (remaining > MAX_RUNS) {
    const extra = remaining - MAX_RUNS;
    const sorted = [...runs.entries()]
      .filter(([rid]) => !staleIds.includes(rid))
      .sort((a, b) => a[1].updated_at - b[1].updated_at);
    for (const [rid] of sorted.slice(0, extra)) staleIds.push(rid);
  }
  for (const rid of staleIds) runs.delete(rid);
  return staleIds.length;
}

// ── WS 事件注入 ──

export type WorkflowEventSink = (sessionId: string, eventType: string, payload: Record<string, unknown>) => void;

let eventSink: WorkflowEventSink = () => {};

export function setWorkflowEventSink(sink: WorkflowEventSink): void {
  eventSink = sink;
}

const EV_STEP_START = "workflow_step_start";
const EV_STEP_END = "workflow_step_end";
const EV_STEP_ERROR = "workflow_step_error";
const EV_COMPLETED = "workflow_completed";

// ── 执行引擎 ──

async function executeSimpleStep(stepDef: Record<string, unknown>, variables: Record<string, unknown>): Promise<string> {
  const tool = String(stepDef.tool ?? "");
  const args = (stepDef.args ?? {}) as Record<string, unknown>;
  if (tool === "sleep") {
    const duration = Number(args.duration ?? 1);
    await Bun.sleep(duration * 1000);
    return `Slept for ${duration}s`;
  }
  if (tool === "log") {
    const message = String(args.message ?? "");
    console.info(`[workflow] ${message}`);
    return message;
  }
  if (tool === "set_var") {
    variables[String(args.key ?? "")] = args.value ?? "";
    return `Set variable ${args.key} = ${args.value}`;
  }
  throw new Error(`Unsupported workflow tool: ${tool}`);
}

async function executeWorkflow(
  deps: WorkflowDeps,
  runId: string,
  sessionId: string,
): Promise<void> {
  const run = runs.get(runId);
  if (!run) return;

  const def = run.getDef();
  const steps = Array.isArray(def.steps) ? (def.steps as Array<Record<string, unknown>>) : [];

  for (let i = 0; i < steps.length; i++) {
    if (run.cancelled) {
      run.status = "cancelled";
      run.updated_at = Date.now() / 1000;
      eventSink(sessionId, EV_COMPLETED, {
        run_id: runId,
        status: "cancelled",
        current_step: i,
        total_steps: steps.length,
      });
      return;
    }

    run.markStepRunning(i);
    const stepId = run.current_step_id ?? `step_${i}`;
    const stepDef = steps[i]!;

    eventSink(sessionId, EV_STEP_START, {
      run_id: runId,
      step_id: stepId,
      position: i,
      tool: String(stepDef.tool ?? ""),
      args: (stepDef.args ?? {}) as Record<string, unknown>,
      total_steps: steps.length,
    });

    try {
      let output: string;
      if (def.mode === "sidecar" && deps.executeViaKernel) {
        const result = await deps.executeViaKernel(stepDef);
        output = String(result.output ?? "");
      } else {
        output = await executeSimpleStep(stepDef, (def.vars ?? {}) as Record<string, unknown>);
      }

      run.markStepDone(i);
      eventSink(sessionId, EV_STEP_END, {
        run_id: runId,
        step_id: stepId,
        position: i,
        status: "succeeded",
        output: output ? output.slice(0, 2000) : "",
      });
    } catch (err) {
      const errorMsg = String(err);
      run.markStepFailed(i, errorMsg);
      run.status = "failed";
      run.updated_at = Date.now() / 1000;
      eventSink(sessionId, EV_STEP_ERROR, { run_id: runId, step_id: stepId, position: i, error: errorMsg });
      eventSink(sessionId, EV_COMPLETED, {
        run_id: runId,
        status: "failed",
        error: errorMsg,
        current_step: i,
        total_steps: steps.length,
      });
      return;
    }
  }

  run.status = "succeeded";
  run.updated_at = Date.now() / 1000;
  eventSink(sessionId, EV_COMPLETED, {
    run_id: runId,
    status: "succeeded",
    current_step: steps.length,
    total_steps: steps.length,
  });
}

// ── 路由 ──

export interface WorkflowDeps {
  /** sidecar 模式步骤执行（kernel execute_workflow_step RPC，由 server 注入） */
  executeViaKernel?: (stepDef: Record<string, unknown>) => Promise<{ output?: string }>;
}

export function createWorkflowRoutes(deps: WorkflowDeps = {}): Hono {
  const app = new Hono();

  app.get("/api/workflows/definitions", (c) => {
    const definitions = loadWorkflowDefinitions();
    return c.json({
      workflow_ids: Object.keys(definitions),
      definitions: Object.fromEntries(
        Object.entries(definitions).map(([id, wf]) => [
          id,
          {
            name: String(wf.name ?? id),
            description: String(wf.description ?? ""),
            step_count: Array.isArray(wf.steps) ? wf.steps.length : 0,
          },
        ]),
      ),
    });
  });

  app.get("/api/sessions/:sessionId/workflows", (c) => {
    const sessionId = c.req.param("sessionId");
    const sessionRuns = [...runs.values()]
      .filter(
        (run) =>
          run.parent_turn_id !== null &&
          (run.parent_turn_id === sessionId || run.parent_turn_id.startsWith(sessionId.slice(0, 8))),
      )
      .map((run) => run.toDict());
    return c.json({ runs: sessionRuns });
  });

  app.post("/api/sessions/:sessionId/workflows", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = (await c.req.json().catch(() => ({}))) as {
      workflow_id?: string;
      parent_turn_id?: string | null;
    };
    const definitions = loadWorkflowDefinitions();
    const wfDef = definitions[String(body.workflow_id ?? "")];
    if (!wfDef) {
      return c.json({ detail: `Workflow definition '${body.workflow_id}' not found` }, 404);
    }
    const steps = Array.isArray(wfDef.steps) ? wfDef.steps : [];
    if (steps.length === 0) return c.json({ detail: "Workflow has no steps" }, 400);

    const runId = crypto.randomUUID().replace(/-/g, "");
    const run = new WorkflowRunState(runId, String(body.workflow_id), wfDef, body.parent_turn_id ?? null);
    run.status = "running";
    runs.set(runId, run);
    cleanupStaleRuns();

    // 后台执行（fire-and-forget）
    void executeWorkflow(deps, runId, sessionId);

    return c.json({ run_id: runId, status: run.status });
  });

  app.get("/api/sessions/:sessionId/workflows/:runId", (c) => {
    const run = runs.get(c.req.param("runId"));
    if (!run) return c.json({ detail: "Workflow run not found" }, 404);
    return c.json(run.toDict());
  });

  app.post("/api/sessions/:sessionId/workflows/:runId/cancel", (c) => {
    const runId = c.req.param("runId");
    const run = runs.get(runId);
    if (!run) return c.json({ detail: "Workflow run not found" }, 404);
    if (["succeeded", "failed", "cancelled"].includes(run.status)) {
      return c.json({ detail: `Workflow already ${run.status}` }, 400);
    }
    run.status = "cancelled";
    run.cancel_reason = "cancelled_by_user";
    run.updated_at = Date.now() / 1000;
    run.cancelled = true;
    return c.json({ run_id: runId, status: run.status });
  });

  app.post("/api/sessions/:sessionId/workflows/:runId/resume", async (c) => {
    const sessionId = c.req.param("sessionId");
    const runId = c.req.param("runId");
    const run = runs.get(runId);
    if (!run) return c.json({ detail: "Workflow run not found" }, 404);
    if (run.status !== "failed") {
      return c.json({ detail: `Cannot resume workflow in '${run.status}' state` }, 400);
    }
    run.status = "running";
    run.failure_code = null;
    run.updated_at = Date.now() / 1000;
    void executeWorkflow(deps, runId, sessionId);
    return c.json({ run_id: runId, status: run.status });
  });

  return app;
}
