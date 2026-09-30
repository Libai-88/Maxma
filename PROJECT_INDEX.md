# MaxmaHere 项目索引

> 这是当前代码导航，不是历史迁移记录。代码、测试和构建脚本与本文档冲突时，以代码和测试为准。
>
> 更新时间：2026-09-29（基线：main @ `348c585`，version.py = `v2.6.11`）

## 唯一现行架构入口

- [当前架构](docs/00-当前架构.md)
- [README](README.md)
- [当前交接说明](HANDOFF.md)

## 运行链路

```text
web/src/main.ts
  -> web/src/composables/useChat.ts
  -> api/routes/chat.py
  -> api/pi_bridge/sidecar_manager.py
  -> api/pi_bridge/rpc_client.py
  -> bun-sidecar/src/session-bridge.ts
  -> oh-my-pi AgentSession
```

辅入口：`web/src/quick-chat/main.ts` — 独立挂载的轻量聊天页（QuickChatApp，默认素影主题），与主应用共享 Pinia store、主题与后端 API。

## 目录导航

| 目录 | 入口 | 责任 |
| --- | --- | --- |
| `web/` | `web/src/main.ts`、`web/src/quick-chat/main.ts` | Vue 应用、路由、Pinia、REST/WS、主题和工具结果渲染 |
| `api/` | `api/server.py`（`main.py` 启动） | FastAPI、鉴权、会话、配置、WebSocket 桥接 |
| `api/pi_bridge/` | `sidecar_manager.py` | Bun 进程、JSON-RPC、SessionMap、事件和安全适配 |
| `bun-sidecar/` | `src/session-bridge.ts` | oh-my-pi session、模型、工具、MCP、审批和 RPC |
| `desktop/` | `src-tauri/src/main.rs` | Tauri 进程管理、端口、资源、WebView2、Job Object |
| `agent/` | `prompts.py`、`persona_loader.py` | system prompt、人设加载、记忆与上下文组装 |
| `config/` | `settings.py` | 环境变量、端口、超时、权限开关、人设/规则/贴纸数据 |
| `build/` | `build-server.bat` | 前端、Bun、PyInstaller、smoke test 和桌面构建 |
| `build/` | `build-portable.bat`（根目录） | 便携版完整构建流程 |
| `tests/` | `pytest -q` | Python 后端、路径、RPC、会话和集成测试（97 个测试文件） |
| `app_paths.py` | — | 开发/冻结双模式路径解析与数据目录 |
| `version.py` | — | 项目统一版本号单一数据源 |

## 前端关键位置

- 主应用入口：`web/src/main.ts`；轻量聊天入口：`web/src/quick-chat/main.ts`
- 路由：`web/src/router/index.ts`（带 `meta.feature` 能力守卫，禁用能力重定向到 `FeatureUnavailableView`）
- API：`web/src/api/index.ts`
- 聊天连接：`web/src/composables/useChat.ts`（WebSocket 生命周期，~2200 行核心）
- 斜杠命令：`web/src/composables/useSlashCommands.ts` + `useSlashCommandsProvide.ts`
- 状态（Pinia）：`web/src/stores/` — session / chat / memory / provider / persona / capabilities / plugin / activity / metrics / health / onboarding / workbench / sidebar / collab / tools
- 类型定义：`web/src/types/`（chat / session / provider / mcp / persona / workflow / workbench / news / metrics / activity / audit-log 等 17 个模块）
- 工具组件注册：`web/src/components/tools/registry.ts`（覆盖全部 OMP 内置工具）
- 组件分组：
  - `web/src/components/` — 聊天核心（ChatWindow / MessageBubble / ChatInput / ModelSelector / ThinkingBlock / PlanCard / SubAgentCard / StickerPicker 等）
  - `web/src/components/workbench/` — 工作台面板与卡片（canvas-registry + cards/）
  - `web/src/components/inspira/` — 30+ 动效/视觉组件（AuroraBackground、AnimatedModal、GlareCard 等）
  - `web/src/components/ui/` — Ds 系列基础组件（DsModal / DsToast / DsTooltip / ConfirmDialog 等）
  - `web/src/components/plugins/` — 插件卡片/搜索/配置面板
  - `web/src/components/brand/` — 品牌印章（BrandSeal）
- 页面：`web/src/views/`（25 个）
  - 对话域：`ChatView`（主界面）、`ShareView`（分享会话）
  - 记忆/角色：`MemoryView`、`SoulView`、`UserView`
  - 配置域：`ProvidersView`、`McpView`、`SettingsView`、`AppearanceView`、`PrivacyView`、`MaxmaBlockerView`、`CapabilitiesView`（能力仪表盘）
  - 扩展域：`PluginListView`、`PluginDetailView`、`ExtensionView`、`RulesView`、`AutomationView`、`CollabView`
  - 信息域：`NewsView`、`ActivityView`、`MetricsView`、`HelpView`
  - 流程域：`OnboardingView`（首次引导）、`FeatureUnavailableView`、`NotFoundView`
- 工具函数：`web/src/utils/`（env / wsProtocol / markdown / logger / error / thinkPath 等）
- 设计令牌和主题：`web/src/assets/styles/`（tokens.css 为活规范）+ `web/src/themes/`（素影 suying / 夜间 night）

## 后端关键位置

- 应用工厂：`api/server.py`；启动：`main.py`
- 聊天 WS：`api/routes/chat.py`（事件转发、Plan/Artifact/审批链路）
- 聊天支撑：`chat_model.py`（模型配置）、`chat_turns.py`（回合缓存）、`chat_artifacts.py`（产物）
- WS 协议常量：`api/ws_protocol.py`（WsEventType / WsMessageType 枚举）
- 会话管理：`api/session_manager.py`、`routes/sessions.py`、`session_compress.py`、`const_session_store.py`
- Provider：`api/routes/providers.py`（凭据信封加密存储）
- MCP：`api/routes/mcp.py`、`mcp_oauth.py`、`mcp_test.py`、`mcp_validation.py`
- OMP Settings：`api/routes/settings.py`、`settings_panels.py`
- 记忆：`api/routes/memory.py`（CRUD + 搜索/筛选/统计）
- 能力仪表盘：`api/routes/capabilities.py`（聚合 Settings/工具/MCP/Provider/配置源）
- 插件：`api/routes/plugins.py`；规则：`rules.py`；自动化：`automation.py`
- 贴纸系统：`stickers.py`、`sticker_upload.py`、`sticker_favorites.py`
- 人设：`persona.py`；引导：`onboarding.py`；动态：`news.py`
- 运行可观测：`activity.py`（活动流）、`metrics.py`、`diagnostics.py`、`audit_log.py`、`balance.py`（余额）、`context_usage.py`、`transcripts.py`
- 工作流：`workflows.py`（YAML 定义 + 运行状态 + WS 进度）
- 其他：`files.py`、`upload.py`、`collab.py`、`deferred_runs.py`、`restart.py`、`maxma_blocker.py`
- 认证：`api/auth.py`、`api/db/auth.py`、`api/middleware/`
- 路径安全：`api/pi_bridge/security_adapter.py`、`api/routes/path_whitelist.py`、`maxma_blocker.py`
- 凭据安全：`api/security/credential_envelope.py`、`credential_mask.py`
- SessionMap：`api/pi_bridge/session_adapter.py`
- 事件映射：`api/pi_bridge/ws_event_mapper.py`（验证/丰富 sidecar 事件）

## Sidecar 关键位置

- RPC server：`bun-sidecar/src/session-bridge.ts`（~1500 行）
  - 会话核心：`create_session` / `prompt` / `cancel` / `destroy_session` / `undo` / `compact` / `get_messages` / `get_health`
  - 审批与计划：`user_response` / `set_auto_approve` / `plan_action` / `set_plan_mode`
  - 检查点与目标：`checkpoint_action` / `goal_action` / `get_goal_state` / `session_recap`
  - MCP：`reload_mcp` / `reload_mcp_for_session`
  - Settings：`get_settings` / `set_settings`
  - 能力探测：`get_discovered_mcp` / `get_discovered_skills` / `get_discovered_extensions`
  - 插件：`list_plugins` / `install_plugin` / `uninstall_plugin` / `set_plugin_enabled` / `get_plugin_detail` / `get_plugin_config` / `update_plugin_config`
  - 其他：`execute_workflow_step` / `headless_prompt`
  - 事件推送：`mapPiEventToMaxma()` 将 OMP 事件映射为 Maxma WS 事件
- RPC 类型：`bun-sidecar/src/rpc-types.ts`
- 支撑模块：`approval.ts`（审批 UI 上下文）、`plan-bridge.ts`、`blocker.ts`、`events.ts`、`mcp.ts`、`model.ts`、`state.ts`、`omp-compat.ts`
- 自定义工具：`bun-sidecar/src/tools/index.ts`（`registerCustomTools()`）
  - `remember_memory`（写长期记忆）/ `search_memories`（检索记忆）
  - `get_sticker`（内置贴纸）/ `list_rules`（质量规则）/ `list_automations`（自动化清单）
- MCP 配置加载：`session-bridge.ts` 的 `loadConfiguredMcp()` / `createConfiguredMcp()`
- 测试：`bun-sidecar/tests/`（session-bridge rpc/mcp/pure、plan-bridge、tools、automations 等 8 个）

## 桌面壳关键位置

- 主进程：`desktop/src-tauri/src/main.rs`（后端 sidecar 启动、健康等待、崩溃重启、WebView2 检查、Job Object 清理）
- 端口管理：`desktop/src-tauri/src/port_manager.rs`
- 前端访问本地 API 必须走 `tauriFetch()`，不要用原生 `fetch()` 访问 `http://127.0.0.1`。

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
后端：python main.py 或 start_dev.py
前端：cd web && npm run dev
桌面开发：build\run-desktop-dev.bat
Python 测试：pytest -q
前端测试：cd web && npx vitest run
Sidecar 测试：cd bun-sidecar && bun test
服务端构建：build\build-server.bat
桌面构建：build\build-desktop.bat
构建契约检查：powershell -NoProfile -ExecutionPolicy Bypass -File build\test-build-contract.ps1
```

## 便携版打包（onedir 模式）

- `build/maxma-server.spec`：`exclude_binaries=True` + `COLLECT()`，Python 运行时持久化在 `_internal/`，启动 1-2 秒。
- 打包必须用项目 `.venv`：`.venv\Scripts\python.exe -m PyInstaller build\maxma-server.spec --clean`
- 产物结构：Tauri 主程序 + PyInstaller bootloader + `_internal/`（Python 运行时 + bun-sidecar node_modules）+ `portable.flag`（便携模式契约标记）+ `data/`（用户数据）+ `resources/runtime/`（嵌入式 Node/Python/uv）+ `dist/`（前端静态文件）。
- 依赖策略：Python 侧已裁剪 chromadb/onnxruntime（`constraints.txt` 阻断安装）；bun-sidecar node_modules 完整保留 oh-my-pi 上游依赖；浏览器等大资源按需下载，不预打包。
- 知识库（`/kb`）返回 503，已废弃。

## 版本事实

当前仓库基线为 `main` / `348c585` / `v2.6.11`（2026-09-17）。运行时版本来源为 `version.py`；发布前需同步核对 `web/package.json`、Tauri 配置和 Git tag。

**当前实现边界**：

- Agent 推理和工具循环只在 oh-my-pi sidecar 中执行；Python 后端是 API、会话和安全策略层。
- `/kb`、部分旧兼容接口和自治接口仍可能返回 stub/未启用状态；自动化、协作、插件等前端路由由 capabilities 清单做 feature 开关。
- Memory 事件未实现（OMP memory 独立运行，不发射事件）；MCP 配置变更需 `reload_mcp_for_session` 或新建 session。
