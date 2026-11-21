/**
 * browser-agent-server.cjs — 桌面浏览器给 Agent 用的本机控制端点（P3）。
 *
 * 只监听 127.0.0.1 随机端口，用每次启动生成的随机 secret 鉴权；配置写到
 * <data>/api/data/browser-agent.json（0600）。bun-sidecar 工具读同一份配置。
 * 端点只接受固定动作白名单，不暴露 Electron 对象，也不提供任意 URL 之外的
 * 能力（URL 仍受 browser-view 的 http(s) 策略约束）。
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

/** 端点层也校验白名单，避免“控制器才拒绝”的伪边界。 */
const AGENT_ACTIONS = new Set([
  "open",
  "snapshot",
  "extract",
  "screenshot",
  "scroll",
  "back",
  "forward",
  "act",
  "console",
  "tabs",
  "close_tab",
  "downloads",
]);

function writeConfig(configPath, payload) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
}

function startBrowserAgentServer({ controller, dataDir, logger = console }) {
  const secret = crypto.randomBytes(32).toString("hex");
  const configPath = path.join(dataDir, "api", "data", "browser-agent.json");
  let server = null;
  /** request_id → 在途/已完成 Promise；60s 内重放同 id 不再产生第二次副作用。 */
  const requests = new Map();
  const REQUEST_TTL_MS = 60_000;
  const MAX_REQUESTS = 200;

  function rememberRequest(id, task) {
    if (!id) return task;
    requests.set(id, task);
    if (requests.size > MAX_REQUESTS) {
      const oldest = requests.keys().next().value;
      if (oldest) requests.delete(oldest);
    }
    const timer = setTimeout(() => requests.delete(id), REQUEST_TTL_MS);
    timer.unref?.();
    task.finally(() => { /* 结果保留到 TTL，供同 id 重放读取 */ }).catch(() => undefined);
    return task;
  }

  const serverInstance = http.createServer((request, response) => {
    const fail = (status, message) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: message }));
    };
    if (request.method !== "POST" || request.url !== "/execute") {
      fail(404, "not found");
      return;
    }
    if (request.headers["x-maxma-browser-secret"] !== secret) {
      fail(403, "forbidden");
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) request.destroy();
    });
    request.on("end", () => {
      let payload;
      try { payload = JSON.parse(body); } catch { fail(400, "invalid json"); return; }
      const action = typeof payload?.action === "string" ? payload.action : "";
      const args = payload?.args && typeof payload.args === "object" ? payload.args : {};
      if (!AGENT_ACTIONS.has(action)) {
        fail(400, `unknown action: ${action || "(empty)"}`);
        return;
      }
      const requestId = typeof payload?.request_id === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(payload.request_id)
        ? payload.request_id
        : "";
      let task = requestId ? requests.get(requestId) : undefined;
      if (!task) {
        task = controller.agentExecute(action, args);
        rememberRequest(requestId, task);
      }
      task.then((result) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, request_id: requestId || undefined, result }));
      }).catch((error) => {
        logger.warn?.("[browser-agent]", error instanceof Error ? error.message : String(error));
        fail(200, error instanceof Error ? error.message : String(error));
      });
    });
  });

  return {
    configPath,
    start() {
      return new Promise((resolve) => {
        serverInstance.listen(0, "127.0.0.1", () => {
          server = serverInstance;
          const address = server.address();
          writeConfig(configPath, {
            port: address.port,
            secret,
            pid: process.pid,
            started_at: Date.now(),
          });
          logger.info?.(`[browser-agent] listening on 127.0.0.1:${address.port}`);
          resolve({ port: address.port });
        });
      });
    },
    stop() {
      try { fs.rmSync(configPath, { force: true }); } catch { /* best effort */ }
      if (server) {
        server.close();
        server = null;
      }
    },
  };
}

module.exports = { startBrowserAgentServer };
