# MaxmaHere 当前交接说明

> 本文件记录当前可执行状态，供下一位 Agent 快速接手。
>
> 完整架构请先读 [docs/00-当前架构.md](docs/00-当前架构.md)。迁移过程与决策记录见 [dev_docs/bun-backend-migration-plan.md](dev_docs/bun-backend-migration-plan.md)。

## 当前状态

- 仓库：`https://github.com/Libai-88/Maxma.git`
- 分支：`main`（当前开发基线：`feat/jet-hub-plugin`，含插件面，尚未合入 main）
- 版本：`v2.6.11`（`version.py` / `web/package.json` / 便携包 `portable.flag` 三处一致）
- Agent 引擎：`@earendil-works/pi-coding-agent` 0.99.0（kernel in-process）。
  **落后上游 11 个版本**：上游 latest = **1.4.0**（2026-10-21 发布），0.99.0 之后已跨 **1.0 大版本**，其中 **1.0.3 与 1.2.0 自带 `### Breaking Changes`**（1.0.3 将 Azure provider 由 `azure-openai-responses` 改名 `azure`，命中 `bun-sidecar/src/kernel/model.ts:48` 的硬编码白名单）。
  **「精确锁定 0.99.0」曾经只对 3 个直接包成立**：pi 0.99.x 对家族包声明 `^0.99.0`，两把锁实测漂出过两套版本（backend 的 chord/pi-codemode/pi-mcp/pi-telemetry/pi-tui = 0.99.1，sidecar 同批 = 0.99.0），而 `bun-backend/bun.lock` 还被 `.gitignore` 的 `*.lock`（本意是忽略运行时文件锁）吞掉过，CI 的 `--frozen-lockfile` 无锁可冻。现已：两处 `package.json` 各加 `overrides` 把 8 个 `@earendil-works/*` 钉成同一版本、`bun-backend/bun.lock` 收编入库、由 `bun-sidecar/tests/engine-boundary.test.ts` 校验「两 workspace 直接依赖同版本 + 两把锁解析版本逐包相等 + 两把锁都被跟踪」。
  三件套在两个 workspace 各锁一份（`bun-backend/package.json`、`bun-sidecar/package.json`），升级必须同步动两处 + 两把锁 —— 用 `node scripts/upgrade-pi.mjs`（旧 `upgrade-omp.mjs` 已删除，它查的是另一个还活着的 `@oh-my-pi` scope 且只动一个 workspace）。
  引擎消费面（用到的导出符号、事件名、工具名、settings 键、provider api）的**单一数据源是 `bun-sidecar/src/kernel/pi-contract.ts`**，由 `tests/pi-contract.test.ts`（对账已安装的 pi 包）与 `tests/engine-boundary.test.ts`（对账边界纪律与三侧清单）双向校验，升级前对着它核对，不要靠 grep 全文。
- 后端：Bun + Hono（`bun-backend/`，默认端口 8000）
- 前端：Vue 3 + Vite + Pinia + TypeScript
- 分发形态：**Web 便携包**（后端托管 `web/dist`）与 **Electron 桌面便携包**（`desktop/`，electron 44.5.1）。
  ⚠️ **构建产物不进版本控制**（`dist/**` 与父仓的 `MaxmaHere-Portable/` 都在 `.gitignore`）——
  `git clone` 拿不到便携包，交付必须"重建 + 拷走"。完整步骤、易踩点与验证脚本见
  [dev_docs/build-and-artifacts.md](dev_docs/build-and-artifacts.md) §6.1。
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

> 数字为 **2026-10-27**（引擎契约守卫落地后）在 `feat/jet-hub-plugin` 上实测结果，不是估计值。
> 演进轨迹：115/61（插件面前）→ 227/83（`c79a8b5` 任务中心）→ 本次 +9 条设置语义测试 / +21 条守卫测试；前端 451 → 472 → 509（工具映射 33 条 + 门控 4 条 + Agent 守卫若干）。

> 下列数字为 2026-10-27 实测；**它们会随每次加测试而变化**，所以每条都给了现测命令，
> 别把这些数字当权威——权威是跑一遍的结果（或直接 `bash scripts/verify-all-gates.sh`）。

```text
后端：cd bun-backend && bun test        （240 pass / 0 fail，35 个测试文件，26.5s）
引擎：cd bun-sidecar && bun test        （108 pass / 0 fail，12 个测试文件， 5.7s）
前端：cd web && npx vitest run         （509 pass / 0 fail，59 个测试文件，14.4s）
类型：cd bun-sidecar && bun x tsc --noEmit   （0 error —— CI 硬门槛）
      node scripts/check-type-budget.mjs     （sidecar 基线 0 / backend 基线 86，只准减）
前端类型/规范：cd web && npx vue-tsc --noEmit（0 error）· npm run lint（0 error / 20 warning）
              · npm run lint:colors（160 个 Vue 文件 0 违规）
打包：cd bun-backend && bun run build-server.mjs（server.js 21.6MB，externals 23 包自检通过）
便携冒烟：powershell -File build\portable-smoke-test.ps1（退出码 0 = 通过）
桌面包渲染层：powershell -File scripts\verify-desktop-render.ps1（验外壳拉起后端 + 渲染层连上 WS）
便携包用户路径：bun scripts\verify-portable-user-path.mjs（首启人格列表/切换、免费渠道模型）
端到端回合：bash scripts/smoke-e2e-roundtrip.mjs（需后端在跑，见「常用命令」）
一次性复跑全部上述项：bash scripts/verify-all-gates.sh（判定按退出码，不按输出字符串）
```

> ⚠️ `bun-backend` 的 86 个 tsc 错误是阶段二 Python→Bun 直译遗留的**历史欠债**（含测试文件），
> 从未进过 CI 所以悄悄攒下；本次用棘轮锁住（`dev_docs/typecheck-baseline.json`），新增即红。
> 引擎边界所在的 `bun-sidecar` 已清零并作为硬门槛进 `.github/workflows/sidecar.yml`。
> 后端侧曾有的真实断裂：`kernel/types.ts` 从 `pi-coding-agent` import 了它并不导出的 `Model`
> ——纯类型 import 被擦除，运行时与测试都察觉不到，只有 tsc 看得见。
> 前端与后端的测试数一直在涨，但**曾经没有一条测到"引擎侧是否真的发出 `deferred_subagent_submitted`"**——
> 现已由 `bun-sidecar/tests/engine-boundary.test.ts` 的「契约事件必须有生产者，或在未生产登记表里有原因」
> 双向校验守住（`MAXMA_ENGINE_WS_EVENTS` vs kernel 生产者 vs `ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED`）。

## Agent 任务中心（后台子任务）

设计意图：对话中派发的子 Agent 会在 `/agent-tasks`（Dock 左侧栏「Agent」）以任务卡片呈现。

> ⚠️ **当前状态（2026-10-27）：这条链在 pi 引擎下没有数据来源，入口已按能力门控关闭。**

> 唯一的落库点是 `chat-ws.ts:483-517` 消费 `deferred_subagent_submitted` 事件的那个 case，而
> `bun-sidecar/src` 全目录 grep `deferred|subagent` **零命中**——引擎侧从不发这个事件（pi 无子 Agent
> 运行时，判据见 `dev_docs/pi-migration-plan.md` §6.0 spike 与 §7.5 对 deferred_runs 的「移除」处置）。
> 因此 `deferred_runs` 表恒空；`cancel_deferred_run` 也无 handler（落 `bridge-pi.ts` 末尾的
> `not yet migrated` 兜底分支）。事件与追踪层均为上一代引擎（OMP）遗留。
>
> **本次已落地的门控（不要再当成"功能可用"引用）**：
> - 登记处：`kernel/pi-contract.ts` 的 `ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED`（含原因与处置）；
>   由 `tests/engine-boundary.test.ts` 双向校验——契约声明为引擎产出的事件若既无生产者又未登记，红；
>   登记为"不产出"却查出生产者，也红（清单不许骗人）。
> - `capabilities.features.sub_agents` 现为 `{ enabled: 面板开关 && engine_supported,
>   engine_supported: false, reason: "…" }`：**产品开关与引擎支持度分开表达**，
>   `panel_configs.json` 的 `sub_agents.enabled`（当前 true）只代表用户意图，不代表能力存在。
> - 前端：`Dock.vue` 的 Agent 条目声明 `feature: 'sub_agents'`（能力清单禁用即隐藏），
>   `router/index.ts` 的 `/agent-tasks` 带 `meta.feature`，直达 URL 落「功能不可用」页；
>   由 `web/tests/agentTasksGating.spec.ts` 锁住这三处声明与门控机制本身。
> - 若要真正恢复该功能，需要在 Maxma 侧自建子任务派发并让 kernel 发出该事件（pi 不会提供），
>   然后撤掉这条登记。

以下为该模块的实现细节（描述的是代码结构，不代表功能当前可用）：

- 数据源：`bun-backend/src/routes/deferred-runs.ts` 的三个端点
  （list / get / cancel），前端封装在 `web/src/composables/useAgentTasks.ts`
- 前端：`web/src/views/AgentTasksView.vue` + `web/src/components/agent/*`
- 关键契约：
  - **后端时间戳是秒**（`Math.floor(Date.now() / 1000)`），前端统一换算成毫秒
  - 只有存在 `queued` / `running` 任务时才轮询（4s），全终态后停
  - deferred-runs 三个 REST 端点**恒定挂载**（不受 `features.sub_agents` 影响，路由本身不能用
    `meta.feature` 门控它们）；被门控的是**入口**：`/agent-tasks` 路由带 `meta.feature: 'sub_agents'`、
    Dock 条目带同名 `feature`，`features.sub_agents.enabled` 现由
    `面板开关 && engine_supported` 共同决定。
    ⚠️ 历史坑：本节此前写「`features.sub_agents.enabled` 默认 `false`」——与代码不符；
    实际值取自 `api/data/panel_configs.json`（当前 **`true`**），而引擎侧无生产者。
    **产品开关 ≠ 引擎能力**，两者已拆开表达，勿再复用 `enabled` 判引擎支持度。
  - 端点 404 → 判定「能力不可用」并隐藏面板，不当错误抛给用户
- 隐私边界（ADR 0003）：只消费 `DeferredRun`，**不读**后端记录里的
  `task` / `name`；标题一律用不透明 `run_id` 短串
- 依赖边是**推导**出来的（后端不记录子任务间依赖）：同回合 = 并行，
  相邻回合 = 顺序

## 插件子系统（当前分支的重点）

- 注册表：`bun-backend/src/plugins/registry.ts`；DSH 宿主：`bun-backend/src/plugins/dsh/`
- 内置插件：`codearts-auth`（展示名 **Jet Hub**），默认启用
- REST 面：`routes/plugins.ts`（注册表 CRUD + providers/models 列表 + toggle + install）
- 插件自己的 RPC 面：`POST /api/jet-hub`（`plugins/dsh/http-bridge.ts` 通用转发，路径由插件给出）
- 前端：`views/JetHubView.vue`、`stores/jetHub.ts`、`utils/jetHub/**`；路由 `/plugins/:name/jet-hub`
- 数据：数据目录 `plugins/`（`registry.json` + `plugins/dsh/`），经 `DSH_HOME` / `DSH_JET_HUB_STATE_DIR` 注入，不写 `~/.dsh`
- 移植范围、未接方法的归属与踩坑记录：`dev_docs/codearts-plugin-integration-plan.md`
- 覆盖守卫：`bun-backend/tests/plugins/jet-hub-coverage.test.ts` 从插件分派器现读方法名做差集，插件升级新增方法会红

## 全局设置（2026-10-27 语义修正，行为有变）

`/api/settings` 此前是**三层空转**：写进 `SettingsManager.inMemory()` 单例（不落盘）、
不进任何会话（会话的 SettingsManager 由 pi 自行装配，与那个单例无关）、且不校验键是否存在
（`applyOverrides` 对未知键宽容 → 返回 `{ok:true}` 却什么都没发生）。

现在的规则，改动任何设置项前先看这里：

1. **每个点路径必须先在 `bun-sidecar/src/kernel/pi-contract.ts` 的 `MAXMA_SETTINGS_KEYS`
   登记**，字段是 `engineReal`（引擎里是否真有这个键，由测试对已安装 pi 的
   `settings-manager.d.ts` 现算）+ `consumer`（谁真的消费它）：
   - `"pi"` —— 引擎真实键，会被 `engineSettingsForNewSession()` 下发给**新建会话**；
   - `"maxma"` —— 引擎没有该键，但 Maxma 自己消费（`skills.enabled` 经 create_session 参数、
     `recap.*` 由前端读）；
   - `"none"` —— 无人消费（22 个 OMP 遗留 + `vault.enabled` 等），`PUT` 直接 **409** 带原因。
2. 显式改动持久化到 `api/data/settings_overrides.json`（Maxma 自有格式，不依赖引擎磁盘格式），
   原子 tmp+rename，文件损坏时**拒绝覆盖**（503）而不是清空用户配置。
3. **只转发用户真正改过的键**给会话，没拨过的保持引擎默认值——避免一次改动把整套默认覆盖掉。
4. 面板不再摆无人消费的开关：`GET /api/settings/schema` 返回每一项的归属与支持状态，
   `SettingsView.vue` 的 `CORE_PATHS` 只剩 13 条；由
   `bun-sidecar/tests/engine-boundary.test.ts` 校验「面板每个键都已登记」且「登记为 none 的键
   不许出现在面板上」，后端 `routes/settings.ts` 的键全集也改为从登记表取（不再手抄）。
5. 测试：`bun-backend/tests/settings-contract.test.ts`（9 条，含"重启后可恢复"与两种拒绝路径）。

## 数据位置

开发模式使用项目目录；便携模式使用可执行文件旁 `data/`（`portable.flag` 标记）；标准模式使用 `%APPDATA%\MaxmaHere`。路径解析集中在 `bun-backend/src/app-paths.ts`（惰性 getter，`MAXMA_DATA_DIR` / `MAXMA_BUNDLE_DIR` / `MAXMA_EXE_DIR` 可覆盖）。

**引擎自己的配置目录**：pi 用它自己拼出来的环境变量名定位 agent 目录
（`config.js`：`ENV_AGENT_DIR = ${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`，回落 `~/.pi/agent`），
而 `start.bat:10` / `start-web.bat:12` / `build-portable.bat:143` / `desktop/electron/main.cjs:121`
注入的正是字面量 `PI_CODING_AGENT_DIR`。**上游改这个命名会静默失效**——便携包会把会话/设置/凭据
写进用户主目录，且不报错。因此新增启动自检：`bun-sidecar/src/kernel/engine-info.ts` 的
`agentDirDiagnostics()` 直接问引擎 `getAgentDir()` 解析到哪儿、判断它是否落在 Maxma 数据目录内
（**验结果而不是比字符串**），后端启动时不满足就 `console.error` 喊出来。该状态还出现在
免鉴权的 `/api/health` 的 `engine` 字段（**只作信息字段，不参与 overall 判定**——开发形态下
pi 用 `~/.pi/agent` 是正常的，算成 degraded 会让健康检查天天红）与
`/api/capabilities` 的 `engine.agent_dir_inside_expected`。桌面壳在探活成功后读该字段，
读到 `false` 才 `showErrorBox`（桌面形态一定注入了该变量，false 即真失效；请求失败属于
"未知"，不打扰启动）。注入与校验成对存在，由 `bun-sidecar/tests/engine-boundary.test.ts` 断言。

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

交付前闸门（一次性复跑；判定用**退出码**，不用输出字符串匹配）：

```text
bash scripts/verify-all-gates.sh
  # sidecar bun test + bun x tsc --noEmit / backend bun test
  # web vitest + vue-tsc + eslint + check-hardcoded-colors
  # 类型债棘轮（scripts/check-type-budget.mjs）/ 后端 bundle
```

端到端回合冒烟（验证 `web → WS → kernel → pi → provider → SSE 回流` 整条链路）：

```text
cd bun-backend && bun run src/server.ts                      # 另开一个终端
BASE=http://127.0.0.1:8000 TOKEN=<auth_tokens 里的 token> \
  bun scripts/smoke-e2e-roundtrip.mjs                        # 退出码 0 = 链路通
```

它**在本地起一个假的 OpenAI 兼容服务**并注册成临时渠道，因此不花额度、不依赖外网，
也不受内置免费渠道配额影响（2026-10-27 就是免费渠道被 429 卡住、单测又全都测不到
这条链路，才需要它）。跑完自动删临时会话与临时渠道。

引擎升级入口（替代已删除的 upgrade-omp.mjs / verify-omp-settings.mjs）：
```text
node scripts/upgrade-pi.mjs --check     # 只读：版本差距 + current→target 的 Breaking Changes
node scripts/upgrade-pi.mjs 1.4.0       # 两个 workspace 一起 bump + 家族 overrides + 自动验证 + 失败回滚
node scripts/check-type-budget.mjs --write  # 类型债下降后，下调基线（只准降不准升）
```

## 当前限制

- MCP 配置热重载需调用 `reload_mcp_for_session` RPC 而非自动检测。
- **内置免费渠道（Maxma 免费模型）当前不可用**（2026-10-27 实测，非代码回归）：
  上游 `GET https://opencode.ai/zen/v1/models` 提供 84 个模型、8 个 `-free`，
  但逐个实测（`bun scripts/verify-free-models.mjs`）的结果是：
  **7 个返回 429 `FreeUsageLimitError`**（模型存在、身份被接受，但额度耗尽——
  **无法判定能否出内容，因此不能凭猜测放行**：deepseek-v4.1-flash-free、
  flint-40b-free、glm-5.3-flash-free、jev-1.13-free、
  nemotron-3.5-lightning-free、nemotron-3.5-super-vl-free、mimo-v2.6-flash-free），
  **1 个返回 403 `RegionError`**（`beam-free` — "not available in your country"，
  与额度无关、不会自行恢复）。
  Maxma 侧因此只放行 `mimo-v2.6-flash-free`（日志 `models synced: 1 free models`）。
  - **白名单不扩充是有据的决定**，不是遗漏：7 个待额度恢复后用上述脚本复测；
    `beam-free` 已记入 `FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS`（kernel），
    `isOpenCodeZenModelAvailable()` 显式拒绝——避免将来"上游列表里有它"被顺手放行。
  - 已修掉的两处：`space-bunny-free` 上游已下架却仍作兜底目标（现兜底列表为空，
    触发时 `console.warn` 留痕，不再静默换名重发）；同一模型 id 曾抄在 5 处，
    现已收成 kernel 单源。
  - 仍开放的产品判断：兜底策略应从"硬编码第二个 id"改为"从同步到的可用免费列表
    里选下一个"——需要产品确认语义，本次未擅自改。
- 自动化功能已下线（capabilities `automation.enabled=false`，前端路由守卫隐藏）；如需恢复基于 Bun 重写为独立工作项。
- 插件的**网络安装面**刻意未开：`POST /api/plugins/install` 只启用已随包分发的插件，未知插件返回拒绝；真正的网络安装需先过安全评审。
- **后台子任务（Agent 任务中心）在 pi 引擎下无数据来源**，入口已按能力门控隐藏（见「Agent 任务中心」一节）；`deferred-runs` 三个 REST 端点仍挂载，供未来接上执行侧后复用。
- 插件方法面有 8 个方法未接，均为形态/策略/重复问题（功能缺口为 0），逐项归属见移植计划 §8。
- `/kb` 知识库路由已移除。
- Memory 事件未实现（pi memory 独立运行，不发射事件）。
- 发布前需要核对 `version.py`、`web/package.json`、`portable.flag` 和 Git tag，避免产品版本不一致。

## 已知文档落差

- `web/UI_UX_REVIEW.md`、`web/FRONTEND_AUDIT_2026-08-09.md`、`web/DESIGN_ENG_REVIEW.md` 等前端评审报告写于
  旧品牌（远山青/粉红配色、12 主题）与旧插件状态（桩化）之下，**结论已过期**，不可直接引用其中的分数与 P0 建议。
  现行视觉规范见 `docs/brand-guidelines.md`（朱砂 + 宣纸、6 主题）。
- **`docs/contracts/agent-rpc.md` 与 `ws-events.md` 的「契约源」曾整段指认已删除的 Python 实现**
  （`api/pi_bridge/rpc_client.py`、`api/ws_protocol.py`、`api/routes/chat.py`、`api/routes/settings.py` 今天都不存在）。
  2026-10-27 已校正为 Bun 侧真实实现（`kernel/bridge-pi.ts`、`kernel/events.ts`、`routes/chat-ws.ts`），
  并补「传输现状：in-process，无 stdio 层」。历史教训：这两份文档把 `session_recap` / `execute_workflow_step`
  标为「未迁移」近一个月，而代码早已实现，导致一次解耦调查误判功能不可用——**引用 §8 状态列前先对 `bridge-pi.ts`**。
- **`docs/archive/omp-upgrade-guide.md`、`docs/archive/omp-upgrade-runbook.md`、`docs/archive/omp-capability-gap.md` 已废弃**
  （2026-08 基线，对象是上一代引擎 @oh-my-pi）。三份文件顶部已加告示块并逐条列出失效点；正文保留作历史演练记录。
- **升级工具已重写**：旧的 `scripts/upgrade-omp.mjs` 与 `scripts/verify-omp-settings.mjs` **已删除**
  （前者读旧 scope 依赖键得到 `undefined` 后抛 `TypeError`，且查到的是仍在发版的 `@oh-my-pi` 18.13.1，
  还只 bump `bun-sidecar` 一个 workspace；后者要读的 `settings-schema.d.ts` 在新引擎不存在、
  要解析的 `globalPaths` 也已从源码消失，且**失败时退出码为 0** —— 一条会给出绿灯的死检查）。
  现为 `scripts/upgrade-pi.mjs`：两个 workspace 一起 bump（含 overrides 里的家族包）、
  列出 current→target 之间的 Breaking Changes、跑 tsc + 两份守卫测试 + 两侧 `bun test`、
  升完复查两把锁是否一致，**任何一步失败都非零退出并回滚 package.json**。
  实测：`node scripts/upgrade-pi.mjs --check` → 当前 0.99.0 / latest 1.4.0 / 跨大版本需 `--force` /
  列出 1.0.3 与 1.2.0 的 Breaking 段 / 报「两把锁一致」。
- **类型断层面已补齐**：`bun-sidecar` 的 `bun x tsc --noEmit` 原为 14 个 error，现 **0**，
  并作为硬门槛进入 `.github/workflows/sidecar.yml`（该 workflow 同时还修了覆盖率名单：
  旧 `CORE` 里的 `approval.ts`/`state.ts` 已不存在，真正的引擎接缝 `bridge-pi/plan/goal/pi-session`
  从来没被门槛覆盖过）。`bun-backend` 的 86 个是阶段二直译遗留（含测试文件），
  用棘轮 `scripts/check-type-budget.mjs` + `dev_docs/typecheck-baseline.json` 锁成"只准减"，
  并接进 `bun-backend.yml`。被修掉的真实断裂：`kernel/types.ts` 从 `pi-coding-agent` import
  它并不导出的 `Model`（纯类型 import 被擦除，运行时与测试都看不见）；`tools.ts`/`plan.ts`
  的 `execute` 返回形状与引擎 `AgentToolResult` 不符（`details` 必填 vs 我方选填、
  content 联合被摊平）；MCP config 被我方压成 `Record<string, unknown>` 丢掉可判别性。
- **引擎版本一致性现在有三层守卫**：`bun-sidecar/tests/engine-boundary.test.ts` 断言两 workspace
  直接依赖逐包同版本、两把 `bun.lock` 解析版本逐包相等、两把锁都被版本控制跟踪；`package.json`
  的 `overrides` 把 8 个 `@earendil-works/*` 钉死（上游 0.99.x 用 `^` 声明家族包，不钉就漂）；
  `bun-backend/bun.lock` 已从 `.gitignore` 的 `*.lock` 通配里收编入库。
  `/api/capabilities` 的 `engine` 字段现由 `kernel/engine-info.ts` 报**真实 pi 版本**
  （旧实现展示的是 `maxma-sidecar` 的 0.1.0 产品版本）。
- **`contract-snapshot.test.ts` 的局限仍在，但已被补上**：它喂的是手写合成 pi 事件对象，
  只锁"我方映射不回归"，测不到上游改名。对账已安装包的新守卫
  `bun-sidecar/tests/pi-contract.test.ts`（值导出用运行时 dynamic import、类型导出用包内 d.ts 全集、
  工具名/档位/provider api/settings 键全部与已安装引擎双向差集）与
  `bun-sidecar/tests/engine-boundary.test.ts`（边界纪律、事件生产者对账、三侧清单一致性）
  均已落地，`pi-contract.ts` 的清单不再只是声明。


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
- 含中文的 `*.ps1` 必须保留 UTF-8 BOM（否则 Windows PowerShell 按 GBK 解码，
  报出指向 `param()` 的误导性解析错误）；由 `bun-backend/tests/script-encoding.test.ts` 守住。
