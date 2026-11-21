/**
 * 设计画布的 Agent 工具：读状态 / 批量构图 / 导出。
 *
 * 工具本体不直接碰 React 或 IndexedDB——它把命令广播给当前会话的真实渲染端，
 * 由 DesignCanvasPane 的控制器执行；这样 Agent 改的就是用户眼前那张画布，
 * 撤销栈、图层、属性面板与导出结果天然一致。
 */
import fs from "node:fs";
import path from "node:path";

import type { MaxmaToolDescriptor, MaxmaToolResult } from "./descriptor";
import { canvasCommandBroker, type CanvasCommandReply } from "./canvas-broker";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_IMAGE_CHARS = 5_000_000;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface CanvasToolContext {
  sessionId: string;
  cwd?: string;
  sendEvent: (sessionId: string, event: { type: string; payload: Record<string, unknown> }) => void;
}

function text(value: unknown): MaxmaToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  };
}

function failure(message: string): MaxmaToolResult {
  return text({ ok: false, error: message });
}

function replyOrThrow(reply: CanvasCommandReply): unknown {
  if (!reply.ok) throw new Error(reply.error || "画布命令失败");
  return reply.result;
}

function readImageDataUrl(imagePath: string, cwd?: string): { dataUrl: string; fileName: string } {
  const resolved = path.isAbsolute(imagePath) ? imagePath : path.resolve(cwd || process.cwd(), imagePath);
  const ext = path.extname(resolved).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) throw new Error(`不支持的图片格式 ${ext || "(无扩展名)"}；请用 png/jpg/jpeg/webp/gif`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error(`不是文件：${resolved}`);
  if (stat.size > MAX_IMAGE_BYTES) throw new Error(`图片超过 20 MB：${resolved}`);
  const bytes = fs.readFileSync(resolved);
  return {
    dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
    fileName: path.basename(resolved),
  };
}

function attachImages(operations: unknown, cwd?: string): Record<string, unknown>[] {
  if (!Array.isArray(operations)) throw new Error("operations 必须是数组");
  return operations.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`operations[${index}] 必须是对象`);
    }
    const operation = { ...(raw as Record<string, unknown>) };
    if (operation.op !== "add_image") return operation;
    const imagePath = operation.imagePath;
    if (typeof imagePath !== "string" || !imagePath.trim()) {
      throw new Error(`operations[${index}] add_image 需要 imagePath`);
    }
    const { dataUrl, fileName } = readImageDataUrl(imagePath.trim(), cwd);
    operation.dataUrl = dataUrl;
    operation.fileName = fileName;
    delete operation.imagePath;
    return operation;
  });
}

function safeExportName(name: unknown): string {
  const cleaned = typeof name === "string"
    ? name.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "")
    : "";
  return (cleaned || "设计画布").slice(0, 80);
}

function writeExport(dataUrl: unknown, targetPath: string): string {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("画布没有返回 PNG 数据");
  }
  const bytes = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, bytes);
  return targetPath;
}

function parseArgs(params: Record<string, unknown>): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params) ? params : {};
}

export function canvasReadTool(context: CanvasToolContext): MaxmaToolDescriptor {
  return {
    name: "canvas_read",
    label: "读取设计画布",
    description:
      "读取当前会话的设计画布：画板尺寸/背景、元素列表（id、类型、名称、坐标、尺寸、文字/颜色/图片资源等）、" +
      "当前选中元素。改画布前先调用它拿到元素 id；不要凭聊天里的描述猜坐标。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    approval: "read",
    async execute(_toolCallId, rawParams): Promise<MaxmaToolResult> {
      const params = parseArgs(rawParams);
      try {
        const result = replyOrThrow(await canvasCommandBroker.request(
          context.sessionId,
          "read",
          params,
          context.sendEvent,
        ));
        return text({ ok: true, project: result });
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function canvasApplyTool(context: CanvasToolContext): MaxmaToolDescriptor {
  return {
    name: "canvas_apply",
    label: "编辑设计画布",
    description:
      "直接编辑用户眼前的设计画布。一次调用传 operations 数组，按顺序原子执行，只产生一条撤销记录。" +
      "支持：rename(name) 项目改名；preset(preset=社媒方图/竖版故事/横版封面/A4海报/手机界面/网页首屏) 切画板；" +
      "artboard(width,height,background) 自定义画板；add_text(text,x,y,width,height,name,fontSize,fontWeight,fontFamily,color,align,lineHeight,letterSpacing,rotation,opacity) 加文字；" +
      "add_shape(shape=rect|ellipse|line,x,y,width,height,name,fill,stroke,strokeWidth,radius,rotation,opacity) 加形状；" +
      "add_image(imagePath,x,y,width,height,name,fit=cover|contain,radius,rotation,opacity) 从本地绝对路径加图；" +
      "update(id,patch) 改属性；remove(id)；duplicate(id)；reorder(id,direction=up|down) 调层级；select(id|null)；clear()。" +
      "坐标以画板左上角为 0,0。做完整构图时把全部 add_* 放进同一次调用，不要一次一个元素。",
    parameters: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 60,
          description: "按顺序执行的操作列表；完整构图应合并为一次调用。",
          items: { type: "object", required: ["op"], additionalProperties: true },
        },
      },
      required: ["operations"],
      additionalProperties: false,
    },
    approval: "write",
    async execute(_toolCallId, rawParams): Promise<MaxmaToolResult> {
      const params = parseArgs(rawParams);
      try {
        const operations = attachImages(params.operations, context.cwd);
        const result = replyOrThrow(await canvasCommandBroker.request(
          context.sessionId,
          "apply",
          { operations },
          context.sendEvent,
        )) as {
          changed?: boolean;
          selectedId?: string | null;
          addedIds?: string[];
          messages?: string[];
          summary?: unknown;
          project?: unknown;
        };
        delete result.project;
        return text({
          ok: true,
          ...result,
          hint: "画布已经更新；需要视觉确认时调用 canvas_export 查看导出图，不要只说“已完成”。",
        });
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export function canvasExportTool(context: CanvasToolContext): MaxmaToolDescriptor {
  return {
    name: "canvas_export",
    label: "导出设计画布",
    description:
      "把当前设计画板按画板尺寸导出为 PNG。默认写到工作区 canvas-exports/ 下并把图片返回给你查看；" +
      "imagePath 可指定绝对或相对文件路径。toChat=true 会把导出图放进当前会话的对话输入框（仍需用户发送）。" +
      "适合在构图后做视觉检查，或把成品交给用户。",
    parameters: {
      type: "object",
      properties: {
        imagePath: { type: "string", description: "可选：导出 PNG 的绝对路径或相对工作区路径" },
        toChat: { type: "boolean", description: "是否把 PNG 放进当前会话输入框（默认 false）" },
        includePreview: { type: "boolean", description: "是否把 PNG 返回给模型查看（默认 true）" },
      },
      additionalProperties: false,
    },
    approval: "write",
    async execute(_toolCallId, rawParams): Promise<MaxmaToolResult> {
      const params = parseArgs(rawParams);
      try {
        const result = replyOrThrow(await canvasCommandBroker.request(
          context.sessionId,
          "export",
          { toChat: params.toChat === true },
          context.sendEvent,
        )) as {
          name?: string;
          width?: number;
          height?: number;
          elementCount?: number;
          dataUrl?: string;
          queuedForChat?: boolean;
        };
        const name = safeExportName(result.name?.replace(/\.png$/i, ""));
        const base = context.cwd || process.cwd();
        const requested = typeof params.imagePath === "string" && params.imagePath.trim()
          ? params.imagePath.trim()
          : path.join("canvas-exports", `${name}.png`);
        const target = path.isAbsolute(requested) ? requested : path.resolve(base, requested);
        const written = writeExport(result.dataUrl, target);

        const blocks: MaxmaToolResult["content"] = [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            name: `${name}.png`,
            width: result.width,
            height: result.height,
            elementCount: result.elementCount,
            path: written,
            queuedForChat: result.queuedForChat === true,
          }, null, 2),
        }];
        const dataUrl = result.dataUrl ?? "";
        if (params.includePreview !== false && dataUrl.length <= MAX_INLINE_IMAGE_CHARS) {
          blocks.push({
            type: "image",
            data: dataUrl.slice(dataUrl.indexOf(",") + 1),
            mimeType: "image/png",
          });
        }
        return { content: blocks, details: { path: written, width: result.width, height: result.height } };
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
