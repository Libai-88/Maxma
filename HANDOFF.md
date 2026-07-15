# MaxmaHere 交接文档

> 写给后续开发者：本文档描述项目当前的真实状态。

---

## 一、Maxma 是什么

MaxmaHere 是一个**本地优先的 AI 工作站**，以 oh-my-pi 为 Agent 引擎，Vue 3 为前端，Tauri 为桌面壳。

**核心设计**：Maxma = oh-my-pi 的前端。所有 Agent 推理由 oh-my-pi 提供，Maxma 负责品牌 UI/UX、用户管理、路由和安全策略。

### 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| Agent 引擎 | oh-my-pi (Bun/TypeScript) | v16.5.2 |
| LLM 提供商 | 40+（Anthropic, OpenAI, DeepSeek, 本地 Ollama...） | — |
| 后端 | FastAPI + uvicorn (Python) | >= 0.110 |
| 前端 | Vue 3 + Vite 5 + Pinia + TypeScript | Vue ^3.4 |
| 桌面壳 | Tauri 2 + Rust | v2.6.6 |
| 会话持久化 | oh-my-pi JSONL + SQLite（SessionMap） | — |
| 内存/向量 | ChromaDB + ONNX Runtime | paraphrase-multilingual |
| Python | >= 3.11 | 隔离 .venv |

### 目录结构

```
MaxmaHere/
├── bun-sidecar/                ← oh-my-pi 引擎（Bun sidecar）
│   └── src/
│       ├── session-bridge.ts   ← JSON-RPC 服务器：封装 createAgentSession
│       ├── rpc-types.ts        ← 协议类型定义
│       └── tools/              ← 13 个原生 AgentTool
├── api/
│   ├── pi_bridge/              ← Python ↔ oh-my-pi 桥接层
│   │   ├── sidecar_manager.py  ← Bun 进程生命周期
│   │   ├── rpc_client.py       ← JSON-RPC 2.0 客户端
│   │   ├── session_adapter.py  ← SessionMap 持久化映射
│   │   ├── ws_event_mapper.py  ← 事件校验/包装
│   │   ├── security_adapter.py ← 路径安全/MaxmaBlocker
│   │   └── approval_adapter.py ← 审批级别映射
│   ├── routes/
│   │   └── chat.py             ← WS 端点，唯一 agent 执行路径（oh-my-pi）
│   └── providers/              ← LLM Provider 管理
├── web/                        ← Vue 3 前端
├── config/                     ← 人设、贴纸
├── agent/                      ← Python 辅助（prompts, context_manager）
├── memory/                     ← 记忆系统
└── desktop/                    ← Tauri 桌面壳
```

### 架构要点

1. **Agent 引擎**：oh-my-pi（Bun 进程）执行所有 agent 推理循环。Python 端通过 JSON-RPC over stdio 与之通信。
2. **LangGraph 已完全移除**：`agent/graph.py` 及其依赖（planner/executor/coordinator/verifier）已于 2026-07-15 全部删除。`langgraph` 包已从环境卸载。
3. **工具系统**：oh-my-pi 的 32 个内置工具（bash/read/write/edit/gh/task 等）+ 13 个 Maxma 自定义 TypeScript AgentTool（天气/节假日/Todoist ×10/塔罗牌），直接注册在 `createAgentSession` 的 `customTools` 选项中。
4. **记忆系统**：4 层记忆仍在，但通过 oh-my-pi 的 `transformContext` hook 注入。
5. **人设系统**：SOUL.md/USER.md/AGENTS.md 通过 `build_system_prompt()` 生成 system prompt 传给 oh-my-pi。

---

## 二、已完成的工作

### 2026-07-15 — oh-my-pi 全面迁移（12 个任务）

| 阶段 | 任务 | 状态 |
|---|---|---|
| **0. Spike** | 技术验证：oh-my-pi 作为 sidecar 运行 | ✅ |
| **1. Bridge** | SidecarManager + JsonRpcClient + WS 映射 + chat.py 集成 | ✅ |
| **2. Tools** | 事件映射修复 + pi_adapter.py + E2E 测试 | ✅ |
| **3. Complete** | Provider 迁移 + SessionMap + 记忆/人格对接 | ✅ |
| **善后** | 清理 5 个遗留 `build_agent` 调用 | ✅ |
| **善后** | 删除 agent/graph.py + LangGraph 依赖 | ✅ |
| **善后** | 对抗式审查 + Bug 修复（tool_error/重启上下文恢复） | ✅ |
| **工具重写** | 13 个原生 TypeScript AgentTool（weather/holiday/todoist ×10/tarot） | ✅ |
| **代码清理** | 删除旧 Python tools/ 目录、MCP 桥接、pi_adapter.py | ✅ |

### 遗留待办

| 事项 | 优先级 | 说明 |
|---|---|---|
| `api/checkpointer_factory.py` 中的 MemorySaver 回退 | 低 | 已用 try/except 保护，`langgraph` 卸载后自动降级为 None |
| `memory/narrative.py` 中的 LTM CRUD agent | 低 | 无 langgraph 时跳过 CRUD agent，LTM 摘要仍正常工作 |
| Session 重启完整恢复（加载 oh-my-pi JSONL） | 中 | 当前使用 SessionMap 存储最近 5 轮对话作为上下文注入 |
| 打包构建需更新（Bun sidecar 纳入安装包） | 中 | 当前 dev 模式可用，生产打包需更新 PyInstaller spec |

---

## 三、关键配置

### 环境变量

| 变量 | 用途 | 必需 |
|---|---|---|
| `OPENAI_API_KEY` | 默认 LLM Provider | 至少配置一个 |
| `TODOIST_API_TOKEN` | Todoist 工具 | 否 |
| `AMAP_API_KEY` | 高德地图 MCP | 否 |
| `UAPIS_API_KEY` | 天气/节假日 API | 否 |

### 切换 LangGraph 回退（不推荐）

部分端点（`sessions.py` undo）备有 LangGraph 回退路径，由 `try: from agent.graph import build_agent` 保护。要启用需：
1. `pip install langgraph langgraph-checkpoint-sqlite`
2. 删除 `api/routes/sessions.py` 中 undo 函数体的 try/except 保护

---

## 四、常见坑

- **缩进混合**：该项目历史原因存在 tab/spaces 混用。编辑文件后请检查。
- **sidecar 启动顺序**：`SidecarManager.start()` 是幂等的，但首次调用会启动 Bun 进程（耗时 ~0.5s）。应用启动时 `app.state.sidecar_manager` 仅初始化实例，不启动进程。
- **MCP 工具**：高德地图等外部工具通过 MCP 接入，需用户在前端配置 MCP 服务器地址。
