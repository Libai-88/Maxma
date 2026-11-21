/**
 * tests/agent-audit.test.ts — M1/T4 审计与写入快照的取证。
 *
 * 直接读回 JSONL / 快照 JSON，而不是只看函数返回；写入路径与后端 `/api/audit-log`
 * 共享同一数据目录，路由测试只需读同一个文件。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  agentAuditPath,
  agentSnapshotsDir,
  appendAgentAudit,
  recordToolDenied,
  recordToolEnd,
  recordToolStart,
  snapshotBeforeWrite,
} from "../src/kernel/agent-audit";
import { PathPolicy } from "../src/kernel/path-policy";
import { createMaxmaPathPolicyExtension } from "../src/kernel/extensions/maxma-path-policy";
import { createMaxmaAuditExtension } from "../src/kernel/extensions/maxma-audit";

let dataDir = "";
let root = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-audit-data-"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-audit-root-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

function readLines(): Array<Record<string, unknown>> {
  try {
    return fs.readFileSync(agentAuditPath(), "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function readSnapshot(id: string): Record<string, unknown> {
  const dir = agentSnapshotsDir();
  for (const session of fs.readdirSync(dir)) {
    const file = path.join(dir, session, `${id}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  }
  throw new Error(`snapshot not found: ${id}`);
}

describe("agent-audit", () => {
  test("已有文件快照保存原内容与 sha256；新文件记录 existed=false", () => {
    const file = path.join(root, "a.txt");
    fs.writeFileSync(file, "before\n", "utf8");
    const existing = snapshotBeforeWrite({
      sessionId: "s1",
      cwd: root,
      toolName: "write",
      toolCallId: "t1",
      args: { file_path: "a.txt", content: "after" },
    });
    expect(existing.snapshotId).toBeTruthy();
    expect(existing.existed).toBe(true);
    const meta = readSnapshot(existing.snapshotId!);
    expect(Buffer.from(String(meta.content_base64), "base64").toString("utf8")).toBe("before\n");
    expect(meta.sha256).toHaveLength(64);

    const fresh = snapshotBeforeWrite({
      sessionId: "s1",
      cwd: root,
      toolName: "write",
      toolCallId: "t2",
      args: { path: "new.txt", content: "new" },
    });
    expect(fresh.snapshotId).toBeTruthy();
    expect(fresh.existed).toBe(false);
    const freshMeta = readSnapshot(fresh.snapshotId!);
    expect(freshMeta.existed).toBe(false);
  });

  test("审计记录写入 JSONL；输入中的密钥被打码", () => {
    recordToolDenied({
      sessionId: "s1",
      toolName: "bash",
      toolCallId: "t3",
      args: { command: "curl --token super-secret https://x" },
      reason: "网络命令默认拒绝",
    });
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.decision).toBe("denied");
    expect(String(lines[0]?.input_summary)).not.toContain("super-secret");
    expect(String(lines[0]?.input_summary)).toContain("[REDACTED]");
  });

  test("tool start 写快照 id，end 写 end/error，不把成功记成 denied", () => {
    const file = path.join(root, "b.txt");
    fs.writeFileSync(file, "b", "utf8");
    recordToolStart({ sessionId: "s1", cwd: root, toolName: "edit", toolCallId: "t4", args: { file_path: "b.txt" } });
    recordToolEnd({ sessionId: "s1", toolName: "edit", toolCallId: "t4", isError: false });
    const lines = readLines();
    expect(lines.map((line) => line.decision)).toEqual(["start", "end"]);
    expect(lines[0]?.snapshot_id).toBeTruthy();
  });

  test("audit extension 实际挂到 tool_execution_start/end", () => {
    const ext = createMaxmaAuditExtension({ sessionId: "s1", cwd: root }) as { factory: (pi: unknown) => void };
    const handlers = new Map<string, (event: unknown) => void>();
    ext.factory({
      on: (name: string, handler: (event: unknown) => void) => {
        handlers.set(name, handler);
        return () => {};
      },
    });
    fs.writeFileSync(path.join(root, "c.txt"), "c", "utf8");
    handlers.get("tool_execution_start")!({
      toolName: "write",
      toolCallId: "t5",
      args: { file_path: "c.txt", content: "new" },
    });
    handlers.get("tool_execution_end")!({ toolName: "write", toolCallId: "t5", isError: false });
    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]?.decision).toBe("start");
    expect(lines[1]?.decision).toBe("end");
  });
});

describe("path policy denied audit", () => {
  test("越界路径被 block 时写入 denied 记录，且不执行工具", async () => {
    const policy = new PathPolicy({ roots: [root], cwd: root });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-audit-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "s", "utf8");
    try {
      const ext = createMaxmaPathPolicyExtension(policy, root, "s1") as { factory: (pi: unknown) => void };
      let handler: ((event: unknown) => Promise<unknown>) | undefined;
      ext.factory({
        on: (_name: string, h: (event: unknown) => Promise<unknown>) => {
          handler = h;
          return () => {};
        },
      });
      const result = await handler!({
        toolName: "read",
        toolCallId: "t6",
        input: { file_path: path.join(outside, "secret.txt") },
      }) as { block?: boolean };
      expect(result.block).toBe(true);
      const lines = readLines();
      expect(lines.at(-1)?.decision).toBe("denied");
      expect(String(lines.at(-1)?.detail)).toContain("路径");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
