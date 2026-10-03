# Agent 预行动不确定性估计与自适应澄清

> 研究日期：2026-10-03
>
> 研究问题：Maxma 是否值得在 Agent 真正执行工具前估计“这次行动是否足够确定”，并在不确定性或潜在损失较高时自动向用户澄清？如果值得，最小可验证实现是什么？

## 结论

值得研究，但第一步应当做成**执行前门控（pre-action gate）**，而不是训练一个新的置信度模型。

最小可验证实现：对每个即将执行的工具调用生成一个结构化的“行动草案”，检查工具名、必填参数、关键对象、范围和可逆性；对低风险且字段明确的调用直接执行，对字段缺失、候选解释分歧或外部影响较大的调用复用现有 `ask_user` 机制提问。门控结果必须记录为结构化事件，随后用真实轨迹评估“少错了多少、增加了多少追问和延迟”。

这条路线有三个依据：

1. 澄清问题本身应被视为一个决策问题：何时问、问什么、得到答案后如何行动。研究表明，基于用户意图分布的熵来选择澄清对象，比随机挑选更能找到“澄清后会受益”的样本；在仅允许对 10% 样本提问时，Intent-Sim 报告的性能增益约为随机基线的两倍。
2. 只看当前回复可能奖励“完整但武断”的回答。ICLR 2025 的双轮偏好实验显示，用澄清后的未来结果来评价首轮动作，可以提升最终答案 F1 约 4–5%，并使模型在不需要澄清时更准确地直接回答（相对已有方法约提升 3 个百分点）。
3. 工具调用错误会污染后续状态，代价不仅是文本答案错误，还可能是执行失败、费用、信息泄露或不可逆外部影响。近期工具调用研究把“调用工具、直接回答、继续规划”等视为需要校准的不确定性决策，但这仍是较新的研究方向，不能把模型自报的 confidence 当作可靠概率。

## 已有证据

### 1. “何时澄清”可以用预期收益来定义

Zhang 与 Choi 将任务拆为：判断是否需要澄清、生成能消除歧义的问题、利用回答完成任务。他们提出 Intent-Sim，通过模拟多个可能的用户意图并估计输出熵，来寻找“回答可能错误且澄清有帮助”的样本。论文在 QA、机器翻译和自然语言推理上评估，并报告了跨任务和模型的稳健改进。

这给 Maxma 的直接启示是：门控目标不应是“所有不确定都提问”，而应是“澄清能够改变行动或显著降低错误损失时才提问”。同一个缺字段，在只读搜索和删除文件两类工具上的阈值应不同。

来源：

- Zhang, M. J. Q. & Choi, E. *Clarify When Necessary: Resolving Ambiguity Through Interaction with LMs*（arXiv, 2023）：<https://arxiv.org/abs/2311.09469>
- 论文中关于 Intent-Sim、意图熵与 10% 澄清预算的摘要和实验说明：<https://arxiv.org/pdf/2311.09469>

### 2. 训练和评价应看后续结果，而非只看首轮文本

Zhang、Knox 与 Choi 的 ICLR 2025 研究指出，传统单轮偏好标注容易偏好“看起来完整”的武断回答，因为标注者没有看到用户补充信息之后的结果。他们用双轮偏好模拟用户回答澄清问题，再评价最终是否覆盖用户的不同解释；在多个开放域 QA 设置中，方法带来约 4–5% 的答案 F1 改进，并提升“该问还是直接答”的判断准确率约 3 个百分点。

对 Maxma 来说，这意味着评估应覆盖整个交互轨迹：如果 Agent 先问一个高价值问题，随后一次工具调用完成任务，应把这条轨迹与“直接猜参数、调用失败、再重试”比较，而不是只统计首轮是否产生了文本答案。

来源：

- Zhang, M. J. Q., Knox, W. B. & Choi, E. *Modeling Future Conversation Turns to Teach LLMs to Ask Clarifying Questions*（ICLR 2025）：<https://arxiv.org/abs/2410.13788>；会议论文：<https://proceedings.iclr.cc/paper_files/paper/2025/file/97e2df4bb8b2f1913657344a693166a2-Paper-Conference.pdf>
- 作者代码与数据仓库：<https://github.com/mikejqzhang/clarifying_questions>

### 3. 工具调用决策有独立的错误类型和累积风险

Zhou 等人的 2026 年预印本把工具调用中的两类错误明确区分出来：在不支持或不需要时错误调用工具，以及本该调用工具却编造直接答案。论文指出，多步轨迹中前一动作的错误会传播到后续状态，并报告以不确定性对齐作为训练信号可以改善工具决策和不确定性估计。

这是支持“工具参数不确定性”作为单独观测量的证据，但该工作仍属于新近预印本，且主要研究训练方法。Maxma 的 MVP 不应依赖其训练算法；可以先把问题变成可观测的工程指标：字段缺失、候选工具/参数分歧、工具返回后的校验失败、重试次数和用户纠正次数。

来源：

- Zhou et al. *Exploring Agentic Tool-Calling Decisions via Uncertainty-Aligned Reinforcement Learning*（arXiv, 2026）：<https://arxiv.org/abs/2606.06976>

### 4. 单轮置信度不能直接代表 Agent 轨迹置信度

近期轨迹级研究比较了 token 概率、重采样一致性和模型自评等不确定性方法，指出它们从单轮回答迁移到多轮工具轨迹时表现不均衡；聚合方式、动作集合一致性和计算预算都会影响结果。这支持一个保守实现原则：第一版将“uncertainty”称为**门控信号/风险分数**，而不是宣称已经得到校准概率。

来源：

- Bouchard & Chauhan. *Beyond Single-Turn Confidence: Trajectory-Adapted Uncertainty Quantification for LLM Agents*（arXiv, 2026）：<https://arxiv.org/abs/2608.11552>

### 5. 行为规范也要求处理歧义并表达不确定性

OpenAI Model Spec 将“必要时提出澄清问题”和“表达不确定性”列为默认行为，并要求在意图不清时说明假设、给出安全猜测或提出澄清问题。它是行为规范而非效果实验，不能作为效果证据，但可作为产品行为的外部一致性参考。

来源：

- OpenAI Model Spec（2025-04-11）：<https://model-spec.openai.com/2025-04-11.html>
- OpenAI 对该规范的说明：<https://openai.com/index/sharing-the-latest-model-spec/>

## 适合 Maxma 的最小可验证实现

### A. 把门控点放在工具参数已经形成、工具尚未执行的位置

不要先做全局“用户请求是否模糊”分类器。最小改动应放在 Agent 已经选择工具并准备参数之后，因为这时可检查的是一个具体动作：

```text
模型提出 tool_call(name, arguments)
        ↓
pre_action_gate(tool, arguments, context)
        ├─ proceed：继续现有工具执行
        └─ clarify：发出 ask_user，暂停该调用，用户回答后重新生成参数
```

门控输入只需包括：工具名、JSON 参数、工具 schema、当前用户请求、最近一轮上下文、工具的风险/可逆性元数据。门控不执行工具，也不替用户填充缺失的关键参数。

### B. 第一版使用可审计的混合分数

不要把一次模型自评的“我有 80% 把握”当作概率。使用以下四类信号组成离散风险分数即可：

- **Schema 缺失**：必填参数缺失、类型不匹配、枚举值不合法。
- **语义歧义**：对象、目标、时间、范围、收件人、文件路径等存在多个合理解释。
- **动作分歧**：用同一上下文做 2–3 次低温度结构化重采样，比较工具名与关键参数的一致性；分歧只作为启发式信号。
- **影响等级**：只读查询、可回滚写入、发送/删除/购买等外部影响动作分别设定不同阈值；高影响动作即使参数格式正确，也需要明确对象和范围，必要时走现有审批。

建议将结果压缩成三个状态，便于先做实验：

```text
proceed       参数完整、关键字段一致、风险低
clarify       缺少会改变结果的字段，或候选动作/对象分歧
confirm       参数完整但动作有外部影响，沿用现有审批语义
```

`clarify` 与 `confirm` 需要区分：前者是在补充任务语义，后者是在用户已给出明确意图后确认执行高影响动作。

### C. 复用现有 Maxma 能力

仓库已有适合承载 MVP 的基础：

- `bun-backend/src/plugins/task-brief/index.ts` 已定义结构化 `clarify` / `ready` 结果、最多 3 个问题和 JSON 解析校验，可作为澄清问题生成器的交互契约参考。
- `web/src/types/index.ts`、`web/src/composables/useChat.ts` 与 `web/src/components/ApprovalBubble.vue` 已有 `ask_user` 事件、用户响应和审批气泡链路。
- `bun-backend/src/routes/chat-ws.ts` 已透传 `ask_user` 并处理 `user_response`，因此 MVP 不需要新增一种前端交互协议。

第一版只需增加一层门控调用和事件字段，例如 `uncertainty_score`、`uncertainty_reasons`、`decision`、`tool_name`；不要改变现有工具 schema 或重新设计聊天 UI。

### D. 只问“能改变行动”的问题

澄清问题生成规则沿用现有 task-brief 约束，并增加一个门槛：问题的答案必须能改变工具参数、工具选择、执行范围或风险判断。优先询问：

1. 目标对象：到底操作哪个文件、会话、账户、收件人或记录？
2. 范围和约束：时间区间、目录、数量、预算、格式或筛选条件？
3. 执行意图：只查看/预览，还是写入、发送、删除或购买？

一次最多 1–3 个问题；如果只有一个字段缺失，就只问一个。无法从用户回答中形成完整合法参数时，保持暂停，不允许门控替模型猜测。

## 最小实验设计

使用脱敏的历史轨迹或人工构造的 30–50 条任务，覆盖三类：

- 明确且低风险：应直接执行。
- 明确目标但缺关键参数：应澄清。
- 参数完整但高影响：应确认或沿用审批。

每条任务比较两个条件：当前基线 Agent，以及增加门控后的 Agent。记录：

- **必要澄清率**：被专家标记为“缺信息会改变结果”的任务中，成功提问的比例。
- **过度提问率**：本可直接完成的任务被追问的比例。
- **错误动作率**：工具名、关键参数或目标对象错误的比例。
- **首次成功率**：无需重试或用户纠正即完成的比例。
- **用户纠正率**：用户需要指出对象/范围错误的比例。
- **交互成本**：额外问题数、模型调用数和端到端延迟。
- **高影响拦截率**：发送、删除、购买等动作在关键字段不明确时被阻止的比例。

最小成功标准应是：在过度提问率和延迟可接受的前提下，错误动作率或用户纠正率下降；如果只增加问题数量而没有减少错误，不应继续扩大实现。

## 研究边界与风险

- **自评置信度不等于校准概率**：第一版报告排序/门控效果，不报告“80% 可靠”之类未经校准的概率。
- **不确定性来源要分开**：用户意图不清、模型知识不足、工具不可用、参数 schema 错误是不同问题；只有第一类主要适合通过询问用户解决。
- **不能把重采样分歧当真值**：同一模型的输出一致可能只是共同偏差；应把真实工具结果、用户纠正和人工标注作为最终标签。
- **澄清有成本**：每次问题都会增加延迟和认知负担；门控目标是最小化错误损失与交互成本的总和。
- **高风险动作仍需审批**：不确定性门控不能替代现有权限、审批、路径白名单和不可逆操作保护。

## 推荐的后续顺序

1. 先做只读工具的离线回放：只记录门控决策，不改变线上行为。
2. 用人工标注校准阈值，确认哪些字段缺失确实会改变结果。
3. 将 `clarify` 接到已有 `ask_user`，只在低风险工具上开启灰度。
4. 加入高影响工具的 `confirm` 分支，并与现有审批事件合并观测。
5. 只有当规则和重采样信号证明有稳定收益后，再研究专门的校准模型或训练方法。

## 参考来源

- Zhang, M. J. Q. & Choi, E. (2023). *Clarify When Necessary: Resolving Ambiguity Through Interaction with LMs*. <https://arxiv.org/abs/2311.09469>
- Zhang, M. J. Q., Knox, W. B. & Choi, E. (2025). *Modeling Future Conversation Turns to Teach LLMs to Ask Clarifying Questions*. ICLR 2025. <https://arxiv.org/abs/2410.13788>；<https://proceedings.iclr.cc/paper_files/paper/2025/file/97e2df4bb8b2f1913657344a693166a2-Paper-Conference.pdf>
- Zhou, Y. et al. (2026). *Exploring Agentic Tool-Calling Decisions via Uncertainty-Aligned Reinforcement Learning*. <https://arxiv.org/abs/2606.06976>
- Bouchard, D. & Chauhan, M. S. (2026). *Beyond Single-Turn Confidence: Trajectory-Adapted Uncertainty Quantification for LLM Agents*. <https://arxiv.org/abs/2608.11552>
- OpenAI. *Model Spec (2025-04-11)*. <https://model-spec.openai.com/2025-04-11.html>

## 项目内依据

- [task-brief 插件](../bun-backend/src/plugins/task-brief/index.ts)
- [task-brief 测试](../bun-backend/tests/plugins/task-brief.test.ts)
- [前端事件类型](../web/src/types/index.ts)
- [聊天事件处理](../web/src/composables/useChat.ts)
- [审批交互组件](../web/src/components/ApprovalBubble.vue)
- [聊天 WebSocket 路由](../bun-backend/src/routes/chat-ws.ts)



