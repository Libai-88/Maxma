/**
 * services/memory-store.ts — 记忆 v2 的三层存储（M4 / MEM-1）。
 *
 * 三层是**真实的三份数据**，不是同一个 YAML 里的标签：
 *   persona  <data>/config/personas/memory.yaml       （跨项目长期事实，原有文件）
 *   project  <data>/memory/projects/<key>.yaml        （项目知识，按项目 key 分文件）
 *   session  <data>/memory/sessions/<key>.jsonl       （会话事件，只追加）
 *
 * 为什么这样分：人格记忆可以跟着用户走，项目知识换项目就该看不见，会话事件
 * 不应该污染长期记忆。导出/导入按三层打包，导入默认合并、可选替换。
 *
 * 边界：
 *   - 只接受安全 key（字母数字 . _ -），不接受路径；项目/会话 key 由调用方给；
 *   - 单文件 8 MiB、单次导入 5000 条上限，超限整批拒绝；
 *   - 写入仍是临时文件 + rename；导入先全部校验再落盘，避免写一半。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { dataDir, getPersonasDataDir } from "../app-paths";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_ENTRIES = 5_000;

const bunYaml = (
  globalThis as typeof globalThis & {
    Bun: { YAML: { parse(text: string): unknown; stringify(value: unknown): string } };
  }
).Bun.YAML;

export type MemoryScope = "persona" | "project" | "session";

export interface MemoryFactRecord {
  id: string;
  content: string;
  category: string;
  updatedAt: string;
  scope: MemoryScope;
  /** 项目文件名 / 会话文件名；persona 为空。 */
  source?: string;
}

export interface MemoryBundle {
  version: 1;
  exportedAt: string;
  persona: Record<string, unknown>;
  projects: Record<string, Record<string, unknown>>;
  sessions: Record<string, Array<Record<string, unknown>>>;
}

export function memoryRoot(): string {
  return path.join(dataDir(), "memory");
}

export function projectsDir(): string {
  return path.join(memoryRoot(), "projects");
}

export function sessionsDir(): string {
  return path.join(memoryRoot(), "sessions");
}

export function conflictsLogPath(): string {
  return path.join(memoryRoot(), "conflicts.jsonl");
}

export function personaMemoryPath(): string {
  return path.join(getPersonasDataDir(), "memory.yaml");
}

/** 只允许安全 key；非法直接拒绝，绝不把请求体拼进路径。 */
export function safeMemoryKey(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
  const key = value.trim();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(key)) throw new Error(`${label} 只允许字母数字 . _ -（最多 80 字符）`);
  return key;
}

function readSizeLimited(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function loadYamlDocument(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return {};
  const raw = readSizeLimited(file);
  if (raw === null) return null;
  try {
    const parsed = bunYaml.parse(raw) as unknown;
    if (parsed === null || parsed === undefined) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw error;
  }
}

function writeYamlDocument(file: string, document: Record<string, unknown>): void {
  atomicWrite(file, bunYaml.stringify(document));
}

function isExpired(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = new Date(value.trim().replace(" ", "T"));
  return Number.isFinite(parsed.getTime()) && Date.now() >= parsed.getTime();
}

export function projectFacts(document: Record<string, unknown>, scope: MemoryScope, source?: string): MemoryFactRecord[] {
  const facts: MemoryFactRecord[] = [];
  for (const [rawId, rawItem] of Object.entries(document)) {
    const id = String(rawId);
    if (id.startsWith("_") || rawItem === null || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    if (isExpired(item.expires_at)) continue;
    const content = item.description ?? item.content;
    if (typeof content !== "string" || !content.trim()) continue;
    const category = item.theme ?? item.category ?? "other";
    facts.push({
      id,
      content,
      category: String(category || "other"),
      updatedAt: String(item.latest_update_time ?? item.updatedAt ?? ""),
      scope,
      ...(source ? { source } : {}),
    });
  }
  return facts;
}

function readSessionEvents(file: string, source: string): MemoryFactRecord[] {
  const raw = readSizeLimited(file);
  if (raw === null) return [];
  const out: MemoryFactRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.content !== "string" || !parsed.content.trim()) continue;
      out.push({
        id: typeof parsed.id === "string" ? parsed.id : `${source}-${out.length}`,
        content: parsed.content,
        category: typeof parsed.category === "string" ? parsed.category : "事件",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
        scope: "session",
        source,
      });
    } catch {
      // 单行坏数据不拖垮整个文件。
    }
  }
  return out;
}

function listLayerFiles(dir: string, ext: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith(ext) && !name.includes(".tmp"))
      .sort();
  } catch {
    return [];
  }
}

export function listMemories(scope: MemoryScope | "all"): MemoryFactRecord[] {
  const facts: MemoryFactRecord[] = [];
  if (scope === "persona" || scope === "all") {
    const document = loadYamlDocument(personaMemoryPath());
    if (document) facts.push(...projectFacts(document, "persona"));
  }
  if (scope === "project" || scope === "all") {
    for (const name of listLayerFiles(projectsDir(), ".yaml")) {
      const document = loadYamlDocument(path.join(projectsDir(), name));
      if (document) facts.push(...projectFacts(document, "project", name.slice(0, -5)));
    }
  }
  if (scope === "session" || scope === "all") {
    for (const name of listLayerFiles(sessionsDir(), ".jsonl")) {
      facts.push(...readSessionEvents(path.join(sessionsDir(), name), name.slice(0, -6)));
    }
  }
  return facts;
}

export function memoryStats(scope: MemoryScope | "all"): { total: number; categories: Record<string, number>; scopes: Record<MemoryScope, number> } {
  const facts = listMemories(scope);
  const categories: Record<string, number> = {};
  const scopes: Record<MemoryScope, number> = { persona: 0, project: 0, session: 0 };
  for (const fact of facts) {
    categories[fact.category] = (categories[fact.category] ?? 0) + 1;
    scopes[fact.scope] += 1;
  }
  return { total: facts.length, categories, scopes };
}

export interface AddMemoryInput {
  scope: MemoryScope;
  content: string;
  category?: string;
  /** project/session 层必需。 */
  key?: string;
}

export function addMemory(input: AddMemoryInput): MemoryFactRecord {
  const content = input.content.trim();
  if (!content) throw new Error("content 不能为空");
  if (content.length > 4_000) throw new Error("content 超过 4000 字符");
  const category = (input.category ?? "").trim() || "其他";
  const now = localTimestamp();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (input.scope === "persona") {
    const document = loadYamlDocument(personaMemoryPath()) ?? {};
    document[id] = { description: content, theme: category, latest_update_time: now, history: [] };
    writeYamlDocument(personaMemoryPath(), document);
  } else if (input.scope === "project") {
    const key = safeMemoryKey(input.key, "project key");
    const file = path.join(projectsDir(), `${key}.yaml`);
    const document = loadYamlDocument(file) ?? {};
    document[id] = { description: content, theme: category, latest_update_time: now, history: [] };
    writeYamlDocument(file, document);
  } else {
    const key = safeMemoryKey(input.key, "session key");
    const file = path.join(sessionsDir(), `${key}.jsonl`);
    const event = { id, content, category, updatedAt: now };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
  }
  return { id, content, category, updatedAt: now, scope: input.scope, ...(input.key ? { source: input.key } : {}) };
}

export function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function exportMemoryBundle(): MemoryBundle {
  const persona = loadYamlDocument(personaMemoryPath()) ?? {};
  const projects: Record<string, Record<string, unknown>> = {};
  for (const name of listLayerFiles(projectsDir(), ".yaml")) {
    const document = loadYamlDocument(path.join(projectsDir(), name));
    if (document) projects[name.slice(0, -5)] = document;
  }
  const sessions: Record<string, Array<Record<string, unknown>>> = {};
  for (const name of listLayerFiles(sessionsDir(), ".jsonl")) {
    const key = name.slice(0, -6);
    const facts = readSessionEvents(path.join(sessionsDir(), name), key);
    sessions[key] = facts.map((f) => ({ id: f.id, content: f.content, category: f.category, updatedAt: f.updatedAt }));
  }
  return { version: 1, exportedAt: new Date().toISOString(), persona, projects, sessions };
}

function validateBundle(raw: unknown): MemoryBundle {
  if (!raw || typeof raw !== "object") throw new Error("导入包必须是对象");
  const bundle = raw as Partial<MemoryBundle>;
  if (bundle.version !== 1) throw new Error("导入包 version 必须是 1");
  if (!bundle.persona || typeof bundle.persona !== "object" || Array.isArray(bundle.persona)) throw new Error("persona 必须是对象");
  if (!bundle.projects || typeof bundle.projects !== "object" || Array.isArray(bundle.projects)) throw new Error("projects 必须是对象");
  if (!bundle.sessions || typeof bundle.sessions !== "object" || Array.isArray(bundle.sessions)) throw new Error("sessions 必须是对象");
  let count = Object.keys(bundle.persona).length;
  const projects: Record<string, Record<string, unknown>> = {};
  for (const [rawKey, rawDoc] of Object.entries(bundle.projects)) {
    const key = safeMemoryKey(rawKey, "project key");
    if (!rawDoc || typeof rawDoc !== "object" || Array.isArray(rawDoc)) throw new Error(`项目 ${key} 的内容必须是对象`);
    const doc = rawDoc as Record<string, unknown>;
    count += Object.keys(doc).length;
    if (count > MAX_IMPORT_ENTRIES) throw new Error(`导入条目超过 ${MAX_IMPORT_ENTRIES} 上限`);
    projects[key] = doc;
  }
  const sessions: Record<string, Array<Record<string, unknown>>> = {};
  for (const [rawKey, rawEvents] of Object.entries(bundle.sessions)) {
    const key = safeMemoryKey(rawKey, "session key");
    if (!Array.isArray(rawEvents)) throw new Error(`会话 ${key} 必须是事件数组`);
    count += rawEvents.length;
    if (count > MAX_IMPORT_ENTRIES) throw new Error(`导入条目超过 ${MAX_IMPORT_ENTRIES} 上限`);
    sessions[key] = rawEvents.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === "object" && !Array.isArray(event));
  }
  return { version: 1, exportedAt: String(bundle.exportedAt ?? ""), persona: bundle.persona as Record<string, unknown>, projects, sessions };
}

export interface ImportResult {
  persona: number;
  projects: number;
  sessions: number;
  mode: "merge" | "replace";
}

/** 导入：先整包校验，再落盘；merge 按 id 覆盖同 id，replace 直接替换整层。 */
export function importMemoryBundle(raw: unknown, mode: "merge" | "replace" = "merge"): ImportResult {
  const bundle = validateBundle(raw);
  const personaExisting = mode === "merge" ? loadYamlDocument(personaMemoryPath()) ?? {} : {};
  const persona = { ...personaExisting, ...bundle.persona };
  const projectCount = Object.keys(bundle.projects).length;
  const sessionCount = Object.keys(bundle.sessions).length;

  writeYamlDocument(personaMemoryPath(), persona);
  for (const [key, document] of Object.entries(bundle.projects)) {
    const file = path.join(projectsDir(), `${key}.yaml`);
    const existing = mode === "merge" ? loadYamlDocument(file) ?? {} : {};
    writeYamlDocument(file, { ...existing, ...document });
  }
  for (const [key, events] of Object.entries(bundle.sessions)) {
    const file = path.join(sessionsDir(), `${key}.jsonl`);
    const lines = events.map((event) => JSON.stringify({
      id: typeof event.id === "string" ? event.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: typeof event.content === "string" ? event.content : "",
      category: typeof event.category === "string" ? event.category : "事件",
      updatedAt: typeof event.updatedAt === "string" ? event.updatedAt : localTimestamp(),
    })).filter((line) => JSON.parse(line).content);
    if (mode === "replace") atomicWrite(file, `${lines.join("\n")}${lines.length ? "\n" : ""}`);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (lines.length) fs.appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
    }
  }
  return { persona: Object.keys(bundle.persona).length, projects: projectCount, sessions: sessionCount, mode };
}

export function appendConflictDecision(record: Record<string, unknown>): void {
  try {
    fs.mkdirSync(memoryRoot(), { recursive: true });
    fs.appendFileSync(conflictsLogPath(), `${JSON.stringify({ timestamp: new Date().toISOString(), ...record })}\n`, "utf8");
  } catch (error) {
    console.warn("[memory] conflict log write failed:", error);
  }
}
