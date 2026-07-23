![首页](images/%E9%A6%96%E9%A1%B5.png)

# MaxmaHere

> 基于 oh-my-pi 的本地优先 AI Agent 桌面客户端。

MaxmaHere 提供多 LLM Provider、流式对话、Agent 工具、MCP、Skill、人设、记忆、权限审批和 Windows 桌面打包能力。

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
| Agent 引擎 | oh-my-pi v16.5.2，Bun/TypeScript sidecar |
| 后端 | FastAPI + Uvicorn，Python 3.11+ |
| 前端 | Vue 3 + Vite + TypeScript + Pinia |
| 桌面壳 | Tauri 2 + Rust |
| 持久化 | YAML、SQLite、oh-my-pi session、浏览器 localStorage |
| 打包 | PyInstaller + Tauri NSIS |

数据流：

```text
Vue/Tauri -> HTTP/WebSocket -> FastAPI -> JSON-RPC stdio -> Bun sidecar -> oh-my-pi -> LLM/MCP
```

## 开发环境

需要 Python 3.11+、Bun 1.3+、Node.js 18+。构建 Windows 桌面安装包还需要 Rust、Tauri CLI 和 Visual Studio C++ Build Tools。

```bat
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
cd bun-sidecar
bun install
cd ..
```

## 启动与测试

```bat
start.bat
```

```text
后端：python main.py 或 start_dev.py
前端：cd web && npm run dev
桌面开发：build\run-desktop-dev.bat
Python 测试：pytest -q
前端测试：cd web && npx vitest run
Sidecar 测试：cd bun-sidecar && bun test
```

## 构建

```bat
build\build-server.bat
build\build-desktop.bat
```

构建契约检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\test-build-contract.ps1
```

## 当前实现边界

- Agent 推理和工具循环只在 oh-my-pi sidecar 中执行。
- Python 后端是 API、会话和安全策略层，不是 Agent 图执行器。
- MCP 配置变更后，新建 session 才能保证使用最新配置。
- `/kb`、部分旧兼容接口和自治接口仍可能返回 stub/未启用状态，新增功能前先以路由和测试为准。

## License

MIT
