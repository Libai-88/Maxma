/**
 * kernel/task-graph.ts — 子 Agent 任务图（M3 / A2）。
 *
 * 为什么不是"再来一个调度器"：Maxma 的子 Agent 已经是一个工具调用里的并行执行。
 * 任务图只补三件它现在缺的事：
 *   1. 依赖顺序（B 必须等 A 成功才开跑）；
 *   2. 失败隔离（A 失败时只阻塞依赖 A 的任务，独立任务继续跑）；
 *   3. 可重试（单任务失败后按 retries 再跑，不把整批拖死）。
 *
 * 纯状态机，不认识模型、不碰文件、不睡眠。调度器（subagent.ts）只做：
 * `nextReady()` 取活 → `start()` → 跑 → `succeed()/fail()`；所有可观察状态都在
 * `snapshot()` 里，测试与 UI 都不需要另建一份真值。
 *
 * 边界（写死）：
 *   - 依赖必须指向同一批任务里的 id；未知依赖、重复 id、环都直接拒绝整批；
 *   - 一个任务只会在所有依赖 **成功** 后才 ready；依赖失败/阻塞会级联阻塞；
 *   - retries 是"额外尝试次数"，0 表示一次；重试仍失败才进入 failed；
 *   - 取消是不可逆终态，未开始的任务直接 cancelled，不再被调度。
 */

export type TaskGraphStatus = "pending" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";

export interface TaskGraphInput {
  id: string;
  prompt: string;
  label?: string;
  dependsOn?: string[];
  /** 失败后的额外尝试次数（0 = 只跑一次，上限 3）。 */
  retries?: number;
}

export interface TaskGraphNode {
  id: string;
  prompt: string;
  label: string;
  dependsOn: string[];
  retries: number;
  status: TaskGraphStatus;
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** 被哪个上游任务阻塞（status=blocked 时）。 */
  blockedBy?: string;
}

export interface TaskGraphSnapshotNode {
  id: string;
  label: string;
  status: TaskGraphStatus;
  dependsOn: string[];
  attempts: number;
  error?: string;
  blockedBy?: string;
}

const MAX_TASKS = 16;
const MAX_RETRIES = 3;

export class TaskGraphError extends Error {
  readonly code: string;
  constructor(message: string, code = "TASK_GRAPH_INVALID") {
    super(message);
    this.code = code;
  }
}

/** 从工具入参构建任务图；非法输入整批拒绝（不做"跑一半再说"）。 */
export function buildTaskGraph(inputs: TaskGraphInput[]): TaskGraph {
  if (inputs.length === 0) throw new TaskGraphError("tasks 为空", "TASK_GRAPH_EMPTY");
  if (inputs.length > MAX_TASKS) throw new TaskGraphError(`任务数超过上限（${MAX_TASKS}）`, "TASK_GRAPH_TOO_MANY");

  const nodes = new Map<string, TaskGraphNode>();
  inputs.forEach((input, index) => {
    const id = (typeof input.id === "string" ? input.id : "").trim() || `task-${index + 1}`;
    if (nodes.has(id)) throw new TaskGraphError(`任务 id 重复：${id}`, "TASK_GRAPH_DUPLICATE_ID");
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt) throw new TaskGraphError(`任务 ${id} 缺少 prompt`, "TASK_GRAPH_EMPTY_PROMPT");
    const dependsOn = Array.isArray(input.dependsOn)
      ? [...new Set(input.dependsOn.filter((value): value is string => typeof value === "string" && value.trim().length > 0))]
      : [];
    const retries = Number.isFinite(input.retries)
      ? Math.min(MAX_RETRIES, Math.max(0, Math.floor(Number(input.retries))))
      : 0;
    nodes.set(id, {
      id,
      prompt,
      label: (input.label ?? "").trim() || `任务 ${index + 1}`,
      dependsOn,
      retries,
      status: "pending",
      attempts: 0,
    });
  });

  for (const node of nodes.values()) {
    for (const dependency of node.dependsOn) {
      if (!nodes.has(dependency)) {
        throw new TaskGraphError(`任务 ${node.id} 依赖了不存在的任务：${dependency}`, "TASK_GRAPH_UNKNOWN_DEPENDENCY");
      }
      if (dependency === node.id) {
        throw new TaskGraphError(`任务 ${node.id} 不能依赖自己`, "TASK_GRAPH_CYCLE");
      }
    }
  }

  // 环检测（DFS 三色）：依赖方向是"node → dependency"，检测同一连通分量里的环。
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new TaskGraphError(`任务依赖存在环（${id}）`, "TASK_GRAPH_CYCLE");
    visiting.add(id);
    for (const dependency of nodes.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of nodes.keys()) visit(id);

  return new TaskGraph(nodes);
}

export class TaskGraph {
  private readonly nodes: Map<string, TaskGraphNode>;
  private cancelled = false;
  private cancelReason = "";

  constructor(nodes: Map<string, TaskGraphNode>) {
    this.nodes = nodes;
  }

  /** 按输入顺序返回当前 ready 的最多 limit 个任务，并保持 pending 不变。 */
  ready(limit: number): TaskGraphNode[] {
    if (this.cancelled) return [];
    const ready: TaskGraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (ready.length >= limit) break;
      if (node.status !== "pending") continue;
      const dependencies = node.dependsOn.map((id) => this.nodes.get(id)!);
      const allSucceeded = dependencies.every((dependency) => dependency.status === "succeeded");
      if (allSucceeded) ready.push(node);
    }
    return ready;
  }

  start(id: string): void {
    const node = this.require(id);
    if (node.status !== "pending") throw new TaskGraphError(`任务 ${id} 当前状态不是 pending（${node.status}）`);
    node.status = "running";
    node.attempts += 1;
    node.startedAt = Date.now();
  }

  succeed(id: string): void {
    const node = this.require(id);
    if (node.status !== "running") throw new TaskGraphError(`任务 ${id} 当前状态不是 running（${node.status}）`);
    node.status = "succeeded";
    node.finishedAt = Date.now();
    node.error = undefined;
  }

  /**
   * 标记失败：还有重试额度时回到 pending；否则 failed，并级联阻塞所有依赖它的任务。
   * 返回最终状态，方便调用方决定是否还要再跑。
   */
  fail(id: string, error: string): TaskGraphStatus {
    const node = this.require(id);
    if (node.status !== "running") throw new TaskGraphError(`任务 ${id} 当前状态不是 running（${node.status}）`);
    if (node.attempts <= node.retries) {
      node.status = "pending";
      node.startedAt = undefined;
      node.error = error;
      return node.status;
    }
    node.status = "failed";
    node.error = error;
    node.finishedAt = Date.now();
    this.blockDependents(id);
    return node.status;
  }

  /** 取消：running 由调用方中止，pending 全部转为 cancelled，依赖方级联。 */
  cancelAll(reason: string): void {
    this.cancelled = true;
    this.cancelReason = reason;
    for (const node of this.nodes.values()) {
      if (node.status === "pending" || node.status === "running") {
        if (node.status === "pending") {
          node.status = "cancelled";
          node.error = reason;
          node.finishedAt = Date.now();
          node.blockedBy = undefined;
        }
      }
    }
  }

  /** 父会话取消时，正在跑的任务由执行器标记；这里只负责还没开始的部分。 */
  markCancelled(id: string, reason: string): void {
    const node = this.require(id);
    node.status = "cancelled";
    node.error = reason;
    node.finishedAt = Date.now();
  }

  snapshot(): TaskGraphSnapshotNode[] {
    return [...this.nodes.values()].map((node) => ({
      id: node.id,
      label: node.label,
      status: node.status,
      dependsOn: [...node.dependsOn],
      attempts: node.attempts,
      ...(node.error ? { error: node.error } : {}),
      ...(node.blockedBy ? { blockedBy: node.blockedBy } : {}),
    }));
  }

  node(id: string): TaskGraphNode | undefined {
    return this.nodes.get(id);
  }

  nodesInInputOrder(): TaskGraphNode[] {
    return [...this.nodes.values()];
  }

  counts(): Record<TaskGraphStatus, number> {
    const counts: Record<TaskGraphStatus, number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
      cancelled: 0,
    };
    for (const node of this.nodes.values()) counts[node.status] += 1;
    return counts;
  }

  isDone(): boolean {
    return [...this.nodes.values()].every((node) =>
      node.status === "succeeded" ||
      node.status === "failed" ||
      node.status === "blocked" ||
      node.status === "cancelled",
    );
  }

  get cancelReasonText(): string {
    return this.cancelReason;
  }

  private blockDependents(failedId: string): void {
    const queue = [failedId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const node of this.nodes.values()) {
        if (node.status !== "pending" || !node.dependsOn.includes(current)) continue;
        node.status = "blocked";
        node.blockedBy = current;
        node.error = `上游任务 ${current} 失败，已阻塞`;
        node.finishedAt = Date.now();
        queue.push(node.id);
      }
    }
  }

  private require(id: string): TaskGraphNode {
    const node = this.nodes.get(id);
    if (!node) throw new TaskGraphError(`未知任务：${id}`, "TASK_GRAPH_UNKNOWN_ID");
    return node;
  }
}
