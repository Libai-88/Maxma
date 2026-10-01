/**
 * routes/balance.ts — DeepSeek 余额查询（api/routes/balance.py 的 Bun 直译，
 * 阶段二 2.4）。
 *
 * 凭据来源：DEEPSEEK_API_KEY 环境变量（与 Python 一致）。
 * 错误映射：超时 → 504；HTTP 错误/其他 → 500（不透传上游错误体）。
 */

import { Hono } from "hono";

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

export function createBalanceRoutes(): Hono {
  const app = new Hono();

  app.get("/api/deepseek-balance", async (c) => {
    const apiKey = process.env.DEEPSEEK_API_KEY ?? "";
    if (!apiKey) {
      return c.json({ detail: "DeepSeek API key 未配置，请在 .env 中设置 DEEPSEEK_API_KEY" }, 400);
    }
    try {
      const resp = await fetch(DEEPSEEK_BALANCE_URL, {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        console.warn(`[balance] DeepSeek API HTTP ${resp.status}`);
        return c.json({ detail: "查询余额失败，请稍后重试" }, 500);
      }
      return c.json(await resp.json());
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        return c.json({ detail: "DeepSeek API 请求超时" }, 504);
      }
      console.warn(`[balance] DeepSeek API error: ${String(err)}`);
      return c.json({ detail: "查询余额失败，请稍后重试" }, 500);
    }
  });

  return app;
}
