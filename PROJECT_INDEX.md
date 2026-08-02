# MaxmaHere 项目索引

> 这是当前代码导航，不是历史迁移记录。代码、测试和构建脚本与本文档冲突时，以代码和测试为准。
>
> 更新时间：2026-08-02

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

## 目录导航

| 目录 | 入口 | 责任 |
| --- | --- | --- |
| `web/` | `web/src/main.ts` | Vue 应用、路由、Pinia、REST/WS、主题和工具结果渲染 |
| `api/` | `api/server.py` | FastAPI、鉴权、会话、配置、WebSocket 桥接 |
| `api/pi_bridge/` | `sidecar_manager.py` | Bun 进程、JSON-RPC、SessionMap、事件和安全适配 |
| `bun-sidecar/` | `src/session-bridge.ts` | oh-my-pi session、模型、工具、MCP、审批和 RPC |
| `desktop/` | `src-tauri/src/main.rs` | Tauri 进程管理、端口、资源、WebView2、Job Object |
| `agent/` | `prompts.py` | system prompt、人设加载和上下文组装 |
| `config/` | `settings.py` | 环境变量、端口、超时和权限开关 |
| `build/` | `build-server.bat` | 前端、Bun、PyInstaller、smoke test 和桌面构建 |
| `build/` | `build-portable.bat` | 便携版完整构建流程（prepare-assets → build-server → Tauri → 组装）|
| `build/` | `prepare-assets.ps1` | 资源准备（Phase 3 优化后跳过所有下载）|
| `tests/` | `pytest -q` | Python 后端、路径、RPC、会话和集成测试 |

## 前端关键位置

- 路由：`web/src/router/index.ts`
- API：`web/src/api/index.ts`
- 聊天连接：`web/src/composables/useChat.ts`
- 会话状态：`web/src/stores/session.ts`
- 聊天状态：`web/src/stores/chat.ts`
- 记忆状态：`web/src/stores/memory.ts`
- 工具组件注册：`web/src/components/tools/registry.ts`（覆盖全部 31 个 OMP 内置工具）
- 图标系统：`web/src/components/Icon.vue`（SVG 图标注册中心）
- Inspira UI 组件：`web/src/components/inspira/`（40+ 个动画/交互/视觉组件，详见下方）
- 工具函数：`web/src/lib/utils.ts`（cn() 条件 class 拼接）
- 页面：`web/src/views/`
  - `ChatView` - 对话主界面
  - `MemoryView` - 记忆管理（搜索/筛选/行内编辑/统计）
  - `CapabilitiesView` - 能力仪表盘（配置源优先级/冲突检测/工具/MCP/Provider）
  - `PluginListView` - 插件管理器（安装/卸载/启禁）
  - `ExtensionView` - 扩展管理器（扩展/Skills 发现）
  - `SettingsView` - OMP 设置面板（压缩/重试/工具/推理预算）
  - 更多：`McpView`、`ProvidersView`、`SoulView`、`PrivacyView` 等
- 工具气泡组件：`web/src/components/tools/`
  - 专用气泡：`PythonBubble`、`FilesBubble`、`FileEditBubble`、`ImageBubble`、`AskUserBubble`、`MemoryBubble`、`BrowserBubble`、`SearchBubble`、`TodoBubble`
  - 通用输出：`GenericOutputBubble`（覆盖 bash/launch/ssh/github/lsp/debug 等 16 个工具）
  - 共享工具：`_shared/BubbleChrome.vue`、`_shared/displayNames.ts`
- 设计令牌和主题：`web/src/assets/styles/`、`web/src/themes/`

## 后端关键位置

- 应用工厂：`api/server.py`
- 聊天 WS：`api/routes/chat.py`
- WS 协议常量：`api/ws_protocol.py`（WsEventType / WsMessageType 枚举）
- 会话管理：`api/session_manager.py`
- Provider：`api/routes/providers.py`
- MCP：`api/routes/mcp.py`（含自动发现 `/mcp/discovered`）
- OMP Settings：`api/routes/settings.py`（读写 OMP 运行时配置）
- 记忆：`api/routes/memory.py`（CRUD + 搜索/筛选/统计）
- 能力仪表盘：`api/routes/capabilities.py`（聚合 Settings/工具/MCP/Provider/配置源）
- 插件管理：`api/routes/plugins.py`（CRUD + 安装/卸载/启禁）
- 认证：`api/middleware/auth.py`、`api/db/auth.py`
- 路径安全：`api/pi_bridge/security_adapter.py`、`api/routes/path_whitelist.py`
- SessionMap：`api/pi_bridge/session_adapter.py`
- 事件映射：`api/pi_bridge/ws_event_mapper.py`（验证/丰富 sidecar 事件）

## Sidecar 关键位置

- RPC server：`bun-sidecar/src/session-bridge.ts`
  - 核心 RPC：`create_session` / `prompt` / `cancel` / `destroy_session` / `undo` / `get_messages`
  - 审批 RPC：`user_response`
  - Settings RPC：`get_settings` / `set_settings`
  - 能力探测 RPC：`get_discovered_mcp` / `get_discovered_skills` / `get_discovered_extensions`
  - 插件管理 RPC：`list_plugins` / `install_plugin` / `uninstall_plugin` / `set_plugin_enabled`
  - 事件推送：`mapPiEventToMaxma()` 将 OMP 事件映射为 Maxma WS 事件
  - 审批 UI：`createApprovalUiContext()` 桥接 OMP 审批到前端 UI
- RPC 类型：`bun-sidecar/src/rpc-types.ts`
- 事件类型定义：`MaxmaEvent` 联合类型覆盖全部映射事件
- 自定义工具注册：`bun-sidecar/src/tools/index.ts`（当前返回空数组，全部使用 OMP 原生工具）
- MCP 配置加载：`bun-sidecar/src/session-bridge.ts` 的 `loadConfiguredMcp()` 和 `createConfiguredMcp()`

## 安全和契约文档

- [安全责任契约](docs/security-contract.md)
- [权限模式](dev_docs/permission-modes.md)
- [路径白名单](dev_docs/path-whitelist.md)
- [沙箱边界](dev_docs/sandbox-boundaries.md)
- [运行时状态 ADR](dev_docs/adr/0001-runtime-status-contract.md)
- [权限模式 ADR](dev_docs/adr/0004-permission-modes.md)
- [注册 Artifact 协议 ADR](dev_docs/adr/0006-registered-artifact-protocol.md)
- [Git 规范](dev_docs/conventions/git-conventions.md)

## 开发命令

```text
后端：python main.py
前端：cd web && npm run dev
Python 测试：pytest -q
前端测试：cd web && npx vitest run
Sidecar 测试：cd bun-sidecar && bun test
服务端构建：build\\build-server.bat
桌面构建：build\\build-desktop.bat
便携版构建：build-portable.bat
```

## 便携版打包（onedir 模式）

### 架构概述

PyInstaller 使用 **onedir 模式**（`build/maxma-server.spec`：`exclude_binaries=True` + `COLLECT()`），
Python 运行时和依赖持久化在 `_internal/` 目录，启动无需重复解压。

**性能对比**：
- onefile 模式（旧）：每次启动解压 464MB 到临时目录，耗时 60-90 秒
- onedir 模式（新）：首次解压到 `_internal/` 后持久化，启动 **1-2 秒**

健康检查超时相应从 90 秒降至 30 秒（`desktop/src-tauri/src/main.rs:HEALTH_TIMEOUT_SECS`）。

### 便携版目录结构

```text
MaxmaHere-Portable/ (1.6GB 总体积)
├── maxma-here.exe       26MB   Tauri 主程序
├── maxma-server.exe     13MB   PyInstaller bootloader（轻量）
├── _internal/           1.4GB  Python 运行时 + bun-sidecar node_modules（持久化，勿删）
├── portable.flag               便携模式标记（app_paths.py / main.rs 共同契约）
├── data/                       用户数据（配置、日志、数据库、上传等）
├── resources/
│   ├── runtime/         158MB  Node + Python + uv 嵌入式运行时
│   ├── assets/          空目录 按需下载资源（Puppeteer 浏览器等）
│   └── default-config/  4KB    默认 MCP 配置模板
└── dist/                25MB   前端静态文件
```

### 体积优化历史

**Phase 1 - 清理 Python 无用依赖**：
- 移除 chromadb + onnxruntime（知识库功能已废弃，`api/routes/kb.py` 返回 503）
- `constraints.txt` 阻断安装：`chromadb==0` / `onnxruntime==0`
- 减少 50+ 传递依赖，Python 侧从 464MB 降至 ~200MB

**Phase 2 - onedir 模式优化启动**：
- `build/maxma-server.spec`：`exclude_binaries=True` + `COLLECT()`
- 避免每次启动重复解压，从 60-90 秒降至 1-2 秒
- 健康检查超时从 90 秒降至 30 秒

**Phase 3 - 移除预打包资源改按需下载**：
- 删除 Playwright Chromium (690MB) - oh-my-pi 使用 Puppeteer 而非 Playwright
- 删除 ONNX 嵌入模型 (463MB) - 知识库功能已移除
- `build/prepare-assets.ps1` 跳过 Playwright 和 ONNX 下载
- Puppeteer 首次使用浏览器时自动下载到用户目录
- 总体积从 2.7GB 降至 1.6GB（节省 1.1GB / 41%）

### 依赖策略

**Python 侧**：
- ❌ 已移除：chromadb, onnxruntime（知识库废弃）
- ✅ 保留：FastAPI, uvicorn, pydantic 等核心依赖

**bun-sidecar node_modules (1.2GB)**：
- ✅ **完整保留** oh-my-pi 上游依赖，符合品牌前端定位
- 包括：@oh-my-pi/* 全系列包、@huggingface/transformers、onnxruntime-node、puppeteer-core 等
- 跨平台原生模块（@oh-my-pi/pi-natives-*）虽然占空间但为上游功能，不删除

**资源文件**：
- ❌ 不再预打包：Playwright 浏览器、ONNX 模型
- ✅ 按需下载：Puppeteer 浏览器（首次使用时自动下载）
- ✅ 嵌入打包：Node/Python/uv 运行时（158MB，离线可用）

### 打包注意事项

1. **必须使用项目 .venv**：
   ```bash
   .venv\Scripts\python.exe -m PyInstaller build\maxma-server.spec --clean
   ```
   使用全局 Python 会引入环境外依赖，导致体积膨胀。

2. **资源准备**：
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-assets.ps1
   ```
   目前跳过所有下载（Phase 3 优化），仅用于未来扩展。

3. **验证构建产物**：
   - `build/dist/maxma-server/` 应包含 `maxma-server.exe` + `_internal/` 目录
   - `desktop/src-tauri/target/release/resources/` 应为 158MB（不含 models/ 和 playwright/）

4. **废弃路径标记**：
   - `app_paths.py`: `PLAYWRIGHT_BROWSERS_PATH` 和 `ONNX_MODEL_PATH` 标记为 DEPRECATED
   - 代码中可能仍有引用但不实际使用，保留以避免破坏性更改

## 版本事实

当前仓库基线为 `feat/gsap-signature-animations` / `80e1c07f` / `v2.6.6`。运行时版本来源为 `version.py`；发布前需同步核对前端、Tauri 配置和 Git tag。

**最近增强**（2026-08-02）：
- ✅ Inspira UI 全面集成 — 40+ 组件 + 8 页面改造
  - 新增组件：AuroraBackground, GlareCard, FloatingCard, NumberTicker, Sparkles, AnimatedModal 等 40+ 个 Inspira 组件
  - 页面改造：SettingsView, CapabilitiesView, MemoryView, NewsView, MetricsView, ActivityView, HelpView, WelcomeScreen
  - 全局优化：极光背景、光束连接线、流星效果、鼠标感应发光、分层模糊、边框呼吸动画
  - 修复：移除 Carousel3D 改用 AnimatedModal；修复动画层遮挡开关按钮问题

**前置增强**（2026-07-27）：
- ✅ 配置透明度 — 能力仪表盘 `CapabilitiesView` + `GET /api/capabilities`
- ✅ 工具 UI 覆盖 — 31/31 OMP 内置工具均有专用气泡组件
- ✅ 记忆系统 UI — 搜索/类别筛选/置信度过滤/行内编辑/统计
- ✅ 插件管理 — `PluginListView` + RPC 插件安装/卸载/启禁
- ✅ 扩展管理 — `ExtensionView` + Sidecar 扩展发现 RPC
- ✅ 配置源可视化 — 13 个来源优先级排列 + 文件实态检测 + 冲突检测
- ✅ 上下文压缩增强 — `context_compressed` 事件增加 `will_retry`/`error_message`

**前置优化**（2026-07-26）：
- ✅ 代码质量修复（WS 协议枚举化、错误分类 bug、常量化）
- ✅ 启动性能优化（60-90秒 → 1-2秒，Phase 1+2）
- ✅ 便携版体积优化（2.7GB → 1.6GB，Phase 3）

关键 commits：
- `80e1c07f` - Inspira UI 全面集成 — 40+ 组件 + 8 页面改造
- `e047d2d9` - snapshot current state before Inspira UI integration
- `bca53c84` - 用 Canvas 有机贝塞尔流体背景替换 CSS 模糊液态背景
