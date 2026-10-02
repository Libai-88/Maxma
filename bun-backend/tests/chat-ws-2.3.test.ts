/**
 * tests/chat-ws-2.3.test.ts — chat WS 契约单测（阶段 2.3）。
 *
 * mock ServerWebSocket 直测 handleChatMessage/registerChatConnection——
 * 消息分发/白名单/幂等去重/BUSY/artifact_result/协议握手首帧/多窗口广播。
 * kernel in-process；全部内联构造（无共享 helper——规避 bun test 与
 * 跨目录动态 import 组合下的进程挂起问题）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-ws-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function makeSession(): Promise<{
  sid: string;
  sessions: Map<string, Record<string, unknown>>;
  sent: Array<Record<string, unknown>>;
  ws: never;
  conns: Map<string, Set<never>>;
  seenIds: Map<string, string[]>;
}> {
  const kernel = await import("../../bun-sidecar/src/kernel/bridge-pi");
  const chatws = await import("../src/routes/chat-ws");
  const sessions = new Map();
  const pendingPlans = new Map();
  const conns = new Map();
  const seenIds = new Map<string, string[]>();
  const sent: Array<Record<string, unknown>> = [];
  const io = {
    send: () => {},
    sendError: () => {},
    sendEvent: (sid: string, event: Record<string, unknown>) => {
      const set = conns.get(sid);
      if (set) for (const w of set) w.send(JSON.stringify(event));
    },
  };
  const callRpc = (method: string, params: Record<string, unknown>) => {
    const sid = params.session_id as string;
    kernel.handlePiSessionRpc({ io, sessions, pendingPlans }, method, sid, params, 0);
  };
  await kernel.handlePiCreateSession({ io, sessions, pendingPlans }, { cwd: process.cwd() }, 0);
  const sid = [...sessions.keys()][0]!;
  const ws = { data: { sessionId: sid }, send: (d: string) => sent.push(JSON.parse(d)) } as never;
  chatws.registerChatConnection(
    { sessions, pendingPlans, connections: conns, seenClientMsgIds: seenIds, callRpc, broadcast: io.sendEvent } as never,
    sid,
    ws,
  );
  conns.set(sid, new Set([ws]));
  const hub = { sessions, pendingPlans, connections: conns, seenClientMsgIds: seenIds, callRpc, broadcast: io.sendEvent };
  return { sid, hub, sent, ws };
}

describe("chat WS（阶段 2.3）", () => {
  test("握手首帧 hello protocol_version=1（阶段〇-3 契约）", async () => {
    const { sent } = await makeSession();
    expect(sent[0]).toEqual({ type: "hello", payload: { protocol_version: 1 } });
  }, 15000);

  test("ping → pong；未知类型静默丢弃", async () => {
    const { handleChatMessage } = await import("../src/routes/chat-ws");
    const { sid, hub, ws, sent } = await makeSession();

    handleChatMessage(hub, ws, JSON.stringify({ type: "ping" }));
    expect(sent.at(-1)).toEqual({ type: "pong" });

    handleChatMessage(hub, ws, JSON.stringify({ type: "unknown_thing", payload: {} }));
    expect(sent.filter((f) => f.type === "unknown_thing").length).toBe(0);

    handleChatMessage(hub, ws, "not-json");
  }, 15000);

  test("client_msg_id 幂等去重：已登记 id 的重试被静默丢弃（不触发 prompt）", async () => {
    const { handleChatMessage } = await import("../src/routes/chat-ws");
    const { sid, hub, ws, sent } = await makeSession();
    hub.seenClientMsgIds.set(sid, ["msg-abc"]);

    const before = sent.length;
    handleChatMessage(
      hub,
      ws,
      JSON.stringify({ type: "chat", payload: { message: "重试", client_msg_id: "msg-abc" } }),
    );
    await Bun.sleep(30);
    expect(sent.length).toBe(before);
  }, 15000);

  test("BUSY：prompt 进行中发 chat → error {code: BUSY}", async () => {
    const { handleChatMessage } = await import("../src/routes/chat-ws");
    const kernel = await import("../../bun-sidecar/src/kernel/bridge-pi");
    const { sid, hub, ws, sent } = await makeSession();
    const record = hub.sessions.get(sid) as { currentGuard: unknown };
    record.currentGuard = kernel.createDoneGuardStub ? kernel.createDoneGuardStub() : {};

    handleChatMessage(hub, ws, JSON.stringify({ type: "chat", payload: { message: "再来一条" } }));
    const errors = sent.filter((f) => f.type === "error");
    expect(errors.length).toBe(1);
    expect((errors[0]!.payload as { code: string }).code).toBe("BUSY");
  }, 15000);

  test("chat 使用所选 provider 的模型和后端凭据", async () => {
    const { handleChatMessage } = await import("../src/routes/chat-ws");
    const { sid, hub, ws } = await makeSession();
    const providersFile = path.join(dataDir, "api", "data", "providers.yaml");
    fs.writeFileSync(providersFile, Bun.YAML.stringify({
      providers: [{
        id: "test-provider",
        provider_type: "openai-completions",
        label: "Test provider",
        api_key: "test-secret",
        base_url: "http://127.0.0.1:1234/v1",
        models: ["test-model"],
        enabled: true,
      }],
    }));
    hub.callRpc = async (method: string) => ({ ok: true as const, result: method === "prompt" ? { ok: true } : null });

    handleChatMessage(hub, ws, JSON.stringify({
      type: "chat",
      payload: { message: "hello", provider_id: "test-provider", model_name: "test-model" },
    }));
    await Bun.sleep(50);

    const record = hub.sessions.get(sid) as { session: { model?: { provider: string; id: string } } };
    expect(record.session.model).toMatchObject({ provider: "test-provider", id: "test-model" });
  }, 15000);

  test("artifact_action：token=base64(路径) → artifact_result completed/404", async () => {
    const { handleChatMessage } = await import("../src/routes/chat-ws");
    const { hub, ws, sent } = await makeSession();

    const tmpFile = path.join(dataDir, "artifact.txt");
    fs.writeFileSync(tmpFile, "file content");
    handleChatMessage(hub, ws, JSON.stringify({
      type: "artifact_action",
      payload: { artifact_id: "a1", action_id: "act1", token: Buffer.from(tmpFile).toString("base64") },
    }));
    const ok = sent.filter((f) => f.type === "artifact_result").at(-1) as {
      payload: { status: string; content: string };
    };
    expect(ok.payload.status).toBe("completed");
    expect(ok.payload.content).toBe("file content");

    const missingToken = Buffer.from(path.join(dataDir, "ghost.txt")).toString("base64");
    handleChatMessage(hub, ws, JSON.stringify({
      type: "artifact_action",
      payload: { artifact_id: "a2", action_id: "act2", token: missingToken },
    }));
    const err = sent.filter((f) => f.type === "artifact_result").at(-1) as {
      payload: { status: string; error: string };
    };
    expect(err.payload.status).toBe("error");
    expect(err.payload.error).toBe("File not found");
  }, 15000);

  test("广播：kernel 事件到达全部连接（MULTI-WS-001 多窗口同播）", async () => {
    const kernel = await import("../../bun-sidecar/src/kernel/bridge-pi");
    const chatws = await import("../src/routes/chat-ws");
    const sessions = new Map();
    const io = { send: () => {}, sendError: () => {}, sendEvent: () => {} };
    await kernel.handlePiCreateSession({ io, sessions, pendingPlans: new Map() }, { cwd: process.cwd() }, 0);
    const sid = [...sessions.keys()][0]!;

    const conns = new Map<string, Set<never>>();
    const mk = () => {
      const sent: Array<Record<string, unknown>> = [];
      const ws = { data: { sessionId: sid }, send: (d: string) => sent.push(JSON.parse(d)) } as never;
      return { ws, sent };
    };
    const w1 = mk();
    const w2 = mk();
    const hub = { sessions, pendingPlans: new Map(), connections: conns, seenClientMsgIds: new Map(), callRpc: async () => ({ ok: true as const, result: null }), broadcast: (s: string, e: Record<string, unknown>) => { const set = conns.get(s); if (set) for (const w of set) w.send(JSON.stringify(e)); } };
    chatws.registerChatConnection(hub as never, sid, w1.ws);
    chatws.registerChatConnection(hub as never, sid, w2.ws);
    expect(conns.get(sid)!.size).toBe(2);

    hub.broadcast(sid, { type: "notice", payload: { message: "广播测试" } });
    expect((w1.sent.at(-1) as { type: string }).type).toBe("notice");
    expect((w2.sent.at(-1) as { type: string }).type).toBe("notice");

    chatws.unregisterChatConnection(hub as never, sid, w1.ws);
    hub.broadcast(sid, { type: "notice", payload: { message: "第二次" } });
    expect((w2.sent.at(-1) as { type: string }).type).toBe("notice");
    expect(conns.get(sid)!.size).toBe(1);
  }, 15000);
});

/** 构造单连接的 connections map（幂等测试用）。 */
function connsOf(sid: string, ws: never): Map<string, Set<never>> {
  return new Map([[sid, new Set([ws])]]);
}
