# MaxmaHere 项目索引

> 这是当前代码导航，不是历史迁移记录。代码、测试和构建脚本与本文档冲突时，以代码和测试为准。
>
> 更新时间：2026-10-01（基线：main，version.py = `v2.6.11`）

## 唯一现行架构入口

- [当前架构](docs/00-当前架构.md)
- [README](README.md)
- [当前交接说明](HANDOFF.md)

## 运行链路

```text
web/src/main.ts
  -> web/src/composables/useChat.ts
  -> bun-backend/src/routes/chat-ws.ts（WS 分发 + 回合富化）
  -> bun-backend/src/server.ts callKernelRpc（in-process）
  -> bun-sidecar/src/kernel/bridge-pi.ts
  -> pi AgentSession
```

辅入口：`web/src/quick-chat/main.ts` — 独立挂载的轻量聊天页（QuickChatApp，默认素影主题），与主应用共享 Pinia store、主题与后端 API。

## 目录导航

| 目录 | 入口 | 责任 |
| --- | --- | --- |
| `web/` | `web/src/main.ts`、`web/src/quick-chat/main.ts` | Vue 应用、路由、Pinia、REST/WS、主题和工具结果渲染 |
| `bun-backend/` | `src/server.ts` | Hono 后端：鉴权/限流/CORS、全部 REST 路由、chat WS、kernel in-process 装配、静态托管 |
| `bun-sidecar/` | `src/kernel/bridge-pi.ts` | pi 引擎桥：AgentSession、模型、工具、MCP、审批、计划、目标、检查点、事件映射 |
| `config/` | — | 内置模板与人设/规则/贴纸数据（运行时可写副本在数据目录） |
| `build/` | `build-server.bat` | Bun 后端 bundle（server.js + bun.exe + sharp 原生件）与冒烟测试 |
| `build-portable.bat`（根目录） | — | Web 便携包完整构建流程 |
| `api/data/` | — | 运行时数据目录（providers.yaml / maxma.db / credential.key 等，历史路径名保留） |
| `version.py` | — | 项目统一版本号单一数据源（后端经 app-version.ts 读取） |

## 前端关键位置

- 主应用入口：`web/src/main.ts`；轻量聊天入口：`web/src/quick-chat/main.ts`
- 路由：`web/src/router/index.ts`（带 `meta.feature` 能力守卫，禁用能力重定向到 `FeatureUnavailableView`）
- API：`web/src/api/index.ts`
- 聊天连接：`web/src/composables/useChat.ts`（WebSocket 生命周期）
- 斜杠命令：`web/src/composables/useSlashCommands.ts` + `useSlashCommandsProvide.ts`
- 状态（Pinia）：`web/src/stores/` — session / chat / memory / provider / persona / capabilities / plugin / activity / metrics / health / onboarding / workbench / sidebar / collab / tools
- 类型定义：`web/src/types/`（chat / session / provider / mcp / persona / workflow / workbench / news / metrics / activity / audit-log 等模块）
- 工具组件注册：`web/src/components/tools/registry.ts`（覆盖全部内置工具）
- 组件分组：
  - `web/src/components/` — 聊天核心（ChatWindow / MessageBubble / ChatInput / ModelSelector / ThinkingBlock / PlanCard / SubAgentCard / StickerPicker 等）
  - `web/src/components/workbench/` — 工作台面板与卡片（canvas-registry + cards/）
  - `web/src/components/inspira/` — 30+ 动效/视觉组件（AuroraBackground、AnimatedModal、GlareCard 等）
  - `web/src/components/ui/` — Ds 系列基础组件（DsModal / DsToast / DsTooltip / ConfirmDialog 等）
  - `web/src/components/plugins/` — 插件卡片/搜索/配置面板（当前引擎下为空态/不可用）
  - `web/src/components/brand/` — 品牌印章（BrandSeal）
- 页面：`web/src/views/`
  - 对话域：`ChatView`（主界面）、`ShareView`（分享会话）
  - 记忆/角色：`MemoryView`、`SoulView`、`UserView`
  - 配置域：`ProvidersView`、`McpView`、`SettingsView`、`AppearanceView`、`PrivacyView`、`MaxmaBlockerView`、`CapabilitiesView`（能力仪表盘）
  - 扩展域：`PluginListView`、`PluginDetailView`、`ExtensionView`、`RulesView`、`CollabView`（AutomationView 由 feature 开关隐藏）
  - 信息域：`NewsView`、`ActivityView`、`MetricsView`、`HelpView`
  - 流程域：`OnboardingView`（首次引导）、`FeatureUnavailableView`、`NotFoundView`
- 工具函数：`web/src/utils/`（env / wsProtocol / markdown / logger / error / thinkPath 等）
- 设计令牌和主题：`web/src/assets/styles/`（tokens.css 为活规范）+ `web/src/themes/`（素影 suying / 夜间 night）

## 后端关键位置（bun-backend/src/）

- 应用装配：`server.ts`（Hono + 中间件 + 路由挂载 + Bun.serve WS 升级 + 静态托管）
- 聊天 WS：`routes/chat-ws.ts`（消息分发、事件广播、回合富化层）；回合缓存 `routes/chat-turns.ts`；产物 `routes/chat-artifacts.ts`
- 会话门面：`routes/sessions.ts`、`routes/session-compress.ts`、`const-session-store.ts`
- Provider：`routes/providers.ts`（凭据信封加密存储）；余额 `routes/balance.ts`；内置免费供应商 `services/opencode-zen.ts`
- MCP：`routes/mcp.ts`、`mcp-oauth.ts`、`mcp-test.ts`、`mcp-validation.ts`
- Settings：`routes/settings.ts`、`settings-panels.ts`、`settings-global.ts`（pi 全局 SettingsManager）
- 记忆：`routes/memory.ts`（CRUD + 搜索/筛选/统计）
- 能力仪表盘：`routes/capabilities.ts`（聚合 settings/工具/MCP/Provider/配置源 + Phase4 manifest）
- 插件：`routes/plugins.ts`（桩）；规则：`routes/rules.ts`；工具清单：`routes/tools.ts`
- 贴纸系统：`routes/stickers.ts`、`sticker-upload.ts`（sharp 转换）、`sticker-favorites.ts`
- 人设：`routes/persona.ts`；引导：`routes/onboarding.ts`；动态：`routes/news.ts`
- 运行可观测：`routes/activity.ts`（活动流 SSE）、`routes/metrics-route.ts`、`metrics.ts`、`routes/diagnostics.ts`、`error-collector.ts`、`health.ts`、`runtime-status.ts`、`routes/audit-log.ts`、`routes/transcripts.ts`
- 工作流：`routes/workflows.ts`（YAML 定义 + 运行状态 + WS 进度）
- 其他：`routes/files.ts`、`routes/upload.ts`、`routes/collab.ts`、`routes/deferred-runs.ts`、`routes/restart.ts`、`routes/maxma-blocker.ts`、`routes/core.ts`
- 认证：`auth.ts`、`db/core.ts`、`middleware/auth.ts`、`middleware/rate-limit.ts`、`middleware/request-log.ts`
- 凭据安全：`security/credential-envelope.ts`（Fernet 兼容 + 信封层）
- 路径与配置：`app-paths.ts`（惰性 getter）、`config-settings.ts`、`cors-config.ts`、`app-version.ts`
- 存储：`db/core.ts`（bun:sqlite，v1-v7 迁移）、`yaml-store.ts`（Bun.YAML 原子写）

## 引擎关键位置（bun-sidecar/src/）

- kernel 桥：`kernel/bridge-pi.ts`（`handlePiCreateSession` / `handlePiSessionRpc`——后端 in-process 直调）
  - 会话核心：`create_session` / `prompt` / `cancel` / `destroy_session` / `undo` / `compact` / `get_messages` / `get_health`
  - 审批与计划：`user_response` / `set_auto_approve` / `plan_action` / `set_plan_mode`
  - 检查点与目标：`checkpoint_action` / `goal_action` / `get_goal_state`
  - MCP：`reload_mcp_for_session`
  - Settings：`get_settings` / `set_settings`
- 支撑模块：`kernel/pi-session.ts`、`kernel/prompt.ts`、`kernel/events.ts`、`kernel/approval-gate.ts`、`kernel/plan.ts`、`kernel/goal.ts`、`kernel/mcp.ts`、`kernel/model.ts`、`kernel/tools.ts`、`kernel/extensions/`（maxma-approval / maxma-blocker）
- 自定义工具：`tools/`（`remember_memory` / `search_memories` / `get_sticker` / `list_rules` / `list_automations`）
- RPC 类型：`src/rpc-types.ts`
- 旧 stdio 入口：`src/session-bridge.ts`（当前无运行时调用方，仅契约测试引用）
- 测试：`bun-sidecar/tests/`（rpc / mcp / plan-bridge / tools / automations 等）

## 安全和契约文档

- [安全责任契约](docs/security-contract.md)
- [权限模式](dev_docs/permission-modes.md)
- [路径白名单](dev_docs/path-whitelist.md)
- [沙箱边界](dev_docs/sandbox-boundaries.md)
- [Git 规范](dev_docs/conventions/git-conventions.md)
- ADR：`dev_docs/adr/`（运行时状态契约、权限模式、注册 Artifact 协议等）
- 品牌规范：`docs/brand-guidelines.md`（唯一品牌事实源；`DESIGN.md` 为已废弃的 alpha 存档）

## 开发命令

```text
一键安装：install.bat
一键启动：start.bat
后端：cd bun-backend && bun run src/server.ts
前端：cd web && npm run dev
后端测试：cd bun-backend && bun test
前端测试：cd web && npx vitest run
引擎测试：cd bun-sidecar && bun test
服务端构建：build\build-server.bat
便携包构建：build-portable.bat
便携冒烟：powershell -NoProfile -ExecutionPolicy Bypass -File build\portable-smoke-test.ps1
```

## 便携版打包（Web 形态）

- 构建链：`build\build-server.bat` → `dist\bun-server\`（`server.js` 经 `bun build --target bun` 打包；`bun.exe` 固定版运行时；`node_modules\` 携带 sharp 原生件）→ `build-portable.bat` 组装便携目录。
- 产物结构：`server.js` + `bun.exe` + `node_modules\`（sharp/libvips）+ `web\dist\`（前端静态文件）+ `config\`（模板/规则/内置贴纸）+ `.omp\skills\` + `version.py` + `bun-sidecar\package.json` + `portable.flag`（便携模式契约标记）+ `data\`（用户数据）+ `MaxmaHere.bat`（启动器）。
- 打包形态说明：不用 `bun build --compile` 单文件——sharp 的 libvips 原生 DLL 无法被编译产物内嵌（启动即崩）；bundle 路线（bun.exe + server.js + 原生件目录）是验证过的可行形态，贴纸上传端到端可用。
- 启动器通过 `MAXMA_BUNDLE_DIR` / `MAXMA_DATA_DIR` / `MAXMA_EXE_DIR` / `MAXMA_SERVE_WEB` 环境变量显式指定路径（扁平化 server.js 的模块内路径不再指向项目根）。
- 浏览器等大资源按需下载，不预打包。

## 版本事实

运行时版本来源为 `version.py`；发布前需同步核对 `web/package.json`、`portable.flag` 和 Git tag。

**当前实现边界**：

- Agent 推理和工具循环只在 pi 引擎（kernel）中执行；Bun 后端是 API、会话和安全策略层。
- 自动化功能随旧后端下线（capabilities `automation.enabled=false`，前端路由守卫隐藏）；插件系统在当前引擎不可用（REST 桩化）。
- `/kb` 知识库已废弃返回 503；部分旧兼容接口可能返回 stub/未启用状态。
- Memory 事件未实现（pi memory 独立运行，不发射事件）；MCP 配置变更需 `reload_mcp_for_session` 或新建 session。
