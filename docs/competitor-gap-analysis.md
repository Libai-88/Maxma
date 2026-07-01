## MaxmaHere vs 竞品能力差距分析

### 一、MaxmaHere 当前能力概览

MaxmaHere v2.6.0 是一个本地优先的个人 AI Agent 桌面应用，核心架构为 LangGraph ReAct 循环 + FastAPI 后端 + Vue 3 前端 + Tauri v2 桌面壳。

**已有能力：** 47 个原生工具（11 个类别）、三层记忆系统（YAML 持久化 + 叙事管道 + 上下文窗口摘要）、多人格切换、MCP 四协议支持（stdio/SSE/HTTP/WS）、Skills & 宏管理、自然语言驱动 MCP/Skills 配置、子 Agent 并行、上下文压缩与实体提取、WebSocket 流式输出、14 种专用工具气泡组件、Tauri 桌面集成、路径安全白名单。

**独特优势（竞品没有的）：** 跨会话持久记忆（竞品每次对话从零开始）、多人格系统、ask_user 系列交互工具（中途中断等用户回复）、自然语言自配置 MCP/Skills、完全本地自托管隐私。

---

### 二、核心差距（按影响程度排序）

#### 1. 代码执行沙箱 — 安全性根基缺失

**竞品做法：** Codex 有内核级云沙箱，所有代码在隔离环境执行；Trae Solo 有预装 Node.js/git 的云沙箱；ZCode 有本地 IDE 内安全沙箱。

**MaxmaHere 现状：** 代码直接在用户机器执行，仅靠路径白名单 + MaxmaBlocker 做访问控制。`run_python` 工具虽然存在但没有沙箱隔离。

**差距影响：** 这是最大的安全短板。用户不敢让 Agent 自由执行代码，因为一旦出错可能影响系统。

**建议方案：** 短期可基于 Windows Sandbox 或 Docker Desktop 做进程隔离；中期可参考 Codex 的 gVisor 方案做用户态内核拦截。

---

#### 2. 并行子 Agent — 复杂任务效率瓶颈

**竞品做法：** Codex 支持并行 sub-agent 各自在独立云环境工作；Claude Code 有原生 subagent 架构，主任务拆分为多个并行 agent 同时分析仓库、写代码、跑测试、写文档；Trae Solo 有多 agent 协作模块。

**MaxmaHere 现状：** `call_sub_agent` 工具存在，支持 2 层嵌套，但主聊天路由 `select_tools_for_query()` 返回的工具列表不包含 MCP 工具，子 Agent 和主 Agent 的工具集不对称。且没有自动任务拆分——需要 Agent 自己判断何时拆子任务。

**差距影响：** 大型任务（如"重构整个项目"）只能串行执行，效率远低于竞品的并行拆分。

---

#### 3. 代码编辑精度 — 缺乏 diff 感知

**竞品做法：** Claude Code 用精确字符串替换（old_string → new_string），Codex 用 diff 格式，都能精准修改单个函数而不触碰其他代码。前端有实时 diff 预览。

**MaxmaHere 现状：** `file_edit` 工具存在但没有 diff 预览组件，用户看不到改动对比。编辑策略依赖 LLM 自己生成完整文件内容或精确替换，没有兜底的 diff 校验机制。

**差距影响：** 用户无法直观确认 Agent 改了什么，信任度低。大文件编辑时容易出错。

---

#### 4. Git 集成 — 版本控制完全缺失

**竞品做法：** Claude Code 可以 commit、push、创建 PR；Codex 能自主创建 PR 并处理 review 反馈；ZCode 有对话级版本回滚（时间旅行）；Trae Solo 内置 Git GUI。

**MaxmaHere 现状：** 没有任何 git 工具。Agent 无法查看 diff、提交代码、创建分支。

**差距影响：** 作为编程辅助工具，这是基础能力缺失。用户需要手动管理所有版本控制。

---

#### 5. Plan Mode — 执行前策略审查

**竞品做法：** Claude Code 有 Plan Mode，输出完整策略后等用户确认再执行；ZCode 有推理模式，先评估需求再写代码；Trae Solo SOLO Coder 有 Plan Mode 分析长任务。

**MaxmaHere 现状：** `agent/planner.py` 有 planner 节点，但它是自动判断简单/复杂，复杂任务生成计划后直接注入系统消息开始执行，没有"等用户确认"的环节。

**差距影响：** 用户无法在 Agent 动手前审查和修改计划，导致方向错误时浪费大量 token 和时间。

---

#### 6. 项目结构自动感知 — 缺乏 codebase understanding

**竞品做法：** Claude Code 启动时自动读取项目结构、README、package.json 等，建立全局理解；Codex 扫描整个仓库建立索引；ZCode 理解全局项目上下文。

**MaxmaHere 现状：** Agent 没有自动的项目感知机制。需要用户手动告诉它项目在哪、用什么框架，或者通过 `file_search` 一个个文件探索。

**差距影响：** 每次新对话都要重新建立项目理解，效率低。

---

#### 7. 多模态输入 — 只能处理文本

**竞品做法：** Codex 支持 192K 多模态，可以截图上传让 Agent 还原 UI；Claude Code 可以分析图片转代码；Trae Solo 支持语音输入 + 文件上传 + 手机扫码。

**MaxmaHere 现状：** `image_understand` 工具调用智谱 GLM-5V-Turbo 可以分析图片，但仅限网络搜索场景。没有"上传截图 → 生成代码"的完整流程。

---

#### 8. Event Hooks — 自动化触发

**竞品做法：** Claude Code 有 Hook 机制，监听 git 事件和 CI 告警自动触发修复；Codex 有 Triggers & Hooks 做 CI/CD 自动化。

**MaxmaHere 现状：** 没有任何事件钩子系统。Agent 只能被动响应用户输入。

---

### 三、差距矩阵

| 能力维度 | MaxmaHere | Codex | Claude Code | ZCode | Trae Solo |
|---|---|---|---|---|---|
| 代码沙箱隔离 | ✗ | ✓ 内核级 | △ 本地 | △ IDE内 | ✓ 云沙箱 |
| 并行子Agent | △ 手动 | ✓ 自动 | ✓ 原生 | △ 多模型 | ✓ 多agent |
| Diff预览编辑 | △ 基础 | ✓ diff | ✓ 精确替换 | ✓ | ✓ |
| Git集成 | ✗ | ✓ PR | ✓ commit/PR | ✓ 时间旅行 | ✓ Git GUI |
| Plan Mode | △ 自动 | ✓ | ✓ 审查 | ✓ 推理模式 | ✓ |
| 项目自动感知 | ✗ | ✓ 仓库索引 | ✓ 自动扫描 | ✓ 全局上下文 | ✓ |
| 多模态输入 | △ 图片理解 | ✓ 截图→代码 | ✓ 图片分析 | ✓ | ✓ 语音 |
| Event Hooks | ✗ | ✓ CI/CD | ✓ git hooks | ✗ | ✗ |
| 持久记忆 | ✓ 三层 | ✗ | △ CLAUDE.md | △ | △ State Sync |
| 多人格 | ✓ | ✗ | ✗ | ✗ | ✗ |
| 自然语言自配置 | ✓ MCP+Skills | ✗ | ✓ MCP | ✓ GUI配置 | ✓ |
| 交互中断等待 | ✓ ask_user | ✗ | ✗ | ✗ | ✗ |
| 本地隐私 | ✓ 完全本地 | ✗ 云执行 | △ 本地终端 | △ 本地IDE | △ 云沙箱 |
| MCP支持 | ✓ 4协议 | ✓ | ✓ 最成熟 | ✓ GUI | ✓ |

---

### 四、优先级建议

**P0（核心体验，差距最大）：**
1. Git 集成工具（git_status / git_diff / git_commit / git_push）— 实现成本低，体验提升大
2. 项目结构自动感知（启动时扫描项目目录树 + 读取 README/package.json/pyproject.toml）
3. Plan Mode 用户确认环节（planner 输出计划后暂停，等用户确认或修改再继续）

**P1（差异化竞争力）：**
4. 代码编辑 diff 预览前端组件
5. 并行子 Agent 自动拆分（planner 判断可并行的任务自动 spawn 多个 sub-agent）
6. 截图 → 代码流程（image_understand + frontend-sandbox 串联）

**P2（长期建设）：**
7. 代码执行沙箱（Windows Sandbox / Docker）
8. Event Hooks 系统（git hook / 文件变更监听）
9. 跨设备同步（可选，看产品定位）
