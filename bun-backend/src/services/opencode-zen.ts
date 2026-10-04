/**
 * services/opencode-zen.ts — OpenCode Zen 免费模型集成
 * （api/services/opencode_zen.py 的 Bun 直译，阶段二 2.4）。
 *
 * 内置默认供应商（匿名 key=public，开箱即用）+ 官方免费模型列表周期同步。
 * 同步失败静默降级（保留现有 models）；api_key 与 providers 路由同加密信封。
 */

import {
  findProvider,
  loadProviders,
  providersYamlPath,
  saveProviders,
  type ProviderEntry,
} from "../routes/providers";
import { encryptApiKey } from "../security/credential-envelope";
import { getCredentialKeyPath } from "../app-paths";

export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const OPENCODE_ZEN_ANON_API_KEY = "public";
export const OPENCODE_ZEN_PROVIDER_ID = "opencode-zen";
export const OPENCODE_ZEN_LABEL = "OpenCode Zen (免费)";

const FREE_SUFFIX = "-free";
const FREE_HIDDEN_MODELS = new Set(["big-pickle", "hy3-free"]);
const EXTERNAL_BLOCKED_FREE_MODELS = new Set(["mimo-v2.5-free", "mimo-v2.6-flash-free"]);

const SYNC_TIMEOUT = 15_000;
const SYNC_INTERVAL_MS = 6 * 3600 * 1000;
const SYNC_FIRST_DELAY_MS = 3_000;

/** 网络不可用时的兜底免费模型列表（保证新用户首启可用）。 */
const FALLBACK_FREE_MODELS = [
  "space-bunny-free",
  "nemotron-3-ultra-free",
  "north-mini-code-free",
  "laguna-s-2.1-free",
  "ling-3.0-flash-free",
  "big-pickle",
];

const DEFAULT_CONTEXT_WINDOW = 262144;

export function isFreeModel(modelId: unknown): boolean {
  const mid = String(modelId ?? "").trim();
  if (!mid) return false;
  return mid.endsWith(FREE_SUFFIX) || FREE_HIDDEN_MODELS.has(mid);
}

export function isOpenCodeZenModelAvailable(modelId: unknown): boolean {
  const mid = String(modelId ?? "").trim();
  return isFreeModel(mid) && !EXTERNAL_BLOCKED_FREE_MODELS.has(mid);
}

/** 稳定排序：deepseek-v4-flash-free 默认首位，其余按字母序（big-pickle 靠后）。 */
export function orderModels(models: string[]): string[] {
  const prefer = ["space-bunny-free"];
  const head = prefer.filter((m) => models.includes(m));
  const rest = models.filter((m) => !head.includes(m)).sort();
  return [...head, ...rest];
}

/** GET {base}/models 拉取并过滤免费模型（去重保序）；异常 → []。 */
export async function fetchFreeModels(): Promise<string[]> {
  try {
    const resp = await fetch(`${OPENCODE_ZEN_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${OPENCODE_ZEN_ANON_API_KEY}` },
      redirect: "manual",
      signal: AbortSignal.timeout(SYNC_TIMEOUT),
    });
    if (resp.status >= 300) {
      console.warn(`[opencode-zen] models fetch HTTP ${resp.status} (non-fatal)`);
      return [];
    }
    var data: unknown = await resp.json();
  } catch {
    console.warn("[opencode-zen] models fetch failed (non-fatal)");
    return [];
  }
  const models: string[] = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const items = (data as Record<string, unknown>).data;
    if (Array.isArray(items)) {
      for (const m of items) {
        if (!m || typeof m !== "object" || Array.isArray(m)) continue;
        const mid = (m as Record<string, unknown>).id;
        if (typeof mid === "string" && isOpenCodeZenModelAvailable(mid) && !models.includes(mid)) models.push(mid);
      }
    }
  }
  return models;
}

/** 构造内置供应商条目（api_key 加密信封存储）。 */
export function buildProviderEntry(): ProviderEntry {
  return {
    id: OPENCODE_ZEN_PROVIDER_ID,
    provider_type: "openai",
    label: OPENCODE_ZEN_LABEL,
    api_key: encryptApiKey(OPENCODE_ZEN_ANON_API_KEY, getCredentialKeyPath()),
    base_url: OPENCODE_ZEN_BASE_URL,
    models: [...FALLBACK_FREE_MODELS],
    enabled: true,
    context_window: DEFAULT_CONTEXT_WINDOW,
    builtin: true,
  };
}

/** 幂等注入默认供应商（保留用户修改，同时清理已知不可用模型）。 */
export function ensureOpencodeZenProvider(): ProviderEntry | null {
  const items = loadProviders();
  const existing = findProvider(items, OPENCODE_ZEN_PROVIDER_ID);
  if (existing !== null) {
    const models = Array.isArray(existing.models) ? existing.models.filter(isOpenCodeZenModelAvailable) : [];
    if (models.length !== existing.models.length) {
      existing.models = models;
      try {
        saveProviders(items);
      } catch (err) {
        console.error(`[opencode-zen] failed to sanitize provider models: ${String(err)}`);
      }
    }
    return existing;
  }
  const provider = buildProviderEntry();
  // 插入列表头：前端无历史选择时选中第一个 enabled provider
  items.unshift(provider);
  try {
    saveProviders(items);
  } catch (err) {
    console.error(`[opencode-zen] failed to persist default provider: ${String(err)}`);
    return null;
  }
  console.info(`[opencode-zen] default provider injected (id=${OPENCODE_ZEN_PROVIDER_ID})`);
  return provider;
}

function loadProviderModels(): string[] {
  const target = findProvider(loadProviders(), OPENCODE_ZEN_PROVIDER_ID);
  const models = target?.models;
  return Array.isArray(models) ? models.filter(isOpenCodeZenModelAvailable) : [];
}

export interface SyncResult {
  synced: boolean;
  models: string[];
  provider_id: string;
}

/** 从官方同步免费模型列表到 providers.yaml。 */
export async function syncOpencodeZenModels(): Promise<SyncResult> {
  const remote = await fetchFreeModels();
  if (remote.length === 0) {
    console.info("[opencode-zen] sync skipped: no remote free models");
    return { synced: false, models: loadProviderModels(), provider_id: OPENCODE_ZEN_PROVIDER_ID };
  }
  const ordered = orderModels(remote);
  const items = loadProviders();
  let target = findProvider(items, OPENCODE_ZEN_PROVIDER_ID);
  if (target === null) {
    // 理论上 ensure 已注入；双保险：锁内直接补建
    target = buildProviderEntry();
    items.push(target);
  }
  target.models = ordered;
  try {
    saveProviders(items);
  } catch (err) {
    console.error(`[opencode-zen] sync persist failed: ${String(err)}`);
    return { synced: false, models: [...ordered], provider_id: OPENCODE_ZEN_PROVIDER_ID };
  }
  console.info(`[opencode-zen] models synced: ${ordered.length} free models`);
  return { synced: true, models: [...ordered], provider_id: OPENCODE_ZEN_PROVIDER_ID };
}

// ── 后台周期同步任务 ──

let syncTimer: ReturnType<typeof setInterval> | null = null;
let firstDelayTimer: ReturnType<typeof setTimeout> | null = null;

export function startBackgroundSync(): void {
  firstDelayTimer = setTimeout(() => {
    try {
      ensureOpencodeZenProvider();
    } catch (err) {
      console.error(`[opencode-zen] startup ensure failed: ${String(err)}`);
    }
    void runSyncIteration();
    syncTimer = setInterval(() => void runSyncIteration(), SYNC_INTERVAL_MS);
    if (typeof syncTimer.unref === "function") syncTimer.unref();
  }, SYNC_FIRST_DELAY_MS);
  // 不阻塞进程退出（测试/打包场景）；syncTimer 在延迟回调内才创建，unref 在回调内做
  if (typeof firstDelayTimer.unref === "function") firstDelayTimer.unref();
}

async function runSyncIteration(): Promise<void> {
  try {
    await syncOpencodeZenModels();
  } catch (err) {
    console.error(`[opencode-zen] background sync iteration failed: ${String(err)}`);
  }
}

export function stopBackgroundSync(): void {
  if (firstDelayTimer) clearTimeout(firstDelayTimer);
  if (syncTimer) clearInterval(syncTimer);
  firstDelayTimer = null;
  syncTimer = null;
}
