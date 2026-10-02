# Maxma 缓存与推理成本优化：证据与实验方案

日期：2026-10-02
范围：基于仓库当前 Pi 依赖与官方 API 文档，为可验证的缓存和降本实验提供依据。本文不把缓存命中或节省金额当作既成结果。

## 结论

Maxma 有会话历史持久化，也使用 Pi 处理模型请求；这两类缓存不能混为一谈。浏览器/会话缓存帮助恢复界面，不代表模型少收输入 token。模型提示缓存由具体提供商、API、模型和请求前缀共同决定，Maxma 只能稳定请求结构、保留逐次用量证据并比较成本，不能保证命中。

## 当前实现可确认的边界

- sidecar 固定使用 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent` 0.99.0（`bun-sidecar/package.json` 与 lockfile）。随包 Pi 文档及实现表明 `cacheWarming` 支持 `off | streaming | idle`，默认 `streaming`，并由 Pi 在 session 模型请求路径挂接 warmer；只有模型声明了当前 tier 的 `promptCache` 生命周期、且 Pi 估算的可避免 miss 成本达到 `$0.05`，才会刷新，刷新 usage 计入 session totals。故 Pi 层已有暖缓存机制，但不能据此断言 Maxma 正在为所有已选模型实际暖缓存。[Pi 0.99.0 npm 发布页](https://www.npmjs.com/package/@earendil-works/pi-coding-agent/v/0.99.0)；[Pi settings 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)；[Pi models 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)
- Maxma 的 `createMaxmaSession` 没有覆盖 Pi 的默认缓存保活模式；是否实际运行取决于 Pi agent 全局设置、模型 cache-life metadata 与模型目录价目。尤其是 Maxma 自定义端点未命中 Pi registry 时，[`model.ts`](../bun-sidecar/src/kernel/model.ts) 会以 `ZERO_COST` 且不带 `promptCache` 生命周期注册单模型；按随包 Pi 文档规则，这种模型不符合 cache warming 条件。因此 OpenCode 免费/自定义模型当前不能指望 Pi 自动保活缓存。
- 用量事件在 `events.ts` 从 `message_end` 的助手消息传出；后端 `chat-ws.ts` 将该回合的 `state.usage` 覆盖为最近一条带 usage 的助手消息，完成时只记录一次 LLM 调用。[events.ts](../bun-sidecar/src/kernel/events.ts) [chat-ws.ts](../bun-backend/src/routes/chat-ws.ts) 工具循环可能产生多次模型请求，所以现有指标不应解释为完整逐请求汇总或账单级成本。
- Pi `getAgentDir()` 默认配置目录是 `~/.pi/agent`，并支持 `PI_CODING_AGENT_DIR` 覆盖。Maxma 调用 `getAgentDir()`，Electron 启动环境目前未设置该变量；若无用户级覆盖，Pi 配置会落在用户主目录（Windows 常见为 C 盘）。具体是否写入取决于所走的 Pi 配置/模型存储路径。要满足完全 D 盘隔离，应在桌面启动配置中显式指向程序旁数据目录，再调整 Pi 缓存设置。
- 当前指标只归一化 `input/output/cacheRead/cacheWrite`，并对其求缓存比例；它没有保留提供商原始 usage 对象，也未记录逐请求 API、缓存缺失原因或按模型价格计算的实付成本。[chat-ws.ts](../bun-backend/src/routes/chat-ws.ts) [metrics.ts](../bun-backend/src/metrics.ts)

## 提供商文档给出的事实

### OpenAI

- 缓存复用的是**完全匹配的 prompt 前缀**；模型、服务等级、工具等请求设置需要兼容。维护会话本身不保证缓存命中。GPT‑5.6 及后续模型的可缓存前缀至少 1,024 个可见输入 token；较早模型门槛会受工具、图像、结构化输出、推理强度和 verbosity 等请求设置影响。[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) [Diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics)
- 缓存存续期与费用依模型不同。官方文档当前列出 GPT‑5.6+ 的 30 分钟 TTL；更早模型可能使用 `in_memory` 或 `24h` 选项。不要把一种模型的 TTL 或读写费率套用到其他模型/兼容端点。[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- 实测应读取响应 `usage.input_tokens_details.cached_tokens`；诊断接口可比较两个响应的前缀并说明 miss 原因，但只适用于 Responses API 的指定支持模型。[Diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics)

### Anthropic

- 默认缓存 TTL 至少 5 分钟，每次使用会刷新；生命周期从请求开始计时，生成耗时会消耗 TTL。支持模型可以使用 1 小时缓存，但写入费用更高。最多 4 个 cache breakpoint；系统提示、工具或消息前缀变化会影响后续复用。[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- 官方当前说明 5 分钟 cache write 为基础输入价格的 1.25 倍、1 小时 write 为 2 倍，read 通常为 0.1 倍（按模型可能有例外）。应将“写缓存的额外费用”纳入净节省，而不能只展示命中 token 比率。[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- 响应用量字段的 `input_tokens` 是最后一个 breakpoint 后的未缓存部分；需同时记录 `cache_read_input_tokens` 和 `cache_creation_input_tokens` 才能还原缓存与未缓存输入。[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

### Gemini API

- 官方文档称 Gemini 2.5+ 开启隐式缓存，实际缓存要求模型各自满足最小输入长度；文档建议将大型、共用内容置于 prompt 前部，并在较短时间内发送相似前缀。响应提供 `usage.total_cached_tokens`，以实测此字段为准。[Context caching](https://ai.google.dev/gemini-api/docs/caching)
- 这不等于 Maxma 可跨提供商统一强制缓存；显式 cache object 与隐式缓存支持范围也因 API 不同。[Context caching](https://ai.google.dev/gemini-api/docs/caching)

## 值得验证的改进思路

以下均为待验证建议，不是已测收益。

1. **建立逐模型调用账本。** 在 sidecar 的每一次模型调用边界记录模型/provider/API、原始 usage、归一化的输入/输出/cache read/cache write、用量是否缺失、延迟、会话/轮次与计费价目版本。对无法拿到 usage 的请求标成“未知”，不要按 0% 或估算值冒充真实命中。逐请求累加工具循环里的所有 LLM 请求，才能对照账单或提供商控制台。
2. **按提供商计算实际净成本。** 依据已核实的模型单价和该次 response usage 分别计算普通输入、缓存写入、缓存读取、输出成本。汇总缓存读 token 比率与“相对不缓存节省/增加的成本”两个指标；费率未知或 endpoint 是兼容代理时标记成本未知。按 provider/model 分组，避免平均数掩盖免费层和付费层的差异。
3. **稳定长前缀，动态信息后置。** 对同一 provider/model 做请求快照差异分析，优先找每轮都变动的系统提示、工具顺序、日期/运行态内容、扩展清单与上下文注入。只有在 Pi 的实际序列化 prompt 中验证变化位置后，才尝试把高稳定内容前置、易变内容后置；用相邻轮次缓存 token 数与成本对照验证，避免为了缓存重排破坏提示词行为。该方向符合 OpenAI 对精确前缀及稳定工具定义的要求和 Gemini 的共用前缀建议。
4. **Pi cache warming 按模型分层试验。** 先查模型目录中是否声明 `promptCache.short/long` 及供应商 TTL；将实验限定到已确认可缓存、重复使用频率足够的模型。比较 `off`、Pi 默认/`streaming`、`idle` 三组的真实 cache write/read token、成本、TTFT 和空闲时长。Anthropic 的写入溢价说明保活不能默认视为降本。测试阶段不要把“Pi 为该模型估算可避免费用达阈值”当作提供商实际账单收益。
5. **无缓存供应商也能降本：缓存应用自己的确定性工作。** 对昂贵但确定性的本地解析、项目索引、文件摘要等结果采用带内容 hash 和失效条件的磁盘缓存；缓存键纳入项目内容版本、模型/规则版本和用户权限边界，失效后回源。用重复任务回放比较 API 调用次数、输出质量和数据陈旧率。该项是应用层减少重复工作，不应记入“prompt cache hit rate”。
6. **小模型/规则路由只通过任务集评估后启用。** 统计可由确定性逻辑解决的任务比例；对分类/决策器建立代表性标注集，比较路由准确率、失败返工成本和总 token 成本，再决定是否路由。路由调用自身也计费；不能只依据“模型较小/输出较快”推导总成本下降。

## 建议的验证协议

- 固定版本、模型、provider、API 类型、系统提示词、工具和测试输入；每种场景运行多轮，并分开记录首次写入、紧随其后的重复请求、跨 TTL 空闲后请求、工具定义改变、切换模型/推理设置等案例。
- 主指标：供应商报告的 cache read/write token、全部 LLM 调用 token、按当日费率核算的总成本、TTFT/总延迟、任务成功率/人工返工率。缺失字段要单列比例。
- 对照组保持内容一致，只改变一个变量；报告原始样本、均值与离散程度。没有真实 provider usage 与费率时，仅报告 token/请求代理量，不报告节省金额。
- 对缓存重排、压缩或路由的每个改动，加入同一批任务的质量对照；低成本若伴随成功率下降，应报告单位成功任务成本，而非单次请求费用。

## 来源

优先使用提供商与 Pi 官方资料；不同模型、API 和兼容服务可能采用不同字段与缓存行为，接入时应以对应 endpoint 文档和真实响应为准。资料核对日期：2026-10-02。



## 代码链路复核：缓存预热用量与实时指标

Pi 0.99.0 将非对话用量作为独立 `UsageEntry` 写入 session transcript；官方格式示例明确用 `kind: "cache_warm"` 表示缓存预热，并说明它参与 Pi session token/cost 总量，但不进入对话上下文（`bun-sidecar/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`）。Maxma 目前只把 Pi 的 `message_end` 映射为 `answer` 并提取该助手消息的 usage；`entry_appended` 等事件被忽略，后端也仅从 `answer` 写入单个 `TurnState.usage`。因此 Maxma 的实时 LLM 指标**没有证据表明覆盖了 cache-warm usage**，也不能用来核对 Pi session 总成本。由于 Pi 的 UsageEntry 不一定经由 Maxma 当前订阅的事件暴露，需在真实测试中同时比对 Pi session usage 与 Maxma 指标，确认漏计路径后再设计接入。

另一个可直接确认的口径问题是工具循环：每条 `message_end` 可包含一笔助手请求 usage，但 `chat-ws.ts` 覆盖同一轮的 usage 字段，最终仅持久化最后一个有 usage 的 assistant message；轮次 token、缓存率和输出速度因此可能低估或错配。建议分两层记录：**请求级 ledger**忠实保存每次模型响应及来源状态，**轮次级汇总**累加其中可加总的 usage，并分别标记缺失 usage 和旁路 usage（例如 cache warming）。不要把“轮次结束时最后一条消息”作为“整轮模型成本”。

这项观测修复优先于主动调参：若基线漏记工具调用与预热，任何缓存命中率或降本 A/B 对比都会被污染。验收时至少核对一个无工具请求、一个包含两次模型调用的工具循环、一个符合 Pi 条件的 cache-warming session；逐项比较 provider usage、Pi session totals、Maxma request ledger 和轮次聚合值。对不支持缓存或未返回 usage 的模型，显示“不可观测/未知”，而非推断为零命中。
