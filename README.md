![首页](images/%E9%A6%96%E9%A1%B5.png)

# MaxmaHere

> 基于 oh-my-pi 的 AI Agent 桌面客户端 — **开箱即用，零依赖安装**。

支持 **40+ LLM 提供商**、**oh-my-pi 32 个内置工具** + **Maxma 自定义工具**、**MCP 外接工具**、**长期记忆**、**人设系统**，覆盖编码、文件操作、网络搜索、Todo 管理、天气查询、地图服务、娱乐等场景。

---

## 架构

```
Maxma 前端 (Vue 3 + Tauri)  ← 品牌 UI 完全保留
    ↕ WebSocket (23 个事件类型)
Python 后端 (FastAPI)        ← HTTP/WS 路由、认证、Session 管理
    ↕ JSON-RPC (stdio)
oh-my-pi 引擎 (Bun)          ← Agent 推理循环、40+ Provider、32 内置工具
    ↕ MCP 协议
外部工具 (高德地图等)         ← MCP 服务器
```

- **LangGraph 已完全移除**。Agent 推理层由 oh-my-pi 提供。
- Python 后端负责前端通信、用户认证、Session 持久化。
- 13 个 Maxma 自定义工具（天气、节假日、Todoist、塔罗牌）以原生 TypeScript AgentTool 运行在 oh-my-pi 侧。

---

## 前置要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Python | 3.11+ | 后端运行时 |
| Bun | 1.3+ | oh-my-pi sidecar 运行时 |
| Node.js | 18+ | 前端构建 |
| Rust | 最新 | Tauri 桌面打包 |
| VS Build Tools | 2022 | Windows 编译 |

---

## 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/Libai-88/Maxma.git
cd Maxma

# 2. 初始化 Python 环境
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# 3. 安装 oh-my-pi sidecar 依赖
cd bun-sidecar
bun install
cd ..

# 4. 配置 LLM Provider
# 编辑 config/providers.yaml 或通过前端设置页面添加

# 5a. 浏览器模式（快速开发）
start.bat

# 5b. Tauri 桌面 dev 模式
build\run-desktop-dev.bat
```

---

## 技术栈

| 层 | 技术 |
|---|---|
| Agent 引擎 | oh-my-pi v16.5.2 (Bun/TypeScript) |
| LLM 提供商 | 40+（Anthropic, OpenAI, DeepSeek, Google, 本地Ollama...） |
| 后端 | FastAPI + uvicorn (Python) |
| 前端 | Vue 3 + Vite 5 + Pinia + TypeScript |
| 桌面壳 | Tauri 2 + Rust |
| 会话持久化 | oh-my-pi JSONL + SQLite（SessionMap） |
| 内存/向量 | ONNX Runtime + ChromaDB |
| 打包 | PyInstaller (后端) + Tauri NSIS (桌面) |

---

## 项目结构

```
MaxmaHere/
├── bun-sidecar/            ← oh-my-pi 引擎
│   └── src/
│       ├── session-bridge.ts  ← JSON-RPC 服务器（核心）
│       ├── rpc-types.ts       ← 协议类型定义
│       └── tools/             ← 13 个原生 AgentTool（天气/Todoist/塔罗等）
├── api/
│   ├── pi_bridge/           ← Python ↔ oh-my-pi 桥接层
│   │   ├── sidecar_manager.py ← Bun 进程生命周期管理
│   │   ├── rpc_client.py      ← JSON-RPC 2.0 客户端
│   │   ├── session_adapter.py ← SessionMap 持久化映射
│   │   ├── security_adapter.py← 路径安全/MaxmaBlocker
│   │   ├── approval_adapter.py← 审批级别映射
│   │   └── ws_event_mapper.py ← 事件校验与包装
│   ├── routes/              ← FastAPI 路由
│   └── providers/           ← LLM Provider 管理
├── web/                     ← Vue 3 前端 SPA
├── config/                  ← 人设(personas/)、贴纸(stickers/)
├── agent/                   ← Python 端辅助模块（prompts、context_manager 等）
├── memory/                  ← 记忆系统
├── desktop/                 ← Tauri 桌面壳
└── build/                   ← 构建脚本
```

---

## 核心功能

### 工具系统

oh-my-pi 提供 32 个内置工具 + 13 个 Maxma 自定义工具：

| 类型 | 工具 | 由谁提供 |
|------|------|----------|
| **文件** | read, write, edit, glob, grep | oh-my-pi 内置 |
| **代码** | bash, eval(py/js/rb), debug, lsp | oh-my-pi 内置 |
| **网络** | web_search, browser, fetch | oh-my-pi 内置 |
| **版本控制** | gh (GitHub) | oh-my-pi 内置 |
| **子任务** | task (DAG 编排) | oh-my-pi 内置 |
| **交互** | ask | oh-my-pi 内置 |
| **记忆** | recall, reflect, retain, memory_edit | oh-my-pi 内置 |
| **天气** | get_current_weather | Maxma 自定义 |
| **节假日** | holiday_calendar | Maxma 自定义 |
| **待办** | todo_add/list/complete 等 10 个 | Maxma 自定义 |
| **娱乐** | tarot | Maxma 自定义 |
| **地图** | 高德地图（周边搜索/路线规划等） | 通过 MCP 接入 |

### Skills 技能

Skills 是存放在 `anthropic_skills/` 目录下的独立技能包。oh-my-pi 会在适当时机自动识别并调用这些技能扩展能力边界。

### MCP 外接工具

通过 MCP（Model Context Protocol）接入外部工具，oh-my-pi 原生支持自动发现和连接 MCP 服务器。

### 长期记忆

Maxma 自动记录事实和对话历史，通过 ChromaDB 检索注入到 agent 上下文中。

### 人设系统

| 文件 | 用途 |
|------|------|
| `SOUL.md` | AI 的人设、性格、说话风格 |
| `USER.md` | 你的基本信息和偏好 |
| `AGENTS.md` | AI 的工具使用策略等行为规则 |
| `memory.yaml` | AI 自动维护的长期记忆 |

---

## 安全机制

- **路径白名单**：限制 AI 可读写的文件目录
- **MaxmaBlocker**：`config/.maxma_blocker` 标记文件阻断敏感目录
- **Python 执行确认**：每会话可切换"检查"或"自动"模式

---

## 开发

```bash
# 后端测试
pytest -q

# Sidecar 测试
python api/pi_bridge/test_integration.py
python api/pi_bridge/test_tools_e2e.py
python api/pi_bridge/test_session_map.py

# 前端
cd web && npm run dev
```

---

## License

MIT
