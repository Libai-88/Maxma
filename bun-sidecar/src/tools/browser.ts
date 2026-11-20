/**
 * tools/browser.ts — 桌面内置浏览器的 Agent 工具（P3）。
 *
 * 工具运行在 sidecar，通过桌面主进程写在 <data>/api/data/browser-agent.json
 * 的 loopback 端口 + 随机 secret 调用浏览器。没有桌面端时返回 desktop_required。
 * 超时返回 outcome_unknown，明确禁止自动重试（动作可能已经生效）。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

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
  const requestId = randomUUID();
  try {
    response = await fetch(`http://127.0.0.1:${config.port}/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-maxma-browser-secret": config.secret,
      },
      body: JSON.stringify({ action, args, request_id: requestId }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return text(`outcome_unknown：动作 ${action} 已发出，但未收到浏览器结果（${message}；request_id=${requestId}）。不要自动重试；请先用 browser_read snapshot 确认当前状态。`);
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
      "读取或观察 Maxma 内置浏览器：snapshot 返回正文和带 ref 的可操作元素（role/name/value/checked 等，ref 只在本次快照内有效）；extract 按 CSS selector 取文本；screenshot 返回 PNG；scroll 滚动；back/forward 切换历史；console 取页面日志和最近异常。只读工具，不提交表单。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["snapshot", "extract", "screenshot", "scroll", "back", "forward", "console"], description: "观察动作" },
        selector: { type: "string", description: "extract 使用的 CSS selector" },
        limit: { type: "number", description: "extract 最多返回多少个元素（1-50，默认 20）" },
        dx: { type: "number", description: "scroll 横向位移" },
        dy: { type: "number", description: "scroll 纵向位移" },
        clear: { type: "boolean", description: "console 读取后是否清空缓冲" },
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
        clear: params.clear,
      });
    },
  };
}

export function browserActTool(): MaxmaToolDescriptor {
  return {
    name: "browser_act",
    label: "浏览器原生操作",
    description:
      "对 Maxma 内置浏览器执行原生输入：click 用真实鼠标点击（可点 ref/selector，也可用截图坐标 x/y 视觉定位）；drag 用真实鼠标从 ref/坐标拖到另一个 ref/坐标；fill/type 先聚焦再输入（fill 会清空原值）；press 发真实按键（Enter、Tab、Control+A 等）；hover 悬停；select 选择下拉值；check/uncheck 切换勾选；upload 给 input[type=file] 设置本机绝对路径文件；scrollIntoView 把元素滚到视口中央；wait 等元素、正文文本或时长；evaluate 在页面执行只读或调试脚本。目标用 browser_read snapshot 返回的 ref（推荐）或 CSS selector。会改变页面或提交数据，审批模式可能要求确认。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["click", "fill", "type", "press", "hover", "select", "check", "uncheck", "drag", "upload", "scrollIntoView", "wait", "evaluate"],
          description: "原生操作类型",
        },
        ref: { type: "string", description: "snapshot 返回的 ref，例如 e3；页面变化后失效" },
        selector: { type: "string", description: "CSS selector；没有 ref 时可用" },
        text: { type: "string", description: "fill/type 要输入的文本（最长 5000 字符）；wait 时可作为正文等待文本" },
        key: { type: "string", description: "press 的按键，例如 Enter、Tab、Control+A、ArrowDown" },
        value: { type: "string", description: "select 的目标 option value" },
        expression: { type: "string", description: "evaluate 的页面脚本，最长 4000 字符" },
        timeoutMs: { type: "number", description: "wait 超时，1-15000 毫秒，默认 5000" },
        ms: { type: "number", description: "wait 固定等待毫秒数" },
        clickCount: { type: "number", description: "click 次数 1-3，默认 1" },
        x: { type: "number", description: "click/drag 起点的视口坐标（CSS px）；与 y 一起用，可替代 ref" },
        y: { type: "number", description: "click/drag 起点的视口坐标（CSS px）" },
        toRef: { type: "string", description: "drag 终点的 ref" },
        toSelector: { type: "string", description: "drag 终点的 CSS selector" },
        toX: { type: "number", description: "drag 终点的视口 X 坐标" },
        toY: { type: "number", description: "drag 终点的视口 Y 坐标" },
        steps: { type: "number", description: "drag 中间移动步数 4-60，默认 20" },
        files: {
          type: "array",
          items: { type: "string" },
          description: "upload 的本机绝对路径，最多 10 个；必须是已存在的普通文件",
        },
      },
      required: ["action"],
    },
    approval: "write",
    async execute(_id, params) {
      return callBrowser("act", {
        action: params.action,
        ref: params.ref,
        selector: params.selector,
        text: params.text,
        key: params.key,
        value: params.value,
        expression: params.expression,
        timeoutMs: params.timeoutMs,
        ms: params.ms,
        clickCount: params.clickCount,
        x: params.x,
        y: params.y,
        toRef: params.toRef,
        toSelector: params.toSelector,
        toX: params.toX,
        toY: params.toY,
        steps: params.steps,
        files: params.files,
      });
    },
  };
}
