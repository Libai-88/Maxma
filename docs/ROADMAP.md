# MaxmaHere 全面开发路线图

> 目标：补齐与 Codex / Claude Code / ZCode / Trae Solo 的全部能力差距，同时将品牌独特优势打磨到生产级可靠。
> 最后更新：2026-07-01

---

## 一、编程工具链补齐

### 1.1 Git 集成

**现状：** 无任何 git 工具，Agent 无法查看 diff、提交代码、创建分支。

#### 后端工具（`tools/git/`）

| 工具名 | 功能 | 关键实现 |
|--------|------|----------|
| `git_status` | 查看仓库状态 | `git status --porcelain`，解析为结构化输出（staged/unstaged/untracked） |
| `git_diff` | 查看文件 diff | `git diff` / `git diff --cached`，返回 unified diff 格式 |
| `git_log` | 查看提交历史 | `git log --oneline -n`，支持文件级历史 |
| `git_commit` | 提交变更 | `git add` + `git commit -m`，自动检测敏感文件（.env 等）并警告 |
| `git_branch` | 分支管理 | 列出/创建/切换/删除分支 |
| `git_push` | 推送到远程 | `git push`，支持设置 upstream |
| `git_pr` | 创建 Pull Request | 调用 `gh pr create`（需要 GitHub CLI），自动生成标题和描述 |

**文件结构：**
```
tools/git/
├── TOOL.md              # 领域知识：git 工作流、commit message 规范
├── tool_git_status.py
├── tool_git_diff.py
├── tool_git_log.py
├── tool_git_commit.py
├── tool_git_branch.py
├── tool_git_push.py
└── tool_git_pr.py
```

**注册：** `tools/__init__.py` 新增 `"git"` 分类，加入 `CORE_TOOLS`（始终可用），关键词映射 `"git"/"提交"/"分支"/"代码"` → `["git"]`。

**前端气泡：** `components/tools/GitStatusBubble.vue`（文件列表 + 状态图标）、`GitDiffBubble.vue`（diff 渲染，用红色/绿色高亮增删行）。

**验收标准：**
- 用户说"帮我提交代码"，Agent 能自动 status → diff → 生成 commit message → commit
- 用户说"创建一个 PR"，Agent 能生成标题描述并调用 gh CLI
- 敏感文件（.env, credentials）提交前自动警告

**复杂度：** 中等（7 个工具 + 2 个气泡组件，模式参考 memory 工具集）

---

### 1.2 代码编辑 Diff 预览

**现状：** `file_edit` 工具支持 `old_string → new_string` 精确替换，但前端 `FileEditBubble.vue` 只展示文本结果，没有 diff 对比视图。

#### 后端改造

**`tools/files/tool_file_edit.py` 增强：**
- `edit` 和 `multi_edit` 操作返回 diff 片段（unified diff 格式），包含上下文 3 行
- 新增 `preview` 操作：只计算 diff 不实际写入，返回 `{diff, change_summary: {additions, deletions, file_path}}`

#### 前端组件

**新建 `components/tools/FileDiffView.vue`：**
- 基于 unified diff 渲染 side-by-side 或 inline 对比视图
- 红色背景 = 删除行，绿色背景 = 新增行，灰色 = 上下文
- 顶部显示文件路径 + 变更统计（+N / -N 行）
- 不需要引入外部 diff 库——后端直接返回 diff 文本，前端用 CSS 渲染

**改造 `FileEditBubble.vue`：**
- 当工具返回包含 `diff` 字段时，渲染 `FileDiffView` 替代纯文本

**验收标准：**
- Agent 编辑文件后，前端展示红绿 diff 预览
- 用户能直观看到哪些行被修改/添加/删除

**复杂度：** 中等（1 个新组件 + 修改 1 个工具 + 修改 1 个气泡）

---

### 1.3 项目结构自动感知

**现状：** Agent 没有自动的项目感知机制，每次新对话从零开始。

#### 方案：会话启动时的自动扫描

**新建 `agent/project_scanner.py`：**
```python
def scan_project(root: Path) -> ProjectContext:
    """扫描项目根目录，返回结构化上下文。"""
    # 1. 目录树（深度 3，忽略 node_modules/.git/__pycache__/dist/build/.venv）
    # 2. 读取关键文件（按优先级，存在即读）：
    #    README.md / README / package.json / pyproject.toml / Cargo.toml
    #    / go.mod / requirements.txt / .env.example / docker-compose.yml
    # 3. 检测技术栈（根据文件推断：框架、语言、包管理器）
    # 4. 统计信息（文件数、代码行数估算、主要语言占比）
```

**集成到 `api/routes/chat.py`：**
- 首次对话或检测到新项目路径时，调用 `scan_project()`
- 结果注入为 `SystemMessage`（在系统提示词之后、用户消息之前）
- 格式：简洁的结构化文本（~500 token），不占用过多上下文

**新建工具 `project_info`：**
- Agent 可以主动调用获取当前项目上下文
- 支持传入自定义 root 路径重新扫描

**验收标准：**
- 新对话中用户提到项目路径后，Agent 自动了解项目结构和技术栈
- 不再需要用户手动告知"这是一个 Vue 3 + FastAPI 项目"

**复杂度：** 中等（1 个扫描模块 + 1 个工具 + chat.py 集成）

---

### 1.4 Plan Mode 用户确认

**现状：** `agent/planner.py` 的 `classify_and_plan()` 生成计划后直接注入 `SystemMessage` 开始执行，用户无法审查。

#### 改造方案

**后端改造 `agent/planner.py`：**
- 新增 `PLAN_CONFIRM_THRESHOLD`：当计划步骤 >= 3 时，触发确认流程
- 计划生成后不直接注入，而是通过 WebSocket 发送 `plan_proposed` 事件
- 前端展示计划卡片，用户可"确认执行" / "修改后确认" / "取消"

**新增 WebSocket 消息类型：**
```typescript
// 服务端 → 客户端
interface PlanProposedEvent {
  type: 'plan_proposed'
  payload: {
    plan_id: string
    steps: string[]        // 计划步骤列表
    suggested_tools: string[]  // 建议使用的工具
  }
}

// 客户端 → 服务端
interface PlanResponseMessage {
  type: 'plan_response'
  payload: {
    plan_id: string
    action: 'approve' | 'modify' | 'reject'
    modified_plan?: string  // 用户修改后的计划
  }
}
```

**前端组件 `components/PlanCard.vue`：**
- 展示编号步骤列表
- 三个按钮：确认 / 编辑 / 拒绝
- 编辑模式：将计划文本放入可编辑 textarea，修改后提交

**Agent 挂起机制：**
- 复用 `ask_user` 系列的 `asyncio.Future` 挂起模式
- `planner_node` 中 await Future，等待用户响应
- 超时 120 秒（比 ask_user 的 300 秒短，因为计划确认应该快速）

**验收标准：**
- 复杂任务（>= 3 步）生成计划后暂停，前端展示计划卡片
- 用户确认后 Agent 继续执行
- 用户可修改计划内容后确认
- 简单任务（< 3 步）不触发确认，直接执行

**复杂度：** 高（涉及 WebSocket 新消息类型 + 前端新组件 + Agent 挂起机制复用）

---

### 1.5 并行子 Agent 自动拆分

**现状：** `call_sub_agent` 存在但需要 Agent 自己判断何时拆分。主聊天路由 `select_tools_for_query()` 不包含 MCP 工具。

#### 改造方案

**Planner 增强（`agent/planner.py`）：**
- 计划中标注哪些步骤可以并行（`[并行]` 标签）
- 当检测到多个独立步骤时，planner 在计划中明确标注并行组

**新增 `parallel_execute` 工具（`tools/sub_agent/tool_parallel.py`）：**
```python
class ParallelExecuteInput(BaseModel):
    tasks: str  # JSON 数组，每个元素 {task: str, name: str}

class ParallelExecuteTool(ToolBase):
    name = "parallel_execute"
    # 同时 spawn 多个子 Agent，等待全部完成后汇总结果
```

**修复 MCP 工具可见性：**
- `api/routes/chat.py` 中 `turn_tools = select_tools_for_query(user_message)` 后，追加 `app_state.mcp_tools`
- 或在 `select_tools_for_query` 内部将 MCP 工具加入返回列表

**验收标准：**
- Planner 能识别可并行的任务步骤
- Agent 调用 `parallel_execute` 同时启动多个子 Agent
- 所有子 Agent 完成后，主 Agent 汇总结果回复用户
- MCP 工具在主对话中可用

**复杂度：** 高（planner 提示词改造 + 新工具 + MCP 工具可见性修复）

---

### 1.6 代码执行沙箱

**现状：** 代码直接在用户机器执行，无隔离。

#### 分阶段方案

**Phase 1 — 进程级隔离（短期）：**
- `run_python` 工具增加 `timeout` 参数（默认 30 秒，最大 120 秒）
- 使用 `subprocess.run` 替代 `exec`，独立进程执行
- 限制内存使用（`resource` 模块或 `job_object` Windows API）
- 禁止网络访问（可选，通过防火墙规则或 `seccomp`）

**Phase 2 — Windows Sandbox 集成（中期）：**
- 检测 Windows Sandbox 是否可用（`WindowsSandbox` feature）
- `run_python` 在 Sandbox 中执行（通过 `wsrun` 命令）
- 自动挂载项目目录为只读
- 执行完毕 Sandbox 自动销毁

**Phase 3 — Docker 集成（可选）：**
- 检测 Docker Desktop 是否运行
- 提供预构建的 `maxma-sandbox` 镜像（Python + Node.js + 常用工具）
- `run_python` / `run_shell` 在 Docker 容器中执行
- 自动挂载项目目录，容器执行后销毁

**验收标准：**
- Phase 1：代码在独立进程执行，超时自动杀死，不影响主进程
- Phase 2：代码在 Windows Sandbox 中执行，无法访问用户其他文件

**复杂度：** 高（Phase 1 中等，Phase 2-3 高）

---

### 1.7 Event Hooks 系统

**现状：** 无任何事件钩子机制，Agent 只能被动响应。

#### 方案设计

**新建 `agent/hooks.py`：**
```python
class HookManager:
    """事件钩子管理器，监听特定事件并自动触发 Agent 动作。"""

    # 支持的钩子类型
    # - file_change: 监控目录的文件变更（watchdog）
    # - git_event: git hook 触发（post-commit, pre-push 等）
    # - schedule: 定时执行（cron 表达式）
    # - webhook: HTTP webhook 接收

    def register(self, hook_type: str, config: dict, action: str): ...
    def unregister(self, hook_id: str): ...
    def list_hooks(self) -> list[dict]: ...
```

**配置存储：** `api/data/hooks.yaml`

**钩子触发流程：**
1. 事件发生（文件变更 / git 事件 / 定时 / webhook）
2. HookManager 匹配已注册的钩子
3. 创建临时 Agent 会话，注入触发上下文
4. Agent 执行预设动作（如：文件变更后自动跑测试）
5. 结果通过 WebSocket 推送或写入日志

**前端管理页面 `views/HooksView.vue`：**
- 列出所有已注册钩子
- 创建/编辑/删除钩子
- 查看触发历史

**验收标准：**
- 用户可以注册"当 src/ 目录文件变更时自动运行 pytest"的钩子
- 文件变更后 Agent 自动执行测试并报告结果

**复杂度：** 高（新模块 + 文件监听 + 前端管理页面）

---

### 1.8 多模态输入增强

**现状：** `image_understand` 工具调用智谱 GLM-5V-Turbo 分析图片，但没有"截图→代码"的完整流程。

#### 改造方案

**ChatInput 增强：**
- 支持拖拽/粘贴图片到输入框
- 图片上传到 `api/routes/upload.py`（已存在），返回临时 URL
- 图片作为消息附件随用户文本一起发送

**Agent 侧处理：**
- 用户消息中包含图片时，自动附加图片描述（调用 `image_understand`）
- 描述注入为 HumanMessage 的补充文本
- Agent 根据描述 + 用户文本决定后续动作（如生成代码）

**新建 `components/ImagePreview.vue`：**
- 输入框中的图片缩略图预览
- 支持删除已添加的图片

**验收标准：**
- 用户可以拖拽 UI 截图到聊天输入框
- Agent 能理解截图内容并生成对应的前端代码
- 生成的代码在 HtmlSandbox 中预览

**复杂度：** 中等（ChatInput 改造 + 图片消息处理 + 预览组件）

---

## 二、品牌独特优势强化

### 2.1 记忆系统生产化

**现状：** 三层记忆架构完整，但有以下体验问题：
- 记忆条目 75 字限制太严，复杂事实被截断
- 记忆更新时旧信息删除不够智能（有时应该合并而不是覆盖）
- 前端 MemoryView 展示不够直观
- 没有记忆搜索/过滤功能

#### 改进项

**记忆容量提升：**
- 75 字 → 150 字，允许更完整的事实描述
- `memory_manager.py` 修改 `MAX_DESC_LENGTH` 常量
- 同步更新 narrative.py 中的系统提示词

**智能合并增强：**
- `merge_memories` 工具当前只是手动合并两条
- 增强：在 update 时自动检测语义相似度，如果新记忆与已有记忆高度相似（> 80%），提示合并而非新增
- 相似度计算：简单的关键词重叠 + 主题匹配（不需要 embedding 模型）

**记忆搜索工具：**
- 新增 `search_memories` 工具
- 支持按关键词、分区、时间范围搜索
- 返回匹配的记忆条目列表

**前端 MemoryView 增强：**
- 搜索框：支持全文搜索记忆内容
- 分区过滤：点击分区标签过滤显示
- 时间线视图：按时间排序的瀑布流（已有基础，优化交互）
- 记忆编辑：点击记忆条目可以直接编辑内容

**验收标准：**
- 记忆条目可写到 150 字
- 用户说"我之前跟你说过关于 XX 的事"，Agent 能搜索记忆并找到
- 前端可以搜索、过滤、编辑记忆

**复杂度：** 中等（修改限制 + 新工具 + 前端增强）

---

### 2.2 多人格系统深化

**现状：** 支持 `SOUL.*.md` 多人格切换，但切换后 Agent 的行为变化主要靠提示词约束，没有工具集/记忆/权限的差异化。

#### 改进项

**人格专属记忆：**
- 每个人格有独立的记忆分区（`memory_{persona}.yaml`）
- 切换人格时，加载对应的记忆子集
- 共享记忆（如用户偏好）在所有格间共享

**人格专属工具集：**
- `SOUL.*.md` 的 frontmatter 中可声明 `tools: [file_read, file_write, ...]`
- 未声明的工具对该人格不可用
- 例如：工作人格有全部工具，娱乐人格只有聊天和塔罗

**人格创建向导：**
- 新增 `create_persona` 工具
- Agent 可以通过对话引导用户创建新人格
- 自动生成 `SOUL.{name}.md` 文件

**前端增强：**
- SoulView 增加"创建新人格"按钮
- 人格卡片展示：头像（可选）、描述、当前状态、专属工具列表
- 切换动画过渡

**验收标准：**
- 不同人格有不同的记忆和工具权限
- 用户可以通过对话让 Agent 帮忙创建新人格
- 前端有完善的人格管理界面

**复杂度：** 高（记忆分区改造 + 工具权限系统 + 创建工具 + 前端改造）

---

### 2.3 交互工具体验优化

**现状：** `ask_user` 系列工具能中断 Agent 等待用户回复，但前端交互比较基础。

#### 改进项

**AskUserBubble 增强：**
- 支持富文本选项（选项带图标/描述）
- 多选模式支持"全选/反选"快捷操作
- 输入框支持 @ 提及工具名（自动补全）
- 历史回答记录（同类问题自动填充上次的回答）

**新增 `ask_user_confirm` 工具：**
- 专门用于危险操作确认（删除文件、推送代码等）
- 前端显示红色警告样式的确认卡片
- 需要用户输入"确认"二字才能继续（防误触）

**超时体验优化：**
- 倒计时可视化（气泡底部进度条）
- 即将超时时闪烁提醒
- 超时后自动执行默认操作（而非直接报错）

**验收标准：**
- ask_user 交互更直观美观
- 危险操作有专门的确认流程
- 超时有可视化倒计时

**复杂度：** 低-中（前端组件增强 + 新工具）

---

### 2.4 自然语言自配置扩展

**现状：** 已有 `manage_mcp` / `manage_skills` / `manage_macros` 三个配置工具。

#### 扩展项

**新增 `manage_providers` 工具：**
- 通过对话管理 LLM 提供商（添加/删除/切换/测试连接）
- 用户说"帮我加一个 DeepSeek 的 API"，Agent 自动配置

**新增 `manage_env_vars` 工具：**
- 通过对话管理环境变量
- 用户说"把 Tavily API key 设成 xxx"，Agent 自动设置

**新增 `manage_whitelist` 工具：**
- 通过对话管理路径白名单
- 用户说"允许访问 D:/Projects 目录"，Agent 自动添加

**统一配置入口：**
- 所有配置工具统一在 `tools/config/` 目录
- 新增 `TOOL.md` 中增加"配置能力总览"章节
- Agent 可以一次性完成多个配置操作（如：添加 MCP + 设置环境变量 + 添加路径白名单）

**验收标准：**
- 所有设置页面的功能都能通过自然语言完成
- 新用户首次使用时，Agent 能引导完成全部初始配置

**复杂度：** 中等（3 个新工具，模式参考已有的 manage_mcp）

---

### 2.5 上下文管理精细化

**现状：** 60% 阈值触发摘要，动态保留 3-6 轮，LLM 摘要 + 实体提取。

#### 改进项

**用户可控的上下文策略：**
- 新增 `context_strategy` 工具
- 用户可以指定"保留最近 10 轮对话"或"不要压缩上下文"
- 策略持久化到会话元数据

**上下文使用可视化增强：**
- `ContextUsageBadge` 增加饼图/条形图分解
- 显示各部分占比：系统提示词 / 历史消息 / 工具输出 / 用户消息
- 预测"还能对话 N 轮"

**选择性遗忘：**
- 新增 `forget` 工具
- 用户可以指定"忘记关于 XX 的讨论"
- Agent 从上下文中移除相关消息（通过 checkpoint 编辑）

**验收标准：**
- 用户可以控制上下文压缩策略
- 前端有详细的上下文使用分解图
- 用户可以让 Agent 选择性遗忘某些讨论

**复杂度：** 中等（新工具 + 前端增强 + checkpoint 编辑逻辑）

---

### 2.6 本地隐私强化

**现状：** 完全本地运行，数据不离开机器。但缺乏明确的隐私声明和控制。

#### 改进项

**隐私仪表盘（前端新页面 `views/PrivacyView.vue`）：**
- 显示所有数据存储位置（记忆、会话、配置、日志）
- 一键导出所有个人数据
- 一键清除所有对话历史
- 显示网络请求统计（哪些外部 API 被调用过）

**数据加密存储：**
- 敏感配置（API keys）使用 Windows DPAPI 加密存储
- `providers.yaml` 中的 `api_key` 字段加密
- 启动时解密，运行时内存中明文

**审计日志：**
- 记录所有外部 API 调用（时间、目标、数据量）
- 前端可查看审计日志
- Agent 可通过 `audit_log` 工具查看

**验收标准：**
- 用户能清楚看到所有数据存储在哪里
- API key 不以明文存储在磁盘上
- 有完整的网络活动审计

**复杂度：** 高（加密模块 + 审计系统 + 前端新页面）

---

## 三、工程质量与体验基础

### 3.1 前端组件库标准化

**现状：** 25+ 组件风格不统一，样式分散在各组件的 `<style>` 中。

**改进：**
- 提取共享 CSS 变量和组件样式到 `assets/styles/design-system.css`
- 统一卡片、按钮、输入框、徽章的样式规范
- 新建 `components/ui/` 目录存放基础 UI 组件（Button、Input、Card、Badge、Modal）
- 所有页面和气泡组件基于基础 UI 组件构建

**复杂度：** 中（渐进式重构，不需要一次性完成）

---

### 3.2 错误处理与恢复

**现状：** 工具错误返回 `format_error()`，但缺乏系统性的重试和恢复机制。

**改进：**
- 新增 `agent/error_recovery.py`
- 工具连续失败 2 次后自动切换策略（换工具 / 换参数 / 请求用户帮助）
- 网络错误自动重试（指数退避，最多 3 次）
- 前端错误展示统一为 `ErrorCard.vue`（显示错误类型、建议操作、报告按钮）

**复杂度：** 中等

---

### 3.3 性能监控与优化

**现状：** 有基础 `api/metrics.py`，但缺乏端到端延迟追踪。

**改进：**
- 每次 Agent 回合记录：LLM 调用延迟 / 工具执行时间 / 总回合时间
- 前端 `HealthPanel` 增加性能指标展示
- 慢查询告警（单回合 > 30 秒时提示用户）

**复杂度：** 低-中

---

## 四、开发里程碑

| 里程碑 | 包含内容 | 预估周期 |
|--------|----------|----------|
| **M1: 编程基础** | 1.1 Git 集成 + 1.2 Diff 预览 + 1.3 项目感知 | 1-2 周 |
| **M2: 交互升级** | 1.4 Plan Mode + 1.8 多模态 + 2.3 交互优化 | 1-2 周 |
| **M3: 并行与沙箱** | 1.5 并行子 Agent + 1.6 沙箱 Phase 1 | 1-2 周 |
| **M4: 记忆强化** | 2.1 记忆生产化 + 2.5 上下文精细化 | 1 周 |
| **M5: 人格深化** | 2.2 多人格系统 + 2.4 自配置扩展 | 1-2 周 |
| **M6: 自动化** | 1.7 Event Hooks + 2.6 隐私强化 | 2 周 |
| **M7: 工程质量** | 3.1 组件标准化 + 3.2 错误处理 + 3.3 性能监控 | 1 周 |

---

## 五、文件变更索引

### 新建文件

```
tools/git/                          # 1.1 Git 工具集（7 个工具 + TOOL.md）
tools/config/tool_manage_providers.py  # 2.4 Provider 管理工具
tools/config/tool_manage_env_vars.py   # 2.4 环境变量管理工具
tools/config/tool_manage_whitelist.py  # 2.4 路径白名单管理工具
tools/sub_agent/tool_parallel.py       # 1.5 并行执行工具
agent/project_scanner.py               # 1.3 项目扫描器
agent/hooks.py                         # 1.7 事件钩子系统
agent/error_recovery.py                # 3.2 错误恢复
web/src/components/PlanCard.vue        # 1.4 计划确认卡片
web/src/components/ImagePreview.vue    # 1.8 图片预览
web/src/components/tools/FileDiffView.vue  # 1.2 Diff 预览
web/src/components/tools/GitStatusBubble.vue  # 1.1 Git 状态气泡
web/src/components/tools/GitDiffBubble.vue    # 1.1 Git Diff 气泡
web/src/components/ui/                 # 3.1 基础 UI 组件库
web/src/views/HooksView.vue           # 1.7 钩子管理页面
web/src/views/PrivacyView.vue         # 2.6 隐私仪表盘
docs/ROADMAP.md                        # 本文档
```

### 修改文件

```
tools/__init__.py                     # 注册 git/parallel 等新工具 + 关键词映射
api/routes/chat.py                    # MCP 工具可见性修复 + 项目感知注入
agent/planner.py                      # Plan Mode 确认流程 + 并行标注
agent/prompts.py                      # 项目上下文注入 + 人格专属记忆
agent/context_manager.py              # 选择性遗忘 + 用户可控策略
memory/memory_manager.py              # 75→150 字限制 + 相似度检测
memory/narrative.py                   # 人格专属记忆分区
tools/files/tool_file_edit.py         # 返回 diff 片段 + preview 操作
tools/files/TOOL.md                   # 更新文档
tools/config/TOOL.md                  # 增加配置能力总览
web/src/components/ChatInput.vue      # 图片拖拽/粘贴
web/src/components/tools/FileEditBubble.vue  # Diff 渲染
web/src/components/ContextUsageBadge.vue     # 饼图分解
web/src/components/MemoryPanel.vue          # 搜索/过滤
web/src/views/MemoryView.vue               # 搜索/过滤/编辑
web/src/views/SoulView.vue                 # 创建新人格
web/src/router/index.ts                    # 新路由
web/src/App.vue                            # 新菜单项
web/src/types/index.ts                     # 新类型定义
web/src/api/index.ts                       # 新 API 调用
api/server.py                              # HookManager 启动
app_paths.py                               # 新路径常量
```
