# MaxmaHere 当前交接说明

> 本文件记录当前可执行状态与全面排查结果，供下一位 Agent 快速接手。
>
> 完整架构请先读 [docs/00-当前架构.md](docs/00-当前架构.md)。

## 当前状态

- 仓库：`https://github.com/Libai-88/Maxma.git`
- 分支：`feat/gsap-signature-animations`（已合并所有分支的成熟版本）
- 当前提交：`76ac60e5`
- 当前 tag：`v0.1-mature`（回滚用：`git checkout tags/v0.1-mature`）
- 合并前备份 tag：`v0.1-pre-merge`
- Agent 引擎：oh-my-pi v16.5.2
- 后端：FastAPI + Uvicorn
- 前端：Vue 3 + Vite + Pinia + TypeScript
- 桌面：Tauri 2 + Rust

### 已合并分支

| 分支 | 说明 |
|------|------|
| `feat/gsap-signature-animations` | 当前分支，GSAP 动效 + Inspira UI 集成 |
| `origin/main` | 主分支 |
| `origin/feat/omp-alignment` | OMP 对齐 |
| `origin/fix/bridge-contract` | 桥接层契约修复 |
| `feat/omp-alignment` (local) | 本地 OMP 对齐（含常驻背景光斑） |

## 唯一 Agent 路径

```text
web -> FastAPI /ws/chat/{session_id} -> JSON-RPC stdio -> bun-sidecar/src/session-bridge.ts -> oh-my-pi
```

修改聊天功能时，优先检查：

1. `web/src/composables/useChat.ts`
2. `api/routes/chat.py`
3. `api/pi_bridge/rpc_client.py`
4. `bun-sidecar/src/session-bridge.ts`
5. 对应的前端、Python 和 sidecar 测试

## 全面排查结果

> 排查时间：2026-08-02
> 排查范围：前端空壳功能、中间层通信健康度、后端 Agent 能力发挥

### 整体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构健康度 | **92%** | 四层架构清晰，主链路通畅 |
| 前端-后端接通率 | **93%** | 核心聊天功能完整，Plan/Artifact/Workflow 已打通 |
| 中间层可靠度 | **95%** | WebSocket 主链路健康，事件转发已修复 |
| Agent 能力发挥 | **88%** | 核心 Agent 能力正常，高级功能已通过 EventBus 接入 |

---

### 一、前端排查（空壳功能）

#### 核心功能已接通 ✅

- 聊天会话（WebSocket 双向通信）— 正常
- 模型选择/提供商管理 — 正常
- 工具执行结果渲染（31 个 OMP 工具气泡）— 正常
- 会话管理（CRUD + 历史）— 正常
- 主题切换 — 正常
- 设置面板（部分）— 正常

#### 空壳功能（UI 存在但未接通后端）⚠️

| 功能 | 前端文件 | 后端状态 | 严重程度 |
|------|----------|----------|----------|
| **自动化/定时任务** | `AutomationView.vue` | 后端有 `collab.py` 但功能不完整，部分端点未实现 | **中** |
| **协作/分享** | `CollabView.vue` | 后端端点未完全实现 | **中** |
| **能力发现面板** | `CapabilitiesView.vue`（已删除） | 对应后端端点 `/api/capabilities` 已移除 | **低** |
| **插件市场** | `PluginListView.vue`, `PluginDetailView.vue`（已删除） | 后端有 stub 端点 | **低** |

#### 已修复的空壳功能 ✅

| 功能 | 修复方式 | 相关文件 |
|------|----------|----------|
| **Plan Mode（计划模式）** | `chat.py` 转发 `plan_response` 到 sidecar `plan_action` RPC；sidecar 注入审批文本 | `chat.py`, `session-bridge.ts` |
| **Artifact 管理** | 后端 `TOOL_END` 检测写文件工具后合成 `artifact` 事件；`artifact_action` 读取文件内容 | `chat.py`, `ws_protocol.py` |
| **Workflow 引擎** | `workflows.py` 完整实现 YAML 定义加载、运行状态管理、WebSocket 进度推送 | `workflows.py`, `ws_protocol.py` |

#### 建议

- **中优**：隐藏自动化/协作/插件市场等未完全接通的 UI 入口，或添加 `feature flag` 控制显示
- **低优**：文档同步（HANDOFF.md 已更新至 2026-08-02 状态）

---

### 二、中间层排查（通信链路健康度）

#### 运行链路

```
useChat.ts (WebSocket)
  -> FastAPI /ws/chat/{session_id} (chat.py _stream_turn_sidecar)
    -> JSON-RPC stdio (rpc_client.py)
      -> session-bridge.ts (mapPiEventToMaxma)
        -> oh-my-pi AgentSession
```

#### 主链路健康 ✅

- WebSocket 连接/重连机制正常
- JSON-RPC 请求/响应正常
- 事件流推送正常（thinking_delta, token, tool_update, done, error 等）
- 会话生命周期管理正常

#### 已修复的缺陷 ✅

| 问题 | 位置 | 修复方式 |
|------|------|----------|
| `plan_response` 消息黑洞 | `chat.py` | 已转发到 sidecar `plan_action` RPC，`plan_proposed/step_start/step_end/step_error/completed` 事件通用转发 |
| `artifact_action` 消息黑洞 | `chat.py` | 已实现文件读取/操作，返回 `artifact_result` 事件；`TOOL_END` 分支自动检测写文件工具并合成 `artifact` 事件 |
| `update_auto_approve` 仅更新 Python 侧状态 | `chat.py` | 已同步到 sidecar `set_auto_approve` RPC，运行时修改 OMP `tools.approvalMode` |
| MCP 热重载不生效 | session-bridge.ts | 已实现 `reload_mcp_for_session` RPC，重新连接 MCP 服务器并刷新工具列表 |
| `ask_user` 事件字段缺失 | session-bridge.ts | `parseApprovalTitle` 从格式化 title 解析 `risk_level` / `tool_input` 字段 |

#### 事件映射状态

| 事件 | 前端 | 后端 | Sidecar | OMP SDK | 状态 |
|------|------|------|---------|---------|------|
| `thinking_delta` | ✅ | ✅ | ✅ | ✅ | 正常 |
| `token` | ✅ | ✅ | ✅ | ✅ | 正常 |
| `tool_update` | ✅ | ✅ | ✅ | ✅ | 正常 |
| `tool_end` | ✅ | ✅ | ✅ | ✅ | 正常 |
| `done` | ✅ | ✅ | ✅ | ✅ | 正常（含 A1 cancelled 补发） |
| `error` | ✅ | ✅ | ✅ | ✅ | 正常（含 trace_id + category） |
| `context_compressed` | ✅ | ✅ | ✅ | ✅ | A3 已接通 |
| `plan_proposed` | ✅ | ✅ | ✅ | ✅ | 已实现：chat.py 透传 sidecar 事件 |
| `artifact` | ✅ | ✅ | ✅ | ✅ | 已实现：TOOL_END 检测写文件工具后合成 |
| `sub_session_created` | ✅ | ✅ | ✅ | ✅ | 已实现：EventBus 订阅 TASK_SUBAGENT_LIFECYCLE_CHANNEL |

---

### 三、后端 Agent 排查（能力发挥评估）

#### 已正常发挥的能力 ✅

- 基础对话（chat/completion）— 正常
- 工具调用（function calling）— 正常（31 个 OMP 内置工具）
- 上下文管理（context_compressing/compressed）— 正常
- 流式输出（SSE / WebSocket 流）— 正常
- 会话持久化（SQLite + AsyncSqliteSaver）— 正常
- 模型配置/提供商管理 — 正常
- 安全机制（路径白名单、MCP 命令白名单、MaxmaBlocker）— 正常

#### 已修复的能力 ✅

| 能力 | 修复方式 | 相关文件 |
|------|----------|----------|
| **Plan Mode** | `chat.py` 转发 `plan_response` 到 sidecar `plan_action` RPC；sidecar 注入审批文本到 agent 上下文并恢复 prompt | `chat.py`, `session-bridge.ts` |
| **Artifact 机制** | 后端 `TOOL_END` 检测 WriteTool/EditTool 等写文件工具后，从输出提取文件路径，读取文件内容，合成 `artifact` 事件 | `chat.py`, `ws_protocol.py` |
| **Workflow 引擎** | `workflows.py` 完整实现：YAML 定义加载、运行状态管理、步骤执行、WebSocket 进度推送 | `workflows.py` |
| **运行时切换 auto_approve** | `set_auto_approve` RPC 直接修改 OMP `tools.approvalMode` 运行时属性 | `session-bridge.ts` |
| **Sub-Agent 事件** | `session-bridge.ts` 订阅 `createAgentSession` 返回的 `eventBus` 的 `TASK_SUBAGENT_LIFECYCLE_CHANNEL`，映射为 `sub_session_created` 事件 | `session-bridge.ts` |

#### 仍受限的能力 ⚠️

| 能力 | 当前状态 | 根因 |
|------|----------|------|
| **Maxma 自定义工具** | `bun-sidecar/src/tools/index.ts` 返回空数组 | 所有工具已迁移到 OMP 内置工具，无自定义工具注册 |
| **Deferred Runs** | 后端有端点，前端 UI 未完全暴露 | 功能开关控制，默认关闭 |
| **记忆系统（mnemopi）** | 独立 state 运行，不与事件流集成 | memory 跑在独立状态中，不通过 subscribe 事件推送 |
| **Memory 事件** | 不可实现（轮询方案成本高，收益低） | OMP 无 memory EventBus 通道，轮询 `memory_summary.md` 增加复杂性 |

---

### 四、关键文件清单

#### 排查中涉及的核心文件

| 文件 | 职责 | 排查结论 |
|------|------|----------|
| `api/routes/chat.py` | WebSocket 聊天端点，事件转发 | 主链路正常，`plan_response`/`artifact_action`/`update_auto_approve` 已修复 |
| `api/pi_bridge/ws_event_mapper.py` | 事件映射 | 正常 |
| `api/pi_bridge/rpc_client.py` | JSON-RPC stdio 客户端 | 正常 |
| `api/pi_bridge/sidecar_manager.py` | Sidecar 进程生命周期管理 | 正常 |
| `api/routes/workflows.py` | 工作流引擎 API | **完整实现**（YAML 定义、运行管理、WebSocket 进度） |
| `api/routes/collab.py` | 协作 API | 部分实现 |
| `api/ws_protocol.py` | WebSocket 事件类型定义 | 正常（已添加 ARTIFACT 等事件类型） |
| `bun-sidecar/src/session-bridge.ts` | JSON-RPC 服务端，OMP 会话管理 | 主链路正常，`ask_user` 字段已修复，Sub-Agent 事件已接入 |
| `bun-sidecar/src/rpc-types.ts` | RPC 类型定义 | 正常（A6 类型修正已包含，plan_action/set_auto_approve/reload_mcp 等已添加） |
| `bun-sidecar/src/tools/index.ts` | 自定义工具注册入口 | **返回空数组** |
| `web/src/composables/useChat.ts` | WebSocket 连接管理，事件处理 | 主链路正常，handler 已就绪 |
| `web/src/components/tools/registry.ts` | 工具气泡注册 | 正常（31 个 OMP 工具全覆盖） |
| `web/src/types/index.ts` | 事件类型定义 | 正常（已更新实现状态注释） |

---

### 五、后续建议

1. **短期**：隐藏自动化/协作/插件市场等未完全接通的 UI 入口，避免用户混淆
2. **中期**：评估 Deferred Runs 是否需要补全 WebSocket 事件推送
3. **长期**：根据产品需求决定是否实现自定义工具系统、协作功能等
4. **持续**：维护 HANDOFF.md 与代码的同步，新功能接入后及时更新

## 数据位置

开发模式使用项目目录；冻结桌面模式使用 `%APPDATA%\\MaxmaHere`。用户数据包括 Provider、认证 Token、SQLite、固定会话、人设、Skill、Macro、上传文件、日志和向量数据。

## 常用命令

```text
python main.py                          # 启动后端
pytest -q                               # 运行 Python 测试
cd web && npm run dev                   # 启动前端
cd web && npx vitest run                # 运行前端测试
cd bun-sidecar && bun test              # 运行 sidecar 测试
build\\build-server.bat                 # 构建服务端
build\\build-desktop.bat                # 构建桌面版
```

## 当前限制

- MCP 配置热重载已实现，但需调用 `reload_mcp_for_session` RPC 而非自动检测。
- 知识库和自治相关部分存在 stub 或受功能开关控制的接口。
- 发布前需要核对 `version.py`、`web/package.json`、Tauri 配置和 Git tag，避免产品版本不一致。
- Maxma 自定义工具注册入口为空。
- Memory 事件未实现（OMP memory 独立运行，不发射事件）。
- Deferred Runs 需产品决策是否补全 WebSocket 事件推送。

## 变更规则

- 先阅读 [dev_docs/conventions/git-conventions.md](dev_docs/conventions/git-conventions.md)。
- 安全边界变化必须同步更新安全契约和测试。
- 结构变化先更新 [docs/00-当前架构.md](docs/00-当前架构.md)。
- 代码与文档冲突时，以代码和测试为准，并修正文档。