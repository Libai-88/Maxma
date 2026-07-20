/**
 * tools/config/manage_skills.ts — Manage anthropic_skills/ skills
 *
 * Lists, enables/disables skills by reading SKILL.md files and their
 * frontmatter metadata.
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const SKILLS_DIR = "anthropic_skills";

// B-001: resolve against MAXMA_PROJECT_ROOT (forwarded by sidecar_manager.py)
// so the tool reads the real project-level skills directory instead of
// bun-sidecar/anthropic_skills/.
function projectRoot(): string {
  return process.env.MAXMA_PROJECT_ROOT ?? process.cwd();
}

const params = z.object({
  action: z
    .enum(["list", "get", "enable", "disable"])
    .describe("操作类型: list=列举所有技能, get=查看单个技能内容, enable=启用, disable=禁用"),
  name: z.string().optional().describe("技能名称（用于 get/enable/disable）"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_skills",
  label: "Manage Skills",
  description:
    "管理 anthropic_skills/ 目录下的 AI 技能包。"
    + "可列举所有可用技能、查看技能详情、启用或禁用技能。"
    + "技能是存放于 anthropic_skills/ 下的 SKILL.md 文件，"
    + "每个技能包含独立的指令和流程。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const skillsDir = path.resolve(projectRoot(), SKILLS_DIR);

    if (params.action === "list") {
      if (!fs.existsSync(skillsDir)) {
        return { content: [{ type: "text", text: "anthropic_skills/ 目录不存在" }] };
      }
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      const skills: { name: string; description: string; path: string }[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
        if (!fs.existsSync(skillPath)) continue;
        const content = fs.readFileSync(skillPath, "utf-8");
        const desc = parseFrontmatter(content).description || entry.name;
        skills.push({ name: entry.name, description: desc, path: skillPath });
      }
      if (skills.length === 0) {
        return { content: [{ type: "text", text: "没有找到任何技能" }] };
      }
      const lines = skills.map(
        (s) => `- [${s.name}](${s.path}): ${s.description}`
      );
      return {
        content: [
          {
            type: "text",
            text: `## 可用技能 (${skills.length} 个)\n\n${lines.join("\n")}`,
          },
        ],
      };
    }

    if (params.action === "get") {
      if (!params.name) {
        return { content: [{ type: "text", text: "请指定技能名称 (name 参数)" }], isError: true };
      }
      const skillPath = path.resolve(skillsDir, params.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) {
        return { content: [{ type: "text", text: `技能 "${params.name}" 不存在` }], isError: true };
      }
      const content = fs.readFileSync(skillPath, "utf-8");
      return { content: [{ type: "text", text: content }] };
    }

    // enable/disable — rename file to SKILL.md / SKILL.md.disabled
    if (!params.name) {
      return { content: [{ type: "text", text: "请指定技能名称" }], isError: true };
    }
    const skillPath = path.resolve(skillsDir, params.name, "SKILL.md");
    const disabledPath = skillPath + ".disabled";
    if (params.action === "enable") {
      if (fs.existsSync(disabledPath)) {
        fs.renameSync(disabledPath, skillPath);
        return { content: [{ type: "text", text: `技能 "${params.name}" 已启用` }] };
      }
      return { content: [{ type: "text", text: `技能 "${params.name}" 已经是启用状态` }] };
    }
    if (params.action === "disable") {
      if (fs.existsSync(skillPath)) {
        fs.renameSync(skillPath, disabledPath);
        return { content: [{ type: "text", text: `技能 "${params.name}" 已禁用` }] };
      }
      return { content: [{ type: "text", text: `技能 "${params.name}" 已经是禁用状态` }] };
    }

    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

/** 简易 frontmatter 解析 */
function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\s*\n(.*?)\n---/s);
  if (!match) return {};
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      meta[key] = val;
    }
  }
  return meta;
}

export default tool;
