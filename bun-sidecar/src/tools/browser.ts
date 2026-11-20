/**
 * tools/browser.ts — 桌面内置浏览器的 Agent 工具（P3）。
 *
 * 工具运行在 sidecar，通过桌面主进程写在 <data>/api/data/browser-agent.json
 * 的 loopback 端口 + 随机 secret 调用浏览器。没有桌面端时返回 desktop_required。
 * 超时返回 outcome_unknown，明确禁止自动重试（动作可能已经生效）。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { MaxmaToolDescriptor, MaxmaToolResult } from "./descriptor";
import { maxmaDataRoot } from "../kernel/project-paths";

interface BrowserAgentConfig {
  port: number;
  secret: string;
  pid?: number;
}

function configPath(): string {
  return path.join(maxmaDataRoot(), "api", "data", "browser-agent.json");
}

async function readConfig(): Promise<BrowserAgentConfig | null> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const value = JSON.parse(raw) as Partial<BrowserAgentConfig>;
    if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port <= 0 || value.port > 65535) return null;
    if (typeof value.secret !== "string" || value.secret.length < 16) return null;
    return { port: value.port, secret: value.secret, pid: value.pid };
  } catch {
    return null;
  }
}

function text(value: string): MaxmaToolResult {
  return { content: [{ type: "text", text: value }] };
}

async function callBrowser(action: string, args: Record<string, unknown>): Promise<MaxmaToolResult> {
  const config = await readConfig();
  if (!config) {
    return text("desktop_required：内置浏览器只在 Maxma 桌面端可用；当前没有发现 browser-agent 配置。");
  }
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-maxma-browser-secret": config.secret,
      },
      body: JSON.stringify({ action, args }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return text(`outcome_unknown：动作 ${action} 已发出，但未收到浏览器结果（${message}）。不要自动重试；请先用 browser_read snapshot 确认当前状态。`);
  }
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; result?: Record<string, unknown> } | null;
  if (!response.ok || !payload) {
    return text(`浏览器控制失败：HTTP ${response.status}${payload?.error ? ` — ${payload.error}` : ""}`);
  }
  if (!payload.ok) return text(`浏览器控制失败：${payload.error ?? "unknown"}`);

  const result = payload.result ?? {};
  if (action === "screenshot" && typeof result.data === "string") {
    return {
      content: [
        { type: "text", text: `浏览器截图 ${result.url ?? ""}`.trim() },
        { type: "image", data: result.data, mimeType: typeof result.mime === "string" ? result.mime : "image/png" },
      ],
      details: { action, url: result.url, title: result.title },
    };
  }
  const serialized = JSON.stringify(result);
  return text(serialized.length > 20_000 ? `${serialized.slice(0, 20_000)}\n…（已截断）` : serialized);
}

export function browserNavigateTool(): MaxmaToolDescriptor {
  return {
    name: "browser_navigate",
    label: "浏览器打开页面",
    description:
      "在 Maxma 桌面端内置浏览器里打开一个 http/https 页面。这是写动作（会改变当前页面），审批模式可能要求用户确认。没有桌面端时返回 desktop_required。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "要打开的 http/https 地址；裸域名或 localhost 也接受，由 UI 归一化。" },
      },
      required: ["url"],
    },
    approval: "write",
    async execute(_id, params) {
      return callBrowser("open", { url: params.url });
    },
  };
}

export function browserReadTool(): MaxmaToolDescriptor {
  return {
    name: "browser_read",
    label: "浏览器读页面",
    description:
      "读取或观察 Maxma 内置浏览器的当前页面：snapshot 返回标题/正文/链接/控件；extract 按 CSS selector 取元素文本；screenshot 返回 PNG；scroll 滚动并返回位置；back/forward 切换历史。只读工具，不提交表单。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["snapshot", "extract", "screenshot", "scroll", "back", "forward"], description: "观察动作" },
        selector: { type: "string", description: "extract 使用的 CSS selector" },
        limit: { type: "number", description: "extract 最多返回多少个元素（1-50，默认 20）" },
        dx: { type: "number", description: "scroll 横向位移" },
        dy: { type: "number", description: "scroll 纵向位移" },
      },
      required: ["action"],
    },
    approval: "read",
    async execute(_id, params) {
      const action = typeof params.action === "string" ? params.action : "";
      return callBrowser(action, {
        selector: params.selector,
        limit: params.limit,
        dx: params.dx,
        dy: params.dy,
      });
    },
  };
}
