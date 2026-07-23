# MaxmaHere 当前交接说明

> 本文件只记录当前可执行状态，不记录已完成迁移的过程。
>
> 完整架构请先读 [docs/00-当前架构.md](docs/00-当前架构.md)。

## 当前状态

- 仓库：`https://github.com/Libai-88/Maxma.git`
- 分支：`main`
- 当前提交：`0d3c3d2f`
- 当前 tag：`v2.7.1`
- Agent 引擎：oh-my-pi v16.5.2
- 后端：FastAPI + Uvicorn
- 前端：Vue 3 + Vite + Pinia + TypeScript
- 桌面：Tauri 2 + Rust

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

## 关键事实

- sidecar 按需启动，不在 FastAPI lifespan 中提前执行 Agent。
- `SessionMap` 保存 Maxma session 与 sidecar session 的映射及有限的回合摘要。
- 完整 Agent 消息通过 sidecar `get_messages` 获取。
- Tauri 端口可能从 8000 回退到其他本地端口，前端必须使用 `ensurePortLoaded()`。
- Tauri HTTP 请求必须使用 `tauriFetch()`。
- 路径白名单、MaxmaBlocker、MCP 命令白名单和 Provider URL 校验属于 Maxma 的安全责任。
- `permission_modes_enabled` 默认关闭时，兼容行为由 sidecar 采用确认优先策略；启用后才使用 session 权限模式分流。

## 数据位置

开发模式使用项目目录；冻结桌面模式使用 `%APPDATA%\\MaxmaHere`。用户数据包括 Provider、认证 Token、SQLite、固定会话、人设、Skill、Macro、上传文件、日志和向量数据。

## 常用命令

```text
python main.py
pytest -q
cd web && npm run dev
cd web && npx vitest run
cd bun-sidecar && bun test
build\\build-server.bat
build\\build-desktop.bat
```

## 当前限制

- MCP 配置热重载不作用于已有 session；需要重建 session。
- 知识库和自治相关部分存在 stub 或受功能开关控制的接口。
- 发布前需要核对 `version.py`、`web/package.json`、Tauri 配置和 Git tag，避免产品版本不一致。

## 变更规则

- 先阅读 [dev_docs/conventions/git-conventions.md](dev_docs/conventions/git-conventions.md)。
- 安全边界变化必须同步更新安全契约和测试。
- 结构变化先更新 [docs/00-当前架构.md](docs/00-当前架构.md)。
- 代码与文档冲突时，以代码和测试为准，并修正文档。
