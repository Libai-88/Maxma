# Maxma OMP 原生重构设计

> **目标：** Maxma 从"带 OMP 后端的独立客户端"进化为"OMP 专属前端框架"。
> Python 后端极致薄层化，所有 Agent 能力由 OMP sidecar 原生提供。
> 品牌 UI 和设计理念（DESIGN.md / PRODUCT.md）完全保留。

---

## 一、架构概览

```
┌─────────────────────────────────────────────────────────┐
│                  Maxma 前端 (Vue 3 + Tauri)               │
│  品牌 UI 保留 · 设计系统保留 · 新增 OMP 能力深度暴露        │
│  对话 | Provider 选择 | 工具面板 | 记忆浏览 | 模型设置      │
└──────────────────────┬──────────────────────────────────┘
        ↕ WebSocket (23 事件类型) + REST API
┌──────────────────────▼──────────────────────────────────┐
│              Python 薄层 (FastAPI)                       │
│  • WS ↔ JSON-RPC 代理                                   │
│  • 认证 (Token)                                         │
│  • 静态文件服务 (Vue 3 dist)                              │
│  • 配置持久化 (YAML: personae/const sessions/settings)    │
└──────────────────────┬──────────────────────────────────┘
        ↕ JSON-RPC 2.0 over stdio
┌──────────────────────▼──────────────────────────────────┐
│              OMP Sidecar (Bun)                           │
│  • Agent 推理循环 (createAgentSession)                   │
│  • 40+ LLM Provider (ModelRegistry)                     │
│  • 32 内置工具 (read/write/bash/gh/task/ask 等)          │
│  • Maxma 自定义 TypeScript AgentTool (6 个配置管理工具)   │
│  • 原生 MCP 自动发现                                     │
│  • 记忆系统 (recall/reflect/retain/memory_edit)          │
│  • Skills 扩展系统                                       │
│  • 上下文压缩 (compaction)                               │
└─────────────────────────────────────────────────────────┘
```

### 职责边界

| 层 | 负责 | 不负责 |
|---|---|---|
| **Vue 3 前端** | 品牌 UI/UX、对话交互、Provider 选择、工具面板、记忆浏览、模型配置 | 不做 Agent 推理、不管理 LLM 连接 |
| **Python 薄层** | WS 代理、HTTP 路由、认证、静态文件、YAML 配置持久化 | 不做 Provider 管理、不执行工具、不管理记忆 |
| **OMP Sidecar** | Agent 推理、LLM 调用、工具执行、MCP 集成、记忆管理、上下文管理 | 不做 UI、不管理持久化配置 |

---

## 二、Python 端删除清单

### 2.1 整个目录删除

| 目录 | 行数参考 | 替代方案 |
|------|---------|---------|
| `memory/` | ~3000 行 | OMP recall/reflect/retain/memory_edit |
| `tools/` | ~5000 行 | OMP 32 内置工具 + TS AgentTool |
| `api/providers/` | ~1000 行 | OMP ModelRegistry (40+ provider) |
| `api/callbacks/` | ~200 行 | 不再需要 |
| `tools/sub_agent/` | ~1000 行 | OMP task 工具 (DAG 编排) |
| `tools/workflow/` | ~500 行 | OMP 原生任务系统 |

### 2.2 单个文件删除

| 文件 | 替代 |
|------|------|
| `agent/autonomy/` | OMP auto-research |
| `agent/hooks.py` | OMP 事件系统 |
| `agent/audit_log.py` | OMP telemetry |
| `agent/circuit_breaker.py` | OMP 内置容错 |
| `agent/error_recovery.py` | OMP 内置 |
| `agent/delegation_scope.py` | 不再需要 |
| `agent/runtime_context.py` | OMP 管理 |
| `agent/think_path.py` | OMP thinking 模式 |
| `tools/mcp.py` | OMP 原生 MCP 自动发现 |
| `tools/interaction/` | OMP ask 工具 |
| `tools/path_security.py` | OMP 文件系统安全原生支持 |
| `tools/crypto.py` | 不再需要 |
| `tools/registry.py` | OMP 工具注册原生 |

### 2.3 需要保留的文件（简化版）

```
api/
  pi_bridge/          ← WS↔JSON-RPC 核心桥接（保留但简化）
  auth.py             ← Token 认证（保留）
  const_session_store.py ← Const 会话 YAML 持久化（保留）
  server.py           ← 应用工厂（大幅简化，移除 checkpointer/provider 等）
  session_manager.py  ← 会话管理（简化，移除工具相关字段）
  routes/
    chat.py           ← WS 端点（简化，移除 provider 选择逻辑）
    sessions.py       ← 会话 CRUD（保留）
    persona.py        ← 人设管理（保留）
    skills.py         ← Skills 清单（保留）
    mcp.py            ← MCP 配置查看（简化）
    files.py          ← 文件上传（保留）
agent/
  prompts.py          ← 构建 system prompt（保留）
  persona_loader.py   ← 人设加载（保留）
  context_manager.py  ← 已简化存根
  project_scanner.py  ← 项目扫描（保留）
config/
  personas/           ← SOUL.md / USER.md / AGENTS.md（保留）
```

### 2.4 Python 依赖变更

**移除：**
```
chromadb                 — OMP 记忆系统替代
onnxruntime              — 不再需要本地嵌入
transformers             — 不再需要
sentence-transformers    — 不再需要
langchain                — 不再需要（这是 langgraph 入口依赖）
langchain-openai         — 不再需要（OMP 管理 provider）
langchain-mcp-adapters   — 不再需要（OMP 原生 MCP）
tavily-python            — OMP web_search 替代
playwright               — OMP browser 工具替代
moviepy                  — 非核心
todoist-api-python       — TS AgentTool 版
uapi-sdk-python          — TS AgentTool 版
```

**保留：**
```
fastapi + uvicorn        — HTTP/WS 服务
pydantic-settings        — 配置
python-dotenv            — .env 加载
pyyaml                   — YAML 持久化
cryptography             — Token 加密
httpx                    — HTTP 客户端（少量）
requests                 — HTTP 客户端（少量）
beautifulsoup4           — HTML 解析
PyPDF2 / python-docx     — 文档解析
```

---

## 三、TypeScript AgentTool 迁移

### 3.1 需要重写的 Maxma 特有工具

这些是 OMP 没有等价物的 Maxma 特有配置管理工具，按 OMP 官方 `ToolDefinition` 规范重写：

| 工具 | 文件 | 职责 | 数据来源 |
|------|------|------|---------|
| `manage_skills` | `tools/manage_skills.ts` | 列举/启用/禁用 `anthropic_skills/` 下的技能 | 直接读文件系统 |
| `manage_macros` | `tools/manage_macros.ts` | 列举/创建/编辑/删除 `macros/` 下的宏 | 直接读文件系统 |
| `manage_providers` | `tools/manage_providers.ts` | 查看/切换 LLM Provider | OMP ModelRegistry |
| `manage_mcp` | `tools/manage_mcp.ts` | MCP 服务器配置管理 | 直接读配置文件 |
| `manage_env_vars` | `tools/manage_env_vars.ts` | 环境变量查看/设置 | 读 .env / 进程 env |
| `manage_whitelist` | `tools/manage_whitelist.ts` | 路径白名单管理 | 直接读配置文件 |

### 3.2 TypeScript 工具目录结构

```
bun-sidecar/src/tools/
  index.ts              ← registerCustomTools() 聚合入口
  todoist.ts            ← 10 个 Todoist 工具（已有）
  weather.ts            ← get_current_weather（已有，在 index.ts 内联）
  holiday.ts            ← holiday_calendar（已有，在 index.ts 内联）
  tarot.ts              ← tarot（已有，在 index.ts 内联）
  config/
    manage_skills.ts    ← 新增
    manage_macros.ts    ← 新增
    manage_providers.ts ← 新增
    manage_mcp.ts       ← 新增
    manage_env_vars.ts  ← 新增
    manage_whitelist.ts ← 新增
```

### 3.3 OMP 官方 ToolDefinition 规范

每个工具遵循以下接口（参考 `@oh-my-pi/pi-agent-core` 的 `AgentTool` 类型）：

```typescript
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";

// 参数 schema 使用 zod v4
const params = z.object({
  action: z.enum(["list", "get", "create", "update", "delete"])
    .describe("操作类型"),
  name: z.string().optional().describe("目标名称"),
});

// 工具定义
const tool: ToolDefinition<typeof params> = {
  name: "manage_xxx",
  label: "管理 XXX",
  description: "清晰的功能描述，OMP 会自动解析并决定是否调用",
  parameters: params,
  execute: async (toolCallId, params) => {
    try {
      const result = await doSomething(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `操作失败: ${String(e)}` }],
        isError: true,
      };
    }
  },
};
```

---

## 四、前端整合

### 4.1 新增前端能力

| 领域 | 新增功能 | 数据来源 |
|------|---------|---------|
| **Provider** | 40+ Provider 可视化选择器、模型角色路由、每会话模型切换 | OMP ModelRegistry (通过 Python 透传) |
| **工具面板** | 工具清单查看、启用/禁用、调用历史可视化 | OMP 工具注册表 |
| **记忆浏览器** | recall 结果展示、事实查看/编辑/删除 | OMP memory_edit |
| **模型设置** | 温度、max_tokens、thinking 模式、OMP settings | OMP Settings |
| **上下文监控** | Token 用量实时显示、压缩状态、上下文概览 | OMP 事件流 |
| **MCP 管理** | MCP 服务器列表、状态、配置 | OMP MCP 自动发现 |

### 4.2 设计原则

1. **渐进式暴露** — 核心对话体验不变。高级能力放在可折叠面板/设置页面。新手不觉得复杂，老手觉得够用。
2. **品牌一致性** — 所有新增 UI 遵循 DESIGN.md 规范：黑白基底、纯黑 accent、系统字体栈、圆角体系。
3. **数据源透明** — 前端无感知 OMP 的存在，所有数据通过 Python 薄层的 REST API 和 WS 事件获取。
4. **品牌保留** — DESIGN.md（极简单色工作台）和 PRODUCT.md（现代·专业·温暖）的设计理念不改变。

### 4.3 前端通信路径

```
用户操作 → Vue 3 组件 → REST /api/xxx → Python 薄层 → 文件系统 / OMP RPC
OMP 事件 → sidecar → Python 桥接 → WS event → Vue 3 前端
```

前端不需要 import 任何 OMP 包。所有 OMP 交互由 Python 薄层封装。

---

## 五、实施阶段

### Phase 1: Python 薄层化（删除 + 简化）
1. 删除 `memory/`、`tools/`、`api/providers/`、`api/callbacks/`、`tools/sub_agent/` 等目录
2. 简化 `api/server.py` — 移除 provider/checkpointer/autonomy/hooks 生命周期
3. 简化 `api/routes/chat.py` — 移除 provider 选择逻辑，纯 sidecar 代理
4. 简化 `api/session_manager.py` — 移除工具相关字段
5. 简化 `pyproject.toml` — 移除不需要的依赖
6. 更新 `build/maxma-server.spec` — 匹配新依赖

### Phase 2: TypeScript AgentTool 重写
1. 创建 6 个配置管理工具的 TS AgentTool 实现
2. 注册到 `bun-sidecar/src/tools/index.ts`
3. 端到端测试工具调用

### Phase 3: 前端 OMP 能力整合
1. Provider 选择器组件
2. 工具面板组件
3. 记忆浏览器组件
4. 模型设置面板
5. 上下文监控

### Phase 4: 测试 + 构建
1. 更新测试套件
2. 验证 dev 模式 0 错误
3. 构建便携版
4. 冒烟测试

---

## 六、边界情况与错误处理

### 6.1 OMP Sidecar 不可用
- Python 薄层检测 sidecar 进程状态
- 前端显示"Agent 引擎未就绪"提示，仍可浏览配置
- 自动重试机制（指数退避）

### 6.2 配置读写冲突
- TypeScript AgentTool 与 REST API 可能同时操作同一配置文件
- 使用文件锁（`portalocker` 或 OMP 内置机制）
- 写操作原子化：读→改→写，失败重试

### 6.3 Provider 配置变更
- OMP 管理 provider，Python 不再存储 provider 配置
- Provider 配置通过前端 → Python REST → OMP RPC 写入 OMP
- 迁移：首次启动时将旧 Python SQLite provider 配置导入 OMP

### 6.4 前向兼容
- 所有 REST API 返回格式不变（前端不需要大量修改）
- WS 事件协议不变（type/payload 结构）
- 配置 YAML 格式不变
