# 系统配置管理 — MCP、Skills、宏、提供商、环境变量、路径白名单

本工具集允许你（Maxma）通过自然语言直接管理系统的各项配置。

## MCP 服务器

MCP（Model Context Protocol）让 Maxma 能调用外部工具和服务。每个 MCP 服务器提供一组工具，工具名自动加 `{server_id}_` 前缀。

### 传输方式
- **stdio**：本地子进程，需要指定 `command`（如 `npx`、`python`）和 `args`
- **sse**：HTTP 服务器推送事件，需要指定 `url`
- **streamable_http**：MCP 2025-03-26 规范 HTTP，需要指定 `url`
- **websocket**：WebSocket 连接，需要指定 `url`

### 常用 MCP 服务器示例
- `@modelcontextprotocol/server-filesystem`（stdio, npx）— 文件系统读写
- `@modelcontextprotocol/server-github`（stdio, npx）— GitHub API
- `@modelcontextprotocol/server-fetch`（stdio, npx）— HTTP 请求
- `playwright`（stdio, npx）— 浏览器自动化

### 注意事项
- 添加/修改/删除 MCP 服务器后会自动触发热重载，新工具立即可用
- stdio 类型的 `command` 必须可用（如 `npx` 需要 Node.js 环境）
- `server_id` 是唯一标识符，不可重复

## LLM 提供商（Providers）

管理 LLM 提供商配置（API 密钥、模型、上下文窗口等）。

### 操作
- **list**：列出所有已配置的提供商
- **add**：添加新提供商（需要 provider_id、api_key、base_url）
- **remove**：删除指定提供商
- **enable/disable**：启用或停用提供商
- **test**：检查提供商配置是否完整

### 注意事项
- API 密钥在列表展示时会自动脱敏（仅显示前4位和后4位）
- 添加或修改提供商后需要重启服务才能生效

## 环境变量（Env Vars）

管理系统的环境变量，主要用于 API 密钥配置。

### 已知变量
- `ZHIPUAI_API_KEY` — 智谱 AI（图片理解等功能）
- `TODOIST_API_TOKEN` — Todoist（待办事项集成）
- `AMAP_API_KEY` — 高德地图（地图/导航功能）
- `TAVILY_API_KEY` — Tavily（网络搜索功能）

### 注意事项
- 设置后立即生效，无需重启
- 值在展示时自动脱敏

## 路径白名单（Whitelist）

管理 Agent 可访问的文件系统路径。Agent 只能读写白名单中的路径。

### 操作
- **list**：列出所有白名单路径
- **add**：添加新路径（支持递归包含子目录）
- **remove**：移除路径

### 注意事项
- 路径会自动规范化（os.path.normpath）
- 添加路径时建议提供描述，方便后续管理

## Skills（技能）

Skills 是可复用的任务指令模板，存放在 `anthropic_skills/{name}/SKILL.md`。当用户请求匹配某个 Skill 的描述时，Maxma 会自动读取并遵循该 Skill 的完整指令。

### SKILL.md 格式
```markdown
---
name: skill-name
description: 简要描述这个 Skill 的用途和触发条件
---

# Skill 标题

## 使用场景
- 当用户需要...

## 步骤
1. 具体步骤...

## 注意事项
- ...
```

### 分类
- **内置 Skills**（builtin）：随系统分发，只读不可修改
- **自定义 Skills**（user）：用户创建，可自由编辑删除

## 宏（Macros）

宏是可复用的指令片段，存放在 `macros/{name}/MACRO.md`。可以嵌入到对话或 Skill 中，提供模块化的指令组合。

## 操作原则
- 创建 Skill/Macro 时，`name` 使用小写字母和连字符（如 `code-review`）
- 描述（description）要清晰具体，便于系统匹配触发
- 内容（content）使用 Markdown 格式，结构清晰
- 修改 MCP 配置后，告知用户新工具已可用（或连接失败的原因）
- 涉及 API 密钥时，提醒用户注意安全
