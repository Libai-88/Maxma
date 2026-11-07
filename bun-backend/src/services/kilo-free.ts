/**
 * services/kilo-free.ts — Kilo 免费池集成（内置第二免费车道）。
 *
 * 与 `services/opencode-zen.ts` 同构：内置默认供应商（开箱即用，用户可停用）
 * + 官方免费清单周期同步；同步失败静默降级（保留现有 models）。
 * 与 zen 的两点协议差别（依据见 `bun-sidecar/src/kernel/kilo-free.ts` 文件头）：
 *   - **无凭据**：providers.yaml 的 api_key 只是形状占位（"anonymous" 加密信封），
 *     传输层（kernel 的 kiloFetch）不发任何授权头；
 *   - **可用性门 = 实测白名单**：上游 `isFree: true` 切片须过 kernel 的
 *     "实测 200 并拿到正文"白名单才进目录（新模型不凭清单放行，
 *     与 zen 侧同一纪律——"不能用"只能实测得出）。
 */

import {
  findProvider,
  loadProviders,
  saveProviders,
  type ProviderEntry,
} from "../routes/providers";
import { encryptApiKey } from "../security/credential-envelope";
import { getCredentialKeyPath } from "../app-paths";
import {
  KILO_DEFAULT_CHAT_BASE_URL,
  KILO_DEFAULT_LISTING_BASE_URL,
  KILO_FALLBACK_MODEL_IDS,
  KILO_KNOWN_UNUSABLE_MODEL_IDS,
  KILO_PRIMARY_MODEL_ID,
  KILO_PROVIDER_ID,
} from "../../../bun-sidecar/src/kernel/kilo-free";

export const KILO_LABEL = "Kilo 免费池";

/**
 * 实测白名单：**唯一来源在 `bun-sidecar/src/kernel/kilo-free.ts`**（主模型 +
 * 兜底候选），这里不得出现字面量副本——zen 渠道同一模型 id 曾抄 5 处、
 * 失效改不完的教训。
 */
const VERIFIED_KILO_MODELS = new Set<string>([
  KILO_PRIMARY_MODEL_ID,
  ...KILO_FALLBACK_MODEL_IDS,
]);

const KNOWN_UNUSABLE_KILO_MODELS = new Set<string>(KILO_KNOWN_UNUSABLE_MODEL_IDS);

const SYNC_TIMEOUT = 15_000;
const SYNC_INTERVAL_MS = 6 * 3600 * 1000;
const SYNC_FIRST_DELAY_MS = 3_000;

const DEFAULT_CONTEXT_WINDOW = 256_000;

export function isKiloModelAvailable(modelId: unknown): boolean {
  const mid = String(modelId ?? "").trim();
  if (KNOWN_UNUSABLE_KILO_MODELS.has(mid)) return false;
  return VERIFIED_KILO_MODELS.has(mid);
}

/** 稳定排序：主模型首位，兜底按 kernel 里的实测顺序，其余按字母序。 */
export function orderKiloModels(models: string[]): string[] {
  const prefer = [KILO_PRIMARY_MODEL_ID, ...KILO_FALLBACK_MODEL_IDS];
  const head = prefer.filter((m) => models.includes(m));
  const rest = models.filter((m) => !head.includes(m)).sort();
  return [...head, ...rest];
}

/**
 * GET {listing}/models 拉取 `isFree: true` 切片并过实测白名单（去重保序）。
 * 清单可能是裸数组或 `{ data: [...] }`（OpenAI 兼容两种常见形状，实测为后者）。
 */
export async function fetchKiloFreeModels(): Promise<string[]> {
  try {
    const resp = await fetch(`${KILO_DEFAULT_LISTING_BASE_URL}/models`, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(SYNC_TIMEOUT),
    });
    if (resp.status >= 300) {
      console.warn(`[kilo-free] models fetch HTTP ${resp.status} (non-fatal)`);
      return [];
    }
    var data: unknown = await resp.json();
  } catch {
    console.warn("[kilo-free] models fetch failed (non-fatal)");
    return [];
  }
  const items = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).data)
      ? ((data as Record<string, unknown>).data as unknown[])
      : [];
  const models: string[] = [];
  for (const m of items) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const entry = m as Record<string, unknown>;
    const mid = entry.id;
    if (typeof mid !== "string") continue;
    if (entry.isFree !== true) continue;
    if (!isKiloModelAvailable(mid)) continue;
    if (!models.includes(mid)) models.push(mid);
  }
  return models;
}

/** 构造内置供应商条目（api_key 是形状占位——传输层不发授权头，见文件头）。 */
export function buildKiloProviderEntry(): ProviderEntry {
  return {
    id: KILO_PROVIDER_ID,
    provider_type: "openai",
    label: KILO_LABEL,
    api_key: encryptApiKey("anonymous", getCredentialKeyPath()),
    base_url: KILO_DEFAULT_CHAT_BASE_URL,
    models: orderKiloModels([...VERIFIED_KILO_MODELS]),
    enabled: true,
    context_window: DEFAULT_CONTEXT_WINDOW,
    builtin: true,
  };
}

/** 幂等注入默认供应商（保留用户修改，同时清理已知不可用模型）。 */
export function ensureKiloFreeProvider(): ProviderEntry | null {
  const items = loadProviders();
  const existing = findProvider(items, KILO_PROVIDER_ID);
  if (existing !== null) {
    // providers.yaml 是外部输入：models 可能被手改坏，先归一成数组再比。
    const currentModels = Array.isArray(existing.models) ? existing.models : [];
    const models = currentModels.filter(isKiloModelAvailable);
    if (models.length !== currentModels.length) {
      existing.models = models;
      try {
        saveProviders(items);
      } catch (err) {
        console.error(`[kilo-free] failed to sanitize provider models: ${String(err)}`);
      }
    }
    return existing;
  }
  const provider = buildKiloProviderEntry();
  // 插入列表头之后、zen 之后：免费车道相邻，且不影响 zen 的"首位默认"约定
  const zenIndex = items.findIndex((p) => p.id === "opencode-zen");
  if (zenIndex >= 0) items.splice(zenIndex + 1, 0, provider);
  else items.unshift(provider);
  try {
    saveProviders(items);
  } catch (err) {
    console.error(`[kilo-free] failed to persist default provider: ${String(err)}`);
    return null;
  }
  console.info(`[kilo-free] default provider injected (id=${KILO_PROVIDER_ID})`);
  return provider;
}

function loadKiloProviderModels(): string[] {
  const target = findProvider(loadProviders(), KILO_PROVIDER_ID);
  const models = target?.models;
  return Array.isArray(models) ? models.filter(isKiloModelAvailable) : [];
}

export interface KiloSyncResult {
  synced: boolean;
  models: string[];
  provider_id: string;
}

/** 从官方清单同步免费模型列表到 providers.yaml。 */
export async function syncKiloModels(): Promise<KiloSyncResult> {
  const remote = await fetchKiloFreeModels();
  if (remote.length === 0) {
    console.info("[kilo-free] sync skipped: no remote free models");
    return { synced: false, models: loadKiloProviderModels(), provider_id: KILO_PROVIDER_ID };
  }
  const ordered = orderKiloModels(remote);
  const items = loadProviders();
  let target = findProvider(items, KILO_PROVIDER_ID);
  if (target === null) {
    // 理论上 ensure 已注入；双保险：锁内直接补建
    target = buildKiloProviderEntry();
    items.push(target);
  }
  target.models = ordered;
  try {
    saveProviders(items);
  } catch (err) {
    console.error(`[kilo-free] sync persist failed: ${String(err)}`);
    return { synced: false, models: [...ordered], provider_id: KILO_PROVIDER_ID };
  }
  console.info(`[kilo-free] models synced: ${ordered.length} free models`);
  return { synced: true, models: [...ordered], provider_id: KILO_PROVIDER_ID };
}

// ── 后台周期同步任务（与 zen 同款节奏）──

let syncTimer: ReturnType<typeof setInterval> | undefined;
let firstDelayTimer: ReturnType<typeof setTimeout> | undefined;

export function startKiloBackgroundSync(): void {
  firstDelayTimer = setTimeout(() => {
    try {
      ensureKiloFreeProvider();
    } catch (err) {
      console.error(`[kilo-free] startup ensure failed: ${String(err)}`);
    }
    void runSyncIteration();
    syncTimer = setInterval(() => void runSyncIteration(), SYNC_INTERVAL_MS);
    if (typeof syncTimer.unref === "function") syncTimer.unref();
  }, SYNC_FIRST_DELAY_MS);
  if (typeof firstDelayTimer.unref === "function") firstDelayTimer.unref();
}

async function runSyncIteration(): Promise<void> {
  try {
    await syncKiloModels();
  } catch (err) {
    console.error(`[kilo-free] background sync iteration failed: ${String(err)}`);
  }
}

export function stopKiloBackgroundSync(): void {
  clearTimeout(firstDelayTimer);
  clearInterval(syncTimer);
  firstDelayTimer = undefined;
  syncTimer = undefined;
}
