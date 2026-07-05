![首页](images/%E9%A6%96%E9%A1%B5.png)

# MaxmaHere

> 基于 LangChain + LangGraph 的 ReAct AI Agent 桌面客户端 — **开箱即用，零依赖安装**。

支持 **多 LLM 提供商**、**SubAgent**、**Anthropic Skill 体系**、**MCP 外接工具**、**长期记忆**、**人设系统**，覆盖任务管理、地图服务、网络查询、文件操作、开发工具等 30+ 个内置 Tool。

---

## 两种使用方式

### 方式一：下载安装包（推荐普通用户）

前往 [Releases 页面](https://github.com/Libai-88/Maxma/releases/latest) 下载 `MaxmaHere_2.6.0_x64-setup.exe`（约 847 MB），双击安装即可。

**特点：**
- 完全自包含 — 内置 Python 3.13 + Node.js v20.18.1 + uv 0.5.11 + Playwright Chromium + ONNX 嵌入模型
- 零依赖安装 — 不需要预装 Python、Node.js 或任何其他工具
- 安装后从开始菜单启动 MaxmaHere 即可

**系统要求：** Windows 10/11 (x64)

### 方式二：从源码构建（开发者）

适合希望二次开发、调试或参与贡献的用户。

#### 前置要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Python | 3.11+ | 后端运行时 |
| Node.js | 18+ | 前端构建 |
| Rust | 最新 | Tauri 桌面打包 |
| VS Build Tools | 2022 | Windows 编译（含「使用 C++ 的桌面开发」工作负载）|

#### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/Libai-88/Maxma.git
cd Maxma

# 2. 一键初始化（创建 .venv、安装依赖、生成 .env、引导配置 LLM）
python setup.py
# 或双击 setup.bat（Windows）

# 3a. 浏览器模式（快速开发）
start.bat

# 3b. Tauri 桌面 dev 模式（完整功能测试）
build\run-desktop-dev.bat

# 3c. 生产打包（产出 NSIS 安装包）
build\build-desktop.bat
```

安装包输出目录：`desktop\src-tauri\target\release\bundle\nsis\`

---

## 配置 LLM 提供商

`setup.py` 第 5 步会引导你输入 **Base URL** 和 **API Key**，自动测试连接并拉取可用模型列表。

推荐使用 **DeepSeek**（性价比高，兼容 OpenAI API）：

1. 前往 [platform.deepseek.com](https://platform.deepseek.com/) 申请 API Key
2. 在 setup.py 中输入：

```
Base URL: https://api.deepseek.com/v1
API Key: sk-你的密钥
```

> 也支持任何 OpenAI 兼容 API（OpenRouter、Qwen、智谱、月之暗面等），运行时也可在 **设置 → 模型** 中新增/切换提供商。

---

## 核心功能

### Tools 工具

内置 30+ Tool，按需调用，覆盖日常工具链：

| 领域 | Tools | 需要配置 |
|------|------|----------|
| **Todo** | 添加/列出/完成/取消/删除/更新/查询任务、列出项目 | `TODOIST_API_TOKEN` |
| **地图** | 周边搜索、地址编码、公交/骑行路线、模糊地址 | `AMAP_API_KEY` |
| **网络** | 天气查询、Tavily 搜索、Tavily 网页提取、节假日日历 | `UAPIS_API_KEY` + `TAVILY_API_KEY` |
| **文件** | 读写删改、目录操作、PDF/Word 阅读 | — |
| **开发** | 语法检查、代码质量分析、单元测试、调试器 | — |
| **系统** | 当前时间、Python 脚本执行 | — |
| **SubAgent** | 创建独立会话执行复杂子任务 | — |
| **交互** | 向用户提问 | — |
| **娱乐** | 答案之书、塔罗牌 | `UAPIS_API_KEY` |

> 所有 Key 仅在用到对应 Tool 时必需，不影响基础对话。

### Skills 技能

Skills 是存放在 `anthropic_skills/` 目录下的独立技能包，每个子文件夹代表一个技能。AI 会**自主识别并调用**这些技能扩展能力边界。

- 可在 [SkillsMP](https://skillsmp.com/zh) 等平台下载 skill
- 也可自行编写：在 `anthropic_skills/` 下创建文件夹，放入 Markdown 指令文件即可，AI 会在适当时机自动加载

### Macros 宏

Macros 是比 Skills 更轻量的流程指引，本质是一篇带 YAML frontmatter 的 `MACRO.md` 文件。

- **触发方式**：输入框以 `!` 或 `！` 开头，自动提词器提示可用宏
- **定义位置**：`macros/<宏名称>/MACRO.md`
- **优势**：无需改代码、无需重启服务，新建一篇 Markdown 即可扩展能力

项目预置了 `macro-creator`（关于宏的宏），说"把这个流程写成宏"即可引导你完成创建。

### MCP 外接工具

通过 MCP（Model Context Protocol）接入外部工具，只需编辑 `config/mcp_servers.yaml`，无需改动代码。

支持 4 种传输类型：

| 类型 | 适用场景 |
|------|----------|
| `stdio` | 本地子进程（如 npx 启动的 MCP server） |
| `sse` | Server-Sent Events 远程连接 |
| `streamable_http` | HTTP 流式远程连接 |
| `websocket` | WebSocket 远程连接 |

打包模式下，stdio 命令会自动解析到内置运行时（Node.js/Python/uv），用户无需关心环境配置。也可在 **MCP 配置 UI** 中点击"测试连接"验证配置。

### 长期记忆

Maxma 会在对话过程中**自动**记录关于你的事实，写入 `config/personas/memory.yaml`，形成长期记忆。

- 支持语义记忆（事实）+ 情景记忆（事件）+ 知识库（文档）
- 基于 ONNX 嵌入模型（`paraphrase-multilingual-MiniLM-L12-v2`）做检索
- 打包版已内置 ONNX 模型，开箱即用

### 人设系统

在 **设置 → 人设 / 用户** 中可在线编辑：

| 文件 | 用途 |
|------|------|
| `SOUL.md` | AI 的人设、性格、说话风格 |
| `USER.md` | 你的基本信息和偏好 |
| `AGENTS.md` | AI 的工具使用策略等行为规则 |
| `memory.yaml` | AI 自动维护的长期记忆 |

编辑后刷新页面即生效，无需重启。

---

## 安全机制

两道安全防线保护你的文件系统：

### 路径白名单

`设置 → 路径白名单` — 限制 AI 可读写的文件目录范围。未在白名单中的路径会被拒绝访问。

### MaxmaBlocker 拒止锚

`设置 → 拒止锚` — 在敏感目录下放置 `.maxma_blocker` 标记文件。AI 在访问任何文件前会检查路径中是否存在此标记，发现即立即阻断并复述自己的意图。

```
用法示例：在 C:/重要文档/ 下创建拒止锚 →
AI 尝试读取该目录时会提示"安全阻断"并等待你确认
```

### Python 执行确认

每个会话可切换 Python 工具的执行模式：

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| **检查**（默认） | AI 写出代码后等你确认才执行 | 不熟悉 AI 生成的代码时 |
| **自动** | AI 直接执行，无需确认 | 信任 AI、频繁调用工具的场合 |

---

## 其他功能

### 固定会话

固定会话（Const Session）可**永久保存**，不会因服务重启或 TTL 过期而丢失。

- 侧边栏会话列表右键任一普通会话 → **固定会话**
- 右键已固定的会话 → **取消固定**
- 适合保存常用的工具性会话、特定角色的对话场景

### 引用机制

输入框支持引用多种内容作为对话上下文：

| 引用类型 | 触发方式 |
|----------|----------|
| **文件引用** | 输入框＋按钮 |
| **文件夹引用** | 输入框＋按钮 |
| **文本引用** | 右键消息 → 引用 |
| **技能引用** | 手动输入 `@技能名` |
| **工具引用** | 手动输入 `#工具名` |
| **网页链接** | 粘贴链接 |

输入 `@` 或 `#` 后自动提词器会出现，方向键 + Tab 确认。

### 私密模式

顶栏「私密」按钮或 `Ctrl + K` 切换。开启后当前对话**不写入长期记忆和本地存储**，刷新页面即丢失。适合临时咨询、隐私话题。

---

## 技术架构

| 层 | 技术选型 |
|------|----------|
| Agent 框架 | `langgraph` ReAct Agent 状态图 |
| LLM 后端 | `langchain-openai`（兼容 OpenAI API） |
| 状态持久化 | `AsyncSqliteSaver`（WAL 模式，进程级持久化） |
| 死循环检测 | 工具调用签名追踪，连续 3 次相同调用自动终止 |
| Web 后端 | FastAPI + uvicorn + WebSocket（流式 Agent 推送） |
| Web 前端 | Vue 3 + TypeScript + Vite |
| 桌面壳 | Tauri 2.x（Rust） |
| 打包 | PyInstaller（后端 sidecar）+ NSIS（Windows 安装包） |

### 三层打包架构（v2.6.0+）

```
NSIS 安装包 (847 MB)
├── 核心层: maxma-server.exe (~210 MB)  ← PyInstaller onefile
├── 运行时层: runtime/ (~80 MB)
│   ├── node/      — Node.js v20.18.1
│   ├── python/    — Python 3.13.13 embeddable (含 pip)
│   └── uv/        — uv 0.5.11
└── 资源层: assets/ (~740 MB)
    ├── playwright/  — Chromium 1228
    └── models/      — ONNX paraphrase-multilingual-MiniLM-L12-v2
```

打包模式下，所有外部命令（npx/node/python/uvx）会自动解析到 `RUNTIME_DIR`，用户无需配置环境变量。

---

## 开发与测试

### 后端测试与门禁

```bash
python -m pip install -r requirements.txt
python -m pip install pytest pytest-asyncio pytest-mock pre-commit ruff
python -m pytest -q                    # 900+ 测试
python -m pre_commit run --all-files   # 代码质量检查
```

### 桌面开发入口

所有桌面入口都先调用 `build\setup-dev-env.bat`，统一解析 Python/Node/Rust/VS Build Tools。

```bat
:: dev 模式（Tauri 窗口 + Vite 热更新）
build\run-desktop-dev.bat

:: 生产打包（产出 NSIS 安装包）
build\build-desktop.bat
```

如果怀疑工具链解析有问题：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\dev-tools.ps1 -Doctor
```

### 路径规则

- 后端单文件产物：`dist\maxma-server.exe`
- Tauri sidecar：`desktop\src-tauri\binaries\maxma-server-x86_64-pc-windows-msvc.exe`
- 前端生产产物：`web\dist`
- 桌面安装包：`desktop\src-tauri\target\release\bundle\nsis`

详细打包规则见 [docs/production-packaging-design.md](docs/production-packaging-design.md) 和 [docs/backend-bundle-rules.md](docs/backend-bundle-rules.md)。

---

## 常见问题

**Q: 安装包下载后无法运行？**
A: Windows SmartScreen 可能拦截未签名的安装包，点击「更多信息」→「仍要运行」即可。

**Q: 启动后提示"暂无已配置的 LLM 提供商"？**
A: 前往 **设置 → 模型** 添加 API Key（推荐 DeepSeek，性价比高）。

**Q: `cargo build` 报错找不到 MSVC 工具链？**
A: 确保 VS Build Tools 已安装「使用 C++ 的桌面开发」工作负载，并重启终端。

**Q: 前端构建失败？**
A: 检查 Node.js 版本（需 18+），删除 `web/node_modules` 后重新 `npm install`。

**Q: MCP 服务器无法启动？**
A: 在 **MCP 配置 UI** 中点击"测试连接"查看错误信息；打包模式下会自动使用内置 Node.js/Python，无需额外配置。

---

## 项目文档

- [项目结构总览](docs/00-结构总览.md)
- [ReAct Agent 核心原理](docs/01-ReAct-Agent核心原理.md)
- [Tool 与 Skill 系统](docs/03-Tool与Skill系统.md)
- [记忆系统](docs/04-记忆系统.md)
- [前端工程化](docs/12-从开发到生产：前端工程化.md)
- [生产打包设计](docs/production-packaging-design.md)

---

## License

[MIT](LICENSE)
