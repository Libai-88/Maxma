import { describe, expect, test } from "bun:test";

import { canvasCommandBroker } from "../../bun-sidecar/src/tools/canvas-broker";
import { CLIENT_MESSAGE_TYPES, handleChatMessage } from "../src/routes/chat-ws";

describe("chat WS 画布回执", () => {
  test("canvas_agent_result 在白名单内，并按会话兑现工具请求", async () => {
    expect(CLIENT_MESSAGE_TYPES.has("canvas_agent_result")).toBe(true);

    let requestId = "";
    const replyPromise = canvasCommandBroker.request("session-a", "read", {}, (_sessionId, event) => {
      requestId = String(event.payload.request_id);
    }, 2_000);
    const sent: string[] = [];
    const ws = {
      data: { sessionId: "session-a" },
      send: (value: string) => { sent.push(value); return 1; },
    };
    handleChatMessage({ sessions: new Map() } as never, ws as never, JSON.stringify({
      type: "canvas_agent_result",
      payload: { request_id: requestId, result: { name: "画布 A" } },
    }));

    expect(await replyPromise).toEqual({ ok: true, result: { name: "画布 A" } });
    expect(sent).toEqual([]);
  });

  test("伪造 session 的回执不会唤醒别的会话", async () => {
    let requestId = "";
    const replyPromise = canvasCommandBroker.request("session-a", "read", {}, (_sessionId, event) => {
      requestId = String(event.payload.request_id);
    }, 80);
    const ws = {
      data: { sessionId: "session-b" },
      send: () => 1,
    };
    handleChatMessage({ sessions: new Map() } as never, ws as never, JSON.stringify({
      type: "canvas_agent_result",
      payload: { request_id: requestId, result: { secret: true } },
    }));

    const reply = await replyPromise;
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain("超时");
  });
});
