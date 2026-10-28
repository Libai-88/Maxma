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

import {
  DEFAULT_BASE_URL,
  FREE_LANE_FALLBACK_MODEL_IDS,
  FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS,
  FREE_LANE_PRIMARY_MODEL_ID,
} from "../../../bun-sidecar/src/kernel/opencode-zen";

/**
 * ⚠️ 端点必须与内核**同源**：上游 2026-10 把推理/目录端点从 `/zen/v1` 迁到
 * `/inference/v1`（依据上游仓库 `src/opencode-product.ts` 的 `baseUrl`），
 * 而这里以前自己写了一份旧字面量 —— 同步目录时会打到已废弃的端点，
 * 与内核的聊天路径走进两个不同的上游入口（症状很难归因：
 * 聊天能用、但模型同步"看起来正常却拿不到新模型"）。
 */
export const OPENCODE_ZEN_BASE_URL = DEFAULT_BASE_URL;
export const OPENCODE_ZEN_ANON_API_KEY = "public";
export const OPENCODE_ZEN_PROVIDER_ID = "opencode-zen";
export const OPENCODE_ZEN_LABEL = "Maxma 免费模型";

const FREE_SUFFIX = "-free";
const FREE_HIDDEN_MODELS = new Set(["big-pickle", "hy3-free"]);

/**
 * **实测不可用**的免费模型：即使将来有人把它加进白名单、或上游临时列出来，
 * 也必须拒绝——否则用户选中就必然报错。
 *
 * 清单本体在 kernel（`FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS`），与"可用"的正向常量
 * 放在一处：它们属于同一个事实（免费渠道可用模型集），不该在两个文件里各留一份。
 * 那正是上一轮 `space-bunny-free` 失效时改不完的根因。
 */
const KNOWN_UNUSABLE_FREE_MODELS = new Set<string>(FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS);
/**
 * 免费渠道的模型标识**唯一来源在 `bun-sidecar/src/kernel/opencode-zen.ts`**。
 * 这里以前自己也抄了一份（`EXTERNAL_COMPATIBLE` + `FALLBACK` + `prefer` 三处），
 * 结果上游下架 `space-bunny-free` 之后，五处副本各留一份、失效改不完，
 * 便携包还把它当内置模型展示给用户选（选了必然报错）。
 */
const EXTERNAL_COMPATIBLE_FREE_MODELS = new Set<string>([
  FREE_LANE_PRIMARY_MODEL_ID,
  ...FREE_LANE_FALLBACK_MODEL_IDS,
]);

const SYNC_TIMEOUT = 15_000;
const SYNC_INTERVAL_MS = 6 * 3600 * 1000;
const SYNC_FIRST_DELAY_MS = 3_000;

/** 网络不可用时的兜底免费模型列表（保证新用户首启可用）。 */
const FALLBACK_FREE_MODELS = [
  FREE_LANE_PRIMARY_MODEL_ID,
  ...FREE_LANE_FALLBACK_MODEL_IDS,
];

const DEFAULT_CONTEXT_WINDOW = 262144;

export function isFreeModel(modelId: unknown): boolean {
  const mid = String(modelId ?? "").trim();
  if (!mid) return false;
  return mid.endsWith(FREE_SUFFIX) || FREE_HIDDEN_MODELS.has(mid);
}

export function isOpenCodeZenModelAvailable(modelId: unknown): boolean {
  const mid = String(modelId ?? "").trim();
  if (KNOWN_UNUSABLE_FREE_MODELS.has(mid)) return false;
  return isFreeModel(mid) && EXTERNAL_COMPATIBLE_FREE_MODELS.has(mid);
}

/** 稳定排序：主免费模型首位，其余按字母序（big-pickle 靠后）。 */
export function orderModels(models: string[]): string[] {
  const prefer = [FREE_LANE_PRIMARY_MODEL_ID, ...FREE_LANE_FALLBACK_MODEL_IDS];
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
    // existing.models 的类型是 unknown（providers.yaml 是外部输入，可能被手改坏）。
    // 旧写法 `models.length !== existing.models.length` 在"models 不是数组"时会
    // 直接抛 TypeError——因为三元只保护了左边那次的取值，右边仍对 unknown 取属性。
    // 现在把当前值先归一成数组再比，非数组一律当成空列表（下面会写回正确形状）。
    const currentModels = Array.isArray(existing.models) ? existing.models : [];
    const models = currentModels.filter(isOpenCodeZenModelAvailable);
    if (models.length !== currentModels.length) {
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
