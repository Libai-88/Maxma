/**
 * health.ts — 后端四部件健康自检（api/health.py 的 Bun 直译，阶段二 2.5b）。
 *
 * LLM / 记忆 / 原生工具集 / MCP 工具集。序列化形状对齐 Python
 * `HealthResponse.model_dump(exclude_none=True)`：字段按模型定义顺序，
 * null 字段省略。
 *
 * 架构适配（kernel in-process，无独立 sidecar 进程）：
 *   - llm：无活跃会话 → ok（内核常驻进程内，无远端可探）；有活跃会话 →
 *     对首个会话调 get_health RPC，pi 桥返回 {ok:true,...} → ok。
 *     结果缓存 60s（UX-HEALTH-001，前端 30s 轮询不重复探测）。
 *   - memory：memory/ 包已移除，恒 ok（detail 与 Python 逐字一致）。
 *   - native_tools：BUILTIN_TOOLS 计数（Python app.state.native_tools 同源）。
 *   - mcp_tools：Python app.state.mcp_tools 自阶段一后恒 [] → 对齐常量。
 *   - ltm：Python 恒 None → exclude_none 省略该字段。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { bundleDir } from "./app-paths";
import { appVersion } from "./app-version";
import { getAppSettings } from "./config-settings";
import { runtimeHealth, sanitizeUserDetail, type HealthState } from "./runtime-status";
import { BUILTIN_TOOLS } from "./routes/tools";

export interface HealthDeps {
  /** 活跃 kernel 会话 id（llm 探测目标）。 */
  sessionIds: () => string[];
  callRpc: (method: string, params: Record<string, unknown>) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
}

/** ComponentHealth 构造（对齐 Pydantic validator 链：sanitize detail + 填充 runtime 字段 + exclude_none）。 */
export function componentHealth(
  status: HealthState,
  opts?: { latencyMs?: number | null; detail?: string | null; retryAt?: number | null },
): Record<string, unknown> {
  const rt = runtimeHealth(status, opts?.detail ?? null, { retryAt: opts?.retryAt ?? null });
  const out: Record<string, unknown> = { status };
  if (opts?.latencyMs != null) out.latency_ms = opts.latencyMs;
  const publicDetail = sanitizeUserDetail(rt.technical_detail);
  if (publicDetail != null && publicDetail !== undefined) out.detail = publicDetail;
  if (rt.reason_code != null) out.reason_code = rt.reason_code;
  if (rt.retry_at != null) out.retry_at = rt.retry_at;
  out.updated_at = rt.updated_at;
  if (rt.summary != null) out.summary = rt.summary;
  return out;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// UX-HEALTH-001：探测结果缓存（60s）
let probeCache: { ts: number; health: Record<string, unknown> } | null = null;
const PROBE_TTL = 60_000;

/** 测试隔离用：清空探测缓存。 */
export function resetHealthProbeCache(): void {
  probeCache = null;
}

async function checkLlm(deps: HealthDeps): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (probeCache && now - probeCache.ts < PROBE_TTL) return probeCache.health;

  let health: Record<string, unknown>;
  const sessionIds = deps.sessionIds();
  if (sessionIds.length === 0) {
    // kernel in-process：无活跃会话可探 → 常驻就绪（对齐 Python 默认分支语义）
    health = componentHealth("ok", {
      latencyMs: 0.0,
      detail: "LLM 由 pi 内核管理，未执行远端探测",
    });
  } else {
    const start = performance.now();
    try {
      const res = await deps.callRpc("get_health", { session_id: sessionIds[0] });
      const elapsed = round1(performance.now() - start);
      if (res.ok && (res.result as Record<string, unknown>)?.ok === true) {
        const message = (res.result as Record<string, unknown>).message;
        health = componentHealth("ok", {
          latencyMs: elapsed,
          detail: typeof message === "string" && message ? message : "pi 内核健康",
        });
      } else {
        health = componentHealth("error", {
          latencyMs: elapsed,
          detail: res.ok ? "内核报告异常" : String(res.error),
        });
      }
    } catch (err) {
      health = componentHealth("error", { detail: `内核健康检查失败: ${String(err)}` });
    }
  }

  probeCache = { ts: now, health };
  return health;
}

function checkMemory(): Record<string, unknown> {
  return componentHealth("ok", {
    latencyMs: 0.0,
    detail: "memory/ 包已移除，由 OMP recall/reflect/retain 替代",
  });
}

function checkNativeTools(): Record<string, unknown> {
  const start = performance.now();
  const elapsed = round1(performance.now() - start);
  return componentHealth("ok", {
    latencyMs: elapsed,
    detail: `${BUILTIN_TOOLS.length} 个工具`,
  });
}

function checkMcpTools(): Record<string, unknown> {
  const start = performance.now();
  const elapsed = round1(performance.now() - start);
  // Python app.state.mcp_tools 自阶段一后恒 []（无 MCP manager 填充）
  return componentHealth("ok", {
    latencyMs: elapsed,
    detail: "0 个工具（未配置 MCP 服务器）",
  });
}

/** .omp/skills 子目录计数（对齐 Python OMP_SKILLS_DIR.is_dir() + iterdir）。 */
export function countOmpSkills(): number {
  const dir = path.join(bundleDir(), ".omp", "skills");
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return 0;
    return fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isDirectory()).length;
  } catch {
    return 0;
  }
}

/** 四部件健康报告（对齐 get_health_report，probe_remote 恒为 Python 服务端硬编码 True）。 */
export async function getHealthReport(deps: HealthDeps): Promise<Record<string, unknown>> {
  const settings = getAppSettings();
  const llm = await checkLlm(deps);
  const memory = checkMemory();
  const nativeTools = checkNativeTools();
  const mcpTools = checkMcpTools();
  const skillsCount = countOmpSkills();

  const all = [llm, memory, nativeTools, mcpTools];
  const overall = all.every((c) => c.status === "ok") ? "ok" : "degraded";

  return {
    status: overall,
    version: appVersion(),
    llm,
    memory,
    native_tools: nativeTools,
    mcp_tools: mcpTools,
    anthropic_skills_count: skillsCount,
    // ltm: Python 恒 None → exclude_none 省略
    provider_diagnostics_enabled: settings.provider_diagnostics_enabled,
    think_path_enabled: settings.think_path_enabled,
    timestamp: Date.now() / 1000,
  };
}
