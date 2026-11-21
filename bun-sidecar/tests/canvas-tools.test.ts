import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CanvasCommandBroker, canvasCommandBroker } from "../src/tools/canvas-broker";
import { canvasApplyTool, canvasExportTool, canvasReadTool, type CanvasToolContext } from "../src/tools/canvas";
import { buildPiCustomTools } from "../src/kernel/tools";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-canvas-"));
  tempDirs.push(dir);
  return dir;
}

describe("canvas command broker", () => {
  test("发出 canvas_command，并按 request_id + session 兑现回执", async () => {
    const broker = new CanvasCommandBroker();
    let sent: { sessionId: string; event: { type: string; payload: Record<string, unknown> } } | null = null;
    const reply = await broker.request("session-a", "read", {}, (sessionId, event) => {
      sent = { sessionId, event };
      const requestId = String(event.payload.request_id);
      queueMicrotask(() => {
        expect(broker.resolve("session-a", { request_id: requestId, result: { name: "画布 A" } })).toBe(true);
      });
    });

    expect(reply).toEqual({ ok: true, result: { name: "画布 A" } });
    expect(sent).not.toBeNull();
    const frame = sent as unknown as { sessionId: string; event: { type: string; payload: Record<string, unknown> } };
    expect(frame.sessionId).toBe("session-a");
    expect(frame.event.type).toBe("canvas_command");
    expect(frame.event.payload).toMatchObject({ action: "read", args: {} });
    expect(broker.size).toBe(0);
  });

  test("其它会话的回执被丢弃，原命令继续等到超时", async () => {
    const broker = new CanvasCommandBroker();
    let requestId = "";
    const reply = await broker.request("session-a", "read", {}, (_sessionId, event) => {
      requestId = String(event.payload.request_id);
      queueMicrotask(() => {
        expect(broker.resolve("session-b", { request_id: requestId, result: { leaked: true } })).toBe(false);
      });
    }, 60);

    expect(reply.ok).toBe(false);
    expect(reply.error).toContain("超时");
    expect(broker.size).toBe(0);
  });

  test("cancelSession 会拒绝该会话所有在途命令", async () => {
    const broker = new CanvasCommandBroker();
    const reply = broker.request("session-a", "export", { toChat: false }, () => {
      queueMicrotask(() => broker.cancelSession("session-a"));
    }, 5_000);

    expect(await reply).toEqual({ ok: false, error: "会话已结束，画布命令取消" });
    expect(broker.size).toBe(0);
  });
});

describe("canvas tools wiring", () => {
  const context: CanvasToolContext = {
    sessionId: "session-a",
    cwd: process.cwd(),
    sendEvent: () => {},
  };

  test("只有拿到会话上下文才注册三个画布工具", () => {
    const withCanvas = buildPiCustomTools(undefined, [], context).map((tool) => tool.name);
    expect(withCanvas).toContain("canvas_read");
    expect(withCanvas).toContain("canvas_apply");
    expect(withCanvas).toContain("canvas_export");

    const withoutCanvas = buildPiCustomTools(undefined, []).map((tool) => tool.name);
    expect(withoutCanvas).not.toContain("canvas_read");
    expect(withoutCanvas).not.toContain("canvas_apply");
    expect(withoutCanvas).not.toContain("canvas_export");
  });

  test("canvas_read 把渲染端结果包成模型可读 JSON", async () => {
    const tool = canvasReadTool({
      ...context,
      sendEvent: (_sessionId, event) => {
        canvasCommandBroker.resolve("session-a", {
          request_id: event.payload.request_id,
          result: { name: "发布会主视觉", elementCount: 2, elements: [] },
        });
      },
    });
    const result = await tool.execute("call-1", {});
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({ ok: true, project: { name: "发布会主视觉", elementCount: 2 } });
  });

  test("canvas_export 落盘 PNG，并可按 includePreview=false 不回传大图", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const dir = tempDir();
    const target = path.join(dir, "out.png");
    const tool = canvasExportTool({
      ...context,
      sendEvent: (_sessionId, event) => {
        canvasCommandBroker.resolve("session-a", {
          request_id: event.payload.request_id,
          result: {
            name: "发布会主视觉.png",
            width: 1080,
            height: 1080,
            elementCount: 3,
            dataUrl: `data:image/png;base64,${png}`,
          },
        });
      },
    });
    const result = await tool.execute("call-2", {
      imagePath: target,
      includePreview: false,
    });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({ ok: true, width: 1080, height: 1080, elementCount: 3 });
    expect(fs.readFileSync(target)).toEqual(Buffer.from(png, "base64"));
    expect(result.content).toHaveLength(1);
  });

  test("canvas_apply 把本地图片路径读成 data URL 再发给渲染端", async () => {
    const dir = tempDir();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const imagePath = path.join(dir, "素材 图.png");
    fs.writeFileSync(imagePath, Buffer.from(png, "base64"));
    let sentOperations: Record<string, unknown>[] = [];
    const tool = canvasApplyTool({
      ...context,
      cwd: dir,
      sendEvent: (_sessionId, event) => {
        const args = event.payload.args as { operations?: Record<string, unknown>[] };
        sentOperations = args.operations ?? [];
        canvasCommandBroker.resolve("session-a", {
          request_id: event.payload.request_id,
          result: { changed: true, addedIds: ["img-1"], summary: { elementCount: 1 } },
        });
      },
    });

    const result = await tool.execute("call-3", {
      operations: [{ op: "add_image", imagePath, x: 10, y: 20, width: 300, height: 180 }],
    });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({ ok: true, changed: true });
    expect(sentOperations[0]?.dataUrl).toBe(`data:image/png;base64,${png}`);
    expect(sentOperations[0]?.fileName).toBe("素材 图.png");
    expect(sentOperations[0]?.imagePath).toBeUndefined();
  });
});
