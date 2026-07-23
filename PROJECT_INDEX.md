# MaxmaHere 项目索引

> 这是当前代码导航，不是历史迁移记录。代码、测试和构建脚本与本文档冲突时，以代码和测试为准。
>
> 更新时间：2026-07-23

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
| `tests/` | `pytest -q` | Python 后端、路径、RPC、会话和集成测试 |

## 前端关键位置

- 路由：`web/src/router/index.ts`
- API：`web/src/api/index.ts`
- 聊天连接：`web/src/composables/useChat.ts`
- 会话状态：`web/src/stores/session.ts`
- 聊天状态：`web/src/stores/chat.ts`
- 工具组件注册：`web/src/components/tools/registry.ts`
- 页面：`web/src/views/`
- 设计令牌和主题：`web/src/assets/styles/`、`web/src/themes/`

## 后端关键位置

- 应用工厂：`api/server.py`
- 聊天 WS：`api/routes/chat.py`
- 会话管理：`api/session_manager.py`
- Provider：`api/routes/providers.py`
- MCP：`api/routes/mcp.py`
- 认证：`api/middleware/auth.py`、`api/db/auth.py`
- 路径安全：`api/pi_bridge/security_adapter.py`、`api/routes/path_whitelist.py`
- SessionMap：`api/pi_bridge/session_adapter.py`

## Sidecar 关键位置

- RPC server：`bun-sidecar/src/session-bridge.ts`
- RPC 类型：`bun-sidecar/src/rpc-types.ts`
- Maxma 工具注册：`bun-sidecar/src/tools/index.ts`
- 配置管理工具：`bun-sidecar/src/tools/config/`
- Todoist 工具：`bun-sidecar/src/tools/todoist.ts`

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
```

## 版本事实

当前仓库基线为 `main` / `0d3c3d2f` / `v2.7.1`。运行时版本来源为 `version.py`；发布前需同步核对前端、Tauri 配置和 Git tag。
