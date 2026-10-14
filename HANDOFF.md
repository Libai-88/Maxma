# MaxmaHere 当前交接说明

> 本文件记录当前可执行状态，供下一位 Agent 快速接手。
>
> 完整架构请先读 [docs/00-当前架构.md](docs/00-当前架构.md)。迁移过程与决策记录见 [dev_docs/bun-backend-migration-plan.md](dev_docs/bun-backend-migration-plan.md)。

## 当前状态

- 仓库：`https://github.com/Libai-88/Maxma.git`
- 分支：`main`（当前开发基线：`feat/jet-hub-plugin`，含插件面，尚未合入 main）
- 版本：`v2.6.11`（`version.py` / `web/package.json` / 便携包 `portable.flag` 三处一致）
- Agent 引擎：`@earendil-works/pi-coding-agent` 0.99.0（kernel in-process）
- 后端：Bun + Hono（`bun-backend/`，默认端口 8000）
- 前端：Vue 3 + Vite + Pinia + TypeScript
- 分发形态：**Web 便携包**（后端托管 `web/dist`）与 **Electron 桌面便携包**（`desktop/`，electron 44.5.1）
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

插件渠道的模型在 pi 侧解析后，**仍走上面这条路径**；只是 provider 不在 providers.yaml 里，
所以 `chat-ws` 要先问 `isPluginProvider()` 再决定是否放行（详见下方「插件子系统」）。

## 测试基线

> 数字为 2026-10-09 在 `feat/jet-hub-plugin` 上实测结果，不是估计值。

```text
后端：cd bun-backend && bun test        （223 pass / 0 fail，33 个测试文件）
引擎：cd bun-sidecar && bun test        （83 pass / 0 fail，10 个测试文件）
前端：cd web && npx vitest run         （411 pass / 0 fail，52 个测试文件）
便携冒烟：powershell -File build\portable-smoke-test.ps1
```

> 注：本文档早期版本记录的后端 115 / 引擎 61 已被插件面带来的新增测试取代。

## 插件子系统（当前分支的重点）

- 注册表：`bun-backend/src/plugins/registry.ts`；DSH 宿主：`bun-backend/src/plugins/dsh/`
- 内置插件：`codearts-auth`（展示名 **Jet Hub**），默认启用
- REST 面：`routes/plugins.ts`（注册表 CRUD + providers/models 列表 + toggle + install）
- 插件自己的 RPC 面：`POST /api/jet-hub`（`plugins/dsh/http-bridge.ts` 通用转发，路径由插件给出）
- 前端：`views/JetHubView.vue`、`stores/jetHub.ts`、`utils/jetHub/**`；路由 `/plugins/:name/jet-hub`
- 数据：数据目录 `plugins/`（`registry.json` + `plugins/dsh/`），经 `DSH_HOME` / `DSH_JET_HUB_STATE_DIR` 注入，不写 `~/.dsh`
- 移植范围、未接方法的归属与踩坑记录：`dev_docs/codearts-plugin-integration-plan.md`
- 覆盖守卫：`bun-backend/tests/plugins/jet-hub-coverage.test.ts` 从插件分派器现读方法名做差集，插件升级新增方法会红

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
- 插件的**网络安装面**刻意未开：`POST /api/plugins/install` 只启用已随包分发的插件，未知插件返回拒绝；真正的网络安装需先过安全评审。
- 插件方法面有 8 个方法未接，均为形态/策略/重复问题（功能缺口为 0），逐项归属见移植计划 §8。
- `/kb` 知识库路由已移除。
- Memory 事件未实现（pi memory 独立运行，不发射事件）。
- 发布前需要核对 `version.py`、`web/package.json`、`portable.flag` 和 Git tag，避免产品版本不一致。

## 已知文档落差

- `web/UI_UX_REVIEW.md`、`web/FRONTEND_AUDIT_2026-08-09.md`、`web/DESIGN_ENG_REVIEW.md` 等前端评审报告写于
  旧品牌（远山青/粉红配色、12 主题）与旧插件状态（桩化）之下，**结论已过期**，不可直接引用其中的分数与 P0 建议。
  现行视觉规范见 `docs/brand-guidelines.md`（朱砂 + 宣纸、6 主题）。

## 前端 token 现状（已修复，勿回退）

对话气泡与状态色文字曾经不可读，已修复并由 `web/tests/themeTokens.spec.ts`（7 条）锁住：

- **用户气泡曾与 AI 气泡同色**（旗舰 `suying` 对比度 1.00）。根因是 `--user-bubble-solid` 回落到
  上一代品牌的 `--accent-pink`（只有 `midnight` 一个主题定义）。现在全局兜底是 `var(--accent)`，
  6 个主题均 ≥1.2，文字对比度均 ≥4.5。
- **`--accent-pink` 曾被两个动效组件消费**（`LiquidBackground` / `ThinkingWave`）但只有 1/6 主题定义它
  ——「随主题变色」实际是「除子夜外一律紫」。现由 `web/src/utils/themeColor.ts` 的 `deriveAltHue()`
  从当前 `--accent` 派生。
- **状态色作文字偏淡**（藤黄在宣纸底 2.34:1）。新增 `--status-*-text`（向 `--text-primary` 靠拢 30% 的
  `color-mix`），24 组实测最差 4.71:1；**作背景/描边时仍用原 token**。
- 遗留的 `--user-bubble` / `--user-bubble-bg` 已无消费点并从主题中删除。
- **深色主题弹窗文字不可见（MODAL-THEME-001）**：`AnimatedModalBody` 的玻璃底曾用
  `color-mix(--text-inverse 8%, transparent)`，而 `SettingsModalContent` 的正文也一律用
  `--text-inverse` —— 同源同色，对比度 1.00。**明色主题当时同样是 1.06~1.13，只是白底白字更难察觉。**
  修法：玻璃底改从 `--bg-raised`/`--bg-card` 派生（掺 8% `--accent` 保留色相），
  正文改 `--text-primary`/`--text-secondary`；`rgba(255,255,255,…)` 硬编码一并换成 token。
  顺带提亮了 `midnight`/`night` 的 `--text-secondary`（原值在弹窗卡片面上仅 3.18 / 4.05）。
- **`--text-inverse` 的语义边界**：只用于「实底色块之上」（如 accent 按钮白字），
  不可当作压在页面/玻璃上的正文色；深色媒体浮层（`MediaViewer` 等）属正当用法，已在测试白名单里。

新增主题时先跑 `cd web && npx vitest run tests/themeTokens.spec.ts`：必填 token、对话可辨性、
状态色文字对比度都会当场报出。

## 变更规则

- 先阅读 [dev_docs/conventions/git-conventions.md](dev_docs/conventions/git-conventions.md)。
- 安全边界变化必须同步更新安全契约和测试。
- 结构变化先更新 [docs/00-当前架构.md](docs/00-当前架构.md)。
- 代码与文档冲突时，以代码和测试为准，并修正文档。
- 便携包构建脚本（`*.bat`）必须保持 CRLF 换行——cmd.exe 无法解析 LF-only 批处理。
