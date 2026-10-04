![首页](images/%E9%A6%96%E9%A1%B5.png)

# MaxmaHere

> 基于 pi 引擎的本地优先 AI Agent 客户端（Web 形态分发）。

MaxmaHere 提供多 LLM Provider、流式对话、Agent 工具、MCP、Skill、人设、记忆、权限审批和一键便携打包能力。

## 先读这里

当前架构、数据流、持久化、安全边界、测试和修改导航统一见：

- [docs/00-当前架构.md](docs/00-当前架构.md)
- [PROJECT_INDEX.md](PROJECT_INDEX.md)

安全变更还必须阅读：

- [docs/security-contract.md](docs/security-contract.md)
- [dev_docs/permission-modes.md](dev_docs/permission-modes.md)
- [dev_docs/path-whitelist.md](dev_docs/path-whitelist.md)

## 技术栈

| 层 | 技术 |
| --- | --- |
| Agent 引擎 | `@earendil-works/pi-coding-agent`（Bun/TypeScript，in-process） |
| 后端 | Bun + Hono（`bun-backend/`） |
| 前端 | Vue 3 + Vite + TypeScript + Pinia |
| 持久化 | YAML、SQLite、pi session、浏览器 localStorage |
| 打包 | Bun bundle（`bun.exe` + `server.js`）+ Web 便携包 |

数据流：

```text
Vue -> HTTP/WebSocket -> Bun 后端 -> pi 引擎（in-process）-> LLM/MCP
```

## 快速开始（Windows 一键）

只需两个脚本：

```bat
install.bat   一键安装（Bun 运行时 + 依赖 + 环境配置）
start.bat     一键启动（后端 + 前端，并打开浏览器 http://localhost:5173）
```

首次使用在网页“提供商”页面配置模型：云端服务填写 Base URL 与 API Key，Ollama、vLLM、LM Studio 等本地服务无需 API Key。浏览器访问 `http://localhost:5173`（开发）或 `http://127.0.0.1:8000`（后端直接托管 `web/dist`）即为 web 端。

## 手动搭建（进阶 / 跨平台）

需要 Bun 1.3+、Node.js 18+。

```bat
powershell -File build\prepare-bun.ps1   REM 准备固定版 bun.exe（或全局安装 bun）
cd bun-backend && bun install
cd ../bun-sidecar && bun install
cd ../web && npm ci
```

## 启动与测试

```bat
start.bat
```

```text
后端：cd bun-backend && bun run src/server.ts（默认 :8000）
前端：cd web && npm run dev
后端测试：cd bun-backend && bun test
前端测试：cd web && npx vitest run
引擎测试：cd bun-sidecar && bun test
```

## 构建

```bat
build\build-server.bat    REM 产出 dist\bun-server（server.js + bun.exe + sharp 原生件）
build-portable.bat        REM 组装 Web 便携包到 ..\MaxmaHere-Portable
```

便携包冒烟检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\portable-smoke-test.ps1
```

## 当前实现边界

- Agent 推理和工具循环只在 pi 引擎（kernel）中执行。
- Bun 后端是 API、会话和安全策略层，不是 Agent 图执行器。
- MCP 配置变更后，新建 session 或调用 `reload_mcp_for_session` 才能保证使用最新配置。
- 自动化功能随旧后端下线（capabilities 清单 `automation.enabled=false`）；插件系统在当前引擎不可用（REST 桩化）；`/kb` 知识库已废弃。

## License

MIT
