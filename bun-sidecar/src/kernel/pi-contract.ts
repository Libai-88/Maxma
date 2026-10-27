/**
 * kernel/pi-contract.ts — Maxma 对 pi 引擎的**消费面单源清单**。
 *
 * ## 为什么需要这个文件
 *
 * Maxma 与 pi 之间的耦合，绝大多数不是「编译期可见」的：pi 把一个事件改名、
 * 一个工具改名、一个 settings 键删掉，`tsc` 不会报错，测试也不会红——因为
 * 这些名字在 Maxma 侧是**字符串字面量**，散落在 kernel、bun-backend 路由与
 * web 前端三处，各写各的。上一代引擎（OMP → pi）换代时，这条链已经断过一次：
 * `deferred_subagent_submitted` 至今仍在 chat-ws 与前端类型里被消费，而引擎侧
 * 早已没有生产者（bun-sidecar/src 全目录 grep `deferred|subagent` 零命中）。
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
 * 前瞻兼容项：**当前锁定的 0.99.0 里还不存在**，升级后才是真名。
 *
 * 上游 1.0.3 的 Breaking Changes 把 Azure provider 从 `azure-openai-responses`
 * 改名为 `azure`，并要求迁移 auth.json / models.json / settings.json 里的 provider key。
 * 两个名字都保留，是为了让同一份代码在升级前后都能解析 Azure 渠道；
 * 只留一个 = 升级当天 Azure 渠道静默解析失败。
 */
export const PI_PROVIDER_APIS_FORWARD_COMPAT = ["azure"] as const;

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

  // ── 引擎没有这个键，但 Maxma 自己消费 ──
  { path: "skills.enabled", engineReal: false, consumer: "maxma", note: "pi 的 skills 键是 string[]（包源清单），无 .enabled；由 bun-backend/src/routes/sessions.ts 读 settings.skills.enabled 转成 create_session 的 skills_enabled" },
  { path: "recap.enabled", engineReal: false, consumer: "maxma", note: "Maxma 应用层闲置回顾开关，读者在 web/src/composables/useChat.ts" },
  { path: "recap.idleSeconds", engineReal: false, consumer: "maxma", note: "同上，闲置时长阈值" },

  // ── 无人消费：上一代引擎遗留，或从来没接线 ──
  { path: "compaction.strategy", engineReal: false, consumer: "none", note: "OMP 遗留：pi 只有摘要式压缩，无 strategy；全仓除面板外无读者" },
  { path: "compaction.thresholdPercent", engineReal: false, consumer: "none", note: "OMP 遗留：agent-rpc.md §8 已记录 pi 无此键" },
  { path: "compaction.midTurnEnabled", engineReal: false, consumer: "none", note: "OMP 遗留，无读者" },
  { path: "compaction.idleEnabled", engineReal: false, consumer: "none", note: "OMP 遗留，无读者" },
  { path: "compaction.idleThresholdTokens", engineReal: false, consumer: "none", note: "OMP 遗留，无读者" },
  { path: "compaction.idleTimeoutSeconds", engineReal: false, consumer: "none", note: "OMP 遗留，无读者" },
  { path: "retry.maxDelayMs", engineReal: false, consumer: "none", note: "pi 实名是 maxAgentDelayMs（或 provider.maxRetryDelayMs），本键不存在且无读者" },
  { path: "retry.modelFallback", engineReal: false, consumer: "none", note: "OMP 遗留：pi RetrySettings 无该键，全仓无读者" },
  { path: "retry.fallbackChains", engineReal: false, consumer: "none", note: "OMP 遗留：pi 无该键，全仓无读者" },
  { path: "tools.approvalMode", engineReal: false, consumer: "none", note: "OMP 遗留：pi 无权限系统，审批由 kernel/approval-gate.ts 经 create_session 的 permission_mode 实现，不经 settings" },
  { path: "tools.discoveryMode", engineReal: false, consumer: "none", note: "OMP 遗留：pi 无此键，无读者" },
  { path: "interruptMode", engineReal: false, consumer: "none", note: "OMP 遗留：pi Settings 无 interruptMode，无读者" },
  { path: "thinkingBudgets.xhigh", engineReal: false, consumer: "none", note: "pi 只有 minimal/low/medium/high 四档预算；xhigh/max 无对应键也无读者" },
  { path: "thinkingBudgets.max", engineReal: false, consumer: "none", note: "同上" },
  { path: "advisor.enabled", engineReal: false, consumer: "none", note: "OMP 遗留：pi 无 advisor 子系统，无读者" },
  { path: "advisor.subagents", engineReal: false, consumer: "none", note: "OMP 遗留：pi 无 subagent 运行时，无读者" },
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
 * 另加引擎派生的 llm_usage 与计划模式的 workflow_step_*）。
 *
 * 由 tests/engine-boundary.test.ts 逐条核对"kernel 里真的有生产者"。
 * 没有生产者又不在下面的显式登记里的，测试红——这正是
 * `deferred_subagent_submitted` 当年静默死亡却全绿的缺口。
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
  "sub_session_created",
  "deferred_subagent_submitted",
  "workflow_step_start",
  "workflow_step_end",
  "workflow_step_error",
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
    event: "deferred_subagent_submitted",
    reason: "pi 无子 Agent 运行时（dev_docs/pi-migration-plan.md §6.0 spike：无任何 subagent 导出）；事件与 DeferredRunManager 均为 OMP 时代遗留",
    handling: "Agent 任务中心入口按能力门控隐藏（capabilities.sub_agents.engine_supported=false），后端追踪面保留待接",
  },
  {
    event: "sub_session_created",
    reason: "同上：pi 无子会话概念，ws-events.md §3.2 所写的「sidecar 发射」指旧 OMP 内核",
    handling: "协议保留，前端 SubAgentCard 待与任务中心一并处置",
  },
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
 * 由 bun-backend 自行合成、不经引擎的事件（不参与"引擎生产者"对账）。
 * 列出来是为了让对账测试的判据可核对，而不是靠猜。
 */
export const BACKEND_SYNTHESIZED_EVENTS = [
  "hello",
  "artifact",
  "pong",
  "turn_start",
  "task_review",
] as const;
