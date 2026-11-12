# MaxmaHere 交接说明

> 当前可执行状态，供下一位接手者。架构请先读 [docs/00-当前架构.md](docs/00-当前架构.md)。
> 更新时间：2026-11-12

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
- **实时纠偏改为悬浮小窗（2026-11-12）**：原先内联在消息区上方的「实时协作」区块会挤压
  排版；现在是 `components/chat/SteeringWindow.tsx` —— Solid Glass `Panel` 做窗框，
  只在流式进行中出现，可拖动（位置与收起态存 localStorage，越界自动钳回视口）、
  可收起成标题条、可关闭（本轮不再弹出，下次发送重新出现），回车=立即调整、
  Shift+回车换行，「稍后」=完成当前步骤后处理。默认停靠在输入框上方，不遮挡 composer。
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


## 2026-11-12 前后端联调收敛（逐页实测 + 补齐半成品）

以真实后端 + 真实 WS/SSE 逐页跑通，把所有「页面在、功能不在」的地方补齐或诚实降级。

| 问题（证据） | 处理 | 锁 |
| --- | --- | --- |
| `/api/activity/stream` TTFB 3.0s：Bun 只在首个 body 字节到达时 flush 响应头，而此前首字节要等 15s 心跳 → 前端 fetch 判失败，活动页永远「离线→轮询」 | 流开始即 `enqueue(": connected\n\n")` 注释帧（规范允许、前端忽略）；实测 TTFB 3.0s → 4ms | `routes-2.3b.test.ts` 断言首帧恰为 `: connected\n\n`，再循环读到 `event: activity` |
| 会话未初始化时 `ensureConnected('__pending__')` 打 `error` → 首屏每次刷新都有红色噪音 | 该占位值走 `debug` 分支，与真实非法 sid 分开 | 同上文件链路，`log.error` 只留给非法 sid |
| 侧栏「固定会话」按钮背后是已删的 REST 面（`constifySession`/`unconstifySession`/`generateSessionTitle` 三个 api + store 三方法），点击必 404 | 删除按钮与整条链（Button/图标/确认框） | `tsc` + 全量测试 |
| `/automation` 仍渲染 `AutomationView`（292 行），而引擎侧 `automation` 能力为 false → 展示不可兑现的开关 | 删视图，路由改指 `FeatureUnavailableView`（与 `sub_agents` 等价诚实降级） | 能力门控 `describeFeatureAvailability` |
| 模型渠道页缺「拉取模型 / 检测」 | 卡片：测试改用 `testExistingProvider`（测已存 Key，此前用空 Key 测 base_url，对需鉴权的渠道恒失败）、新增「拉取模型」（`discover-models` 后写回 `models`，内置渠道禁用以避免 400 守卫）、「检测」（`/health` 同步运行时健康）；添加表单：用输入 Key 测连接 / 拉取模型 + 模型多选（默认全选，创建时写入） | 浏览器实测：`POST /discover-models` 200 + 模型 chip 渲染 + toast |
| 设置页无诊断入口（旧 AppSettingsMenu 的导出/清理/重启全丢） | 新增「维护」分区：导出错误日志（Blob 下载，Electron sandbox 可用）、日志文件列表+占用、清理旧日志、重启后端（轮询 `/api/health` 后自动重载） | 实测 `GET /diagnostics/logs` 200，面板显示文件名与大小 |
| MCP 页只有本地 CRUD，市场/授权整块缺失 | 新增 `components/mcp/McpMarket.tsx`：Smithery Registry（搜索/分页/下载量/已验证徽标/安装/OAuth 授权与状态轮询）+ ModelScope（搜索/详情 env 模板导入）；挂到 MCP 页列表顶部，安装后刷新本地列表 | 实测两来源均返回真实条目（Brave Search/Gmail/高德…），安装与授权按钮就位 |
| 用户页绕过类型化 api 直调 `api.request('/persona/user')` | 改 `api.getPersona('user')` | `tsc` |
| 运行时 `api/data/settings_overrides.json` 未被忽略，跑一次设置 PUT 就污染工作树 | 加入 `.gitignore` 运行时段 | — |

## 2026-11-12 最终复查（逐页 + 契约对账）

以真实后端逐页跑过 27 条路由（含深链硬刷新、快速问答入口）并做前后端契约对账，
再补掉四类「页面在、功能不在 / 界面撒谎 / 部署自伤」的缺陷。

| 问题（证据） | 处理 | 锁 |
| --- | --- | --- |
| **`/plugins/<name>/jet-hub` 一进就崩**：`(e.openProviders ?? []) is not iterable`。store 把 `openProviders/closedProviders/accountTotal/accountEnabled` 定义成派生**函数**，视图按数组用（spread/`.length`/`.map`），且用 `as unknown as` 绕过了 tsc | 视图改为调用函数，本地契约类型改为 `() => T`；页面实测渲染出真实数据（15 渠道 / 账号 1/1） | 浏览器实测 0 error |
| **深链硬刷新白屏**：`base: "./"`（Electron `file://` 需要）在 http 托管下让浏览器把 `./assets/x.js` 解析成 `/plugins/<name>/assets/x.js` → 404，卡在启动页。SPA 内部导航看不出（资源已缓存） | `serveFrontend` 的 SPA fallback 注入 `<base href="/">`（按 mtime 缓存；Electron 读磁盘文件不经此处，相对语义不变） | `server-smoke.test.ts` 断言深链 HTML 含 `<base href="/" />` |
| **重建一次，所有页面都取不到懒加载 chunk**：index.html 无内容指纹却被浏览器启发式缓存，旧壳去请求已删除的 `ShareView-<oldhash>.js` | 外壳响应加 `cache-control: no-store, must-revalidate`（带指纹的静态资源仍可长缓存） | 同上测试断言 `no-store` |
| **`/automation` 把「引擎没有调度器」说成「你在设置里关掉了」** | `features.automation` 补 `engine_supported:false` + `reason`，不可用页原样透传引擎原因 | `routes-2.5.test.ts` 断言两字段 |
| **浏览器工具开关会把自己标成「已启用」**：14 个真实工具里没有任何 `browser_*`，pi 无浏览器运行时 | `features.browser_tools` 恒 `enabled:false, engine_supported:false`，用户偏好改由 `configured` 回显 | 同上测试 |
| **快速问答吞掉失败原因**：只渲染 `turn.finalAnswer`，失败轮仅剩「（发生错误，回复未完成）」，看不到原因/ trace | 渲染 `chat.error` + `errorTraceId`，可点关闭 | 浏览器实测出现具体原因与 trace |
| 插件两处视图同样用 `as unknown as` 自造 store 契约（与 jet-hub 同类的定时炸弹） | `PluginState` 导出，两个视图直接 `usePluginStore()`，删掉本地接口与 cast；成员不匹配由 tsc 拦截 | `web tsc` |

对账结果（当前状态）：前端 102 处 `api.*` 调用逐条命中后端注册路由（`/api/jet-hub` 为插件运行时注册，实测 200）；
155 条后端路由、76 条 GET；WS 事件由 `MAXMA_ENGINE_WS_EVENTS` / `BACKEND_SYNTHESIZED_EVENTS` 两张表与前端
`SERVER_EVENT_HANDLER_TYPES` 编译期对账。写入路径实测回环：规则建→切→删、MCP 建→列→删、分享建→深链→删、
四个设置面板 PUT→GET、主题 `data-theme` 刷新持久。

**仍未收口的类型债**：`JetHubView` 仍在用本地 `JetHubStoreApi`（28 个成员）`as unknown as` 收口，
而它实际消费 74 个成员；本轮只把被误用的四个派生函数改正并在浏览器验证，没有把 74 个签名搬进 store 泛型
（会牵动 store 内部 `get().action` 的自引用注解）。要彻底消掉这类洞，做法是把动作面抽成
`JetHubActions` 并与 `JetHubData` 合并成 store 泛型，让 tsc 逐成员校验。

## 2026-11-12 边界修复（pi 适配为主）

承上一轮"最终复查"，本轮只动边界：凡是「引擎已经给了、前端没接」或「两边形状对不上」
的地方，一律按 pi 的真实契约补到可用。

| 问题（证据） | 处理 | 锁 |
| --- | --- | --- |
| **pi 的用量在前端完全不可见**：`llm_usage` 被 `chat-ws.ts` 每条路径 `return` 掉（只落库+打点），`answer` 的 `usage/provider/model/request_duration_ms` 又被前端类型裁成 `{content}`。指标页只有聚合，逐次请求只能翻 SQLite | 后端 `forwardLlmUsage` 落库后转发精简帧（`cache_status` 由 cacheRead/cacheWrite 现场派生，带 `turn_id`）；`finishTurn` 的终态 `answer` 补 `model/provider`（fallback 后才知道谁回了话）；前端 `ServerEvent` 增 `LlmUsageEvent`、`TurnUsage`，`done.context_usage` 的每轮聚合兜底，回答下方渲染脚注（模型 / ↑in ↓out / 缓存读 / 时长 / 多请求 / 预热） | `chat-ws-2.3b.test.ts`：断言 `cache_warm` 转发帧字段与终态 answer 的 `turn_id` 归属；浏览器实测脚注为 `stub-model ↑210 ↓56 缓存读 1.0K 0.2s` |
| **后端有账本、前端没入口**：`/api/metrics/llm-usage`（summary + recent_calls）零消费者 | 指标页新增「最近模型请求」表（时间/模型/输入/输出/缓存读/耗时/状态，30 天窗口，可刷新），`api.getLlmUsage` 接上 | 浏览器实测 31 行真实记录 |
| **开发模式引擎数据落在用户主目录**：源码直跑没人注入 `PI_CODING_AGENT_DIR`，pi 默认写 `~/.pi/agent`，会话/凭据与 `api/data/maxma.db` 分居两处 | 启动时若未显式注入，默认 `<Maxma 数据根>/api/data/pi`（与打包形态同构）；主目录已有会话时**只提示不搬动**，给出沿用旧目录的环境变量写法 | 实测启动日志：`配置目录=D:\Maxma\MaxmaHere\api\data\pi（在 Maxma 数据目录内）` |
| **JetHubView 的 `as unknown as` 契约**（上轮遗留）：本地声明 28 成员、实际消费 74，`openProviders` 等被当数组用 | store 类型改由初始化函数推导（`JetHubStore = JetHubData & ReturnType<...>`），视图直接 `useJetHubStore()`；本地 `AccountRow/ModelRow/CreditsEntry` 改为 store 真类型，备份回执直接用 `JetHubImportResult` | `tsc`：成员缺失/函数当数组当场报错；浏览器实测 15 渠道渲染 |
| 6ms 请求显示成 `0.0s`、`skipped` 计数与数组混用等展示口径 | 时长 <1s 用 ms；`recent_calls` 表格与脚注同口径 | 浏览器实测 `0.2s` / `6ms` |
| **「历史里没有用量」被我误判为不可修**：`get_messages` 只映射 `{role, content}`，而 pi 的 `AssistantMessage` 本来就带 `usage/provider/model/timestamp`（`pi-ai/dist/types.d.ts:375`）。清掉 localStorage 缓存后脚注消失，是**我们的映射丢了字段**，不是引擎不给 | `get_messages` 原样带回四个可选字段（老客户端/快照测试不受影响）；前端 `backendMessagesToTurns` 按轮汇总重建 `TurnUsage`（多次请求求和、时长 = 末次 assistant 时间戳 − 用户消息时间戳） | `kernel-bridge.test.ts` 断言字段透传且 user 消息不凭空长出 usage；浏览器实测：删除 `maxma_turns_*` 后重载，脚注仍为 `↑384 ↓9 缓存读 256 176ms` |

**仍存在的边界（如实记录，没有伪装成已实现）**

- **pi 确实没有**：子 Agent 运行时、任务调度器、TTS。证据是引擎导出面（157 个名字，无
  `spawn*/task*/scheduler*/tts*`）与 `pi-ai` 类型面。能力清单据此发 `engine_supported:false`，
  页面只说"引擎没有，改设置无效"。
- **浏览器工具不是 pi 的墙**：pi 核心没有 browser 工具，但支持 MCP（`createMcpExtension`），
  ModelScope 市场有 12801 个可装 MCP（含网页抓取类）。所以它是**产品决策**（先不内置浏览器运行时，
  让用户按需装 MCP），不是引擎做不到——`browser_tools` 面板的"暂不生效"仍属实，但文案别再说成"引擎不支持"。
- **安全评审前置**：`plugins.marketplace=false`（网络安装未过下载校验/路径穿越评审）、
  MCP stdio 命令白名单、内置渠道模型列表由 Maxma 托管。
- `tts` 面板只暴露"开关 + 自动朗读"，provider 仍固定 `system`（浏览器 `speechSynthesis`）；
  `panel_configs.json` 里遗留的 `openai-tts` 值不会被 UI 展示，首次写入即归一为 `system`。
- 浏览器控制台在后端重启窗口会出现若干 `Failed to fetch: /api/health`（浏览器网络层自己
  记的失败请求，不是应用日志；`waitForBackend` 本身是静默重试）。

## 2026-11-12 边界收口：按 pi 官方方案实现或被删除

上一轮列出的三条边界本轮按「要么找 pi 官方做法，要么彻底删掉」处理完毕，不再有"保留但不可用"的中间态。

| 能力 | pi 有没有 | 结论 | 做法 |
| --- | --- | --- | --- |
| 子 Agent（`sub_agents`） | **有**：官方示例 `examples/extensions/subagent/`（"Each subagent runs in a separate pi process"）+ pi 官方 SDK 文档的 `createAgentSession`/`SessionManager.inMemory()`（`PI_CODEMODE_MAX_WORKERS` 注释直接以 "in-process subagents" 举例） | **实现**，不再是门控 | `kernel/subagent.ts`：`subagent({tasks})` 工具 → 每个任务一个 in-memory 子会话（独立上下文、只读工具 read/grep/find/ls/bash、不能再委派、跑完 dispose）。选 SDK 而非 CLI 子进程：实测 pi CLI bundle 在 Bun 1.3.14 下起不来（undici `webidl.util.markAsUncloneable`），便携包又不带 Node。面板（开关/并行/超时）真消费；`/api/tools` 与 capabilities 的清单按面板动态追加 `subagent` |
| 后台任务中心 / deferred runs | 无（OMP 时代产物，pi 从不发射那两个事件） | **删除** | 事件 `deferred_subagent_submitted` / `sub_session_created`、`DeferredRunManager`、`/api/sessions/:id/deferred-runs`、`AgentTasksView` + `/agent-tasks` 路由与侧栏项、`deferred_runs` 表（v7 迁移保留版本号占位）、前端 `DeferredRun` 类型与 api —— 全部清掉 |
| 自动化（`automation`） | **无**：导出面 157 个名字无 scheduler/cron，docs 也无 | **删除** | `/automation` 路由、`features.automation`、类型位、`automations`/`automation_run_history` 表（v4 迁移保留占位；v6 的 ALTER 改为空实现） |
| 浏览器工具（`browser_tools`） | 核心**无**，官方路线是 MCP（pi 官方 mcp 文档） | **删除自研面板**，指向 MCP 市场 | `features.browser_tools`、`/api/settings/browser-tools`、前端面板与类型、`panel_configs` 默认键全部移除；需要有浏览器的用户去扩展页的市场装 browser/playwright 类 MCP（ModelScope 现有 12801 个条目） |
| TTS（`tts`） | 无（但也不需要） | **保留** | 实现走浏览器 `speechSynthesis`（`hooks/useTts.ts`），与引擎无关；能力清单按用户开关如实体现在 UI |

实测证据（开发后端 + 受控 provider）：
- `subagent` 工具被审批门拦截（`允许调用 subagent？` + 两个任务的结构化参数）→ 批准 → 子会话执行 → 结果回父会话，`tool` 事件 `done`，0 console error；
- `/api/capabilities`：`sub_agents = {enabled:true, engine_supported:true, mechanism:"pi-sdk-in-process", max_concurrent:2, timeout_seconds:120}`，工具清单含 `subagent`；`automation` / `browser_tools` 已从清单消失。

**这下真的没有"半成品入口"了**：能力清单里剩下的每一项，要么有 pi 机制在跑，要么是纯前端实现（tts），要么是产品安全开关（`plugins.marketplace=false`）。

## 2026-11-12 记忆与行为偏好：删假面，留可验证的真链路

用户质疑两处：记忆页写着「Hindsight 已停用」，成长页「感觉玄幻」。逐条核对后
一处是纯假面（删），一处是真的但不可验证（补证据链）。

| 项 | 事实 | 处理 |
| --- | --- | --- |
| **Hindsight 记忆增强** | 只有 `panel_configs.json` 里一个键 + GET/PUT + 面板：`retention_days` / `importance_threshold` / `processing_mode` / `prompt_template` 四个字段**全仓零读取**（`remember_memory` 写入时不带 expires_at/confidence，检索也不看这些） | 整体删除：面板、`/api/memory/hindsight-config`、默认值与校验、`features.memory.hindsight`、`api.getHindsightConfig`、`HindsightConfig` 类型、`panel_configs` 键、`panels-2.2g` 用例 |
| **`features.memory.episodic`** | 恒为 true，但没有任何情景库实现；`api/data/episodic_memory.json` / `semantic_memory.json` 是上一代遗留的 2 字节空文件（零读写方） | 删除能力字段与两个数据文件；`features.memory` 只剩 `{enabled:true}` |
| **记忆「% 把握」/「平均置信度」** | 写入方从不设置 confidence，投影里恒为 1.0，UI 却渲染成「100% 把握」 | 投影、统计、筛选参数与 UI 里的置信度全部删除（`min_confidence` 查询参数一并去掉） |
| **记忆空态文案** | 原文「与 AI 对话后，OMP 会自动记录有价值的事实」——机制上说错了：只有用户明确要求或 Agent 调 `remember_memory` 才会写 | 改为「只在你明确要求（记住……）或 Agent 调用 remember_memory 时写入，不会自行推断」 |
| **行为偏好（原「成长」）** | 真实、确定性：只从 4 种句式提炼、字符串关键词命中、最多 3 条注入、反馈调置信度、低于 0.25 自动暂停；但页面没有可验证入口，且用 EvoCore/成长这类玄学措辞 | 页面重写：逐字列出 4 种句式与注入规则；新增 **预览注入**（`GET /api/evolution/preview`，逐字返回会追加的文本、只读不改状态）；规则卡展示关键词/证据/正负反馈/最近使用；导航「成长」→「偏好」，去掉 EVOCORE 品牌词，注入头改为「[Maxma 行为偏好：仅以下与本次请求相关的长期偏好适用]」 |
| **`sub_agents.auto_approve/model/show_progress`** | 面板不显示、kernel 不消费（只用 enabled/max_concurrent/timeout_seconds） | 从默认值、类型、`panel_configs` 删除，避免文件里留「看似可配」的死键 |

验证：
- `/api/memory/hindsight-config` → **404**；`features.memory = {enabled:true}`；`/api/memory/stats` 无 `avg_confidence`
- 预览实测：`帮我写个 Python 脚本` → 命中 1 条（`score 6.72`），注入文本与聊天实际追加内容同源（同一个 `renderEvolutionContext`）；`今天天气怎么样` → 0 命中、注入为空
- 页面实测：记忆页无 Hindsight/置信度字样；偏好页有「它具体怎么工作」+ 预览框，预览按钮点完显示关键词与逐字注入文本，0 console error
- 后端测试：`evolution-route.test.ts` 新增 preview 用例（命中/未命中/预览不改 `last_used_at`），其余 273 项全绿

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
> 下列为 2026-11-12 实测（React 重写后）。

```text
引擎  cd bun-sidecar && bun test            128 pass / 0 fail（14 文件）
引擎  cd bun-sidecar && bun x tsc --noEmit  0 error（CI 硬门槛）
后端  cd bun-backend && bun test            280 pass / 0 fail（40 文件）
类型  node scripts/check-type-budget.mjs    sidecar 0 / backend 0（只准减）
前端  cd web && npx tsc --noEmit            0 error
前端  cd web && npm run build               PASS（dist: index/quick-chat/splash + assets）
前端  cd web && npm run lint:colors         0 违规（80 个 TSX）
端到端 bash scripts/smoke-e2e-roundtrip.mjs 退出码 0（需后端在跑）
```

前端组件测试套件（旧 Vue 572 例）随组件重建退役；组件级断言改由
`bun-sidecar` / `bun-backend` 的跨侧契约测试与浏览器实测承担。
阶段二 Python→Bun 直译遗留的 86 个后端类型错误已清零，两侧基线均为 0 并作为硬门槛进 CI。

## 交付前闸门

```text
bash scripts/verify-all-gates.sh
  # sidecar bun test + tsc / backend bun test / web tsc + vite build + 语义色守卫
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

1. `web/src/views/PluginListView.tsx` 的 `plugins.marketplace` 语义：当前 `false` = 「只启用随包插件」，输入框也只接受随包标识。真要开网络安装，前置是安全评审（下载校验、体积/条目上限、路径穿越、原子落盘），见 `routes/plugins.ts` 的 501 分支。
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
