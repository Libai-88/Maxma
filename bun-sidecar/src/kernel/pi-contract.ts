/**
 * kernel/pi-contract.ts — Maxma 对 pi 引擎的**消费面单源清单**。
 *
 * ## 为什么需要这个文件
 *
 * Maxma 与 pi 之间的耦合，绝大多数不是「编译期可见」的：pi 把一个事件改名、
 * 一个工具改名、一个 settings 键删掉，`tsc` 不会报错，测试也不会红——因为
 * 这些名字在 Maxma 侧是**字符串字面量**，散落在 kernel、bun-backend 路由与
 * web 前端三处，各写各的。上一代引擎（OMP → pi）换代时，这条链已经断过一次：
 * `deferred_subagent_submitted` 当年被 chat-ws 与前端类型消费，而引擎侧早已没有
 * 生产者；2026-11-12 复核后用 pi 官方 SDK 的进程内子会话（kernel/subagent.ts）
 * 取代了那套 OMP 时代的 deferred 面，事件与路由一并删除。
 *
 * 所以这里把"Maxma 向 pi 借用了哪些名字"集中声明，由
 * `bun-sidecar/tests/pi-contract.test.ts` 与 `engine-boundary.test.ts` 逐条
 * 对照**已安装的 pi 包**与**三侧源码**做校验。任何一处对不上，测试当场红。
 *
 * ## 维护规则
 *
 * - 新增对 pi 的名字依赖（事件、工具、settings 键、provider api、导出符号），
 *   必须在这里登记，否则守卫测试报错。
 * - 每一项都要写清"pi 改动时谁断、怎么断"，让清单不许骗人
 *   （范式对齐 bun-backend/tests/plugins/jet-hub-coverage.test.ts）。
 * - 本文件**不得 import `@earendil-works/*`**：它是纯数据，会被 bun-backend
 *   一起打包，引入运行时依赖会让产物耦合变实。
 */

// ─────────────────────────────────────────────────────────────
// 1. 引擎包与版本
// ─────────────────────────────────────────────────────────────

/**
 * 引擎版本号——**Maxma 侧的声明值**。
 *
 * 为什么不直接信 pi 自己的 `VERSION`：pi 用
 * `VERSION = pkg.version || "0.0.0"`（`dist/config.js:430`）从**模块旁边的
 * package.json** 读版本。而发布形态里 pi 被 `bun build` 内联进 `server.js`
 * （external 清单不含 `@earendil-works`），产物目录里没有那份 package.json，
 * 于是 `VERSION === "0.0.0"`——dev 环境正确、便携包里谎报。
 * 这里显式声明一份，由测试断言它与两个 workspace 实际锁定的版本一致；
 * `engine-info.ts` 在 pi 报 "0.0.0" 时回落到本值。
 * `scripts/upgrade-pi.mjs` bump 时会一并改写它，避免又多一处手抄。
 */
export const PI_ENGINE_VERSION = "1.5.0";

/** Maxma 直接依赖的 pi 包。两处 workspace 必须同版本（engine-boundary 校验）。 */
export const PI_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
] as const;

/**
 * pi-coding-agent 根导出面中被 Maxma 用到的**值**（class/function）。
 * 校验方式：运行时 dynamic import 已安装包，断言逐项存在——改名即报错。
 */
export const PI_CODING_AGENT_VALUE_EXPORTS = [
  "DefaultResourceLoader",
  "SessionManager",
  "SettingsManager",
  "ModelRuntime",
  "createAgentSession",
  "createCodemodeExtension",
  "createMcpExtension",
  "defineTool",
  "getAgentDir",
  "loadSkills",
] as const;

/** pi-coding-agent 根导出面中被 Maxma 用到的**类型**。 */
export const PI_CODING_AGENT_TYPE_EXPORTS = [
  "AgentSession",
  "InlineExtension",
  "ExtensionAPI",
  "ToolCallEvent",
  "ToolCallEventResult",
  "ToolDefinition",
  "McpServerEntry",
] as const;

/**
 * pi-ai 根导出面中被 Maxma 用到的符号。
 *
 * ⚠️ pi-ai 的 dist/index.d.ts 里有 `export * from "./api/lazy.ts"` 这类通配再导出，
 * 所以"在 index.d.ts 里 grep 到名字"不能作为判据——只有 tsc 探针是可靠的，
 * 这也是 pi-contract.test.ts 用编译探针而不是文本扫描的原因。
 */
export const PI_AI_VALUE_EXPORTS = ["createAssistantMessageEventStream"] as const;

export const PI_AI_TYPE_EXPORTS = [
  "Api",
  "Model",
  "Tool",
  "SimpleStreamOptions",
  "AssistantMessageEventStream",
  "TranscriptContext",
] as const;

/**
 * 深子路径 import。pi-ai 的 exports 图有 `"./api/*"` 通配，故属**公开可达面**；
 * 但 `.lazy` 是延迟加载器约定，属灰色地带——登记于此，pi 改路径时构建期即断（响亮）。
 */
export const PI_AI_DEEP_EXPORTS: ReadonlyArray<{ specifier: string; values: readonly string[] }> = [
  { specifier: "@earendil-works/pi-ai/api/openai-completions.lazy", values: ["openAICompletionsApi"] },
];

/**
 * Maxma 用到的 pi 类型**不在根面再导出**的那一类：靠包内 d.ts 存在性校验。
 * `Model` 曾从 pi-coding-agent 根面 import（kernel/types.ts:10），但 pi 并不从根面
 * 导出它——它是 pi-ai 的类型。这条历史教训由 tsc 探针兜住。
 */
export const PI_NON_ROOT_TYPE_SOURCES: ReadonlyArray<{ package: string; types: readonly string[] }> = [
  { package: "@earendil-works/pi-ai", types: ["Api", "Model", "ThinkingLevel"] },
];

// ─────────────────────────────────────────────────────────────
// 2. pi 事件词表（kernel/events.ts 与 bridge-pi.ts 订阅层消费）
// ─────────────────────────────────────────────────────────────

/** pi `AgentSessionEvent` 中被 Maxma 订阅/映射的顶层事件名。pi 改名 → 事件静默丢失。 */
export const PI_SESSION_EVENTS_CONSUMED = [
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "entry_appended",
  "agent_settled",
  "agent_end",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
] as const;

/**
 * `message_update` 的内层 `assistantMessageEvent.type`。
 * pi 改这些子名 → 流式输出/思考流静默整族消失（最难发现的一类）。
 */
export const PI_ASSISTANT_SUBEVENTS_CONSUMED = [
  "text_delta",
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "error",
] as const;

/**
 * Maxma 主动选择的终态语义：`done` 由 `agent_settled` 触发，而不是 `agent_end`
 * （官方：agent_end 之后自动重试/排队仍可能继续，agent_settled 才是"不会再继续"）。
 * pi 若改 settled 语义 → 前端回合结束时机漂移。上游 1.2.0 已改过"run 启动期间算 busy"
 * 的相邻语义，这一项升级后必须运行时对拍，不能只看类型。
 */
export const PI_TURN_TERMINAL_EVENT = "agent_settled";

/**
 * 「有文档、未从根 index 再导出」的条目形状——Maxma 靠鸭子类型读取。
 * 这两处是全仓最接近"赌 pi 内部结构"的地方，单列登记。
 */
export const PI_DUCK_TYPED_ENTRY_SHAPES: ReadonlyArray<{
  name: string;
  entryType: string;
  fields: readonly string[];
  readAt: string;
  breakMode: string;
}> = [
  {
    name: "usage/cache_warm",
    entryType: "usage",
    fields: ["kind", "provider", "model", "usage"],
    readAt: "kernel/events.ts:175-192 · kernel/bridge-pi.ts:115,129-130,187-188",
    breakMode: "kind 改名 → 缓存预热用量静默不进成本台账（无报错）",
  },
  {
    name: "label/targetId",
    entryType: "label",
    fields: ["targetId"],
    readAt: "kernel/bridge-pi.ts:536-543",
    breakMode: "targetId 改名 → 检查点恢复永远找不到目标",
  },
  {
    name: "sourceInfo/kind",
    entryType: "sourceInfo",
    fields: ["kind"],
    readAt: "kernel/skills.ts:38（skills 来源展示名）",
    breakMode: "SourceInfo 只公开 source；kind 缺失时 skills 来源退回 unknown（仅展示降级，不影响加载）",
  },
];

// ─────────────────────────────────────────────────────────────
// 3. pi 内置工具与模型词表
// ─────────────────────────────────────────────────────────────

/**
 * pi 0.99.x 的**全部**内置工具名（判据：包内 `create{X}Tool` 工厂导出的双向差集，
 * 由 tests/pi-contract.test.ts 现读）。
 *
 * ⚠️ 这张表曾经只有 7 个——那是手抄 `MAXMA_DEFAULT_PI_TOOLS` 的结果，漏了 pi 实际
 * 提供的第 8 个内置工具 `powershell`。工具清单必须从引擎取，不能从"我方启用了哪些"取。
 */
export const PI_BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "powershell",
] as const;

/**
 * Maxma 默认给会话启用的工具子集（= `pi-session.ts` 的 `MAXMA_DEFAULT_PI_TOOLS`）。
 * 与上一张表**故意不同**：powershell 不在默认集内。测试断言本表 ⊆ PI_BUILTIN_TOOLS，
 * 引擎改名/删名时即红；新增工具不会自动进入默认集（需显式决定）。
 */
export const MAXMA_ENABLED_DEFAULT_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

/** Maxma 自己注册给 pi 的自定义工具（bun-sidecar/src/tools/*）。前端展示名须与此对齐。 */
export const MAXMA_CUSTOM_TOOLS = [
  "remember_memory",
  "search_memories",
  "get_sticker",
  "list_rules",
  "read_office_file",
  "write_office_file",
] as const;

/**
 * 条件装配的工具：面板开启时才注册（`/api/tools` 与 capabilities 按同一开关决定是否列出）。
 * `subagent` = pi SDK 的进程内子会话（kernel/subagent.ts）。
 */
export const MAXMA_CONDITIONAL_TOOLS = ["subagent"] as const;

/** kernel 内建的工具型扩展点（计划模式提交）。 */
export const MAXMA_ENGINE_TOOL_EXTRAS = ["submit_plan"] as const;

/**
 * pi 的 `ThinkingLevel` 全序（定义在 pi-agent-core 类型里，**不由 pi-coding-agent 根面再导出**）。
 * Maxma 三侧都在写这 7 个字符串：kernel/model.ts、chat-ws 的 bool→high/off 兼容映射、
 * web/src/stores/chat.ts 的下拉与持久化。pi 增删档位 → 前端静默失配 + 旧 localStorage 非法。
 */
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * provider 的 api 标识白名单（kernel/model.ts 用它判定 providerType 是否合法 api）。
 *
 * 判据：与已安装 pi 的 `KnownApi` 联合类型双向比对（tests/pi-contract.test.ts）。
 * pi 新增一个 KnownApi 而这里没登记 → 测试红（提醒去接），避免"模型能解析、一发送就报错"。
 */
export const PI_PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "azure-openai-responses",
  "anthropic-messages",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-vertex",
  "mistral-conversations",
  "pi-messages",
] as const;

/**
 * 引擎改过名的 api 标识（成对登记，附生效版本）。
 *
 * ⚠️ 这里**不是**"两个名字都当合法值"的白名单——那样做会让当前 0.99.0 运行时
 * 接受一个引擎并不认识的 api 名，把"回落 openai-completions"换成"发送时报错"，
 * 等于新造一条用户可见的报错路径。正确做法是按**已安装引擎的版本**选定实名，
 * 两个方向都能解析（见 `engine-info.ts` 的 `engineApiNames()`）。
 *
 * ## 1.0.3 Azure 改名的实测结论（2026-11-08 升级 1.5.0 时对账修正）
 *
 * 上游 1.0.3 的 Breaking Changes 原文是 "Renamed the Azure provider from
 * `azure-openai-responses` to `azure`"——当时被误读成 **api 名**改了，登记成
 * `azure-openai-responses → azure`。对账已安装 1.5.0 的真实面后证伪：
 * `KnownApi`（pi-ai/dist/types.d.ts）里 `azure-openai-responses` **一直在**，
 * `azure` 从来不在；真正改的是 **provider 键**（`KnownProvider` 新增 `azure`），
 * 两者是不同维度的词表。api 名从未变，改名表因此为空；
 * provider 键 → api 的映射在 `kernel/model.ts` 的 `PROVIDER_API_ALIASES`
 * （`azure → azure-openai-responses`）。
 */
export const PI_PROVIDER_API_RENAMES: ReadonlyArray<{
  from: string;
  to: string;
  since: string;
  note: string;
}> = [];

// ─────────────────────────────────────────────────────────────
// 4. compaction 词表（引擎值 vs Maxma 契约值，两者不等价）
// ─────────────────────────────────────────────────────────────

/** pi 实际会发出的 `compaction_start.reason`（dist/core/agent-session.d.ts:61）。 */
export const PI_COMPACTION_REASONS_ENGINE = ["manual", "threshold", "overflow"] as const;
/**
 * Maxma WS 契约 `context_compressing.payload.reason` 的取值域。
 *
 * `idle` / `incomplete` 是上一代引擎（OMP）遗留，当前引擎不产出；保留是为兼容
 * 历史转录回放与前端既有分支。**`manual` 是本次补上的真缺陷修正**：此前白名单
 * 没有它，未知值一律被钳成 `threshold`，于是"用户手动压缩"在 UI 上被误报成
 * "阈值触发"。
 */
export const MAXMA_COMPACTION_REASONS_WS = [
  "manual",
  "threshold",
  "overflow",
  "idle",
  "incomplete",
] as const;

// 编译期断言（零运行时开销）：**引擎真发的 reason 必须全部落在 WS 契约域内**。
//
// 为什么不只靠测试：`bun-sidecar/tsconfig.json` 只编译 `src`，测试文件不进 tsc；
// 而这条不变量正是"缺一个编译期断层面"的那一类——上一代事故里，白名单漏 `manual`
// 时 tsc 一声不响。把断言写成类型约束后，谁从 `MAXMA_COMPACTION_REASONS_WS`
// 删掉引擎真实值，`tsc --noEmit`（scripts/check-type-budget.mjs 的硬门槛）当场红。
// 反方向（契约里有引擎不发的遗留值）是有意为之，不在此断言范围内。
type _ValuesMustBeCoveredBy<T extends (typeof MAXMA_COMPACTION_REASONS_WS)[number]> = T;
type _EngineCompactionReasonsAreInWsContract = _ValuesMustBeCoveredBy<
  (typeof PI_COMPACTION_REASONS_ENGINE)[number]
>;

/** Maxma 契约里 compaction 的 action 取值：pi 路径恒发 context-full。 */
export const MAXMA_COMPACTION_ACTION_WS = ["context-full"] as const;

// ─────────────────────────────────────────────────────────────
// 5. 目标模式状态词表（前端超前于引擎的部分要点明）
// ─────────────────────────────────────────────────────────────

/** pi 无 goal 运行时；Maxma 自建后**实际只产出**这两个状态。 */
export const MAXMA_GOAL_STATUSES_ENGINE = ["active", "paused"] as const;

/**
 * 前端 `web/src/stores/chat.ts` 声明的状态域（含 budget-limited/complete/dropped）。
 * 这三个值来自上一代引擎的 GoalModeState，当前 kernel 不产出——保留是契约超集，
 * 但必须在测试里被显式承认，否则"前端能显示却永不到来的状态"会误导后续开发。
 */
export const MAXMA_GOAL_STATUSES_WS_SUPERSET = [
  "active",
  "paused",
  "budget-limited",
  "complete",
  "dropped",
] as const;

// ─────────────────────────────────────────────────────────────
// 6. settings 点路径（Maxma 读写 pi Settings 的清单）
// ─────────────────────────────────────────────────────────────

/**
 * pi 的 SettingsManager 是**类型化对象、没有点路径 API**（bridge-pi.ts:477 注释自认），
 * Maxma 在外面临时造了 `readDottedPath`/`buildNestedOverride` 门面，并把遗留 OMP 键
 * 一起塞进 `applyOverrides()`。后果：**写一个 pi 不认识的键是静默 no-op**，
 * 设置面板上的开关看着能拨、拨了没反应。
 *
/**
 * Maxma 设置面板写入的**全部**点路径，以及每一项归谁消费。
 *
 * ## 这张表要解决的问题
 *
 * pi 的 SettingsManager 是类型化对象、没有点路径 API，Maxma 在外面造了
 * `readDottedPath`/`buildNestedOverride` 门面，并把遗留 OMP 键一起塞进
 * `applyOverrides()`。`applyOverrides` 对未知键宽容 → **写一个没人消费的键照样
 * 返回 `{ok:true}`**。实际后果（2026-10-27 实测）：
 *
 *   - `consumer: "none"` 的 22 项拨动完全无效，UI 却报"已保存"；
 *   - `consumer: "pi"` 的项写进的是**内存单例**（settings-global.ts 用
 *     `SettingsManager.inMemory()`），既不进会话也不落盘 → 改了等于没改，重启还原。
 *
 * ## 各字段的判据（避免手抄）
 *
 * - `engineReal`：tests/pi-contract.test.ts 解析已安装 pi 的
 *   `dist/core/settings-manager.d.ts`（Settings / CompactionSettings / RetrySettings /
 *   ThinkingBudgetsSettings）算出真实点路径集合，逐条双向比对。pi 增删键 → 测试红。
 * - `consumer`：登记"这项由谁实际执行"。不变量由测试守：
 *     · `"pi"` ⇒ 必须 `engineReal === true`（不许把引擎没有的键推给引擎）
 *     · `"none"` ⇒ 后端 PUT 必须拒绝（`routes/settings.ts`），不许再静默报成功
 *     · `consumer !== "none"` 时，`note` 里出现的仓库内路径必须是真实文件
 *       （测试校验存在性，防"编造一个消费者"）
 */
export type SettingsConsumer = "pi" | "maxma" | "none";

export const MAXMA_SETTINGS_KEYS: ReadonlyArray<{
  path: string;
  engineReal: boolean;
  consumer: SettingsConsumer;
  note: string;
}> = [
  // ── 引擎真实存在，且推给会话生效 ──
  { path: "compaction.enabled", engineReal: true, consumer: "pi", note: "pi CompactionSettings.enabled" },
  { path: "retry.enabled", engineReal: true, consumer: "pi", note: "pi RetrySettings.enabled" },
  { path: "retry.maxRetries", engineReal: true, consumer: "pi", note: "pi RetrySettings.maxRetries" },
  { path: "retry.baseDelayMs", engineReal: true, consumer: "pi", note: "pi RetrySettings.baseDelayMs" },
  { path: "steeringMode", engineReal: true, consumer: "pi", note: "pi Settings.steeringMode" },
  { path: "followUpMode", engineReal: true, consumer: "pi", note: "pi Settings.followUpMode，见 bun-sidecar/src/kernel/bridge-pi.ts" },
  { path: "thinkingBudgets.minimal", engineReal: true, consumer: "pi", note: "pi ThinkingBudgetsSettings.minimal" },
  { path: "thinkingBudgets.low", engineReal: true, consumer: "pi", note: "pi ThinkingBudgetsSettings.low" },
  { path: "thinkingBudgets.medium", engineReal: true, consumer: "pi", note: "pi ThinkingBudgetsSettings.medium" },
  { path: "thinkingBudgets.high", engineReal: true, consumer: "pi", note: "pi ThinkingBudgetsSettings.high" },

  // ── SETTINGS-VIS-001：pi 真实存在、此前 Maxma 全仓零引用的键 ──
  //
  // 这些不是"新功能"，是**本来就该让用户调**的旋钮：pi 的 settings.md 有明确默认值，
  // 但 Maxma 既没登记也没在界面上暴露，用户只能手改 settings.json。
  // 补齐后由既有机制自动生效（engineSettingsForNewSession 只下发 consumer:"pi" 的
  // 显式改动；没碰过的键保持 pi 默认值）。
  { path: "compaction.reserveTokens", engineReal: true, consumer: "pi", note: "pi CompactionSettings.reserveTokens（默认 16384）：上下文余量低于它时触发自动压缩" },
  { path: "compaction.keepRecentTokens", engineReal: true, consumer: "pi", note: "pi CompactionSettings.keepRecentTokens（默认 20000）：压缩后原样保留的近期 token 数" },
  { path: "branchSummary.reserveTokens", engineReal: true, consumer: "pi", note: "pi BranchSummarySettings.reserveTokens（默认 16384）：切换分支时生成摘要预留的 token" },
  { path: "branchSummary.skipPrompt", engineReal: true, consumer: "pi", note: "pi BranchSummarySettings.skipPrompt（默认 false）：切换分支时不询问是否摘要" },
  { path: "cacheWarming", engineReal: true, consumer: "pi", note: "pi Settings.cacheWarming（off/streaming/idle，默认 streaming）：在跑或空闲时保持 provider 提示缓存热。**仅全局**——pi 文档明示只能写在 agent 目录设置里" },
  { path: "enabledModels", engineReal: true, consumer: "pi", note: "pi Settings.enabledModels（string[]）：模型循环与启动选择的范围；空=全部可用" },
  { path: "defaultThinkingLevel", engineReal: true, consumer: "pi", note: "pi Settings.defaultThinkingLevel（默认 medium）：新会话的思考档位" },
  { path: "hideThinkingBlock", engineReal: true, consumer: "pi", note: "pi Settings.hideThinkingBlock（默认 false）：隐藏思考块" },
  { path: "images.autoResize", engineReal: true, consumer: "pi", note: "pi ImageSettings.autoResize（默认 true）：发送前把图片缩到 2000×2000 内" },
  { path: "images.blockImages", engineReal: true, consumer: "pi", note: "pi ImageSettings.blockImages（默认 false）：禁止向模型发送图片" },

  // ── 引擎没有这个键，但 Maxma 自己消费 ──
  { path: "skills.enabled", engineReal: false, consumer: "maxma", note: "pi 的 skills 键是 string[]（包源清单），无 .enabled；由 bun-backend/src/routes/sessions.ts 读 settings.skills.enabled 转成 create_session 的 skills_enabled" },
  { path: "recap.enabled", engineReal: false, consumer: "maxma", note: "Maxma 应用层闲置回顾开关，读者在 web/src/hooks/useChat.ts" },
  { path: "recap.idleSeconds", engineReal: false, consumer: "maxma", note: "同上，闲置时长阈值" },

  // ── 无人消费：上一代引擎遗留，或从来没接线 ──
  { path: "compaction.strategy", engineReal: false, consumer: "none", note: "OMP 遗留：pi 只有摘要式压缩，无 strategy；全仓除面板外无读者" },
  { path: "compaction.thresholdPercent", engineReal: false, consumer: "none", note: "OMP 遗留：agent-rpc.md §8 已记录 pi 无此键" },
  { path: "compaction.midTurnEnabled", engineReal: false, consumer: "none", note: "OMP 遗留，无读者" },
  { path: "compaction.idleEnabled", engineReal: false, consumer: "none", note: "OMP 遗留，无读者" },
  { path: "compaction.idleThresholdTokens", engineReal: false, consumer: "none", note: "OMP 遗留，无读者" },
  { path: "compaction.idleTimeoutSeconds", engineReal: false, consumer: "none", note: "OMP 遗留，无读者" },
  { path: "retry.maxDelayMs", engineReal: true, consumer: "none", note: "1.5.0 起引擎 RetrySettings 新增 maxDelayMs（此前实名是 maxAgentDelayMs）；面板未暴露该键，直接编辑 settings.json 可生效" },
  { path: "retry.modelFallback", engineReal: false, consumer: "none", note: "OMP 遗留：pi RetrySettings 无该键，全仓无读者" },
  { path: "retry.fallbackChains", engineReal: false, consumer: "none", note: "OMP 遗留：pi 无该键，全仓无读者" },
  { path: "tools.approvalMode", engineReal: false, consumer: "none", note: "OMP 遗留：pi 无权限系统，审批由 kernel/approval-gate.ts 经 create_session 的 permission_mode 实现，不经 settings" },
  { path: "tools.discoveryMode", engineReal: false, consumer: "none", note: "OMP 遗留：pi 无此键，无读者" },
  { path: "interruptMode", engineReal: false, consumer: "none", note: "OMP 遗留：pi Settings 无 interruptMode，无读者" },
  { path: "thinkingBudgets.xhigh", engineReal: false, consumer: "none", note: "pi 只有 minimal/low/medium/high 四档预算；xhigh/max 无对应键也无读者" },
  { path: "thinkingBudgets.max", engineReal: false, consumer: "none", note: "同上" },
  { path: "advisor.enabled", engineReal: false, consumer: "none", note: "OMP 遗留：pi 无 advisor 子系统，无读者" },
  { path: "advisor.subagents", engineReal: false, consumer: "none", note: "OMP 遗留键：pi Settings 无此键。子 Agent 现由 Maxma 工具 subagent（kernel/subagent.ts，pi SDK 进程内会话）实现，与该键无关" },
  { path: "contextPromotion.enabled", engineReal: false, consumer: "none", note: "面板暴露但全仓（web/后端/kernel）除面板自身外无任何读者——从未接线的能力" },
  { path: "autolearn.enabled", engineReal: false, consumer: "none", note: "同上：面板有开关，无实现读者" },
  { path: "async.enabled", engineReal: false, consumer: "none", note: "同上：面板有开关，无实现读者" },
  { path: "async.maxJobs", engineReal: false, consumer: "none", note: "同上" },
  { path: "bash.autoBackground.enabled", engineReal: false, consumer: "none", note: "OMP 的 bash 自动后台化；pi 无对应键，全仓无读者" },
  { path: "bash.autoBackground.thresholdMs", engineReal: false, consumer: "none", note: "同上" },
  {
    path: "vault.enabled",
    engineReal: false,
    consumer: "none",
    note: "面板文案称「允许 read 工具通过 vault:// URL 读取/编辑 Obsidian 保管库」，但全仓（web/后端/kernel/api/config）除面板自身外零个 vault 读者，pi 0.99.0 的 read 工具也不提供 vault:// —— 一个描述不存在能力的开关",
  },
];

/** 便利索引：点路径 → 是否引擎真实存在。 */
export const MAXMA_SETTINGS_ENGINE_REAL_PATHS: ReadonlySet<string> = new Set(
  MAXMA_SETTINGS_KEYS.filter((k) => k.engineReal).map((k) => k.path),
);

// ─────────────────────────────────────────────────────────────
// 7. 引擎侧生产者对账（"我方期待但引擎不发"的登记处）
// ─────────────────────────────────────────────────────────────

/**
 * Maxma WS 契约中**由引擎负责产出**的事件（词表来源 docs/contracts/ws-events.md §3.1，
 * 另加引擎派生的 llm_usage 与 `permission_mode_updated`）。
 *
 * 由 tests/engine-boundary.test.ts 逐条核对"kernel 里真的有生产者"。
 * 没有生产者又不在下面的显式登记里的，测试红——这正是
 * `deferred_subagent_submitted` 当年静默死亡却全绿的缺口（现已删除）。
 *
 * 判据分工（三张清单各自回答"谁对这个事件负责"）：
 *   - 本清单：引擎（kernel）负责产出，逐条要求 kernel 里有生产者；
 *   - `ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED`：**本清单的例外区**——契约还声明着"引擎产出"、
 *     但引擎换代后没人产出了。一张事件同时出现在这两张表里是有意的，出现在
 *     "本清单 + 后端合成"两张里才是矛盾。
 *   - `BACKEND_SYNTHESIZED_EVENTS`：由 bun-backend 路由自行合成，不经引擎，
 *     与前两张互斥（`engine-boundary.test.ts` 查这条互斥）。
 *
 * `permission_mode_updated` 必须落在本清单而不是后端合成表：`record.permissionMode`
 * 的两个写入方（`set_permission_mode` 四档 / `set_auto_approve` 两态）都在 kernel 里，
 * 广播只能由写入方发。REST 层转发不了"别人写的那一次"——那正是这个字段以前会漂移的原因
 * （`dev_docs/permission-modes.md`）。
 *
 * 曾有而今无：`workflow_step_start` / `workflow_step_end` / `workflow_step_error`。
 * 它们由 kernel 的 `execute_workflow_step` 分支产出，而那条分支唯一的调用方
 * （`bun-backend/src/routes/workflows.ts`）用空 deps 挂载，永远走不到 sidecar 路径；
 * 2026-11-02 整条死面连同这三个事件一起删除，恢复自动化是独立工作项。
 */
export const MAXMA_ENGINE_WS_EVENTS = [
  "thinking_start",
  "thinking_delta",
  "thinking_end",
  "token",
  "tool_start",
  "tool_update",
  "tool_end",
  "tool_error",
  "answer",
  "done",
  "error",
  "ask_user",
  "context_compressing",
  "context_compressed",
  "retry_start",
  "retry_end",
  "todo_reminder",
  "irc_message",
  "notice",
  "plan_proposed",
  "plan_completed",
  "plan_step_start",
  "plan_step_end",
  "plan_step_error",
  "goal_updated",
  "llm_usage",
  "context_usage",
  "permission_mode_updated",
  // EXT-UI-001：pi 扩展的 ctx.ui.select/confirm/input/editor/notify 经 kernel
  // 转成前端对话框。**不是**引擎原生事件——pi 在 SDK 模式下通过
  // ExtensionUIContext 回调出站，由 kernel 的 extension-ui.ts 转成 WS 帧。
  "extension_ui_request",
] as const;

/**
 * 被 bun-backend / web 消费、但**当前引擎侧没有任何生产者**的 Maxma 事件。
 *
 * 每一项必须写清原因与处置，否则测试红。反向也测：**登记了却其实有生产者的，同样红**
 * （清单不许骗人，范式对齐 jet-hub-coverage.test.ts 的 NOT_SURFACED 双向校验）。
 *
 * 这是"我方期待但引擎不发"的显式承认位——不该删掉假装没发生，
 * 也不该继续让 UI 以为功能存在。
 */
export const ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED: ReadonlyArray<{
  event: string;
  reason: string;
  handling: string;
}> = [
  {
    event: "irc_message",
    reason: "多 Agent IRC 是 OMP 专有；pi 无对应事件",
    handling: "协议保留，不实现；升级引擎不会带来它",
  },
  {
    event: "todo_reminder",
    reason: "OMP 的 todo 工具提醒；pi 无 todo 内置工具（见 PI_BUILTIN_TOOLS）",
    handling: "协议保留，不实现",
  },
  {
    event: "context_usage",
    reason: "引擎从不发射独立用量事件；常规路径是 done.payload.context_usage（ws-events.md §3.1 已注明）",
    handling: "保留协议位，前端以 done 载荷为准",
  },
  {
    event: "plan_step_start",
    reason: "pi 无计划步骤执行器；Maxma 自建的 plan 模式只在提交/批准层（plan_proposed/plan_completed），不逐步发射",
    handling: "协议保留，不实现",
  },
  {
    event: "plan_step_end",
    reason: "同 plan_step_start",
    handling: "协议保留，不实现",
  },
  {
    event: "plan_step_error",
    reason: "同 plan_step_start",
    handling: "协议保留，不实现",
  },
];

/**
 * kernel 实现的 RPC 方法名（`create_session` 由 dispatcher 单独分流，不在其列）。
 *
 * 这份清单以前手抄在 `session-bridge.ts` 的"需要会话上下文"分支里，抄漏的方法
 * （`session_recap` / `clear_messages` / `set_permission_mode`）在无会话时会被报成
 * `Unknown method` 而不是 `Session not found`。现在由
 * `tests/engine-boundary.test.ts` 与 `bridge-pi.ts` 里实际的
 * `if (method === "...")` 分支做双向差集校验——清单与实现不许各写各的。
 */
export const PI_RPC_METHODS = [
  "prompt",
  "cancel",
  "destroy_session",
  "get_health",
  "user_response",
  // EXT-UI-001：扩展对话框应答（select/confirm/input/editor）。
  // 与 user_response 分开——那条走审批门（超时默认拒绝），这条走扩展 UI 桥
  // （超时按官方默认值回填）。混用会让两类超时语义互相污染。
  "extension_ui_response",
  "undo",
  "compact",
  "get_messages",
  "clear_messages",
  "get_settings",
  "set_settings",
  "set_auto_approve",
  "set_permission_mode",
  "set_plan_mode",
  "plan_action",
  "checkpoint_action",
  "goal_action",
  "get_goal_state",
  "reload_mcp_for_session",
  "session_recap",
  // TREE-001..004：pi 的会话树、树内导航、分叉、重命名/统计/导出。
  // 此前 Maxma 只用过 getBranch()/getLeafId()，整棵树从未暴露给用户。
  "get_tree",
  "navigate_tree",
  "fork_session",
  "set_session_name",
  "get_session_stats",
  "list_prompt_templates",
  "get_session_state",
  "context_edit",
  "reload_session_resources",
  "get_context_usage",
  "export_session_html",
  "steer",
  "follow_up",
] as const;

/**
 * 由 bun-backend 路由自行合成、**不经引擎**的 WS 事件（不参与"引擎生产者"对账）。
 *
 * 判据不是靠猜：`tests/engine-boundary.test.ts` 会扫 `bun-backend/src` 全部
 * WS 发射点（`send("x")` / `hub.broadcast(id, { type: "x" })` /
 * `eventSink(id, EV_CONST, …)` / `ws.send(JSON.stringify({ type: "x" }))`，
 * 常量名回查同文件的 `const EV_X = "x"`），要求
 * **发射得出 → 必须登记**、**登记了 → 必须查得到发射点**，双向都红。
 *
 * 两条历史谎言就是靠这个形状藏住的，本次一并清掉：
 *   - `workflow_completed` 只有后端生产者（`routes/workflows.ts`），此前**三张清单
 *     一张都不在**，所以对账测试看不见它——旧判据只正则扫 `chat-ws.ts`，
 *     从别的后端路由发出去的事件天然免疫。该路由连同这个事件已于 2026-11-02 删除
 *     （死的 REST 工作流面），但扫描器**仍须**覆盖整个目录：形状锁改吃临时 fixture，
 *     见 engine-boundary.test.ts。
 *   - `turn_start` / `task_review` 曾被登记成"后端合成的事件"，其实
 *     `turn_start` 只是 `recordActivity("turn", "turn_start", …)` 的**活动埋点
 *     event_type**（`activity-hub.ts`，不进 WS 帧），`task_review` 是**入站**
 *     客户端消息类型（`chat-ws.ts` 的 `CLIENT_MESSAGE_TYPES`），出站的那个叫
 *     `task_review_update`。登记一个不存在的事件，等于给对账测试开了个永远
 *     不会命中的口子。
 */
export const BACKEND_SYNTHESIZED_EVENTS = [
  "hello",
  "pong",
  "artifact",
  "artifact_result",
  "collaboration_update",
  // ACTION-FAIL-001：会话级动作（user_response / update_auto_approve /
  // plan_action / set_plan_mode / checkpoint_action）的 RPC 失败回执。
  // callKernelRpc 永不 throw（失败解析为 {ok:false}），此前五处
  // `.catch(() => {})` 连 catch 都接不到——失败完全不可见，乐观 UI
  // 停在错误值上。steer/follow_up 的 collaboration_update 是同形状的先例。
  "action_failed",
  "memory_start",
  "memory_tool_start",
  "memory_tool_end",
  "memory_tool_error",
  "memory_done",
  "task_brief_update",
  "task_review_update",
] as const;

// ─────────────────────────────────────────────────────────────
// 8. 会话权限模式档位（Maxma 自建词表，跨 kernel / REST / 前端三侧）
// ─────────────────────────────────────────────────────────────

/**
 * Maxma 权限模式 4 档（AG-PERM-001），限制由强到弱；**数组顺序即 REST
 * `available_permission_modes` 与前端选项的展示顺序**。
 *
 * ## 为什么在"引擎契约"里登记一个引擎没有的名字
 *
 * pi 无内置权限系统（官方 README/Security 明示），四档是 Maxma 自建语义，
 * 落点是官方 tool_call 钩子（`kernel/approval-gate.ts` 的 `needsApprovalForMode`）。
 * 但它和引擎名字属于同一类缺陷：这四个字符串以前**在四处各写一份**——
 * `kernel/types.ts` 的联合类型、`bridge-pi.ts` 的 RPC 入参校验（模块私有、未导出）、
 * `routes/sessions.ts` 的 REST 返回值、`web/src/types/session.ts` 的前端联合。
 * 跨 workspace 的字符串副本 tsc 看不见，只动一处时会出现"REST 说这档可用、
 * kernel 判它非法"（用户选到必 422 的档位）或反过来。现在清单只有这一处，
 * 档位类型由它**派生**（见下），kernel 与 REST 两侧运行时 import 同一份常量
 * （跨 workspace 运行时消费的先例：`routes/capabilities.ts:29`，不属
 * `@earendil-works/*`，故 `engine-boundary.test.ts` 的 allowlist 无需登记）。
 *
 * 前端仍是**副本**，而且是被纪律要求成副本：`engine-boundary.test.ts` 的判据是
 * 「前端只认 Maxma REST/WS 契约」，`web/src` 不许 import kernel 源码，所以前端联合
 * 由 `bun-backend/tests/permission-mode-contract.test.ts` 逐字对账（含
 * `web/src/components/chat/PermissionModeControl.tsx` 的 MODE_ORDER/MODE_LABELS）。
 *
 * 新增/改名一档必须同时动 `needsApprovalForMode` 的分支与前端联合——
 * 该测试对"审批门实际分支的档位集合"与本清单做**双向**差集校验，漏一侧当场红。
 */
export const MAXMA_PERMISSION_MODES = ["read_only", "ask", "operate", "auto"] as const;

/**
 * 档位类型 = 上面清单的派生值（以前是第二个字面量联合，两处可以各漂各的）。
 * `kernel/types.ts` 只做再导出，全仓的 `MaxmaPermissionMode` 都指向这一份。
 */
export type MaxmaPermissionMode = (typeof MAXMA_PERMISSION_MODES)[number];
