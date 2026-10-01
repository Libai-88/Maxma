/**
 * runtime-status.ts — 运行时状态词表（api/runtime_status.py 的 Bun 直译，
 * 阶段二 2.5b）。
 *
 * 仅数据契约 + 确定性归一化：脱敏正则、reason_code 映射、用户摘要、
 * RuntimeStatus.health 构造。重试策略与持久化任务留在各自组件所有者。
 */

export type HealthState = "ok" | "degraded" | "error";

// Python re 模式 → JS（(?i)→i flag；\s 字符类内直接保留）
const SENSITIVE_ASSIGNMENT =
  /(?:api[_ -]?key|authorization|access[_ -]?token|refresh[_ -]?token|bearer|token|secret|password|credential)\s*(?:=|:|\s)\s*[^\s,;]+/gi;
const SENSITIVE_BEARER = /(?:authorization\s*:\s*bearer\s+|bearer\s+)\S+/gi;
const SENSITIVE_QUERY = /[?&](?:api[_-]?key|token|secret|password|authorization)=[^\s&#]+/gi;

/** 去除公开文本中的凭据与敏感 URL query 值。 */
export function sanitizeUserDetail(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  let sanitized = value.replace(SENSITIVE_QUERY, "?[redacted query]");
  sanitized = sanitized.replace(SENSITIVE_BEARER, "[redacted credential]");
  return sanitized.replace(SENSITIVE_ASSIGNMENT, "[redacted credential]");
}

/** 把上游不稳定文本映射到小的稳定 reason-code 词表。 */
export function reasonCodeFor(status: HealthState, technicalDetail?: string | null): string | null {
  if (status === "ok") return null;
  const detail = (technicalDetail ?? "").toLowerCase();
  if (detail.includes("401") || detail.includes("403") || detail.includes("authentication") || detail.includes("permission") || detail.includes("unauthorized") || detail.includes("forbidden")) {
    return "authentication_failed";
  }
  if (detail.includes("429") || detail.includes("rate limit") || detail.includes("rate_limit") || detail.includes("too many requests")) {
    return "rate_limited";
  }
  if (
    detail.includes("400") || detail.includes("404") || detail.includes("413") || detail.includes("422") ||
    detail.includes("invalid configuration") || detail.includes("invalid request") ||
    detail.includes("configuration error") || detail.includes("base url")
  ) {
    return "invalid_configuration";
  }
  if (detail.includes("timeout") || detail.includes("timed out") || detail.includes("deadline")) {
    return "request_timed_out";
  }
  if (detail.includes("connection") || detail.includes("network") || detail.includes("dns") || detail.includes("unreachable")) {
    return "network_unavailable";
  }
  return status === "degraded" ? "runtime_degraded" : "runtime_error";
}

/** 返回安全摘要（不暴露上游实现细节）。 */
export function userSummaryFor(reasonCode: string | null | undefined): string | null {
  const summaries: Record<string, string> = {
    authentication_failed: "Configuration could not be authenticated.",
    rate_limited: "The upstream service is rate limited.",
    invalid_configuration: "The provider configuration needs attention.",
    request_timed_out: "The upstream request timed out.",
    network_unavailable: "The upstream service is unreachable.",
    runtime_degraded: "The component is temporarily degraded.",
    runtime_error: "The component is unavailable.",
  };
  return reasonCode ? summaries[reasonCode] ?? null : null;
}

/** 公开状态 + 非序列化技术上下文（组件所有者使用）。 */
export interface RuntimeStatusValue {
  status: HealthState;
  reason_code: string | null;
  retry_at: number | null;
  updated_at: number;
  summary: string | null;
  technical_detail: string | null;
}

export function runtimeHealth(
  status: HealthState,
  technicalDetail?: string | null,
  opts?: { retryAt?: number | null; updatedAt?: number | null },
): RuntimeStatusValue {
  const reasonCode = reasonCodeFor(status, technicalDetail);
  return {
    status,
    reason_code: reasonCode,
    retry_at: opts?.retryAt ?? null,
    updated_at: opts?.updatedAt ?? Date.now() / 1000,
    summary: userSummaryFor(reasonCode),
    technical_detail: technicalDetail ?? null,
  };
}
