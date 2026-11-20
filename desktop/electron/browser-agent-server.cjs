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

function writeConfig(configPath, payload) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
}

function startBrowserAgentServer({ controller, dataDir, logger = console }) {
  const secret = crypto.randomBytes(32).toString("hex");
  const configPath = path.join(dataDir, "api", "data", "browser-agent.json");
  let server = null;

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
      controller.agentExecute(action, args).then((result) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result }));
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
