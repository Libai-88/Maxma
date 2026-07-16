# Phase 2: TypeScript AgentTool 重写 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 6 个 Maxma 特有配置管理工具从 Python 迁移为 TypeScript AgentTool，遵循 OMP 官方 `ToolDefinition` 规范注册到 sidecar。

**Architecture:** 每个工具是一个独立的 `.ts` 文件，导出 `ToolDefinition` 对象。`bun-sidecar/src/tools/index.ts` 聚合所有工具到 `registerCustomTools()`。工具直接读写文件系统或调用 Python REST API。

**Tech Stack:** OMP v16.5.2, TypeScript, Bun 1.3+, Zod v4

**Prerequisite:** Phase 1 完成（Python 薄层化）。`bun-sidecar/src/tools/index.ts` 存在且有 `registerCustomTools()` 函数。

---

## 文件结构

```
bun-sidecar/src/tools/
  index.ts              ← 修改：注册新工具
  todoist.ts            ← 不变
  config/
    manage_skills.ts    ← 新建：列举/启用/禁用 anthropic_skills/
    manage_macros.ts    ← 新建：列举/创建/编辑/删除 macros/
    manage_providers.ts ← 新建：查看 Provider 配置（从 YAML）
    manage_mcp.ts       ← 新建：MCP 服务器配置管理
    manage_env_vars.ts  ← 新建：查看/设置环境变量
    manage_whitelist.ts ← 新建：路径白名单管理
```

## 数据访问方式

每个工具读取文件系统上的配置文件（YAML/JSON），通过 Node.js `fs` 模块操作：

| 工具 | 配置文件路径 | 操作 |
|------|-------------|------|
| manage_skills | `{project_root}/anthropic_skills/*/SKILL.md` | fs.readdir + fs.readFile |
| manage_macros | `{project_root}/macros/*/MACRO.md` | fs.readdir + fs.readFile + fs.writeFile |
| manage_providers | `{project_root}/config/providers.yaml` | fs.readFile + fs.writeFile |
| manage_mcp | `{project_root}/config/mcp_servers.yaml` | fs.readFile + fs.writeFile |
| manage_env_vars | `{project_root}/.env` | fs.readFile + fs.writeFile |
| manage_whitelist | `{project_root}/config/.whitelist` | fs.readFile + fs.writeFile |

所有路径相对于 `process.cwd()`（即项目根目录），由 `createAgentSession` 的 `cwd` 参数传入。

---

### Task 1: manage_skills

**Files:**
- Create: `bun-sidecar/src/tools/config/manage_skills.ts`
- Modify: `bun-sidecar/src/tools/index.ts` (register new tool)

- [ ] **Step 1: Create manage_skills.ts**

```typescript
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
    const skillsDir = path.resolve(process.cwd(), SKILLS_DIR);

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
```

- [ ] **Step 2: Register in index.ts**

Edit `bun-sidecar/src/tools/index.ts`:

```typescript
import manageSkillsTool from "./config/manage_skills";
// ... other imports

export function registerCustomTools(): ToolDefinition[] {
  return [
    weatherTool,
    holidayTool,
    tarotTool,
    manageSkillsTool,
    // manageMacrosTool,  // will be added in Task 2
    // manageProvidersTool, // will be added in Task 3
    // manageMCPTool,      // ...
    // manageEnvVarsTool,
    // manageWhitelistTool,
    ...todoistTools,
  ];
}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && bun build src/tools/config/manage_skills.ts --outdir=dist 2>&1
```
Expected: No errors.

- [ ] **Step 4: Verify sidecar starts**

```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && timeout 3 bun src/session-bridge.ts 2>&1 || true
```
Expected: No compilation/runtime errors (process waits for stdin).

- [ ] **Step 5: Commit**

```bash
git add bun-sidecar/src/tools/config/manage_skills.ts bun-sidecar/src/tools/index.ts
git commit -m "feat: add manage_skills TypeScript AgentTool"
```

---

### Task 2: manage_macros

**Files:**
- Create: `bun-sidecar/src/tools/config/manage_macros.ts`
- Modify: `bun-sidecar/src/tools/index.ts`

- [ ] **Step 1: Create manage_macros.ts**

```typescript
/**
 * tools/config/manage_macros.ts — Manage macros/ replayable instruction snippets
 *
 * Lists, creates, edits, and deletes MACRO.md files in the macros/ directory.
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const MACROS_DIR = "macros";

const params = z.object({
  action: z
    .enum(["list", "get", "create", "update", "delete"])
    .describe("操作类型: list=列举, get=查看内容, create=创建, update=更新, delete=删除"),
  name: z.string().optional().describe("宏名称（用于 get/create/update/delete）"),
  content: z.string().optional().describe("宏内容（用于 create/update）"),
  description: z.string().optional().describe("宏描述（用于 create/update 的 frontmatter）"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_macros",
  label: "Manage Macros",
  description:
    "管理 macros/ 目录下的可复用指令片段（宏）。"
    + "可列举所有宏、查看宏内容、创建新宏、更新已有宏、删除宏。"
    + "每个宏是一个 MACRO.md 文件，包含可复用的指令文本。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const macrosDir = path.resolve(process.cwd(), MACROS_DIR);

    if (params.action === "list") {
      if (!fs.existsSync(macrosDir)) {
        return { content: [{ type: "text", text: "macros/ 目录不存在" }] };
      }
      const entries = fs.readdirSync(macrosDir, { withFileTypes: true });
      const macros: { name: string; description: string }[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const macroPath = path.join(macrosDir, entry.name, "MACRO.md");
        if (!fs.existsSync(macroPath)) continue;
        const content = fs.readFileSync(macroPath, "utf-8");
        const desc = _parseFrontmatter(content).description || entry.name;
        macros.push({ name: entry.name, description: desc });
      }
      if (macros.length === 0) {
        return { content: [{ type: "text", text: "没有找到任何宏" }] };
      }
      const lines = macros.map((m) => `- ${m.name}: ${m.description}`);
      return {
        content: [{ type: "text", text: `## 可用宏 (${macros.length} 个)\n\n${lines.join("\n")}` }],
      };
    }

    if (params.action === "get") {
      if (!params.name) {
        return { content: [{ type: "text", text: "请指定宏名称" }], isError: true };
      }
      const macroPath = path.resolve(macrosDir, params.name, "MACRO.md");
      if (!fs.existsSync(macroPath)) {
        return { content: [{ type: "text", text: `宏 "${params.name}" 不存在` }], isError: true };
      }
      const content = fs.readFileSync(macroPath, "utf-8");
      return { content: [{ type: "text", text: content }] };
    }

    if (params.action === "create" || params.action === "update") {
      if (!params.name || !params.content) {
        return { content: [{ type: "text", text: "请指定 name 和 content 参数" }], isError: true };
      }
      const macroDir = path.resolve(macrosDir, params.name);
      const macroPath = path.join(macroDir, "MACRO.md");
      if (params.action === "create" && fs.existsSync(macroPath)) {
        return { content: [{ type: "text", text: `宏 "${params.name}" 已存在` }], isError: true };
      }
      fs.mkdirSync(macroDir, { recursive: true });
      const description = params.description || params.name;
      const mdContent = `---\nname: "${params.name}"\ndescription: "${description}"\n---\n\n${params.content}`;
      fs.writeFileSync(macroPath, mdContent, "utf-8");
      return { content: [{ type: "text", text: `宏 "${params.name}" 已${params.action === "create" ? "创建" : "更新"}` }] };
    }

    if (params.action === "delete") {
      if (!params.name) {
        return { content: [{ type: "text", text: "请指定宏名称" }], isError: true };
      }
      const macroDir = path.resolve(macrosDir, params.name);
      const macroPath = path.join(macroDir, "MACRO.md");
      if (!fs.existsSync(macroPath)) {
        return { content: [{ type: "text", text: `宏 "${params.name}" 不存在` }], isError: true };
      }
      fs.rmSync(macroDir, { recursive: true, force: true });
      return { content: [{ type: "text", text: `宏 "${params.name}" 已删除` }] };
    }

    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

function _parseFrontmatter(text: string): Record<string, string> {
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
```

- [ ] **Step 2: Register in index.ts**

```typescript
import manageSkillsTool from "./config/manage_skills";
import manageMacrosTool from "./config/manage_macros";
// ...

export function registerCustomTools(): ToolDefinition[] {
  return [
    weatherTool, holidayTool, tarotTool,
    manageSkillsTool, manageMacrosTool,
    // ... more to come
    ...todoistTools,
  ];
}
```

- [ ] **Step 3: Verify**

```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && bun build src/tools/config/manage_macros.ts --outdir=dist 2>&1 && timeout 3 bun src/session-bridge.ts 2>&1 || true
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add manage_macros TypeScript AgentTool"
```

---

### Task 3: manage_providers

**Files:**
- Create: `bun-sidecar/src/tools/config/manage_providers.ts`
- Modify: `bun-sidecar/src/tools/index.ts`

- [ ] **Step 1: Create manage_providers.ts**

```typescript
/**
 * tools/config/manage_providers.ts — View/manage LLM Providers
 *
 * Lists and manages LLM provider configurations.
 * Provider connections are managed by OMP ModelRegistry;
 * this tool only reads/writes the user's provider config file.
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import * as YAML from "yaml";

const PROFILE_PATH = "config/providers.yaml";

const params = z.object({
  action: z
    .enum(["list", "get", "set_active"])
    .describe("操作类型: list=列举所有 provider, get=查看详情, set_active=切换默认 provider"),
  provider_id: z.string().optional().describe("Provider ID（用于 get/set_active）"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_providers",
  label: "Manage Providers",
  description:
    "管理 LLM Provider 配置。可列举所有已配置的 Provider、查看详情、切换默认 Provider。"
    + "Provider 的添加和删除请通过 Maxma 设置页面操作。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const profilePath = path.resolve(process.cwd(), PROFILE_PATH);

    if (!fs.existsSync(profilePath)) {
      return { content: [{ type: "text", text: "Provider 配置文件不存在" }] };
    }

    const raw = fs.readFileSync(profilePath, "utf-8");
    let config: any;
    try {
      config = YAML.parse(raw);
    } catch {
      return { content: [{ type: "text", text: "Provider 配置文件格式错误" }], isError: true };
    }

    const providers = config?.providers ?? [];

    if (params.action === "list") {
      if (!Array.isArray(providers) || providers.length === 0) {
        return { content: [{ type: "text", text: "没有配置任何 Provider" }] };
      }
      const lines = providers.map((p: any) =>
        `- ${p.id || p.name}: ${p.label || p.model || "(unnamed)"} [${p.enabled ? "✓" : "✗"}]`
      );
      return {
        content: [{ type: "text", text: `## 已配置的 Provider (${providers.length} 个)\n\n${lines.join("\n")}` }],
      };
    }

    if (params.action === "get") {
      if (!params.provider_id) {
        return { content: [{ type: "text", text: "请指定 provider_id" }], isError: true };
      }
      const provider = providers.find((p: any) => (p.id || p.name) === params.provider_id);
      if (!provider) {
        return { content: [{ type: "text", text: `Provider "${params.provider_id}" 不存在` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(provider, null, 2) }] };
    }

    if (params.action === "set_active") {
      if (!params.provider_id) {
        return { content: [{ type: "text", text: "请指定 provider_id" }], isError: true };
      }
      const found = providers.find((p: any) => (p.id || p.name) === params.provider_id);
      if (!found) {
        return { content: [{ type: "text", text: `Provider "${params.provider_id}" 不存在` }], isError: true };
      }
      // Set all to disabled, then enable the target
      for (const p of providers) p.enabled = false;
      found.enabled = true;
      fs.writeFileSync(profilePath, YAML.stringify(config), "utf-8");
      return { content: [{ type: "text", text: `已切换默认 Provider 为 "${params.provider_id}"` }] };
    }

    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
```

- [ ] **Step 2: Register in index.ts**

- [ ] **Step 3: Verify**

```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && bun build src/tools/config/manage_providers.ts --outdir=dist 2>&1
```

- [ ] **Step 4: Commit** `feat: add manage_providers TypeScript AgentTool`

---

### Task 4: manage_mcp

**Files:**
- Create: `bun-sidecar/src/tools/config/manage_mcp.ts`
- Modify: `bun-sidecar/src/tools/index.ts`

- [ ] **Step 1: Create manage_mcp.ts**

```typescript
/**
 * tools/config/manage_mcp.ts — Manage MCP server configurations
 *
 * Lists and manages MCP server connections. MCP servers provide
 * external tools (maps, databases, custom APIs) to the agent.
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";
import * as YAML from "yaml";

const MCP_CONFIG_PATH = "config/mcp_servers.yaml";

const params = z.object({
  action: z
    .enum(["list", "get", "test"])
    .describe("操作类型: list=列举所有 MCP 服务器, get=查看详情, test=测试连接"),
  server_id: z.string().optional().describe("MCP 服务器 ID"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_mcp",
  label: "Manage MCP Servers",
  description:
    "管理 MCP (Model Context Protocol) 服务器配置。"
    + "可列举所有已配置的 MCP 服务器、查看详情、测试连接状态。"
    + "MCP 服务器提供外部工具如高德地图、数据库等。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const configPath = path.resolve(process.cwd(), MCP_CONFIG_PATH);

    if (params.action === "list") {
      if (!fs.existsSync(configPath)) {
        return { content: [{ type: "text", text: "未配置任何 MCP 服务器" }] };
      }
      const raw = fs.readFileSync(configPath, "utf-8");
      let servers: any[];
      try {
        const parsed = YAML.parse(raw);
        servers = parsed?.mcp_servers ?? parsed?.servers ?? [];
      } catch {
        return { content: [{ type: "text", text: "配置文件格式错误" }], isError: true };
      }
      if (!Array.isArray(servers) || servers.length === 0) {
        return { content: [{ type: "text", text: "没有配置任何 MCP 服务器" }] };
      }
      const lines = servers.map((s: any) =>
        `- ${s.id || s.name}: ${s.url || s.command || "(unknown)"}`
      );
      return {
        content: [{ type: "text", text: `## MCP 服务器 (${servers.length} 个)\n\n${lines.join("\n")}` }],
      };
    }

    if (params.action === "get") {
      if (!params.server_id) {
        return { content: [{ type: "text", text: "请指定 server_id" }], isError: true };
      }
      if (!fs.existsSync(configPath)) {
        return { content: [{ type: "text", text: "MCP 配置文件不存在" }], isError: true };
      }
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = YAML.parse(raw);
      const servers = parsed?.mcp_servers ?? parsed?.servers ?? [];
      const server = servers.find((s: any) => (s.id || s.name) === params.server_id);
      if (!server) {
        return { content: [{ type: "text", text: `MCP 服务器 "${params.server_id}" 不存在` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(server, null, 2) }] };
    }

    if (params.action === "test") {
      // MCP connection testing is handled by OMP natively
      return { content: [{ type: "text", text: "MCP 连接测试请使用 OMP 的 MCP 管理功能或 Maxma 设置页面" }] };
    }

    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
```

- [ ] **Step 2: Register in index.ts**

- [ ] **Step 3: Verify → Commit** `feat: add manage_mcp TypeScript AgentTool`

---

### Task 5: manage_env_vars

**Files:**
- Create: `bun-sidecar/src/tools/config/manage_env_vars.ts`
- Modify: `bun-sidecar/src/tools/index.ts`

- [ ] **Step 1: Create manage_env_vars.ts**

```typescript
/**
 * tools/config/manage_env_vars.ts — View/manage environment variables
 *
 * Reads and writes the .env file. Shows current environment variable values
 * (masking sensitive keys like API keys).
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const ENV_PATH = ".env";

const params = z.object({
  action: z
    .enum(["list", "get", "set", "delete"])
    .describe("操作类型: list=列举所有变量, get=查看单个, set=设置, delete=删除"),
  key: z.string().optional().describe("环境变量名"),
  value: z.string().optional().describe("环境变量值（用于 set）"),
});

/** Keys whose values should be masked in output */
const SENSITIVE_KEYS = ["API_KEY", "TOKEN", "SECRET", "PASSWORD", "KEY"];

function maskValue(key: string, value: string): string {
  const isSensitive = SENSITIVE_KEYS.some((s) => key.toUpperCase().includes(s));
  if (!isSensitive) return value;
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

const tool: ToolDefinition<typeof params> = {
  name: "manage_env_vars",
  label: "Manage Environment Variables",
  description:
    "管理环境变量配置。可列举所有环境变量、查看单个变量、设置新值、删除变量。"
    + "敏感信息（API Key、Token 等）在列表中会被部分遮蔽。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const envPath = path.resolve(process.cwd(), ENV_PATH);

    const readEnv = (): Record<string, string> => {
      if (!fs.existsSync(envPath)) return {};
      const content = fs.readFileSync(envPath, "utf-8");
      const vars: Record<string, string> = {};
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx <= 0) continue;
        const k = trimmed.slice(0, eqIdx).trim();
        let v = trimmed.slice(eqIdx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        vars[k] = v;
      }
      return vars;
    };

    const writeEnv = (vars: Record<string, string>): void => {
      const lines = Object.entries(vars)
        .map(([k, v]) => `${k}=${v.includes(" ") ? `"${v}"` : v}`);
      fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");
    };

    if (params.action === "list") {
      const vars = readEnv();
      const keys = Object.keys(vars);
      if (keys.length === 0) {
        return { content: [{ type: "text", text: "没有配置环境变量" }] };
      }
      const lines = keys.map((k) => `- ${k}=${maskValue(k, vars[k])}`);
      return {
        content: [{ type: "text", text: `## 环境变量 (${keys.length} 个)\n\n${lines.join("\n")}` }],
      };
    }

    if (params.action === "get") {
      if (!params.key) {
        return { content: [{ type: "text", text: "请指定 key" }], isError: true };
      }
      const vars = readEnv();
      if (!(params.key in vars)) {
        return { content: [{ type: "text", text: `环境变量 "${params.key}" 未设置` }], isError: true };
      }
      return { content: [{ type: "text", text: `${params.key}=${maskValue(params.key, vars[params.key])}` }] };
    }

    if (params.action === "set") {
      if (!params.key || params.value === undefined) {
        return { content: [{ type: "text", text: "请指定 key 和 value" }], isError: true };
      }
      const vars = readEnv();
      vars[params.key] = params.value;
      writeEnv(vars);
      // Also set in current process environment
      process.env[params.key] = params.value;
      return { content: [{ type: "text", text: `环境变量 "${params.key}" 已设置` }] };
    }

    if (params.action === "delete") {
      if (!params.key) {
        return { content: [{ type: "text", text: "请指定 key" }], isError: true };
      }
      const vars = readEnv();
      if (!(params.key in vars)) {
        return { content: [{ type: "text", text: `环境变量 "${params.key}" 未设置` }], isError: true };
      }
      delete vars[params.key];
      writeEnv(vars);
      return { content: [{ type: "text", text: `环境变量 "${params.key}" 已删除` }] };
    }

    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
```

- [ ] **Step 2: Register in index.ts**

- [ ] **Step 3: Verify → Commit** `feat: add manage_env_vars TypeScript AgentTool`

---

### Task 6: manage_whitelist

**Files:**
- Create: `bun-sidecar/src/tools/config/manage_whitelist.ts`
- Modify: `bun-sidecar/src/tools/index.ts`

- [ ] **Step 1: Create manage_whitelist.ts**

```typescript
/**
 * tools/config/manage_whitelist.ts — Manage path whitelist
 *
 * Lists and manages the filesystem path whitelist that restricts
 * which directories the AI agent can read/write.
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const WHITELIST_PATH = "config/.whitelist";

const params = z.object({
  action: z
    .enum(["list", "add", "remove"])
    .describe("操作类型: list=列举白名单, add=添加路径, remove=移除路径"),
  path_str: z.string().optional().describe("文件路径（用于 add/remove）"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_whitelist",
  label: "Manage Path Whitelist",
  description:
    "管理 AI 可访问的文件路径白名单。"
    + "可列举当前白名单、添加允许访问的路径、移除路径。"
    + "白名单之外的路径 AI 无法读写。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const wlPath = path.resolve(process.cwd(), WHITELIST_PATH);

    const readList = (): string[] => {
      if (!fs.existsSync(wlPath)) return [];
      return fs.readFileSync(wlPath, "utf-8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
    };

    const writeList = (items: string[]): void => {
      const content = "# AI 路径白名单\n# 每行一个路径，支持通配符\n\n" + items.join("\n") + "\n";
      fs.writeFileSync(wlPath, content, "utf-8");
    };

    if (params.action === "list") {
      const items = readList();
      if (items.length === 0) {
        return { content: [{ type: "text", text: "白名单为空（AI 可能无法访问任何文件）" }] };
      }
      const lines = items.map((p, i) => `${i + 1}. ${p}`);
      return {
        content: [{ type: "text", text: `## 路径白名单 (${items.length} 项)\n\n${lines.join("\n")}` }],
      };
    }

    if (params.action === "add") {
      if (!params.path_str) {
        return { content: [{ type: "text", text: "请指定 path_str" }], isError: true };
      }
      const items = readList();
      const resolved = path.resolve(params.path_str);
      if (items.includes(resolved)) {
        return { content: [{ type: "text", text: `路径 "${resolved}" 已在白名单中` }] };
      }
      items.push(resolved);
      writeList(items);
      return { content: [{ type: "text", text: `已添加 "${resolved}" 到白名单` }] };
    }

    if (params.action === "remove") {
      if (!params.path_str) {
        return { content: [{ type: "text", text: "请指定 path_str" }], isError: true };
      }
      const items = readList();
      const resolved = path.resolve(params.path_str);
      const idx = items.indexOf(resolved);
      if (idx === -1) {
        return { content: [{ type: "text", text: `路径 "${resolved}" 不在白名单中` }], isError: true };
      }
      items.splice(idx, 1);
      writeList(items);
      return { content: [{ type: "text", text: `已从白名单移除 "${resolved}"` }] };
    }

    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
```

- [ ] **Step 2: Register in index.ts** — final registration:

```typescript
import manageSkillsTool from "./config/manage_skills";
import manageMacrosTool from "./config/manage_macros";
import manageProvidersTool from "./config/manage_providers";
import manageMCPTool from "./config/manage_mcp";
import manageEnvVarsTool from "./config/manage_env_vars";
import manageWhitelistTool from "./config/manage_whitelist";

export function registerCustomTools(): ToolDefinition[] {
  return [
    weatherTool,
    holidayTool,
    tarotTool,
    manageSkillsTool,
    manageMacrosTool,
    manageProvidersTool,
    manageMCPTool,
    manageEnvVarsTool,
    manageWhitelistTool,
    ...todoistTools,
  ];
}
```

- [ ] **Step 3: Verify** — full sidecar startup:

```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && timeout 3 bun src/session-bridge.ts 2>&1 || true
```
Expected: No errors.

- [ ] **Step 4: Commit** `feat: add manage_whitelist TypeScript AgentTool`

---

### Task 7: Config directory YAML manager utility

All config tools import `yaml` for YAML parsing. Bun bundles `yaml` via npm. Verify it's installed:

- [ ] **Step 1: Check yaml package**

```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && ls node_modules/yaml/package.json 2>/dev/null && node -e "const YAML = require('yaml'); console.log(YAML.parse('key: val'))" 2>&1
```
Expected: `{ key: 'val' }`

If yaml is not installed:
```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && bun add yaml
```

- [ ] **Step 2: Full compilation check**

```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && bun build src/session-bridge.ts --outdir=dist 2>&1
```
Expected: No errors.

- [ ] **Step 3: Full runtime test**

```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && timeout 5 bash -c 'echo "{}" | bun src/session-bridge.ts' 2>&1 || true
```
Expected: No JavaScript errors (the JSON-RPC server should reject invalid JSON gracefully).

---

## 验证清单

所有 6 个工具完成后：

- [ ] `manage_skills` — 列出 `anthropic_skills/` 目录，显示 SKILL.md 元数据
- [ ] `manage_macros` — 列出 `macros/` 目录，支持 CRUD 操作
- [ ] `manage_providers` — 读取 `config/providers.yaml`，切换默认 provider
- [ ] `manage_mcp` — 读取 `config/mcp_servers.yaml`，列出 MCP 服务器
- [ ] `manage_env_vars` — 读取/写入 `.env`，遮蔽敏感键值
- [ ] `manage_whitelist` — 读取/写入 `config/.whitelist`
- [ ] 所有工具在 `session-bridge.ts` 启动时正确注册
- [ ] TypeScript 编译无错误
