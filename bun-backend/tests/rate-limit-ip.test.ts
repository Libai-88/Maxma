/**
 * tests/rate-limit-ip.test.ts — STABILITY-005：本机界面不能被自己的限流挡住。
 *
 * 复现路径（2026-11-18 实测）：`scripts/verify-ui-extension.mjs` 三次加载界面后，
 * 扩展页显示"操作过于频繁，请稍后再试"——因为 `clientIpOf` 只读 header，
 * 而 Bun 的 Request 没有套接字地址，所有本机请求都落进 `"unknown"` 同一个桶
 * （容量 30、补充 2/s），几次页面初始化就打空了。
 *
 * 这里锁两件事：
 *   1. 能拿到 `server.requestIP` 时，回环地址必须**豁免**（走 EXEMPT_IPS）；
 *   2. 拿不到时仍按 `"unknown"` 限流——不能因为识别不出 IP 就把所有请求当本地可信。
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { clientIpOf, createRateLimitMiddleware } from "../src/middleware/rate-limit";

function makeApp() {
  const app = new Hono();
  app.use("*", createRateLimitMiddleware({ capacity: 1, refillRate: 0.01 }));
  app.get("/", (c) => c.text("ok"));
  return app;
}

const loopbackServer = { requestIP: () => ({ address: "127.0.0.1" }) };

describe("clientIpOf", () => {
  test("从 server.requestIP 取到回环地址（不再一律 unknown）", async () => {
    const app = new Hono();
    let seen = "";
    app.use("*", async (c, next) => {
      seen = clientIpOf(c);
      await next();
    });
    app.get("/", (c) => c.text("ok"));
    await app.fetch(new Request("http://127.0.0.1/"), { server: loopbackServer });
    expect(seen).toBe("127.0.0.1");
  });

  test("拿不到 requestIP 也没有代理头 → unknown（不伪装成本地可信）", async () => {
    const app = new Hono();
    let seen = "";
    app.use("*", async (c, next) => {
      seen = clientIpOf(c);
      await next();
    });
    app.get("/", (c) => c.text("ok"));
    await app.fetch(new Request("http://127.0.0.1/"));
    expect(seen).toBe("unknown");
  });

  test("代理头优先于 requestIP（部署在反代后仍按真实客户端计）", async () => {
    const app = new Hono();
    let seen = "";
    app.use("*", async (c, next) => {
      seen = clientIpOf(c);
      await next();
    });
    app.get("/", (c) => c.text("ok"));
    await app.fetch(
      new Request("http://127.0.0.1/", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }),
      { server: loopbackServer },
    );
    expect(seen).toBe("203.0.113.9");
  });
});

describe("限流：回环豁免真的生效", () => {
  test("容量 1 的桶，回环请求连打 5 次全部 200", async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      const res = await app.fetch(new Request("http://127.0.0.1/"), { server: loopbackServer });
      expect(res.status).toBe(200);
    }
  });

  test("同一桶的非回环请求第 2 次即 429（豁免没有放宽成'全放行'）", async () => {
    const app = makeApp();
    const one = await app.fetch(new Request("http://127.0.0.1/"), {
      server: { requestIP: () => ({ address: "203.0.113.9" }) },
    });
    const two = await app.fetch(new Request("http://127.0.0.1/"), {
      server: { requestIP: () => ({ address: "203.0.113.9" }) },
    });
    expect(one.status).toBe(200);
    expect(two.status).toBe(429);
    const body = (await two.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  test("识别不出 IP 时仍然限流（fail-closed）", async () => {
    const app = makeApp();
    const one = await app.fetch(new Request("http://127.0.0.1/"));
    const two = await app.fetch(new Request("http://127.0.0.1/"));
    expect(one.status).toBe(200);
    expect(two.status).toBe(429);
  });
});
