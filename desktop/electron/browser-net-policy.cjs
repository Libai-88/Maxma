/**
 * browser-net-policy.cjs — 内置浏览器的网络 allowlist 策略（纯函数）。
 *
 * 策略默认是 "all"（只允许 http/https 由 browser-view 另行校验）；用户显式切到
 * "allowlist" 后，只有列表中的主机及其子域可以发起网络请求。这里不依赖 Electron，
 * 单测可以直接喂 URL/策略，不需要启动 Chromium。
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_POLICY = Object.freeze({ version: 1, mode: "all", domains: [] });
const MAX_DOMAINS = 200;
const MAX_DOMAIN_LENGTH = 253;

function normalizeDomain(raw) {
  let value = String(raw ?? "").trim().toLowerCase();
  if (!value) throw new Error("域名不能为空");
  if (value.length > MAX_DOMAIN_LENGTH + 8) throw new Error("域名过长");
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname.toLowerCase();
    } catch {
      throw new Error(`不是合法域名：${raw}`);
    }
  } else {
    value = value.split("/")[0].split("?")[0].split("#")[0];
    if (value.includes("@")) value = value.split("@").pop();
  }
  // 允许用户写 *.example.com；语义仍是“example.com 及其子域”。
  value = value.replace(/^\*\./, "").replace(/^\./, "");
  if (value === "*") throw new Error("不允许单独使用 * 作为域名；请把模式切到 all");
  if (/^\[[0-9a-f:]+\]$/i.test(value)) return value;
  if (value.includes(":")) {
    // 主机:端口。IPv6 已在上一个分支处理。
    value = value.split(":")[0];
  }
  if (!value) throw new Error("域名不能为空");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(value)) {
    throw new Error(`不是合法域名：${raw}`);
  }
  return value;
}

/** 接收用户输入（字符串或数组），归一成去重后的域名列表。 */
function normalizeDomains(input) {
  const list = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const domains = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    for (const piece of item.split(/[\s,，;；]+/)) {
      if (!piece.trim()) continue;
      const domain = normalizeDomain(piece);
      if (seen.has(domain)) continue;
      seen.add(domain);
      domains.push(domain);
      if (domains.length > MAX_DOMAINS) throw new Error(`allowlist 最多 ${MAX_DOMAINS} 个域名`);
    }
  }
  return domains;
}

function normalizePolicy(raw) {
  const mode = raw?.mode === "allowlist" ? "allowlist" : raw?.mode === "all" ? "all" : null;
  if (!mode) throw new Error('网络模式只能是 "all" 或 "allowlist"');
  const domains = mode === "allowlist" ? normalizeDomains(raw?.domains ?? []) : [];
  return { version: 1, mode, domains };
}

function hostOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "about:") return "about:blank";
    if (!/^(https?|wss?):$/.test(parsed.protocol)) return "";
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isHostAllowed(host, policy) {
  if (policy?.mode !== "allowlist") return true;
  const value = String(host ?? "").trim().toLowerCase();
  if (!value) return false;
  if (value === "about:blank") return true;
  for (const domain of policy.domains ?? []) {
    if (value === domain) return true;
    // IP/端口只允许精确匹配；域名允许子域。
    if (!/^\[[0-9a-f:]+\]$/i.test(domain) && !/^\d+(?:\.\d+){3}$/.test(domain) && value.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function isUrlAllowedByPolicy(url, policy) {
  if (policy?.mode !== "allowlist") return true;
  if (url === "about:blank") return true;
  const host = hostOf(url);
  if (!host) return false;
  return isHostAllowed(host, policy);
}

function policySummary(policy) {
  const value = policy?.mode === "allowlist" ? policy : DEFAULT_POLICY;
  return {
    mode: value.mode,
    domains: [...(value.domains ?? [])],
    allowAll: value.mode === "all",
  };
}

function readPolicy(policyPath) {
  if (!policyPath) return { ...DEFAULT_POLICY, domains: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    return normalizePolicy(parsed);
  } catch {
    return { ...DEFAULT_POLICY, domains: [] };
  }
}

function writePolicy(policyPath, raw) {
  const policy = normalizePolicy(raw);
  if (!policyPath) return policy;
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  const temp = `${policyPath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(policy, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, policyPath);
  return policy;
}

module.exports = {
  DEFAULT_POLICY,
  MAX_DOMAINS,
  normalizeDomain,
  normalizeDomains,
  normalizePolicy,
  isHostAllowed,
  isUrlAllowedByPolicy,
  policySummary,
  readPolicy,
  writePolicy,
};
