/**
 * Maxma 任务护照：把一次 Cowork 交付的路由、审批、产物指纹与数据边界
 * 聚合成一张可下载、可核验的本地凭证。只读组装，不写工作区、不联网。
 *
 * 设计边界：
 * - 这里是“Maxma 侧记录”，不是对上游网关或第三方服务的审计证明；
 * - 指纹是 SHA-256 内容摘要，不是签名证书；
 * - 护照不直接收录凭据字段，疑似凭据文本会被替换为 [redacted]；也不包含模型原始输出。
 */

import { createHash } from "node:crypto";
import * as path from "node:path";

import type {
  CoworkApproval,
  CoworkArtifact,
  CoworkEvent,
  CoworkTask,
  CoworkTaskDetail,
} from "./cowork-store-types";

export const COWORK_PASSPORT_SCHEMA = "maxma.cowork.passport/v1";

export interface CoworkPassportFallback {
  from_provider: string;
  from_model: string;
  reason: string;
}

export interface CoworkPassportRoute {
  provider_id: string;
  provider_label: string;
  model: string;
  location: string;
  profile: string;
  reason: string;
  fallback: CoworkPassportFallback | null;
  cost: {
    currency: string | null;
    estimated_usd: number | null;
    note: string | null;
  };
  data_policy: string;
}

export interface CoworkPassportApprovalItem {
  kind: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  reason: string | null;
}

export interface CoworkPassportApprovals {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  modified: number;
  expired: number;
  by_kind: {
    plan: number;
    tool: number;
    export: number;
    delete: number;
  };
  items: CoworkPassportApprovalItem[];
}

export interface CoworkPassportArtifactItem {
  name: string;
  path: string;
  kind: string;
  version: number;
  size_bytes: number;
  sha256: string;
  status: string;
}

export interface CoworkPassportSourceItem {
  kind: string;
  path: string;
  label: string | null;
}

export interface CoworkTaskPassport {
  schema: typeof COWORK_PASSPORT_SCHEMA;
  brand: "Maxma";
  product: "MaxmaHere";
  passport_id: string;
  issued_at: string;
  task: {
    id: string;
    title: string;
    objective: string;
    status: string;
    project_id: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    permission_mode: string;
    data_policy: string;
    model_policy: {
      profile: string;
    };
  };
  execution: {
    runs: number;
    latest_run: {
      attempt: number;
      status: string;
      started_at: string;
      ended_at: string | null;
      error: string | null;
    } | null;
    steps: {
      total: number;
      completed: number;
      skipped: number;
      failed: number;
      pending: number;
      running: number;
    };
  };
  route: CoworkPassportRoute | null;
  approvals: CoworkPassportApprovals;
  artifacts: {
    count: number;
    total_bytes: number;
    items: CoworkPassportArtifactItem[];
  };
  source: {
    group_id: string | null;
    workspace_root: string;
    staging_root: string;
    items: CoworkPassportSourceItem[];
  };
  integrity: {
    algorithm: "sha256";
    canonicalization: "json-sort-keys/v1";
    digest: string;
  };
}

export interface CoworkTaskPassportBundle {
  passport: CoworkTaskPassport;
  markdown: string;
  filenames: {
    json: string;
    markdown: string;
  };
}

function parseObject(text: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text ?? "") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function latestRoutePayload(events: CoworkEvent[]): Record<string, unknown> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.type !== "cowork.model.routed") continue;
    const payload = parseObject(event.payload_json);
    if (Object.keys(payload).length > 0) return payload;
  }
  return null;
}

function routeFromPayload(
  payload: Record<string, unknown> | null,
  fallbackDataPolicy: string,
): CoworkPassportRoute | null {
  if (!payload) return null;
  const rawCost = objectOrNull(payload.cost);
  const estimated = rawCost?.estimated_usd;
  const rawFallback = objectOrNull(payload.fallback);
  return {
    provider_id: stringValue(payload.provider_id),
    provider_label: stringValue(payload.provider_label),
    model: stringValue(payload.model),
    location: stringValue(payload.location),
    profile: stringValue(payload.profile),
    reason: stringValue(payload.reason),
    fallback: rawFallback
      ? {
          from_provider: stringValue(rawFallback.from_provider),
          from_model: stringValue(rawFallback.from_model),
          reason: stringValue(rawFallback.reason),
        }
      : null,
    cost: {
      currency: stringValue(rawCost?.currency) || null,
      estimated_usd:
        typeof estimated === "number" && Number.isFinite(estimated) ? estimated : null,
      note: stringValue(rawCost?.note) || null,
    },
    data_policy: stringValue(payload.data_policy) || fallbackDataPolicy,
  };
}

function latestArtifacts(artifacts: CoworkArtifact[]): CoworkArtifact[] {
  const latestByPath = new Map<string, CoworkArtifact>();
  for (const artifact of artifacts) {
    if (artifact.status === "deleted") continue;
    const current = latestByPath.get(artifact.path);
    if (
      !current ||
      artifact.version > current.version ||
      (artifact.version === current.version && artifact.created_at > current.created_at)
    ) {
      latestByPath.set(artifact.path, artifact);
    }
  }
  return [...latestByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function collectSources(task: CoworkTask): CoworkPassportSourceItem[] {
  const inputs = parseObject(task.inputs_json);
  const project = objectOrNull(inputs.project);
  const items: CoworkPassportSourceItem[] = [];
  if (Array.isArray(inputs.assets)) {
    for (const raw of inputs.assets.slice(0, 50)) {
      const item = objectOrNull(raw);
      if (!item || typeof item.path !== "string") continue;
      items.push({
        kind: "asset",
        path: item.path,
        label: stringValue(item.label) || null,
      });
    }
  }
  if (project && (stringValue(project.id) || stringValue(project.title))) {
    items.push({
      kind: "project",
      path: stringValue(project.id) || task.project_id || "",
      label: stringValue(project.title) || null,
    });
  }
  return items;
}

function approvalSummary(approvals: CoworkApproval[]): CoworkPassportApprovals {
  const summary: CoworkPassportApprovals = {
    total: approvals.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    modified: 0,
    expired: 0,
    by_kind: { plan: 0, tool: 0, export: 0, delete: 0 },
    items: [],
  };
  for (const approval of approvals) {
    if (approval.status === "pending") summary.pending += 1;
    else if (approval.status === "approved") summary.approved += 1;
    else if (approval.status === "rejected") summary.rejected += 1;
    else if (approval.status === "modified") summary.modified += 1;
    else if (approval.status === "expired") summary.expired += 1;
    if (approval.kind === "plan" || approval.kind === "tool" || approval.kind === "export" || approval.kind === "delete") {
      summary.by_kind[approval.kind] += 1;
    }
  }
  summary.items = approvals.slice(0, 100).map((approval) => ({
    kind: approval.kind,
    status: approval.status,
    created_at: approval.created_at,
    resolved_at: approval.resolved_at,
    reason: approval.decision_reason,
  }));
  return summary;
}

function stepSummary(steps: CoworkTaskDetail["steps"]): CoworkTaskPassport["execution"]["steps"] {
  const counts = { total: steps.length, completed: 0, skipped: 0, failed: 0, pending: 0, running: 0 };
  for (const step of steps) {
    if (step.status in counts) counts[step.status] += 1;
  }
  return counts;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

/** 护照指纹使用的规范 JSON：对象键递归排序，数组保持顺序，不含空白。 */
export function canonicalCoworkPassportJson(value: unknown): string {
  return canonicalize(value);
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

/**
 * 护照会被下载、转发给老师/同事；即使用户在目标或审批备注里粘贴了凭据，
 * 也不能原样进入可分享的正文。这里只做保守的“像凭据”的形状替换。
 */
const SECRETISH_PATTERN =
  /(?:sk-[A-Za-z0-9_-]{6,}|(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._~+/=-]{12,}|(?:api[_-]?key|access[_-]?token|secret|password)\s*[=:]\s*[^\s,;]+)/gi;

function scrubSecrets(value: unknown): unknown {
  if (typeof value === "string") return value.replace(SECRETISH_PATTERN, "[redacted]");
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrubSecrets(item)]),
    );
  }
  return value;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileStem(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 40) || "maxma-task";
}

export function coworkPassportFilename(task: CoworkTask, extension: "json" | "md"): string {
  return `${safeFileStem(task.title)}-Maxma-Passport.${extension}`;
}

export function buildCoworkTaskPassport(detail: CoworkTaskDetail): CoworkTaskPassport {
  const task = detail.task;
  const modelPolicy = parseObject(task.model_policy_json);
  const latestRun = detail.latest_run ?? detail.runs[detail.runs.length - 1] ?? null;
  const currentArtifacts = latestArtifacts(detail.artifacts);
  const artifactItems = currentArtifacts.map((artifact) => ({
    name: path.basename(artifact.path),
    path: artifact.path,
    kind: artifact.kind,
    version: artifact.version,
    size_bytes: artifact.size_bytes,
    sha256: artifact.sha256,
    status: artifact.status,
  }));
  const sourceItems = collectSources(task);
  const rawBody: Omit<CoworkTaskPassport, "passport_id" | "integrity"> = {
    schema: COWORK_PASSPORT_SCHEMA,
    brand: "Maxma",
    product: "MaxmaHere",
    issued_at: task.completed_at ?? task.updated_at,
    task: {
      id: task.id,
      title: task.title,
      objective: task.objective,
      status: task.status,
      project_id: task.project_id,
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at,
      permission_mode: task.permission_mode,
      data_policy: task.data_policy,
      model_policy: {
        profile: stringValue(modelPolicy.profile),
      },
    },
    execution: {
      runs: detail.runs.length,
      latest_run: latestRun
        ? {
            attempt: latestRun.attempt,
            status: latestRun.status,
            started_at: latestRun.started_at,
            ended_at: latestRun.ended_at,
            error: latestRun.error,
          }
        : null,
      steps: stepSummary(detail.steps),
    },
    route: routeFromPayload(latestRoutePayload(detail.events), task.data_policy),
    approvals: approvalSummary(detail.approvals),
    artifacts: {
      count: artifactItems.length,
      total_bytes: artifactItems.reduce((total, item) => total + item.size_bytes, 0),
      items: artifactItems,
    },
    source: {
      group_id: task.project_id,
      workspace_root: task.workspace_root,
      staging_root: task.staging_root,
      items: sourceItems,
    },
  };
  const body = scrubSecrets(rawBody) as Omit<CoworkTaskPassport, "passport_id" | "integrity">;
  const digest = sha256Json(body);
  return {
    ...body,
    passport_id: `maxma-${digest.slice(0, 12)}`,
    integrity: { algorithm: "sha256", canonicalization: "json-sort-keys/v1", digest },
  };
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderCoworkPassportMarkdown(passport: CoworkTaskPassport): string {
  const route = passport.route;
  const approvalItems = passport.approvals.items;
  const artifacts = passport.artifacts.items;
  const sourceItems = passport.source.items;
  return [
    "# Maxma 任务护照",
    "",
    "> 每个交付，都有一张护照。",
    "",
    `- 护照编号：\`${passport.passport_id}\``,
    `- 任务：${passport.task.title}`,
    `- 任务 ID：\`${passport.task.id}\``,
    `- 状态：${passport.task.status}`,
    `- 签发时间：${passport.issued_at}`,
    `- 数据策略：${passport.task.data_policy}`,
    `- 权限：${passport.task.permission_mode}`,
    "",
    "## 目标",
    "",
    passport.task.objective,
    "",
    "## 模型路由",
    "",
    ...(route
      ? [
          `- 提供商：${route.provider_label || route.provider_id || "未知"}`,
          `- 模型：${route.model || "未知"}`,
          `- 位置：${route.location === "local" ? "本机" : route.location === "cloud" ? "云端" : route.location || "未知"}`,
          `- 档位：${route.profile || "默认"}`,
          `- 成本：${route.cost.estimated_usd === null ? "未知" : `${route.cost.currency ?? "USD"} ${route.cost.estimated_usd}`}`,
          `- 路由原因：${route.reason || "未记录"}`,
          `- 数据策略：${route.data_policy}`,
        ]
      : ["- 未记录模型路由（任务可能尚未运行）"]),
    "",
    "## 执行",
    "",
    `- 运行次数：${passport.execution.runs}`,
    `- 最近运行：${passport.execution.latest_run ? `${passport.execution.latest_run.status}（第 ${passport.execution.latest_run.attempt} 次）` : "未运行"}`,
    `- 步骤：${passport.execution.steps.completed} 完成 / ${passport.execution.steps.total} 记录`,
    "",
    "## 审批",
    "",
    `- 合计：${passport.approvals.total}（批准 ${passport.approvals.approved}，拒绝 ${passport.approvals.rejected}，修改 ${passport.approvals.modified}，待处理 ${passport.approvals.pending}，过期 ${passport.approvals.expired}）`,
    `- 分类：计划 ${passport.approvals.by_kind.plan}，工具 ${passport.approvals.by_kind.tool}，导出 ${passport.approvals.by_kind.export}，删除 ${passport.approvals.by_kind.delete}`,
    ...(approvalItems.length
      ? approvalItems.map((item) => `- ${item.kind} · ${item.status}${item.reason ? ` · ${item.reason}` : ""}`)
      : ["- 无审批记录"]),
    "",
    "## 交付物",
    "",
    ...(artifacts.length
      ? [
          "| 文件 | 版本 | 大小 | SHA-256 |",
          "| --- | --- | --- | --- |",
          ...artifacts.map((item) => `| ${markdownCell(item.name)} | v${item.version} | ${formatBytes(item.size_bytes)} | \`${item.sha256}\` |`),
        ]
      : ["- 暂无交付物"]),
    "",
    "## 来源",
    "",
    ...(sourceItems.length
      ? sourceItems.map((item) => `- ${item.label || item.path}（${item.kind}）：${item.path}`)
      : ["- 未记录外部来源"]),
    "",
    "## 护照指纹",
    "",
    `\`sha256:${passport.integrity.digest}\``,
    "",
    "## 边界说明",
    "",
    "- 护照记录的是 Maxma 侧的任务状态、模型路由选择、审批决定与产物指纹。",
    "- 指纹是 SHA-256 内容摘要，不是第三方签名证书；它不替代对上游网关或外部服务的审计。",
    "- 本地路由记录不等于“数据绝不出机”的强证明；需要结合网络日志或本地桩任务判断。",
    "",
  ].join("\n");
}

export function buildCoworkTaskPassportBundle(detail: CoworkTaskDetail): CoworkTaskPassportBundle {
  const passport = buildCoworkTaskPassport(detail);
  return {
    passport,
    markdown: renderCoworkPassportMarkdown(passport),
    filenames: {
      json: coworkPassportFilename(detail.task, "json"),
      markdown: coworkPassportFilename(detail.task, "md"),
    },
  };
}
