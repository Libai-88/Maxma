# MaxmaHere 交接说明

> 当前可执行状态，供下一位接手者。架构请先读 [docs/00-当前架构.md](docs/00-当前架构.md)。
> 更新时间：2026-11-02（分支 `feat/jet-hub-plugin`，`version.py` = v2.6.12）

## 状态

- 仓库 `https://github.com/Libai-88/Maxma.git`，主分支 `main`；插件面已于 PR #3 squash 合入
  （`feat/jet-hub-plugin` 随之删除）。别在文档里写"领先 N 个提交"这类当场过期的数，
  要核对就现跑 `git rev-list --left-right --count origin/main...HEAD`。
- 版本 **v2.6.12**：`version.py` / `web/package.json` / `desktop/package.json` / 便携包
  `portable.flag` 四处一致，两种便携包已由该提交重建并验证（见 build 文档 §6.1 的四步验证）。
- 引擎 `@earendil-works/pi-coding-agent` **0.99.0**（in-process）。**落后上游 11 个版本**（latest 1.4.0），
  其中 1.0.3 与 1.2.0 自带 Breaking Changes（1.0.3 把 Azure provider 由 `azure-openai-responses` 改名 `azure`，
  命中 `bun-sidecar/src/kernel/model.ts` 的硬编码白名单）。
  升级入口 `node scripts/upgrade-pi.mjs --check` / `... 1.4.0`（两个 workspace 一起 bump + overrides + 自动验证 + 失败回滚）。
  旧的 `upgrade-omp.mjs` / `verify-omp-settings.mjs` 已删除（查的是另一个仍在发版的 `@oh-my-pi` scope，且失败时退出码为 0）。
- 分发形态：Web 便携包 + Electron 桌面便携包。**构建产物不进版本控制**，交付靠"重建 + 拷走"，
  步骤与踩坑见 [dev_docs/build-and-artifacts.md](dev_docs/build-and-artifacts.md) §6.1。

## 唯一 Agent 路径

```text
web -> Bun 后端 /ws/chat/{session_id} -> kernel in-process -> pi AgentSession
```

改聊天功能按序检查：`web/src/composables/useChat.ts` → `bun-backend/src/routes/chat-ws.ts` →
`bun-backend/src/server.ts`（`callKernelRpc`）→ `bun-sidecar/src/kernel/bridge-pi.ts` → 三侧测试。
插件渠道的模型仍走这条路径，只是 provider 不在 `providers.yaml` 里，需先问 `isPluginProvider()`。

## 测试基线

> 数字随每次加测试变化，**权威是跑一遍的结果**（或直接 `bash scripts/verify-all-gates.sh`，判定按退出码）。
> 下列为 2026-11-02 实测。

```text
引擎  cd bun-sidecar && bun test            122 pass / 0 fail（13 文件）
引擎  cd bun-sidecar && bun x tsc --noEmit  0 error（CI 硬门槛）
后端  cd bun-backend && bun test            253 pass / 0 fail（37 文件）
类型  node scripts/check-type-budget.mjs    sidecar 0 / backend 0（只准减）
前端  cd web && npx vitest run              572 pass / 0 fail（64 文件）
前端  cd web && npx vue-tsc --noEmit        0 error
前端  cd web && npm run lint                0 error / 20 warning
前端  cd web && npm run lint:colors         160 个 Vue 文件 0 违规
端到端 bash scripts/smoke-e2e-roundtrip.mjs 退出码 0（需后端在跑）
```

阶段二 Python→Bun 直译遗留的 86 个后端类型错误已全部清零，两侧基线均为 0 并作为硬门槛进 CI。

## 交付前闸门

```text
bash scripts/verify-all-gates.sh
  # sidecar bun test + tsc / backend bun test / web vitest + vue-tsc + eslint + 硬编码色
  # 类型债棘轮 / 后端 bundle
```

端到端回合冒烟（验证 `web → WS → kernel → pi → provider → SSE 回流` 整条链）：
`scripts/smoke-e2e-roundtrip.mjs` **本地起一个假的 OpenAI 兼容服务**并注册成临时渠道，
不花额度、不依赖外网、不受免费渠道配额影响，跑完自动清理临时会话与渠道。

其余真实形态验证：`scripts/verify-portable-user-path.mjs`（便携包首启人格/免费渠道）、
`scripts/verify-desktop-render.ps1`（桌面包渲染层）、`scripts/verify-ui-chat-roundtrip.mjs`（真实前端打字→发送→收到回复，零额度）。

## 常用命令

```text
install.bat / start.bat                       # 一键安装 / 一键启动（后端 :8000 + 前端 :5173）
cd bun-backend && bun run src/server.ts       # 单独起后端
cd web && npm run dev                         # 单独起前端
build\build-server.bat                        # 后端 bundle → dist\bun-server
build-portable.bat                            # Web 便携包 → ..\MaxmaHere-Portable
powershell -File build-desktop-portable.ps1   # Electron 桌面便携包
node scripts/check-type-budget.mjs --write    # 类型债下降后下调基线（只准降）
```

## 当前限制

- MCP 配置热重载需 `reload_mcp_for_session` 或新建会话。
- **内置免费渠道**：协议已按上游 V2 修正（端点 `/inference/v1`、不发 `x-opencode-request`、
  门禁工具只带 `read` 且带完整 schema、补齐 affinity 头），兜底链扩到 4 个候选并走完整条链
  （`nemotron-3.5-lightning-free` → `deepseek-v4.1-flash-free` → `glm-5.3-flash-free` → `nemotron-3.5-super-vl-free`）；
  全败时回放主模型终态帧（不再静默卡超时）。**本机额度当前耗尽**（上游 429，非代码问题）。
  `beam-free` / `space-bunny-free` 已记入 `FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS` 显式拒绝。
  仍开放的产品判断：兜底是否按额度/地区动态挑选（现为固定顺序）。
- 自动化功能已随旧后端下线（`automation.enabled=false`）；恢复需基于 Bun 重写，属独立工作项。
- **Agent 任务中心（后台子任务）在 pi 引擎下无数据来源**：唯一落库点消费 `deferred_subagent_submitted`，
  而引擎侧从不发该事件（pi 无子 Agent 运行时）。入口已按能力门控隐藏（Dock + 路由 `meta.feature`），
  登记在 `pi-contract.ts` 的 `ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED`，由 `engine-boundary.test.ts` 双向校验。
  `deferred-runs` 三个 REST 端点仍挂载，供未来接上执行侧复用。
- 插件网络安装面刻意未开；`/kb` 知识库路由已移除；Memory 事件未实现（pi memory 独立运行，不发事件）。

## 已修（2026-11-02，均有回归锁）

| 缺陷 | 修法 | 锁 |
| --- | --- | --- |
| 权限模式 UI 断链：REST 回 `enabled`，前端读 `permission_modes_enabled`（后端从不产出）→ 控件恒禁用，用户切换被静默吞掉 | REST 与前端类型同源，改回 `{session_id, permission_mode, available_permission_modes}`，控件按服务端列表渲染选项 | `bun-backend/tests/permission-mode-contract.test.ts`（含四处档位清单双向对账） |
| **同一条链上的提权**：PUT 后补发 `update_auto_approve`，而 `set_auto_approve` 是 `auto`/`ask` 两态 → 选 `operate` 被升成 `auto`（绕过审批），选 `read_only` 被退回 `ask` | 删掉补发。PUT 本就经 in-process `set_permission_mode` 改运行中会话的 `record.permissionMode`，补发是 Python/sidecar 跨进程时代的遗留 | 同上 PERM-LIVE-001：断言 `approvalGate.needsApproval(write)` 随档位真实翻转 |
| 路径白名单层随 Python 整体删除，但 UI 仍向用户宣称它存在（5 处文案 + 1 张无读取方的表 + 2 个死类型） | 文案改为真实机制（拒止锚 + 逐次确认）；`db/core.ts` v1 不再建 `path_whitelist` 表；删 `WhitelistEntry`/`ListWhitelistResponse` | `web/tests/pathWhitelistClaims.spec.ts`（挂载扫可见文本 + 历史谎话负控）、`bun-backend/tests/db-schema.test.ts`（老库升级路径） |
| 事件静默丢弃：`useChat.ts` 的 switch 无 `default` | 入口守卫 + `default` 告警 + `SERVER_EVENT_HANDLER_TYPES` 编译期登记表；4 个零消费者的 `workflow_*` 类型从联合删除 | `web/tests/wsEventSink.spec.ts`（含变异测试：往联合加类型而不加 case 会红） |
| `rpc-types.ts` 的 compaction `reason` 手抄清单缺 `manual` | 改为从 `MAXMA_COMPACTION_REASONS_WS` 派生，不再手抄 | `pi-contract.test.ts` 派生形状断言 + `engine-boundary.test.ts` 与前端联合逐字对账 |
| 界面撒谎：`FeatureUnavailableView` 把「引擎做不到」说成「你关掉了」；`browser_tools`/`sub_agents` 面板写了没人读；安装框宣称 npm/GitHub 而 `marketplace=false` | 判定集中在 `describeFeatureAvailability`；无人消费的面板置灰并**拒绝写入**；安装框按 `marketplace` 分支 | `web/tests/capabilityHonesty.spec.ts`、`web/tests/settingsMenuCapability.spec.ts` |
| Electron 包里两处必然 reject 的 Tauri `invoke` | 导出错误日志改浏览器下载；QuickChat 关闭改 `window.close()` + 「已收起」态（`sandbox:true` 下 Electron 不覆写 `window.close`，已核实） | `settingsMenuCapability.spec.ts`、`web/tests/quickChatClose.spec.ts` |
| `Bun Backend` CI 自 10-21 起每次 push 全红（14 项），本地却全绿 | 全是测试对自身环境的隐含假设：写死 `D:\MaxmaTemp`（ubuntu runner 无 D 盘）、`.bat` 的 CRLF 靠本机 `core.autocrlf` 而非仓库保证（补 `.gitattributes`）、persona 用例拷未被跟踪的 `config/personas/SOUL.md`、Skill 安装用例改 `$HOME` 骗 `os.homedir()`（Bun 在 Linux 上不跟随，改走 `getUserSkillsDir()` + `MAXMA_USER_SKILLS_DIR`）。另把 4 处写死的 `"v2.6.11"` 改成与 `appVersion()` 比对 | `bun-backend/tests/_helpers/tmp.ts` + `portable-packaging.test.ts`；CI 已实测转绿 |
| 桌面包 `.sha256` 用两空格（文本模式）+ CRLF，下载方 `sha256sum -c` 对二进制产物必报 FAILED（值其实是对的） | 改 `<hash> *<name>` + `-NoNewline` 显式 LF | `portable-packaging.test.ts`「桌面包的 .sha256 用二进制模式 + LF」，对真实产物断言无 CR、第 65 字节为 ` *`、LF 结尾 |

## 遗留问题（未修，接手时别当成可用功能）

1. **`record.permissionMode` 有两个写入方。** `set_permission_mode`（四档）与 `set_auto_approve`（两态，直接覆盖档位）写同一个字段，而权限模式控件从不 refetch → 拨完「自动执行」开关后，选择器可能显示内核并不在的档位。修法：控件 watch 变化后 refetch，或后端在任一写入路径推 `permission_mode` 事件。
2. **档位清单仍是四份源码副本**（`kernel/types.ts` 类型、`bridge-pi.ts:82` 未导出的 `PI_PERMISSION_MODES`、`routes/sessions.ts`、`web/src/types/session.ts`）。改名会被对账测试当场拦下，但源码层没单源。终态：`MAXMA_PERMISSION_MODES` 进 `pi-contract.ts`，两侧运行时消费（`capabilities.ts:29` 已有同类跨 workspace 先例，不需登记 allowlist）。
3. **工作流执行侧是断的。** `server.ts:230` 用**空 deps** 挂 `createWorkflowRoutes()`，`executeViaKernel` 恒 `undefined`，于是 `mode: "sidecar"` 的定义落进 `executeSimpleStep()` 并因 `Unsupported workflow tool` 失败；kernel 的 `workflow_step_*` 分支只剩直接调 RPC 才够得着。前端也已无任何工作流消费者。详见 [docs/contracts/ws-events.md](docs/contracts/ws-events.md) §4。
4. **Tauri 残骸未清完**：`web/src/utils/env.ts` 的 `detectTauri()`/`tauriFetch`/`get_api_port` 整条死路径（8 个文件经 `tauriFetch` 走它，`envRuntime.spec.ts` 还在测它）、`web/package.json` 仍声明 `@tauri-apps/plugin-http`（`@tauri-apps/api` 只是传递依赖）、`cors-config.ts` 的 `tauri://` origin。两侧形态下 `detectTauri()` 恒 false，所以是**死而不危害**，删除是独立的解耦工作项。
5. **`.omp/skills` 仍在两种便携包里分发，但没人读它。** 13 个 skill 全是上一代引擎内容（`file_read`/`kb_search`/`manage_whitelist`/`run_python`/`git_*` 等 12/13 个引用的是不存在的工具），引擎只加载 `.maxma/skills`（12 个，与之零重叠）。`countOmpSkills()` 把它计成 `anthropic_skills_count`，而该字段唯一的消费方 `web/src/components/StatusBadge.vue` **没有任何地方 import** —— 即一个显示错误数字的死组件。清理要同时动 `build-portable.bat:101`、`build-desktop-portable.ps1:190-191`、`health.ts` 与那个死组件。
6. `PluginListView.vue` 的 `plugins.marketplace` 语义：当前 `false` = 「只启用随包插件」，输入框也只接受随包标识。真要开网络安装，前置是安全评审（下载校验、体积/条目上限、路径穿越、原子落盘），见 `routes/plugins.ts` 的 501 分支。

## 本次文档清理（2026-11-02）

删除 **92 个**版本控制内的过时文件：

| 数量 | 内容 |
| --- | --- |
| 69 | `web/plan-*.md`（一次性实施计划，做完即失效） |
| 5 | `web/` 下的前端评审报告（旧品牌配色 + 已作废分数，HANDOFF 曾列此落差） |
| 12 | `dev_docs/`：路径白名单、沙箱边界、三份迁移计划、插件移植计划、交接记录、五份研究快照、ADR 0002（LTM outbox，代码中无该子系统） |
| 4 | `docs/`：PyInstaller 打包规则 + 3 份 @oh-my-pi 存档 |
| 2 | 根目录：`DESIGN.md`（alpha 存档，已被 brand-guidelines 取代）、空 `package-lock.json` |

另删一份被 `.gitignore` 屏蔽的本地威胁模型文档（`dev_docs/security/` 目录下的
`local-file-security.md`，整篇描述已删除的 Python 文件安全层；因目录被 ignore，
它不会出现在 `git status` 里，极易漏掉），以及空目录 `knowledge_base/`。

重写：`docs/00-当前架构.md`、`docs/security-contract.md`（改为只描述现存检查，
并把"路径白名单已不存在"写进已知缺口）、`docs/contracts/agent-rpc.md`、`docs/contracts/ws-events.md`、
`HANDOFF.md`、`PROJECT_INDEX.md`、`README.md`、`dev_docs/permission-modes.md`、
`dev_docs/conventions/git-conventions.md`（示例换成真实模块，合并流程改为仓内实际的 squash）、
`docs/brand-guidelines.md` §7（指向 `persona-prompt.ts` 真实实现）、`.env.example`
（只保留有读取方的键，删掉 8 个零读取的键）。

顺带清掉 `MAXMA_SERVE_WEB` 的 7 处死注入（两侧源码零读取、零测试断言，
静态托管本就无条件执行）。

新增守卫：`bun-backend/tests/script-encoding.test.ts` 的「文档内的相对链接不得悬空」，
覆盖 `docs/`、`dev_docs/` 与根目录五份文档，两种解析语义（markdown 链接按所在文件、
行内代码路径按仓库根）。已反向验证：插入一条指向已删文档的链接会让它红。

## 变更规则

- 提交前先读 [dev_docs/conventions/git-conventions.md](dev_docs/conventions/git-conventions.md)。
- 安全边界变化必须同步 `docs/security-contract.md` 与测试。
- 结构变化先更新 `docs/00-当前架构.md`。
- 代码与文档冲突时以代码和测试为准，并修正文档。
- `*.bat` 必须保持 CRLF（cmd.exe 无法解析 LF-only）；含中文的 `*.ps1` 必须保留 UTF-8 BOM
  （否则 Windows PowerShell 按 GBK 解码，报出指向 `param()` 的误导性解析错误）。
  由 `bun-backend/tests/script-encoding.test.ts` 守住。
- `docs/` 只放现行规范；废弃文档一律删除（历史用 `git log --diff-filter=D` 取回），
  同测试禁止 `docs/` 下的文档自称废弃。
