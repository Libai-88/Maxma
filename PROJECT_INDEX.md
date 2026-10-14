# MaxmaHere 项目索引

> 这是当前代码导航，不是历史迁移记录。代码、测试和构建脚本与本文档冲突时，以代码和测试为准。
>
> 更新时间：2026-10-09（基线：`feat/jet-hub-plugin`，version.py = `v2.6.11`）

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

插件链路（Jet Hub，经插件 HTTP 桥转发到 `dsh-codearts-auth`）：

```text
web/src/views/JetHubView.vue
  -> web/src/api/index.ts POST /api/jet-hub
  -> bun-backend/src/plugins/dsh/http-bridge.ts（通用转发，路径由插件给出）
  -> dsh-codearts-auth 的 jet-hub-rpc 分派器
  -> pi 桥 registerPluginProviderOn -> pi ModelRuntime.registerProvider
```

## 目录导航

| 目录 | 入口 | 责任 |
| --- | --- | --- |
| `web/` | `web/src/main.ts`、`web/src/quick-chat/main.ts` | Vue 应用、路由、Pinia、REST/WS、主题和工具结果渲染 |
| `bun-backend/` | `src/server.ts` | Hono 后端：鉴权/限流/CORS、全部 REST 路由、chat WS、kernel in-process 装配、静态托管 |
| `bun-backend/src/plugins/` | `plugins/registry.ts`、`plugins/dsh/index.ts` | 插件注册表与 DSH 插件宿主（连接、凭据、HTTP 桥、pi 桥、provider 注册） |
| `bun-sidecar/` | `src/kernel/bridge-pi.ts` | pi 引擎桥：AgentSession、模型、工具、MCP、审批、计划、目标、检查点、事件映射 |
| `desktop/` | `electron/main.cjs`、`electron-builder.config.cjs` | Electron 桌面壳（仅打包形态，本身不含业务逻辑） |
| `config/` | — | 内置模板与人设/规则/贴纸数据（运行时可写副本在数据目录） |
| `build/` | `build-server.bat` | Bun 后端 bundle（server.js + bun.exe + sharp 原生件）与冒烟测试 |
| `build-portable.bat`（根目录） | — | Web 便携包完整构建流程 |
| `api/data/` | — | 运行时数据目录（providers.yaml / maxma.db / credential.key / plugins/ 等，历史路径名保留） |
| `version.py` | — | 项目统一版本号单一数据源（后端经 app-version.ts 读取） |

## 前端关键位置

- 主应用入口：`web/src/main.ts`；轻量聊天入口：`web/src/quick-chat/main.ts`
- 路由：`web/src/router/index.ts`（带 `meta.feature` 能力守卫，禁用能力重定向到 `FeatureUnavailableView`）
- API：`web/src/api/index.ts`
- 聊天连接：`web/src/composables/useChat.ts`（WebSocket 生命周期）
- 斜杠命令：`web/src/composables/useSlashCommands.ts` + `useSlashCommandsProvide.ts`
- 状态（Pinia）：`web/src/stores/` — session / chat / memory / provider / persona / capabilities / plugin / jetHub / activity / metrics / health / onboarding / workbench / sidebar / collab / tools
- 类型定义：`web/src/types/`（chat / session / provider / mcp / persona / workflow / workbench / news / metrics / activity / audit-log 等模块）
- 工具组件注册：`web/src/components/tools/registry.ts`（覆盖全部内置工具）
- 组件分组：
  - `web/src/components/` — 聊天核心（ChatWindow / MessageBubble / ChatInput / ModelSelector / ThinkingBlock / PlanCard / SubAgentCard / StickerPicker 等）
  - `web/src/components/workbench/` — 工作台面板与卡片（canvas-registry + cards/）
  - `web/src/components/inspira/` — 30+ 动效/视觉组件（AuroraBackground、AnimatedModal、GlareCard 等）
  - `web/src/components/ui/` — Ds 系列基础组件（DsModal / DsToast / DsTooltip / ConfirmDialog 等）
  - `web/src/components/plugins/` — 插件卡片/搜索/配置面板
  - `web/src/components/brand/` — 品牌印章（BrandSeal）
- 页面：`web/src/views/`
  - 对话域：`ChatView`（主界面）、`ShareView`（分享会话）
  - 记忆/角色：`MemoryView`、`SoulView`、`UserView`
  - 配置域：`ProvidersView`、`McpView`、`SettingsView`、`AppearanceView`、`PrivacyView`、`MaxmaBlockerView`、`CapabilitiesView`（能力仪表盘）
  - 扩展域：`PluginListView`、`PluginDetailView`、`JetHubView`（插件自带管理界面）、`ExtensionView`、`RulesView`、`CollabView`（AutomationView 由 feature 开关隐藏）
  - 信息域：`NewsView`、`ActivityView`、`MetricsView`、`HelpView`、`EvolutionView`
  - 流程域：`OnboardingView`（首次引导）、`FeatureUnavailableView`、`NotFoundView`
- 工具函数：`web/src/utils/`（env / wsProtocol / markdown / logger / error / thinkPath 等）
- 设计令牌和主题：`web/src/assets/styles/`（tokens.css 为活规范）+ `web/src/themes/`（素影 suying / 極線 ultraline / 夜航 night / 金継 kintsugi / 青原 grass / 子夜 midnight，共 6 个）
- Jet Hub 客户端工具：`web/src/utils/jetHub/`（quota / credits / badge / account-model 格式与能力表，由插件搬运而来）

## 插件子系统关键位置

> 插件面已于 `feat/jet-hub-plugin` 分支落地，取代了原先的 100% 桩实现。移植过程与决策见 `dev_docs/codearts-plugin-integration-plan.md`。

- 注册表：`bun-backend/src/plugins/registry.ts`（`BUILTIN_PLUGINS` 声明式描述符 + `registry.json` 状态合并；`listPlugins` / `setPluginEnabled` / `setPluginConfig` / `uninstallPlugin` / `enabledDshSpecifiers`）
- 内置插件：`codearts-auth`（展示名 **Jet Hub**），默认启用，`kind: "dsh"`
- REST 面：`routes/plugins.ts` — `GET /api/plugins`、`GET /api/plugins/:name`、`GET /api/plugins/:name/config`、`GET /api/plugins/:name/providers`、`GET /api/plugins/:name/models`、`PUT /api/plugins/:name/config`、`PUT /api/plugins/:name/toggle`、`POST /api/plugins/install`、`DELETE /api/plugins/:name`（内置插件拒绝卸载）
- DSH 宿主：`bun-backend/src/plugins/dsh/` — `host.ts`（装配 + 环境注入）、`connection.ts`（插件 HTTP 端点注册）、`http-bridge.ts`（通用转发）、`credential-provider.ts`（实现 DSH 的 `credentials` 抽象类）、`pi-bridge.ts` / `pi-providers.ts`（把渠道注册进 pi ModelRuntime）、`index.ts`（`getDshPluginHost` / `isPluginProvider` / `currentPluginHttpHandlers`）
- 插件数据落盘：数据目录 `plugins/`（`registry.json` + `plugins/<id>/` + `plugins/dsh/`），经 `app-paths.ts` 的 `getPluginsDir` / `getPluginDataDir` / `getDshPluginStateDir` 解析；宿主注入 `DSH_HOME` / `DSH_JET_HUB_STATE_DIR`，使插件账号池留在 Maxma 数据目录内而非 `~/.dsh`
- pi 侧接入：`bun-sidecar/src/kernel/model.ts` 的 `resolvePiModel()` + `bun-sidecar/src/kernel/plugin-models.ts`
- 前端：`views/JetHubView.vue`、`stores/jetHub.ts`、`utils/jetHub/**`；路由 `/plugins/:name/jet-hub`（受 `meta.feature: 'plugins'` 守卫）
- 关键约束（真机踩过，有回归测试守着）：
  1. `chat-ws` 对 providers.yaml 里查不到的 provider 必须回落到 `isPluginProvider()`，且**不传** baseUrl / apiKey / providerType；
  2. 注册自定义 provider 时**必须带 baseUrl**（pi 会拒绝无 baseUrl 的自定义模型），刻意用保留域 `https://plugin.invalid/<route>` 让误用立即响亮失败；
  3. 插件方法面覆盖由 `bun-backend/tests/plugins/jet-hub-coverage.test.ts` 从插件分派器现读方法名做差集守卫，插件升级新增方法会让测试变红。

## 后端关键位置（bun-backend/src/）

- 应用装配：`server.ts`（Hono + 中间件 + 路由挂载 + Bun.serve WS 升级 + 静态托管）
- 聊天 WS：`routes/chat-ws.ts`（消息分发、事件广播、回合富化层）；回合缓存 `routes/chat-turns.ts`；产物 `routes/chat-artifacts.ts`
- 会话门面：`routes/sessions.ts`、`routes/session-compress.ts`、`const-session-store.ts`
- Provider：`routes/providers.ts`（凭据信封加密存储）；余额 `routes/balance.ts`；内置免费供应商 `services/opencode-zen.ts`
- MCP：`routes/mcp.ts`、`mcp-oauth.ts`、`mcp-test.ts`、`mcp-validation.ts`
- Settings：`routes/settings.ts`、`settings-panels.ts`、`settings-global.ts`（pi 全局 SettingsManager）
- 记忆：`routes/memory.ts`（CRUD + 搜索/筛选/统计）
- 能力仪表盘：`routes/capabilities.ts`（聚合 settings/工具/MCP/Provider/配置源 + Phase4 manifest）
- 插件：`routes/plugins.ts`（真实注册表 + REST 面）；规则：`routes/rules.ts`；工具清单：`routes/tools.ts`
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

## 便携版打包（两种形态）

> **产物固定位置、验证方式与踩坑记录见 [dev_docs/build-and-artifacts.md](dev_docs/build-and-artifacts.md)（唯一事实源）。**

| 形态 | 命令 | 产物 |
| --- | --- | --- |
| Web 便携包 | `build-portable.bat` | `..\MaxmaHere-Portable\` |
| Electron 桌面便携包 | `powershell -File build-desktop-portable.ps1` | `dist\electron-portable\MaxmaHere-<版本>-portable-x64.zip` + `.sha256` |

- 两种形态是**同一套后端产物的两种壳**：Web 形态由后端直接托管 `web/dist`；Electron 形态（`desktop/`，electron 44.5.1）只是包一层桌面窗口，业务逻辑全在后端。
- 共同输入：`build\build-server.bat` → `dist\bun-server\`（`server.js` 经 `bun build --target bun` 打包；`bun.exe` 固定版运行时；`node_modules\` 携带 sharp 原生件 **与插件栈**；`externals.json` 为运行时依赖清单）。
- 产物结构：`server.js` + `bun.exe` + `externals.json` + `node_modules\`（sharp/libvips + 插件栈）+ `web\dist\`（前端静态文件）+ `config\`（模板/规则/内置贴纸）+ `.omp\skills\` + `.maxma\skills\` + `version.py` + `bun-sidecar\package.json` + `portable.flag`（便携模式契约标记）+ `data\`（用户数据）+ `MaxmaHere.bat`（启动器）。
- 打包形态说明：不用 `bun build --compile` 单文件——sharp 的 libvips 原生 DLL 无法被编译产物内嵌（启动即崩）；bundle 路线（bun.exe + server.js + 原生件目录）是验证过的可行形态，贴纸上传端到端可用。
- **插件栈刻意不进 bundle**：`@deepseek-ai/dsh-llm` 在模块作用域读自己的 `../package.json`，内联后路径会断（详见构建文档 §4.1）。清单由 `build-server.mjs` 递归推导，`build-server.bat` / `electron-builder.config.cjs` / 冒烟脚本三处都读它。插件栈当前 24 个包（`@deepseek-ai/*` + `dsh-codearts-auth` + `zod`/`jose`/`undici` 等），随包分发是 Jet Hub 在便携版可用的前提。
- 启动器通过 `MAXMA_BUNDLE_DIR` / `MAXMA_DATA_DIR` / `MAXMA_EXE_DIR` / `MAXMA_SERVE_WEB` 环境变量显式指定路径（扁平化 server.js 的模块内路径不再指向项目根）。
- 浏览器等大资源按需下载，不预打包。

## 版本事实

运行时版本来源为 `version.py`；发布前需同步核对 `web/package.json`、`portable.flag` 和 Git tag。

当前 `v2.6.11`：`version.py` / `web/package.json` / 便携包 `portable.flag` **三处一致**（2026-10-09 核对）。

**当前实现边界**：

- Agent 推理和工具循环只在 pi 引擎（kernel）中执行；Bun 后端是 API、会话和安全策略层。
- 自动化功能随旧后端下线（capabilities `automation.enabled=false`，前端路由守卫隐藏）。
- 插件子系统**已落地**（真实注册表 + REST 面 + Jet Hub 管理页，capabilities `features.plugins = { enabled: true, marketplace: false }`）；未接的网络安装面保持拒绝（`POST /api/plugins/install` 只启用已随包分发的插件）。移植范围与未接方法的归属见 `dev_docs/codearts-plugin-integration-plan.md`。
- `/kb` 知识库路由已从后端移除（不是 503 桩）。
- Memory 事件未实现（pi memory 独立运行，不发射事件）；MCP 配置变更需 `reload_mcp_for_session` 或新建 session。
