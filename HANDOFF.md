# MaxmaHere 当前交接说明

> 本文件记录当前可执行状态，供下一位 Agent 快速接手。
>
> 完整架构请先读 [docs/00-当前架构.md](docs/00-当前架构.md)。迁移过程与决策记录见 [dev_docs/bun-backend-migration-plan.md](dev_docs/bun-backend-migration-plan.md)。

## 当前状态

- 仓库：`https://github.com/Libai-88/Maxma.git`
- 分支：`main`
- Agent 引擎：`@earendil-works/pi-coding-agent` 0.99.0（kernel in-process）
- 后端：Bun + Hono（`bun-backend/`，默认端口 8000）
- 前端：Vue 3 + Vite + Pinia + TypeScript
- 分发形态：Web（后端托管 `web/dist`；便携包 = bun.exe + server.js + 资源）
- 阶段二（Python → Bun 全量迁移）已完成：Python 后端、PyInstaller 打包链、Tauri 桌面壳均已移除（tag `stage-2.6`）

## 唯一 Agent 路径

```text
web -> Bun 后端 /ws/chat/{session_id} -> kernel in-process -> pi AgentSession
```

修改聊天功能时，优先检查：

1. `web/src/composables/useChat.ts`
2. `bun-backend/src/routes/chat-ws.ts`（WS 分发 + 回合富化）
3. `bun-backend/src/server.ts`（callKernelRpc 装配）
4. `bun-sidecar/src/kernel/bridge-pi.ts`（RPC 分发与会话桥）
5. 对应的前端、后端（`bun-backend/tests/`）和引擎（`bun-sidecar/tests/`）测试

## 测试基线

```text
后端：cd bun-backend && bun test        （115/115）
引擎：cd bun-sidecar && bun test        （61/61）
前端：cd web && npx vitest run
便携冒烟：powershell -File build\portable-smoke-test.ps1
```

## 数据位置

开发模式使用项目目录；便携模式使用可执行文件旁 `data/`（`portable.flag` 标记）；标准模式使用 `%APPDATA%\MaxmaHere`。路径解析集中在 `bun-backend/src/app-paths.ts`（惰性 getter，`MAXMA_DATA_DIR` / `MAXMA_BUNDLE_DIR` / `MAXMA_EXE_DIR` 可覆盖）。

用户数据包括 Provider（`api/data/providers.yaml`，API Key 凭据信封加密）、认证 Token（`api/data/maxma.db` auth_tokens 表）、SQLite、固定会话、人设、Skill、Macro、上传文件、日志。

## 常用命令

```text
install.bat                             # 一键安装（Bun 运行时 + 依赖 + .env）
start.bat                               # 一键启动（后端 :8000 + 前端 :5173）
cd bun-backend && bun run src/server.ts # 单独启动后端
cd web && npm run dev                   # 单独启动前端
build\build-server.bat                  # 构建后端 bundle（dist\bun-server）
build-portable.bat                      # 组装 Web 便携包（..\MaxmaHere-Portable）
```

## 当前限制

- MCP 配置热重载需调用 `reload_mcp_for_session` RPC 而非自动检测。
- 自动化功能已下线（capabilities `automation.enabled=false`，前端路由守卫隐藏）；如需恢复基于 Bun 重写为独立工作项。
- 插件系统在当前引擎不可用（REST 桩化：GET 空列表、写操作 501）。
- `/kb` 知识库已废弃（503）。
- Memory 事件未实现（pi memory 独立运行，不发射事件）。
- 发布前需要核对 `version.py`、`web/package.json`、`portable.flag` 和 Git tag，避免产品版本不一致。

## 变更规则

- 先阅读 [dev_docs/conventions/git-conventions.md](dev_docs/conventions/git-conventions.md)。
- 安全边界变化必须同步更新安全契约和测试。
- 结构变化先更新 [docs/00-当前架构.md](docs/00-当前架构.md)。
- 代码与文档冲突时，以代码和测试为准，并修正文档。
- 便携包构建脚本（`*.bat`）必须保持 CRLF 换行——cmd.exe 无法解析 LF-only 批处理。
