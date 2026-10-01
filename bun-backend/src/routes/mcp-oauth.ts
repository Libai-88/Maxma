/**
 * routes/mcp-oauth.ts — MCP OAuth 授权流程（api/routes/mcp_oauth.py 的
 * Bun 直译，阶段二 2.4b）。端点挂载在 mcp.ts（与 Python 版模块分工一致）。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { getMcpOAuthTokensPath } from "../app-paths";
import { BunYamlSafeParse, writeYamlAtomic } from "../yaml-store";
import { McpHttpError } from "./mcp-validation";

export interface OAuthPendingState {
  server_name: string;
  redirect_uri: string;
  client_id: string;
  created_at: number;
}

/** 内存中暂存 OAuth state（防 CSRF）。 */
export const oauthPendingStates = new Map<string, OAuthPendingState>();

export interface OauthTokenInfo {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number;
  scope?: string;
  authorized_at?: number;
  [k: string]: unknown;
}

export function loadOauthTokens(): Record<string, OauthTokenInfo> {
  const file = getMcpOAuthTokensPath();
  if (!fs.existsSync(file)) return {};
  const raw = BunYamlSafeParse(fs.readFileSync(file, "utf8"));
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, OauthTokenInfo>) : {};
}

export function saveOauthTokens(tokens: Record<string, OauthTokenInfo>): void {
  fs.mkdirSync(path.dirname(getMcpOAuthTokensPath()), { recursive: true });
  writeYamlAtomic(getMcpOAuthTokensPath(), tokens);
}

/**
 * 用 authorization code 换取 access token 并持久化（POST/GET 回调共用）。
 * 验证 state（防 CSRF）→ token 端点交换 → 存储 → 清除已用 state。
 */
export async function exchangeOauthCode(
  code: string,
  state: string,
  serverNameOverride?: string | null,
): Promise<Record<string, unknown>> {
  const pending = oauthPendingStates.get(state);
  if (!pending) throw new McpHttpError(400, "无效或已过期的 state 参数");

  const serverName = serverNameOverride || pending.server_name;
  const tokenEndpoint = "https://auth.smithery.ai/token";
  let tokenData: Record<string, unknown>;
  try {
    const resp = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: pending.client_id,
        redirect_uri: pending.redirect_uri,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new McpHttpError(502, `Token 交换失败: ${resp.status}`);
    tokenData = (await resp.json()) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof McpHttpError) throw err;
    throw new McpHttpError(502, `Token 交换失败: ${String(err)}`);
  }

  // OAUTH-RMW-001：读-改-写（Bun 单线程天然原子；保留注释对齐语义）
  const tokens = loadOauthTokens();
  const now = Date.now() / 1000;
  tokens[serverName] = {
    access_token: String(tokenData.access_token ?? ""),
    refresh_token: String(tokenData.refresh_token ?? ""),
    token_type: String(tokenData.token_type ?? "Bearer"),
    expires_at: now + Number(tokenData.expires_in ?? 3600),
    scope: String(tokenData.scope ?? ""),
    authorized_at: now,
  };
  saveOauthTokens(tokens);
  oauthPendingStates.delete(state);

  return {
    status: "authorized",
    server_name: serverName,
    token_type: String(tokenData.token_type ?? "Bearer"),
    expires_in: tokenData.expires_in ?? 3600,
  };
}

/** 生成防 CSRF state（secrets.token_urlsafe(32) 等价）。 */
export function newOauthState(): string {
  return crypto.randomBytes(32).toString("base64url");
}
