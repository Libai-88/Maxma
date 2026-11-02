# MaxmaHere 项目索引

> 代码导航，不是历史记录。与代码/测试冲突时以代码为准并回来改本文。
> 更新时间：2026-11-02（基线 `feat/jet-hub-plugin`，v2.6.12）

## 入口

- [README](README.md) — 用户视角的上手
- [docs/00-当前架构.md](docs/00-当前架构.md) — 架构唯一总览
- [HANDOFF.md](HANDOFF.md) — 当前状态、闸门、已知缺陷
- [docs/security-contract.md](docs/security-contract.md) — 安全边界（改动必读）

## 运行链路

```text
web/src/main.ts
  -> web/src/composables/useChat.ts
  -> bun-backend/src/routes/chat-ws.ts（WS 分发 + 回合富化）
  -> bun-backend/src/server.ts callKernelRpc（in-process）
  -> bun-sidecar/src/kernel/bridge-pi.ts
  -> pi AgentSession
```

辅入口：`web/src/quick-chat/main.ts` — 独立挂载的轻量聊天页，与主应用共享 Pinia store、主题与后端 API。

插件链路：`JetHubView.vue` → `POST /api/jet-hub` → `plugins/dsh/http-bridge.ts` → 插件 jet-hub-rpc 分派器 → `pi-bridge`/`pi-providers` → `pi ModelRuntime.registerProvider`。

## 目录

| 目录 | 入口 | 责任 |
| --- | --- | --- |
| `web/` | `src/main.ts`、`src/quick-chat/main.ts` | Vue 应用、路由、Pinia、REST/WS、主题、工具结果渲染 |
| `bun-backend/` | `src/server.ts` | Hono 后端：鉴权/限流/CORS、REST 路由、chat WS、kernel 装配、静态托管 |
| `bun-backend/src/plugins/` | `registry.ts`、`dsh/index.ts` | 插件注册表与 DSH 宿主 |
| `bun-sidecar/` | `src/kernel/bridge-pi.ts` | pi 引擎桥：会话、模型、工具、MCP、审批、计划、目标、检查点、事件映射 |
| `desktop/` | `electron/main.cjs`、`electron-builder.config.cjs` | Electron 桌面壳（仅打包形态） |
| `config/` | — | 内置模板与人设/规则/贴纸数据 |
| `build/` | `build-server.bat` | 后端 bundle 与便携冒烟 |
| `api/data/` | — | 运行时数据目录（历史路径名保留） |
| `version.py` | — | 版本号单一数据源（后端经 `app-version.ts` 读取） |

## 引擎接缝

`bun-sidecar/src/kernel/pi-contract.ts` = Maxma 向引擎借用名字的单一数据源（导出符号、事件名、工具、ThinkingLevel、provider api、settings 点路径、RPC 方法名、未产出事件登记表）。新增对引擎名字的依赖必须先在此登记。

校验：`tests/pi-contract.test.ts`（对账已安装引擎包）、`tests/engine-boundary.test.ts`（边界纪律 + 事件生产者双向对账 + 两 workspace 版本与两把锁一致）、`tests/contract-snapshot.test.ts`（只锁我方映射不回归，测不到上游改名）。

## 前端

- 路由 `src/router/index.ts`（`meta.feature` 能力守卫 → `FeatureUnavailableView`）
- API `src/api/index.ts`；WS 生命周期 `src/composables/useChat.ts`；斜杠命令 `useSlashCommands.ts`
- Pinia `src/stores/`：session / chat / memory / provider / persona / capabilities / plugin / jetHub / activity / metrics / health / onboarding / workbench / sidebar / collab / tools
- 类型 `src/types/`；工具组件注册 `src/components/tools/registry.ts`
- 组件分组：`components/`（聊天核心）、`workbench/`（工作台 canvas-registry + cards）、`inspira/`（动效）、`ui/`（Ds 基础件）、`plugins/`、`brand/`
- 页面 `src/views/`：对话（Chat / Share）、记忆角色（Memory / Soul / User）、配置（Providers / Mcp / Settings / Appearance / Privacy / MaxmaBlocker / Capabilities）、扩展（PluginList / PluginDetail / JetHub / Extension / Rules / Collab）、信息（News / Activity / Metrics / Help / Evolution）、流程（Onboarding / FeatureUnavailable / NotFound）
- 主题：`src/assets/styles/tokens.css`（结构令牌，活规范）+ `src/themes/`（suying 默认 / ultraline / night / kintsugi / grass / midnight，另有 `auto` 解析态）
- Jet Hub 客户端工具：`src/utils/jetHub/`

## 后端（`bun-backend/src/`）

- 装配 `server.ts`；聊天 `routes/chat-ws.ts`、`chat-turns.ts`、`chat-artifacts.ts`
- 会话 `routes/sessions.ts`、`session-compress.ts`、`const-session-store.ts`
- Provider `routes/providers.ts`（凭据信封加密）、`balance.ts`、`services/opencode-zen.ts`
- MCP `routes/mcp.ts`、`mcp-oauth.ts`、`mcp-test.ts`、`mcp-validation.ts`
- Settings `routes/settings.ts`、`settings-panels.ts`、`settings-global.ts`
- 记忆 `routes/memory.ts`；能力 `routes/capabilities.ts`；插件 `routes/plugins.ts` + `plugins/`
- 贴纸 `routes/stickers.ts`、`sticker-upload.ts`、`sticker-favorites.ts`；人设 `persona.ts`；引导 `onboarding.ts`；动态 `news.ts`；规则 `rules.ts`；工具清单 `tools.ts`
- 可观测 `routes/activity.ts`（SSE）、`metrics-route.ts`、`metrics.ts`、`diagnostics.ts`、`error-collector.ts`、`health.ts`、`runtime-status.ts`、`audit-log.ts`、`transcripts.ts`
- 其他 `files.ts`、`upload.ts`、`collab.ts`、`deferred-runs.ts`、`restart.ts`、`maxma-blocker.ts`、`workflows.ts`、`core.ts`
- 安全 `auth.ts`、`middleware/{auth,rate-limit,request-log}.ts`、`security/credential-envelope.ts`
- 路径与存储 `app-paths.ts`、`config-settings.ts`、`cors-config.ts`、`app-version.ts`、`db/core.ts`（bun:sqlite，v1–v10 迁移）、`yaml-store.ts`

## 引擎（`bun-sidecar/src/`）

- `kernel/bridge-pi.ts`：`handlePiCreateSession` / `handlePiSessionRpc`（后端 in-process 直调）
- 支撑：`kernel/{pi-session,prompt,events,approval-gate,plan,goal,mcp,model,tools,skills,plugin-models,opencode-zen,persona-prompt,engine-info}.ts`、`kernel/extensions/`（maxma-approval / maxma-blocker）
- 自定义工具：`tools/`；RPC 类型：`rpc-types.ts`；拒止锚纯函数：`blocker.ts`
- `session-bridge.ts` 是旧 stdio 入口，**无运行时调用方**，仅契约测试引用
- 测试：`bun-sidecar/tests/`

## 契约与规范

- [docs/security-contract.md](docs/security-contract.md) — 安全边界
- [docs/contracts/agent-rpc.md](docs/contracts/agent-rpc.md) — kernel RPC 方法面
- [docs/contracts/ws-events.md](docs/contracts/ws-events.md) — WS 事件词表
- [dev_docs/build-and-artifacts.md](dev_docs/build-and-artifacts.md) — 构建与产物（唯一事实源）
- [dev_docs/conventions/git-conventions.md](dev_docs/conventions/git-conventions.md) — 提交与分支规范
- [dev_docs/permission-modes.md](dev_docs/permission-modes.md) — 权限模式
- [docs/brand-guidelines.md](docs/brand-guidelines.md) — 品牌唯一事实源
- [dev_docs/adr/](dev_docs/adr/) — 决策记录（0001 运行时状态、0003 子任务、0004 权限模式、0005 远程与沙箱、0006 Artifact）

## 开发命令

```text
install.bat / start.bat
cd bun-backend && bun run src/server.ts     # :8000
cd web && npm run dev                        # :5173
cd bun-backend && bun test                   # 后端
cd bun-sidecar && bun test                   # 引擎
cd web && npx vitest run                     # 前端
bash scripts/verify-all-gates.sh             # 交付前全部闸门
```

## 打包

| 形态 | 命令 | 产物 |
| --- | --- | --- |
| 后端 bundle | `build\build-server.bat` | `dist\bun-server\`（两条链的共同输入） |
| Web 便携包 | `build-portable.bat` | `..\MaxmaHere-Portable\` |
| Electron 桌面包 | `powershell -File build-desktop-portable.ps1` | `dist\electron-portable\MaxmaHere-<版本>-portable-x64.zip` + `.sha256` |

产物结构、`externals.json` 契约、插件栈为何不进 bundle、踩坑与验证脚本见
[dev_docs/build-and-artifacts.md](dev_docs/build-and-artifacts.md)。
**构建产物不进版本控制**，交付靠"重建 + 拷走"。

## 版本事实

`version.py` 为单一数据源；发布前核对 `version.py`、`web/package.json`、`desktop/package.json`、`portable.flag` 与 Git tag。
