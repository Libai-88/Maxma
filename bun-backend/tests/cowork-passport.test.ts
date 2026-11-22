/**
 * Maxma 任务护照：纯组装逻辑与隐私边界。
 *
 * 不依赖 DB / 文件系统，专门防止“护照泄露 key”和“把已删除产物算进交付”的退化。
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  buildCoworkTaskPassport,
  buildCoworkTaskPassportBundle,
  canonicalCoworkPassportJson,
  renderCoworkPassportMarkdown,
} from "../src/services/cowork-passport";
import type {
  CoworkArtifact,
  CoworkTaskDetail,
} from "../src/services/cowork-store-types";

function fixture(): CoworkTaskDetail {
  const task: CoworkTaskDetail["task"] = {
    id: "task-1",
    project_id: "project-1",
    title: "周报 / 评审",
    objective: "整理本周材料并生成周报",
    status: "completed",
    workspace_root: "D:\\work\\space",
    staging_root: "D:\\work\\staging",
    permission_mode: "operate",
    model_policy_json: JSON.stringify({
      profile: "private",
      api_key: "sk-policy-never-export",
      provider: { api_key: "sk-provider-never-export" },
    }),
    data_policy: "local_only",
    inputs_json: JSON.stringify({
      project: { id: "project-1", title: "周报项目" },
      assets: [{ path: "D:\\work\\space\\paper.pdf", label: "论文" }],
    }),
    session_id: "session-1",
    schedule_id: null,
    created_at: "2026-11-20T10:00:00.000Z",
    updated_at: "2026-11-20T10:05:00.000Z",
    completed_at: "2026-11-20T10:05:00.000Z",
  };
  const artifacts: CoworkArtifact[] = [
    {
      id: "artifact-old",
      task_id: task.id,
      run_id: "run-1",
      kind: "markdown",
      path: "D:\\work\\staging\\report.md",
      version: 1,
      sha256: "a".repeat(64),
      size_bytes: 100,
      template_id: null,
      status: "deleted",
      sources_json: "[]",
      created_at: "2026-11-20T10:01:00.000Z",
    },
    {
      id: "artifact-v2",
      task_id: task.id,
      run_id: "run-1",
      kind: "markdown",
      path: "D:\\work\\staging\\report.md",
      version: 2,
      sha256: "b".repeat(64),
      size_bytes: 2048,
      template_id: null,
      status: "staged",
      sources_json: "[]",
      created_at: "2026-11-20T10:04:00.000Z",
    },
  ];
  return {
    task,
    runs: [{
      id: "run-1",
      task_id: task.id,
      attempt: 1,
      status: "completed",
      started_at: "2026-11-20T10:00:01.000Z",
      ended_at: "2026-11-20T10:05:00.000Z",
      error: null,
      checkpoint_json: "{}",
      usage_json: "{}",
    }],
    steps: [
      {
        id: "step-1",
        run_id: "run-1",
        seq: 1,
        label: "读取材料",
        status: "completed",
        detail_json: "{}",
        started_at: "2026-11-20T10:00:01.000Z",
        ended_at: "2026-11-20T10:02:00.000Z",
      },
      {
        id: "step-2",
        run_id: "run-1",
        seq: 2,
        label: "生成周报",
        status: "completed",
        detail_json: "{}",
        started_at: "2026-11-20T10:02:00.000Z",
        ended_at: "2026-11-20T10:04:00.000Z",
      },
    ],
    artifacts,
    approvals: [
      {
        id: "approval-plan",
        task_id: task.id,
        run_id: "run-1",
        kind: "plan",
        payload_json: JSON.stringify({ plan_text: "计划" }),
        status: "approved",
        decision_reason: "同意，key sk-reason-never-export",
        expires_at: null,
        created_at: "2026-11-20T10:00:00.000Z",
        resolved_at: "2026-11-20T10:00:30.000Z",
      },
      {
        id: "approval-export",
        task_id: task.id,
        run_id: "run-1",
        kind: "export",
        payload_json: "{}",
        status: "pending",
        decision_reason: null,
        expires_at: "2026-11-20T10:30:00.000Z",
        created_at: "2026-11-20T10:04:00.000Z",
        resolved_at: null,
      },
    ],
    events: [
      {
        id: 1,
        task_id: task.id,
        run_id: "run-1",
        type: "cowork.model.routed",
        payload_json: JSON.stringify({
          provider_id: "magpie",
          provider_label: "Magpie 免费路由组",
          model: "group/never-stuck",
          location: "local",
          profile: "private",
          reason: "优先本机模型",
          fallback: {
            from_provider: "cloud-backup",
            from_model: "backup/model",
            reason: "本机排队超时",
            api_key: "sk-fallback-never-export",
            nested: { api_key: "sk-nested-never-export" },
          },
          cost: { currency: "USD", estimated_usd: 0, note: "本机模型，无 API 费用" },
          data_policy: "local_only",
          api_key: "sk-never-export-me",
        }),
        created_at: "2026-11-20T10:00:01.000Z",
      },
    ],
    latest_run: {
      id: "run-1",
      task_id: task.id,
      attempt: 1,
      status: "completed",
      started_at: "2026-11-20T10:00:01.000Z",
      ended_at: "2026-11-20T10:05:00.000Z",
      error: null,
      checkpoint_json: "{}",
      usage_json: "{}",
    },
  };
}

describe("Maxma 任务护照（M4.1）", () => {
  test("护照只取最新未删除产物，并记录路由、审批与数据策略", () => {
    const passport = buildCoworkTaskPassport(fixture());
    expect(passport.schema).toBe("maxma.cowork.passport/v1");
    expect(passport.brand).toBe("Maxma");
    expect(passport.passport_id.startsWith("maxma-")).toBe(true);
    expect(passport.route?.provider_id).toBe("magpie");
    expect(passport.route?.location).toBe("local");
    expect(passport.route?.cost.estimated_usd).toBe(0);
    expect(passport.route?.fallback?.from_provider).toBe("cloud-backup");
    expect(passport.task.model_policy).toEqual({ profile: "private" });
    expect(passport.approvals.approved).toBe(1);
    expect(passport.approvals.pending).toBe(1);
    expect(passport.approvals.by_kind.plan).toBe(1);
    expect(passport.approvals.by_kind.export).toBe(1);
    expect(passport.artifacts.count).toBe(1);
    expect(passport.artifacts.items[0]?.version).toBe(2);
    expect(passport.artifacts.items[0]?.sha256).toBe("b".repeat(64));
    expect(passport.artifacts.total_bytes).toBe(2048);
    expect(passport.source.items.some((item) => item.kind === "asset")).toBe(true);
    expect(passport.execution.steps.completed).toBe(2);
    expect(passport.integrity.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("护照不泄露 api_key；指纹稳定；Markdown 可读且包含边界说明", () => {
    const first = buildCoworkTaskPassport(fixture());
    const second = buildCoworkTaskPassport(fixture());
    expect(first.integrity.digest).toBe(second.integrity.digest);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("sk-never-export-me");
    expect(serialized).not.toContain("sk-policy-never-export");
    expect(serialized).not.toContain("sk-provider-never-export");
    expect(serialized).not.toContain("sk-fallback-never-export");
    expect(serialized).not.toContain("sk-nested-never-export");
    expect(serialized).not.toContain("sk-reason-never-export");
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("api_key");
    const markdown = renderCoworkPassportMarkdown(first);
    expect(markdown).toContain("# Maxma 任务护照");
    expect(markdown).toContain("每个交付，都有一张护照。");
    expect(markdown).toContain("b".repeat(64));
    expect(markdown).toContain("边界说明");
    expect(markdown).not.toContain("sk-never-export-me");
  });

  test("护照指纹可由外部按规范 JSON 复算", () => {
    const passport = buildCoworkTaskPassport(fixture());
    const { passport_id, integrity, ...body } = passport;
    const recomputed = createHash("sha256").update(canonicalCoworkPassportJson(body)).digest("hex");
    expect(integrity.canonicalization).toBe("json-sort-keys/v1");
    expect(recomputed).toBe(integrity.digest);
    expect(passport_id).toBe(`maxma-${recomputed.slice(0, 12)}`);

    // 重新排序键名不应改变指纹，避免“换个 JSON 美化器就验不过”。
    const reordered = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(reordered).reverse());
    expect(createHash("sha256").update(canonicalCoworkPassportJson(reversed)).digest("hex")).toBe(integrity.digest);
  });

  test("Bundle 返回安全文件名与可下载正文", () => {
    const bundle = buildCoworkTaskPassportBundle(fixture());
    expect(bundle.filenames.json).toBe("周报 _ 评审-Maxma-Passport.json");
    expect(bundle.filenames.markdown).toBe("周报 _ 评审-Maxma-Passport.md");
    expect(bundle.markdown).toContain("task-1");
  });
});
