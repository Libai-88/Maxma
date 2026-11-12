# MaxmaHere 交接说明

> 当前可执行状态，供下一位接手者。架构请先读 [docs/00-当前架构.md](docs/00-当前架构.md)。
> 更新时间：2026-11-11（`version.py` = v2.6.13）

## 2026-11-11 前端重写（重要）

`web/` 由 **Vue 3 + Pinia + vue-router + 自研 6 主题/CSS 类体系** 整体重写为
**React 19 + Vite 6 + Tailwind 4 + shadcn/ui（base-nova）+ Solid Glass 材质**；
状态 zustand，路由 react-router-dom v7，图标 lucide-react。视觉身份从「宣纸 + 朱砂」切换为
烟熏玻璃（`docs/brand-guidelines.md` v2.0）。

- **未变**：后端契约（REST/WS 事件词表）、`web/src/api/`、`web/src/types/`、`web/src/utils/`（框架无关，原样沿用）、
  28 条路由与能力门控、双入口（`index.html` / `quick-chat.html` / `splash.html`）、`base: './'`、生产 CSP、便携包/Electron 打包契约。
- **重写**：`stores/`（zustand）、`hooks/useChat.ts`（完整移植 2563 行 WS 链路与 `SERVER_EVENT_HANDLER_TYPES` 登记）、
  全部视图与组件、对话输入/窗口/工具步骤/审批/计划/上下文环（Solid Glass agent 组件）。
- **删除**：`web/src-vue-backup/`、旧 Vue 测试套件（65 文件，随组件重建退役）、`eslint.config.js`（Vue 插件）、
  `scripts/replace-colors.mjs`、`public/splash.js`、6 主题与 34-Token 契约、Inspira 装饰件与页面转场。
- **闸门变化**：`scripts/verify-all-gates.sh` 的 web 段改为 `tsc --noEmit` + `vite build` + 语义色守卫
  （`npm run lint:colors`，脚本已改写为扫描 TSX）；sidecar/backend 闸门不变。
- **跨侧契约测试已适配新架构**（不是放宽，而是对准新位置/新不变量）：
  - `bun-sidecar/tests/engine-boundary.test.ts`：设置面板改读 `SettingsView.tsx`，对账「面板实际读写的每个键
    都必须已登记」；前端测试套件退役后，「前端测试别手抄内置工具清单」改为守护
    「默认启用集 ⊆ 内置集」；工具展示名改读 `web/src/components/tools/_shared/displayNames.ts`。
  - `bun-backend/tests/permission-mode-contract.test.ts`：前端 4 份副本对账改为**单源**对账
    （`types/session.ts` 联合类型 + `PermissionModeControl.tsx` 的 `MODE_ORDER`/`MODE_LABELS`），
    并新增反向扫描：`web/src` 下除这两个文件外出现 ≥3 个档位字面量即红（防第二份真值）。
  - 设置登记表 `recap.enabled` 的 note 路径 `composables/` → `hooks/`。
- **2026-11-11 实测（全部闸门通过）**：sidecar `bun test` 128 pass / 0 fail；sidecar tsc 0 error；
  backend `bun test` 280 pass / 0 fail；web `tsc --noEmit` 0 error；web `vite build` 通过；
  语义色守卫 78 个 TSX 0 违规；类型债棘轮双侧 0；后端 bundle `externals OK`。
- 浏览器实测（构建产物 + mock 后端/假 WS）：25 条路由逐条 SPA 导航 0 控制台错误；
  完整一轮对话（thinking → 工具步骤含 diff → 流式回答 → done）渲染正确；设置开关 PUT 命中登记键；
  权限模式四档渲染并成功 PUT；能力门控在 `sub_agents`/`automation` 关闭时落 `FeatureUnavailableView`
  并原样显示引擎 reason，侧栏入口同步隐藏。
- **真实链路验收（2026-11-11，非 mock）**：
  - `scripts/smoke-e2e-roundtrip.mjs`（假 provider + 真后端/引擎）→ `✅ 端到端链路通`，
    事件 `hello/token×6/answer/done/task_review_update`，累计文本与假服务回复一致。
  - 后端托管新构建产物（`http://127.0.0.1:8000/`）+ 真实引擎：界面选临时 stub 渠道 →
    发送 → 界面渲染 `收到，链路通：新前端 → WS → 后端 → 引擎 → provider → SSE`，
    `task_review_update` 触发「完成后验收」面板，全程 0 控制台错误。验证后已删除临时渠道与会话。
- 诊断出口：`window.__maxma`（只读 store 快照，不含凭据），供便携包无 DevTools 时排查。
- 聊天操作面已补齐（与旧 ChatView 对齐）：斜杠命令 10 条（含参数解析，如 `/goal 完成周报`）/
  附件菜单（图片·文件·文件夹·链接·表情）/ 表情库（全部·最近·收藏）/ 语音输入（Web Speech）/
  上下文占用环 / 自动执行开关 / 权限模式四档 / 选区引用随消息发送 / 工具中文名 / 用户消息内联贴纸 /
  `@工具名` 提及补全（懒加载一次 `/tools`）。
- **贴纸标记统一渲染（2026-11-11 修复）**：`<sticker:category/file.webp>` 此前只有
  用户气泡解析，assistant 回答（模型回显用户消息里的标记）与分享页会露出裸标签。
  现在 `utils/markdown.ts` 的 `expandStickerTags()` 在 markdown 渲染前统一展开为
  `<img src="/api/stickers/...">`（**代码块与行内代码内不展开**），纯文本场合由
  `components/common/InlineStickers.tsx` 渲染；用户气泡与分享页共用后者。
- **贴纸尺寸口径（2026-11-12）**：贴纸库固有尺寸 29×29 ~ 256×256，且含 2.9:1
  宽条；只限高会让小图缩成一角、宽图被拉伸。统一为
  **固定高 96px + 等比 + 最宽 160px + `object-contain`**：
  `components/common/Sticker.tsx`（React 场合）与 `markdown.css` 的
  `.md-sticker img`（markdown 场合）同口径。
  **不要用 `Attachment`/`AttachmentMedia` 承载贴纸**——它的媒体槽是缩略图语义
  （`aspect-square` + `object-cover`），会裁掉宽图/高图。
- **已知简化（非功能缺失，是呈现颗粒度）**：工具结果统一按「步骤 + 输出/补丁」渲染，
  旧版 13 个专用气泡（搜索/待办/Python/浏览器/图片/文件列表…）未逐一对位；输出内容仍在，
  只是不再按工具类型定制版式。`deferred_subagent_submitted` 的内联子任务卡片并入
  `/agent-tasks` 任务中心。若后续要恢复专用版式，位置是
  `web/src/components/chat/ChatWindow.tsx` 的 `toolToStep`。


## 状态

- 仓库 `https://github.com/Libai-88/Maxma.git`，主分支 `main`；变更一律走分支 + PR squash 合入，
  合并即删分支。别在文档里写"领先 N 个提交"或点名某个短期分支（它会消失）——
  要核对就现跑 `git rev-list --left-right --count origin/main...HEAD`。
- 版本 **v2.6.13**：`version.py` / `web/package.json` / `desktop/package.json` / 便携包
  `portable.flag` 四处一致，两种便携包由该提交重建并验证（见 build 文档 §6.1 的四步验证）。
- 引擎 `@earendil-works/pi-coding-agent` **1.5.0**（in-process）。**与上游 latest 持平**
  （2026-11-08 由 0.99.0 受控升级，`scripts/upgrade-pi.mjs 1.5.0 --force`）。
  0.99→1.5.0 之间三段 Breaking 的消费面对账：1.0.3 的 Azure 改名是 **provider 键**
  （KnownProvider 新增 `azure`），api 名 `azure-openai-responses` 从未变——改名表据此清空，
  provider→api 映射在 `kernel/model.ts` 的 `PROVIDER_API_ALIASES`；1.2.0 的 busy 语义、
  1.5.0 的 pi-schema 校验在本仓均无消费点。Settings 字段 1.5.0 起改由 TypeBox schema
  声明（settings-schema.d.ts），`pi-contract.test.ts` 的解析器已随之重写。
  `retry.maxDelayMs` 自 1.5.0 成为真实键（engineReal 翻转）。
  ⚠️ `upgrade-pi.mjs` 修复过一处自身 bug：overrides 里 DIRECT 三件也各有一份钉死，
  bump 必须连它们一起改——只 bump 家族五件会装出「新家族+旧引擎」混合树
  （实测形态：引擎根包在 Bun 下 import 即炸，形似上游断裂，实为工具 bug）。
- 分发形态：Web 便携包 + Electron 桌面便携包。**构建产物不进版本控制**，交付靠"重建 + 拷走"，
  步骤与踩坑见 [dev_docs/build-and-artifacts.md](dev_docs/build-and-artifacts.md) §6.1。

## 唯一 Agent 路径

```text
web -> Bun 后端 /ws/chat/{session_id} -> kernel in-process -> pi AgentSession
```

改聊天功能按序检查：`web/src/hooks/useChat.ts`（`src/stores/chat.ts` 是通道状态）→ `bun-backend/src/routes/chat-ws.ts` →
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
  `beam-free` / `space-bunny-free` / `crouton-alpha-free` 已记入 `FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS` 显式拒绝。
  仍开放的产品判断：兜底是否按额度/地区动态挑选（现为固定顺序）。
- **内置第二免费车道（Kilo 免费池，2026-11-08）**：来自 dsh-our-free-model 插件的免费渠道移植。
  上游 `api.kilo.ai/api/gateway`（Kilo AI 公共网关）免费池**完全免凭据**——主模型
  `kilo-auto/free`（上游自动路由，本身就是兜底，故客户端无换名重发链）+ 10 个实测
  200 的直连候选（kernel `KILO_FALLBACK_MODEL_IDS`，按实测首字延迟排序）；
  传输层唯一特殊动作是**剥掉授权头**（带任何 bearer 值都 401，实测）。
  ⚠️ **隐私**：免费池全部模型卡声明 `mayTrainOnYourPrompts: true`——prompt 可能被
  上游记录用于改进服务，不适合敏感内容。可用性门与 zen 同纪律：实测白名单
  （11/12 免费模型实测可用，`liquid/lfm-3-1.7b:free` 实测 429 无法判定，已显式拒绝）。
  参考实现（MIT）来自 github.com/Ebony-Vinyl/dsh-our-free-model（npm 2.1.0），
  **未整包捆绑**：该插件自带自升级/公告推送/本地网关等敏感能力，与"插件网络安装面
  刻意未开"的纪律冲突；只移植了 Kilo 车道协议（其 OpenCode Zen 车道与内置渠道同池，无增量）。
- **自动化 / 工作流：整条表面已删除（2026-11-02），不存在"待接通"的实现。** 旧的 Bun REST 工作流面
  （`routes/workflows.ts` + kernel `execute_workflow_step` + `workflow_*` 四个事件与登记 +
  前端 `types/workflow.ts` + 打包里的 `workflows/` 目录）只能报失败，已连同其依赖一起移除。
  旧后端那条 `automation.enabled=false` 也随之下线。恢复自动化是**独立工作项**：定义来源、
  执行侧、前端消费者三样都要重新设计，别试图接回这条链（详见 docs/contracts/ws-events.md §4）。
- **Agent 任务中心（后台子任务）在 pi 引擎下无数据来源**：唯一落库点消费 `deferred_subagent_submitted`，
  而引擎侧从不发该事件（pi 无子 Agent 运行时）。入口已按能力门控隐藏（Dock + 路由 `meta.feature`），
  登记在 `pi-contract.ts` 的 `ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED`，由 `engine-boundary.test.ts` 双向校验。
  `deferred-runs` 三个 REST 端点仍挂载，供未来接上执行侧复用。
- 插件网络安装面刻意未开；`/kb` 知识库路由已移除；Memory 事件未实现（pi memory 独立运行，不发事件）。

## 已修（2026-11-02，均有回归锁）

> ⚠️ 2026-11-11 前端重写后，本表中凡以 `web/tests/*.spec.ts`（Vue 组件测试）为锁的行，
> 锁已随组件重建退役；对应的**后端/引擎侧锁**（`bun-sidecar/tests/`、`bun-backend/tests/`）
> 仍在且全绿。WS 事件全集仍由 `SERVER_EVENT_HANDLER_TYPES: Record<ServerEvent['type'], true>`
> 在编译期强制登记（新增事件不登记 → tsc 报 missing property）。

| 缺陷 | 修法 | 锁 |
| --- | --- | --- |
| 权限模式 UI 断链：REST 回 `enabled`，前端读 `permission_modes_enabled`（后端从不产出）→ 控件恒禁用，用户切换被静默吞掉。旧测试 fixture 自己补了这个字段，所以它一直是绿的 | REST 与前端类型同源，改回 `{session_id, permission_mode, available_permission_modes}`，控件按服务端列表渲染选项 | `bun-backend/tests/permission-mode-contract.test.ts`（含 PERM-LIVE-001 审批行为翻转） |
| 档位清单在四处各写一份字面量（kernel 类型、`bridge-pi.ts` 未导出的 `PI_PERMISSION_MODES`、`sessions.ts`、前端 `PermissionMode`），另有三份前端副本从未被对账（`PermissionModeControl.vue` 的 `availableModes` 默认值、`options` 文案表、`modeRank`）→ 内核改档位名，前端渲染空白选项且 `rank` 为 `undefined` | `MAXMA_PERMISSION_MODES` 进 `pi-contract.ts`，类型由它派生，kernel 两处校验与 REST 响应都运行时消费它；`kernel/types.ts` 改 import+re-export，引用方零改动 | 同 `permission-mode-contract.test.ts`：单源结构锁 + 前端 4 份副本保序对账 + `needsApprovalForMode` 分支集合双向对账（漏分支会静默落进门尾 `return true`） |
| 上一代引擎的 `.omp/skills`（13 个）仍在两种便携包里分发却无人加载（引擎只读 `.maxma/skills` + `.agents/skills`，零名称重叠；12/13 正文指挥模型去调不存在的工具）；并撑着 `countOmpSkills()` → `anthropic_skills_count` → 零 import 的死组件 `StatusBadge.vue` 这条谎，以及能力页里"用户 `~/.omp`"这行没人读的配置源 | 整体删除，两处打包脚本停止暂存，字段/死组件/类型/`.gitignore` 专为其保留的规则/配置源行一并清除（配置源 13→12）；`config/personas/AGENTS.md` 的 Skills 节改写为 pi 真实机制（注入 `<available_skills>`，按 `location` 用 `read` 读；`skill://` 在 pi dist 里不存在） | `bun-sidecar/tests/shipped-skills-packaging.test.ts`：打包暂存的技能根必须等于引擎加载的随包技能根（差集为空），且两侧 src 剥注释后不得把 `.omp` 当运行期路径 |
| Tauri 传输层整条死路径（`detectTauri()`、`ensurePortLoaded()` 的 60×1s `get_api_port` 轮询、`tauriFetch()`、只为它存在的 `vite-env.d.ts` ambient 声明）在两种现行形态下恒为 false 分支 | 全部删除，9 个调用文件改用原生 `fetch`，`getApiBase/getBackendOrigin/getWsBase/openExternal` 恒为同源浏览器形态；`web/package.json` 去掉 `@tauri-apps/plugin-http`（lock 已重生成），`cors-config.ts` 去掉两条 `tauri://` origin 及其被测试钉住的断言；`vite.config.ts` 的 `base:"./"`、`App.vue` 的懒注入时序仍必要，只把理由从 tauri 改成真实原因 | `web/tests/envRuntime.spec.ts`：剥注释递归扫 `web/src/**` 无 `__TAURI`/`@tauri-apps`/`tauriFetch` 等（并断言扫描真覆盖到 `utils/env.ts`，防"零命中"来自空目录）+ 同源 URL 与 `waitForBackend` 行为锁 |
| **同一条链上的提权**：PUT 后补发 `update_auto_approve`，而 `set_auto_approve` 是 `auto`/`ask` 两态 → 选 `operate` 被升成 `auto`（绕过审批），选 `read_only` 被退回 `ask` | 删掉补发。PUT 本就经 in-process `set_permission_mode` 改运行中会话的 `record.permissionMode`，补发是 Python/sidecar 跨进程时代的遗留 | 同上 PERM-LIVE-001：断言 `approvalGate.needsApproval(write)` 随档位真实翻转 |
| 路径白名单层随 Python 整体删除，但 UI 仍向用户宣称它存在（5 处文案 + 1 张无读取方的表 + 2 个死类型） | 文案改为真实机制（拒止锚 + 逐次确认）；`db/core.ts` v1 不再建 `path_whitelist` 表；删 `WhitelistEntry`/`ListWhitelistResponse` | `web/tests/pathWhitelistClaims.spec.ts`（挂载扫可见文本 + 历史谎话负控）、`bun-backend/tests/db-schema.test.ts`（老库升级路径） |
| 事件静默丢弃：`useChat.ts` 的 switch 无 `default` | 入口守卫 + `default` 告警 + `SERVER_EVENT_HANDLER_TYPES` 编译期登记表；4 个零消费者的 `workflow_*` 类型从联合删除 | `web/tests/wsEventSink.spec.ts`（含变异测试：往联合加类型而不加 case 会红） |
| `rpc-types.ts` 的 compaction `reason` 手抄清单缺 `manual` | 改为从 `MAXMA_COMPACTION_REASONS_WS` 派生，不再手抄 | `pi-contract.test.ts` 派生形状断言 + `engine-boundary.test.ts` 与前端联合逐字对账 |
| 界面撒谎：`FeatureUnavailableView` 把「引擎做不到」说成「你关掉了」；`browser_tools`/`sub_agents` 面板写了没人读；安装框宣称 npm/GitHub 而 `marketplace=false` | 判定集中在 `describeFeatureAvailability`；无人消费的面板置灰并**拒绝写入**；安装框按 `marketplace` 分支 | `web/tests/capabilityHonesty.spec.ts`、`web/tests/settingsMenuCapability.spec.ts` |
| Electron 包里两处必然 reject 的 Tauri `invoke` | 导出错误日志改浏览器下载；QuickChat 关闭改 `window.close()` + 「已收起」态（`sandbox:true` 下 Electron 不覆写 `window.close`，已核实） | `settingsMenuCapability.spec.ts`、`web/tests/quickChatClose.spec.ts` |
| `Bun Backend` CI 自 10-21 起每次 push 全红（14 项），本地却全绿 | 全是测试对自身环境的隐含假设：写死 `D:\MaxmaTemp`（ubuntu runner 无 D 盘）、`.bat` 的 CRLF 靠本机 `core.autocrlf` 而非仓库保证（补 `.gitattributes`）、persona 用例拷未被跟踪的 `config/personas/SOUL.md`、Skill 安装用例改 `$HOME` 骗 `os.homedir()`（Bun 在 Linux 上不跟随，改走 `getUserSkillsDir()` + `MAXMA_USER_SKILLS_DIR`）。另把 4 处写死的 `"v2.6.11"` 改成与 `appVersion()` 比对 | `bun-backend/tests/_helpers/tmp.ts` + `portable-packaging.test.ts`；CI 已实测转绿 |
| 桌面包 `.sha256` 用两空格（文本模式）+ CRLF，下载方 `sha256sum -c` 对二进制产物必报 FAILED（值其实是对的） | 改 `<hash> *<name>` + `-NoNewline` 显式 LF | `portable-packaging.test.ts`「桌面包的 .sha256 用二进制模式 + LF」，对真实产物断言无 CR、第 65 字节为 ` *`、LF 结尾 |
| **一个字段两个写入方，谁都不通知谁**：`record.permissionMode` 被 `set_permission_mode`（四档）与 `set_auto_approve`（两态，直接覆盖）写，而权限选择器只信自己那次 GET、也不 watch 变化 → 拨完「自动执行」开关，选择器显示的是内核并不在的档位；同一会话的另一个标签页更看不见 | 内核收成唯一写入口 `bridge-pi.ts` 的 `writePermissionMode`，**每次真正写入广播 `permission_mode_updated { permission_mode }`**（被拒的写入不发）；前端把它登记进 `ServerEvent` 联合 + `SERVER_EVENT_HANDLER_TYPES` + `useChat.ts` 分支，落到 per-channel 状态，「自动执行」开关与权限选择器都从这一份收敛 | `bun-backend/tests/permission-mode-contract.test.ts` 新增 PERM-ANNOUNCE-001 组（真跑 in-process kernel，两种顺序 + 非法档位不发 + REST PUT 也广播 + 事件名/载荷字段名 kernel↔前端类型↔useChat 分支逐字对账 + 反第二份状态真值）；`web/tests/wsEventSink.spec.ts` 锁事件→通道状态（含"无活跃轮次也要处理"）；`web/tests/sessionPermissionModeControl.spec.ts` 锁状态→渲染（迟到 GET 不许回退旧档） |
| **死的 REST 工作流面**：`server.ts` 用空 deps 挂 `createWorkflowRoutes()`，`executeViaKernel` 恒 `undefined` → `mode: "sidecar"` 的定义落进 `executeSimpleStep()` 并因 `Unsupported workflow tool` 失败；REST 面只能报失败，kernel 那条分支只剩直接调 RPC 才够得着，前端零消费者 | 整体删除：路由 + server 挂载与 sink 接线 + kernel `execute_workflow_step` 分支 + 四处登记（`PI_RPC_METHODS` / `MAXMA_ENGINE_WS_EVENTS` 三条 / `BACKEND_SYNTHESIZED_EVENTS` 的 `workflow_completed` / `rpc-types.ts`）+ 前端 `types/workflow.ts` 与其再导出 + 两种便携包停止暂存 `workflows\` + 仓库里那个只有这条死路由会读的空目录 | `bun-sidecar/tests/engine-boundary.test.ts`：新增「干净切换锁」（三侧源码剥注释后无 `workflow` 标识符、三张清单无残留、文件不存在）与 kernel-bridge 的"调它必落 `not yet migrated` 兜底、不再发 `workflow_*`"；原来靠 `workflow_completed` 做的跨文件形状锁改成**机制锁**（临时 fixture 复刻注入型 sink + `const EV_*` 回查 + 埋点干扰项，要求扫得出、且恰好扫出那两个） |

## 遗留问题（未修，接手时别当成可用功能）

1. `PluginListView.vue` 的 `plugins.marketplace` 语义：当前 `false` = 「只启用随包插件」，输入框也只接受随包标识。真要开网络安装，前置是安全评审（下载校验、体积/条目上限、路径穿越、原子落盘），见 `routes/plugins.ts` 的 501 分支。
2. **`config/personas/` 里的 `AGENTS.md` 与 `MAXMA.md` 随两种便携包分发，但没有任何代码读取它们。** `listPersonas()` 只扫 `SOUL*.md`（`persona.ts:78`），`persona-prompt.ts` 只读 SOUL/USER，pi 的项目上下文读的是 `<cwd>/AGENTS.md` 而非包内这个路径。于是 `AGENTS.md` 的「特殊工具说明」整节是上一代引擎的工具词汇且从不被校验：`ask_user_qa`/`ask_user_single_choice`/`ask_user_multi_choice`、`task_tracker`、`call_sub_agent`、`file_read`、`run_python`、`git_status`、`browser_browse`、`tavily_search` 全都不存在（真实面是 `read/bash/edit/write/grep/find/ls` + 6 个自定义 + `submit_plan`）。本轮只修了它确实错误的 Skills 节；要么按真实工具面重写这两份，要么停止分发（与 `.omp/skills` 同一处置）。
3. `capabilities.ts` 的配置源清单除已删的 `~/.omp` 外，其余行（`~/.claude`、`~/.cursor`、`.omprc`、`.omprc.json`、`.mcp.json`、`.github`、项目 `AGENTS.md`…）**未逐条核实是否真被 Maxma/pi 读取**，而能力页把它们连同"活跃 N/M"计数展示给用户。要么核实并只留真实读取方，要么把这整张表降级为"可能存在的目录"措辞。另：删掉 `~/.omp` 行后 `priority` 号从 9 跳到 11（仅展示用，未影响判定）。
4. **`update_auto_approve` 的失败被吞掉。** kernel 侧没有该会话记录时，`callKernelRpc` 解析成 `{ok:false}`，而 `chat-ws.ts:902-905` 以 `void ….catch(() => {})` 丢弃 → 不会有任何回执，「自动执行」开关停在它的乐观值上（权限选择器此时正确地保持内核最后一次宣告的档位）。属既有行为，本轮让分歧从"静默"变成"可见"，真正的修法是给该分支一个回执或错误事件。

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
