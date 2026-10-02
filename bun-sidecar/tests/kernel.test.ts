/**
 * tests/kernel.test.ts — kernel 骨架冒烟测试（阶段一 §6.2 任务 1 验收）。
 *
 * 只测 Maxma 粘合层，不测 pi 本体（官方包自带测试）；不发起模型调用。
 * 会话承载用官方 SessionManager.inMemory()（spike 已验证 Bun 1.3.14 兼容）。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createMaxmaApprovalExtension, MAXMA_APPROVAL_EXTENSION_NAME } from "../src/kernel/extensions/maxma-approval";
import { approvalExtensionFor, createMaxmaSession } from "../src/kernel/pi-session";
import { discoverMaxmaSkills } from "../src/kernel/skills";
import type { ApprovalGate, ApprovalRequest, ApprovalDecision } from "../src/kernel/types";

/** 恒拒门（测试用，模拟超时默认拒绝的终态）。 */
function denyGate(): ApprovalGate {
  return {
    needsApproval(): boolean {
      return true;
    },
    async decide(_req: ApprovalRequest): Promise<ApprovalDecision> {
      return { approved: false, reason: "denied-by-test" };
    },
  };
}

describe("kernel: approvalExtensionFor", () => {
  test("auto 模式或未提供门时不装配审批扩展", () => {
    expect(approvalExtensionFor("auto", denyGate())).toBeUndefined();
    expect(approvalExtensionFor("ask", undefined)).toBeUndefined();
  });

  test("read_only/ask/operate 且有门时装配", () => {
    for (const mode of ["read_only", "ask", "operate"] as const) {
      const ext = approvalExtensionFor(mode, denyGate());
      expect(ext).toBeDefined();
      expect((ext as { name: string }).name).toBe(MAXMA_APPROVAL_EXTENSION_NAME);
    }
  });
});

describe("kernel: maxma-approval extension", () => {
  test("gate 拒绝时返回官方 block 结果", async () => {
    const ext = createMaxmaApprovalExtension(denyGate()) as {
      factory: (pi: unknown) => void;
    };

    // 捕获注册的 tool_call handler（官方 ExtensionAPI.on 形状的最小 stub）
    let handler: ((event: unknown) => Promise<unknown>) | undefined;
    const fakePi = {
      on: (event: string, h: (e: unknown) => Promise<unknown>) => {
        if (event === "tool_call") handler = h;
        return () => {};
      },
      getAllTools: () => [{ name: "bash", annotations: { readOnlyHint: false } }],
    };
    ext.factory(fakePi);
    expect(handler).toBeDefined();

    const result = (await handler!({
      type: "tool_call",
      toolName: "bash",
      toolCallId: "t1",
      input: { command: "echo hi" },
    })) as { block?: boolean; reason?: string } | undefined;

    expect(result?.block).toBe(true);
    expect(result?.reason).toBe("denied-by-test");
  });

  test("gate 放行时返回 undefined（官方放行约定）", async () => {
    const allowGate: ApprovalGate = {
      needsApproval: () => true,
      async decide(): Promise<ApprovalDecision> {
        return { approved: true };
      },
    };
    const ext = createMaxmaApprovalExtension(allowGate) as { factory: (pi: unknown) => void };
    let handler: ((event: unknown) => Promise<unknown>) | undefined;
    ext.factory({
      on: (_e: string, h: (e: unknown) => Promise<unknown>) => {
        handler = h;
        return () => {};
      },
      getAllTools: () => [],
    });
    const result = await handler!({ type: "tool_call", toolName: "read", toolCallId: "t2", input: {} });
    expect(result).toBeUndefined();
  });
});

describe("kernel: createMaxmaSession", () => {
  test("discovers project Agent Skills and exposes them to Pi sessions", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-skills-"));
    const skillDir = path.join(cwd, ".agents", "skills", "verification-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: verification-skill\ndescription: A skill used to verify discovery.\n---\nUse this skill for verification.\n",
    );

    try {
      const discovered = discoverMaxmaSkills(cwd);
      expect(discovered.skills.map((skill) => skill.name)).toContain("verification-skill");

      const session = await createMaxmaSession({ inMemory: true, cwd });
      try {
        expect(session.resourceLoader.getSkills().skills.map((skill) => skill.name)).toContain("verification-skill");
        const expanded = (session as unknown as { _expandSkillCommand(text: string): string })
          ._expandSkillCommand("/skill:verification-skill");
        expect(expanded).toContain("Use this skill for verification.");
      } finally {
        session.dispose();
      }
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("inMemory 会话创建 → 官方 API 面 → dispose", async () => {
    const session = await createMaxmaSession({ inMemory: true, cwd: import.meta.dir });

    // 官方 AgentSession API 面（阶段一桥接依赖的最小集）
    expect(typeof session.prompt).toBe("function");
    expect(typeof session.steer).toBe("function");
    expect(typeof session.followUp).toBe("function");
    expect(typeof session.abort).toBe("function");
    expect(typeof session.waitForIdle).toBe("function");
    expect(typeof session.subscribe).toBe("function");
    expect(typeof session.getActiveToolNames).toBe("function");
    expect(typeof session.setActiveToolsByName).toBe("function");
    expect(session.isStreaming).toBe(false);

    // 默认内置工具（官方：read/bash/edit/write）
    const tools = session.getActiveToolNames();
    for (const t of ["read", "bash", "edit", "write"]) {
      expect(tools).toContain(t);
    }

    // 订阅返回退订函数（官方约定）
    const off = session.subscribe(() => {});
    expect(typeof off).toBe("function");
    off();

    session.dispose();
  });

  test("工具白名单生效（官方 CreateAgentSessionOptions.tools）", async () => {
    const session = await createMaxmaSession({ inMemory: true, cwd: import.meta.dir, tools: ["read"] });
    const tools = session.getActiveToolNames();
    expect(tools).toContain("read");
    expect(tools).not.toContain("bash");
    session.dispose();
  });
});
