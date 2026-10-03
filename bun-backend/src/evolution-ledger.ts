import * as crypto from "node:crypto";

import { getConnection, initializeDatabase } from "./db/core";

export type EvolutionRuleStatus = "candidate" | "active" | "paused" | "rejected";
export type EvolutionFeedback = "positive" | "negative" | "correct";

export interface EvolutionRule {
  id: string;
  rule_text: string;
  scope: string;
  keywords: string[];
  status: EvolutionRuleStatus;
  confidence: number;
  evidence_count: number;
  positive_count: number;
  negative_count: number;
  source: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface EvolutionCandidate {
  ruleText: string;
  scope: string;
  source: "explicit_user";
}

const MAX_RULE_TEXT = 320;
const MAX_ACTIVE_RULES = 128;
const MAX_CONTEXT_RULES = 3;
const MAX_CONTEXT_CHARS = 900;

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function ruleId(ruleText: string, scope: string): string {
  return crypto.createHash("sha256").update(`${scope}
${ruleText}`).digest("hex").slice(0, 64);
}

function keywordsFor(text: string): string[] {
  const normalized = text.toLowerCase();
  const terms = new Set<string>();
  for (const segment of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let length = 2; length <= Math.min(4, segment.length); length++) {
      for (let index = 0; index + length <= segment.length; index++) {
        terms.add(segment.slice(index, index + length));
      }
    }
  }
  for (const term of normalized.match(/[a-z0-9_]{3,}/gu) ?? []) terms.add(term);
  return [...terms].sort((a, b) => b.length - a.length).slice(0, 64);
}

function cleanRuleText(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[。！？!?]+$/u, "").trim().slice(0, MAX_RULE_TEXT);
}

/** 只接受用户明确表达的长期偏好或行为约束，不从普通对话猜测人格。 */
export function extractEvolutionCandidate(message: string, scope = "global"): EvolutionCandidate | null {
  const text = message.trim();
  if (!text || text.length > 4000) return null;
  const patterns: Array<{ re: RegExp; format: (value: string) => string }> = [
    { re: /^(?:请记住|记住|记一下)[：:,，\s]*(.+)$/u, format: (value) => `遵循用户长期要求：${value}` },
    { re: /^(?:以后|今后|接下来)[：:,，\s]*(.+)$/u, format: (value) => `以后按用户偏好执行：${value}` },
    { re: /^(?:我喜欢|我偏好|我的偏好是)[：:,，\s]*(.+)$/u, format: (value) => `用户偏好：${value}` },
    { re: /^(?:不要|别再|请不要)[：:,，\s]*(.+)$/u, format: (value) => `避免：${value}` },
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern.re);
    if (!match?.[1]) continue;
    const ruleText = cleanRuleText(pattern.format(match[1]));
    if (ruleText.length < 5) return null;
    return { ruleText, scope: scope.trim().slice(0, 80) || "global", source: "explicit_user" };
  }
  return null;
}

function rowToRule(row: Record<string, unknown>): EvolutionRule {
  let keywords: string[] = [];
  try {
    const parsed = JSON.parse(String(row.keywords_json ?? "[]"));
    if (Array.isArray(parsed)) keywords = parsed.filter((item): item is string => typeof item === "string");
  } catch {
    keywords = [];
  }
  return {
    id: String(row.id),
    rule_text: String(row.rule_text ?? ""),
    scope: String(row.scope ?? "global"),
    keywords,
    status: (row.status === "active" || row.status === "paused" || row.status === "rejected" ? row.status : "candidate") as EvolutionRuleStatus,
    confidence: clamp(Number(row.confidence ?? 0)),
    evidence_count: Math.max(0, Number(row.evidence_count ?? 0)),
    positive_count: Math.max(0, Number(row.positive_count ?? 0)),
    negative_count: Math.max(0, Number(row.negative_count ?? 0)),
    source: String(row.source ?? "unknown"),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
  };
}

function appendEvent(ruleIdValue: string | null, eventType: string, sessionId?: string, turnId?: string, detail: Record<string, unknown> = {}): void {
  const db = getConnection();
  try {
    db.query(`INSERT INTO evolution_events (rule_id, event_type, session_id, turn_id, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(ruleIdValue, eventType, sessionId ?? null, turnId ?? null, JSON.stringify(detail), nowIso());
  } finally {
    db.close();
  }
}

export function upsertEvolutionRule(candidate: EvolutionCandidate, sessionId?: string, turnId?: string): EvolutionRule {
  initializeDatabase();
  const text = cleanRuleText(candidate.ruleText);
  const scope = candidate.scope.trim().slice(0, 80) || "global";
  const id = ruleId(text, scope);
  const keywords = keywordsFor(text);
  const timestamp = nowIso();
  const db = getConnection();
  try {
    db.query(`INSERT INTO evolution_rules
      (id, rule_text, scope, keywords_json, status, confidence, evidence_count, positive_count, negative_count, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', 0.72, 1, 1, 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        evidence_count = evolution_rules.evidence_count + 1,
        positive_count = evolution_rules.positive_count + 1,
        confidence = MIN(1.0, evolution_rules.confidence + 0.06),
        status = 'active',
        updated_at = excluded.updated_at`).run(
      id, text, scope, JSON.stringify(keywords), candidate.source, timestamp, timestamp,
    );
    db.query(`DELETE FROM evolution_rules WHERE status = 'active' AND id NOT IN
      (SELECT id FROM evolution_rules WHERE status = 'active' ORDER BY updated_at DESC LIMIT ?)`)
      .run(MAX_ACTIVE_RULES);
  } finally {
    db.close();
  }
  appendEvent(id, "learned", sessionId, turnId, { source: candidate.source });
  return getEvolutionRule(id)!;
}

export function learnFromUserMessage(message: string, sessionId?: string, turnId?: string, scope = "global"): EvolutionRule | null {
  const candidate = extractEvolutionCandidate(message, scope);
  return candidate ? upsertEvolutionRule(candidate, sessionId, turnId) : null;
}

export function getEvolutionRule(id: string): EvolutionRule | null {
  initializeDatabase();
  const db = getConnection();
  try {
    const row = db.query("SELECT * FROM evolution_rules WHERE id = ?").get(id) as Record<string, unknown> | null;
    return row ? rowToRule(row) : null;
  } finally {
    db.close();
  }
}

export function listEvolutionRules(status?: EvolutionRuleStatus): EvolutionRule[] {
  initializeDatabase();
  const db = getConnection();
  try {
    const rows = (status
      ? db.query("SELECT * FROM evolution_rules WHERE status = ? ORDER BY updated_at DESC").all(status)
      : db.query("SELECT * FROM evolution_rules ORDER BY updated_at DESC").all()) as Record<string, unknown>[];
    return rows.map(rowToRule);
  } finally {
    db.close();
  }
}

export function setEvolutionRuleStatus(id: string, status: EvolutionRuleStatus): EvolutionRule | null {
  initializeDatabase();
  const timestamp = nowIso();
  const db = getConnection();
  try {
    db.query("UPDATE evolution_rules SET status = ?, updated_at = ? WHERE id = ?").run(status, timestamp, id);
  } finally {
    db.close();
  }
  appendEvent(id, status === "active" ? "approved" : status, undefined, undefined);
  return getEvolutionRule(id);
}

export function recordEvolutionFeedback(id: string, feedback: EvolutionFeedback, correction?: string, sessionId?: string, turnId?: string): EvolutionRule | null {
  const current = getEvolutionRule(id);
  if (!current) return null;
  if (feedback === "correct" && correction?.trim()) {
    const replacement = upsertEvolutionRule({ ruleText: correction.trim(), scope: current.scope, source: "explicit_user" }, sessionId, turnId);
    setEvolutionRuleStatus(id, "paused");
    return replacement;
  }
  initializeDatabase();
  const positive = feedback === "positive" ? 1 : 0;
  const negative = feedback === "negative" ? 1 : 0;
  const delta = feedback === "positive" ? 0.08 : -0.18;
  const timestamp = nowIso();
  const db = getConnection();
  try {
    db.query(`UPDATE evolution_rules SET
      evidence_count = evidence_count + 1,
      positive_count = positive_count + ?,
      negative_count = negative_count + ?,
      confidence = MAX(0, MIN(1, confidence + ?)),
      status = CASE WHEN confidence + ? < 0.25 THEN 'paused' ELSE status END,
      updated_at = ? WHERE id = ?`).run(positive, negative, delta, delta, timestamp, id);
  } finally {
    db.close();
  }
  appendEvent(id, feedback, sessionId, turnId);
  return getEvolutionRule(id);
}

export function getEvolutionContext(query: string): string {
  const queryText = query.toLowerCase();
  const rules = listEvolutionRules("active");
  const scored = rules.map((rule) => {
    const matches = rule.keywords.filter((keyword) => keyword.length >= 2 && queryText.includes(keyword.toLowerCase()));
    const scopeMatch = rule.scope !== "global" && queryText.includes(rule.scope.toLowerCase());
    return { rule, score: matches.length * 3 + (scopeMatch ? 2 : 0) + rule.confidence };
  }).filter((item) => item.score >= 1.7).sort((a, b) => b.score - a.score || b.rule.updated_at.localeCompare(a.rule.updated_at));
  const selected = scored.slice(0, MAX_CONTEXT_RULES);
  if (selected.length === 0) return "";
  const lines: string[] = [];
  let length = 0;
  for (const { rule } of selected) {
    const line = `- ${rule.rule_text}`;
    if (length + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    length += line.length;
    const db = getConnection();
    try { db.query("UPDATE evolution_rules SET last_used_at = ? WHERE id = ?").run(nowIso(), rule.id); } finally { db.close(); }
  }
  return lines.length ? `\n\n[Maxma EvoCore：仅适用于当前请求的已验证行为策略]\n${lines.join("\n")}` : "";
}

export function evolutionStats(): { total: number; active: number; candidates: number; paused: number; avg_confidence: number } {
  const rules = listEvolutionRules();
  const active = rules.filter((rule) => rule.status === "active");
  const candidates = rules.filter((rule) => rule.status === "candidate");
  const paused = rules.filter((rule) => rule.status === "paused");
  return {
    total: rules.length,
    active: active.length,
    candidates: candidates.length,
    paused: paused.length,
    avg_confidence: rules.length ? Math.round((rules.reduce((sum, rule) => sum + rule.confidence, 0) / rules.length) * 100) / 100 : 0,
  };
}
