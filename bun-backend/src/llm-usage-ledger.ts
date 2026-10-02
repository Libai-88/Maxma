import * as crypto from "node:crypto";

import { getConnection, initializeDatabase } from "./db/core";

export const LLM_USAGE_RETENTION_DAYS = 90;
export const LLM_USAGE_RETENTION_SECONDS = LLM_USAGE_RETENTION_DAYS * 24 * 60 * 60;

export type LlmUsageKind = "model_request" | "cache_warm";
export type LlmUsageSource = "pi_message_end" | "pi_usage_entry";
export type LlmUsageStatus = "reported" | "partial" | "estimated" | "missing";
export type LlmCostStatus = "catalog_estimate" | "unknown";
export type LlmCacheStatus = "catalog" | "observed" | "unknown";

export interface LlmUsageCallInput {
  sessionId: string;
  sourceEntryId?: string | null;
  turnId: string | null;
  requestIndex?: number | null;
  kind: LlmUsageKind;
  usageSource: LlmUsageSource;
  provider: string | null;
  model: string | null;
  usage: unknown;
  priceStatus: LlmCostStatus;
  cacheStatus?: LlmCacheStatus;
  requestShapeHash?: string | null;
  prefixFingerprint?: string | null;
  fingerprintEpoch?: string | null;
  durationMs?: number | null;
  occurredAt?: Date;
}

export interface LlmUsageRecorded { id: string; inserted: boolean; }

export interface LlmUsageQuery {
  windowSeconds?: number;
  from?: Date;
  to?: Date;
  provider?: string;
  model?: string;
  now?: Date;
}

export interface LlmUsageCallRow {
  id: string;
  source_entry_id: string | null;
  session_id: string;
  turn_id: string | null;
  request_index: number | null;
  kind: LlmUsageKind;
  usage_source: LlmUsageSource;
  provider: string | null;
  model: string | null;
  occurred_at: string;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cache_observation_status: LlmCacheStatus;
  request_shape_hash: string | null;
  prefix_fingerprint: string | null;
  fingerprint_epoch: string | null;
  usage_status: LlmUsageStatus;
  cost_input: number | null;
  cost_output: number | null;
  cost_cache_read: number | null;
  cost_cache_write: number | null;
  cost_total: number | null;
  cost_status: LlmCostStatus;
}

interface UsageAggregate {
  calls: number;
  reported_usage_calls: number;
  partial_usage_calls: number;
  missing_usage_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cache_unobserved_calls: number;
  model_input_tokens: number;
  model_cache_read_tokens: number;
  cache_warm_read_tokens: number;
  cache_hit_rate: number | null;
  cost_known_calls: number;
  cost_unknown_calls: number;
  cost_total: number | null;
}

export interface LlmUsageSummary extends UsageAggregate {
  window_seconds: number;
  cache_warm_calls: number;
  by_provider: Record<string, UsageAggregate>;
  by_model: Record<string, UsageAggregate>;
  daily: Array<UsageAggregate & { date: string }>;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function digestOrNull(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function epochOrNull(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : null;
}

function readCost(usage: Record<string, unknown> | null): Record<string, number | null> {
  const cost = asRecord(usage?.cost);
  return {
    input: finiteNonNegative(cost?.input),
    output: finiteNonNegative(cost?.output),
    cacheRead: finiteNonNegative(cost?.cacheRead),
    cacheWrite: finiteNonNegative(cost?.cacheWrite),
    total: finiteNonNegative(cost?.total),
  };
}

function normalizeInput(input: LlmUsageCallInput): Omit<LlmUsageCallRow, "id"> {
  const usage = asRecord(input.usage);
  const tokenValues = {
    input: finiteNonNegative(usage?.input),
    output: finiteNonNegative(usage?.output),
    cacheRead: finiteNonNegative(usage?.cacheRead),
    cacheWrite: finiteNonNegative(usage?.cacheWrite),
  };
  const hasUsage = usage !== null;
  const hasCoreUsage = tokenValues.input !== null && tokenValues.output !== null;
  const usageStatus: LlmUsageStatus = !hasUsage
    ? "missing"
    : hasCoreUsage
      ? "reported"
      : "partial";
  const cost = readCost(usage);
  const costStatus: LlmCostStatus = input.priceStatus === "catalog_estimate" && cost.total !== null
    ? "catalog_estimate"
    : "unknown";
  const costIsKnown = costStatus === "catalog_estimate";
  const duration = finiteNonNegative(input.durationMs);

  return {
    session_id: input.sessionId,
    source_entry_id: input.sourceEntryId ?? null,
    turn_id: input.turnId,
    request_index: Number.isInteger(input.requestIndex) && Number(input.requestIndex) > 0
      ? Number(input.requestIndex)
      : null,
    kind: input.kind,
    usage_source: input.usageSource,
    provider: input.provider,
    model: input.model,
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    duration_ms: duration === null ? null : Math.round(duration),
    input_tokens: tokenValues.input,
    output_tokens: tokenValues.output,
    cache_read_tokens: tokenValues.cacheRead,
    cache_write_tokens: tokenValues.cacheWrite,
    cache_observation_status: input.cacheStatus ?? (tokenValues.cacheRead !== null && tokenValues.cacheWrite !== null ? "observed" : "unknown"),
    request_shape_hash: digestOrNull(input.requestShapeHash),
    prefix_fingerprint: digestOrNull(input.prefixFingerprint),
    fingerprint_epoch: epochOrNull(input.fingerprintEpoch),
    usage_status: usageStatus,
    cost_input: costIsKnown ? cost.input ?? null : null,
    cost_output: costIsKnown ? cost.output ?? null : null,
    cost_cache_read: costIsKnown ? cost.cacheRead ?? null : null,
    cost_cache_write: costIsKnown ? cost.cacheWrite ?? null : null,
    cost_total: costIsKnown ? cost.total ?? null : null,
    cost_status: costStatus,
  };
}

export function recordLlmUsageCall(input: LlmUsageCallInput): LlmUsageRecorded {
  initializeDatabase();
  const row = normalizeInput(input);
  const id = crypto.randomUUID();
  const db = getConnection();
  try {
    const result = db.query(
      `INSERT OR IGNORE INTO llm_usage_calls (
        id, source_entry_id, session_id, turn_id, request_index, kind, usage_source, provider, model,
        occurred_at, duration_ms, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, cache_observation_status, request_shape_hash, prefix_fingerprint, fingerprint_epoch,
        usage_status, cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total, cost_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      row.source_entry_id,
      row.session_id,
      row.turn_id,
      row.request_index,
      row.kind,
      row.usage_source,
      row.provider,
      row.model,
      row.occurred_at,
      row.duration_ms,
      row.input_tokens,
      row.output_tokens,
      row.cache_read_tokens,
      row.cache_write_tokens,
      row.cache_observation_status,
      row.request_shape_hash,
      row.prefix_fingerprint,
      row.fingerprint_epoch,
      row.usage_status,
      row.cost_input,
      row.cost_output,
      row.cost_cache_read,
      row.cost_cache_write,
      row.cost_total,
      row.cost_status,
    );
    return { id, inserted: result.changes > 0 };
  } finally {
    db.close();
  }
}

function normalizedWindow(windowSeconds = LLM_USAGE_RETENTION_SECONDS): number {
  return Math.max(1, Math.min(LLM_USAGE_RETENTION_SECONDS, Math.floor(windowSeconds)));
}

function queryWindowSeconds(query: LlmUsageQuery): number {
  const now = query.now ?? new Date();
  const retentionStart = now.getTime() - LLM_USAGE_RETENTION_SECONDS * 1000;
  const requestedStart = query.from?.getTime() ?? (now.getTime() - normalizedWindow(query.windowSeconds) * 1000);
  const start = Math.max(retentionStart, requestedStart);
  const end = Math.min(now.getTime(), query.to?.getTime() ?? now.getTime());
  return Math.max(1, Math.ceil((end - start) / 1000));
}

function buildWhere(query: LlmUsageQuery): { clause: string; values: Array<string> } {
  const now = query.now ?? new Date();
  const retentionStart = now.getTime() - LLM_USAGE_RETENTION_SECONDS * 1000;
  const requestedStart = query.from?.getTime() ?? (now.getTime() - normalizedWindow(query.windowSeconds) * 1000);
  const start = new Date(Math.max(retentionStart, requestedStart)).toISOString();
  const end = new Date(Math.min(now.getTime(), query.to?.getTime() ?? now.getTime())).toISOString();
  const filters = ["occurred_at >= ?", "occurred_at <= ?"];
  const values: Array<string> = [start, end];
  if (query.provider) {
    filters.push("provider = ?");
    values.push(query.provider);
  }
  if (query.model) {
    filters.push("model = ?");
    values.push(query.model);
  }
  return { clause: filters.join(" AND "), values };
}

export function getRecentLlmUsageCalls(query: LlmUsageQuery = {}): LlmUsageCallRow[] {
  initializeDatabase();
  const db = getConnection();
  const where = buildWhere(query);
  try {
    return db.query(
      `SELECT * FROM llm_usage_calls WHERE ${where.clause} ORDER BY occurred_at DESC, rowid DESC LIMIT 500`,
    ).all(...where.values) as LlmUsageCallRow[];
  } finally {
    db.close();
  }
}

function emptyAggregate(): UsageAggregate {
  return {
    calls: 0,
    reported_usage_calls: 0,
    partial_usage_calls: 0,
    missing_usage_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cache_unobserved_calls: 0,
    model_input_tokens: 0,
    model_cache_read_tokens: 0,
    cache_warm_read_tokens: 0,
    cache_hit_rate: null,
    cost_known_calls: 0,
    cost_unknown_calls: 0,
    cost_total: null,
  };
}

function addRow(aggregate: UsageAggregate, row: LlmUsageCallRow): void {
  aggregate.calls += 1;
  if (row.usage_status === "reported") aggregate.reported_usage_calls += 1;
  else if (row.usage_status === "partial") aggregate.partial_usage_calls += 1;
  else if (row.usage_status === "missing") aggregate.missing_usage_calls += 1;

  if (row.input_tokens !== null) aggregate.input_tokens += row.input_tokens;
  if (row.output_tokens !== null) aggregate.output_tokens += row.output_tokens;
  if (row.cache_read_tokens !== null) aggregate.cache_read_tokens += row.cache_read_tokens;
  if (row.cache_write_tokens !== null) aggregate.cache_write_tokens += row.cache_write_tokens;
  if (row.kind === "cache_warm") {
    aggregate.cache_warm_read_tokens += row.cache_read_tokens ?? 0;
  } else {
    if (row.input_tokens !== null) aggregate.model_input_tokens += row.input_tokens;
    if (row.cache_read_tokens !== null) aggregate.model_cache_read_tokens += row.cache_read_tokens;
    if (row.cache_observation_status === "unknown" || row.input_tokens === null || row.cache_read_tokens === null || row.cache_write_tokens === null) aggregate.cache_unobserved_calls += 1;
  }

  if (row.cost_status === "catalog_estimate" && row.cost_total !== null) {
    aggregate.cost_known_calls += 1;
    aggregate.cost_total = (aggregate.cost_total ?? 0) + row.cost_total;
  } else {
    aggregate.cost_unknown_calls += 1;
  }
}

function finalizeAggregate(aggregate: UsageAggregate): UsageAggregate {
  const fullyObserved = aggregate.cache_unobserved_calls === 0;
  const totalInput = aggregate.model_input_tokens + aggregate.model_cache_read_tokens;
  aggregate.cache_hit_rate = fullyObserved && totalInput > 0
    ? aggregate.model_cache_read_tokens / totalInput
    : null;
  if (aggregate.cost_unknown_calls > 0 || aggregate.cost_known_calls === 0) aggregate.cost_total = null;
  return aggregate;
}

export function getLlmUsageSummary(query: LlmUsageQuery = {}): LlmUsageSummary {
  initializeDatabase();
  const db = getConnection();
  const where = buildWhere(query);
  try {
    const rows = db.query(
      `SELECT * FROM llm_usage_calls WHERE ${where.clause} ORDER BY occurred_at ASC, rowid ASC`,
    ).all(...where.values) as LlmUsageCallRow[];
    const totals = emptyAggregate();
    const byProvider = new Map<string, UsageAggregate>();
    const byModel = new Map<string, UsageAggregate>();
    const dailyMap = new Map<string, UsageAggregate>();
    let cacheWarmCalls = 0;

    for (const row of rows) {
      addRow(totals, row);
      if (row.kind === "cache_warm") cacheWarmCalls += 1;
      if (row.provider) {
        const aggregate = byProvider.get(row.provider) ?? emptyAggregate();
        addRow(aggregate, row);
        byProvider.set(row.provider, aggregate);
      }
      if (row.model) {
        const modelKey = `${row.provider ?? "unknown"}/${row.model}`;
        const aggregate = byModel.get(modelKey) ?? emptyAggregate();
        addRow(aggregate, row);
        byModel.set(modelKey, aggregate);
      }
      const day = row.occurred_at.slice(0, 10);
      const dayAggregate = dailyMap.get(day) ?? emptyAggregate();
      addRow(dayAggregate, row);
      dailyMap.set(day, dayAggregate);
    }

    const aggregateRecord = (map: Map<string, UsageAggregate>) => Object.fromEntries(
      [...map.entries()].map(([key, aggregate]) => [key, finalizeAggregate(aggregate)]),
    );
    return {
      window_seconds: queryWindowSeconds(query),
      ...finalizeAggregate(totals),
      cache_warm_calls: cacheWarmCalls,
      by_provider: aggregateRecord(byProvider),
      by_model: aggregateRecord(byModel),
      daily: [...dailyMap.entries()].map(([date, aggregate]) => ({
        date,
        ...finalizeAggregate(aggregate),
      })),
    };
  } finally {
    db.close();
  }
}

export function pruneExpiredLlmUsage(now = new Date()): number {
  initializeDatabase();
  const cutoff = new Date(now.getTime() - LLM_USAGE_RETENTION_SECONDS * 1000).toISOString();
  const db = getConnection();
  try {
    const result = db.query("DELETE FROM llm_usage_calls WHERE occurred_at < ?").run(cutoff);
    return result.changes;
  } finally {
    db.close();
  }
}

let retentionTimer: ReturnType<typeof setInterval> | null = null;

export function startLlmUsageRetentionTask(): void {
  if (retentionTimer) return;
  pruneExpiredLlmUsage();
  retentionTimer = setInterval(() => {
    try {
      pruneExpiredLlmUsage();
    } catch (error) {
      console.warn(`[llm-usage] retention cleanup failed: ${String(error)}`);
    }
  }, 24 * 60 * 60 * 1000);
  retentionTimer.unref?.();
}
