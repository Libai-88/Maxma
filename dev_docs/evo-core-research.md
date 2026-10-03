# Agent 低额外成本自我进化与人格成长：一手来源研究

研究日期：2026-10-03

## 研究边界

这里的“自我进化”指 Agent 在部署后通过任务反馈、记忆、反思和偏好信号改善后续行为；“人格成长”指稳定、可审计的交互偏好与工作习惯逐步形成。研究重点是低额外成本机制，不把部署中的自主改写基础模型权重视为默认方案。

来源只采用论文原文、论文作者/项目官方代码仓库或官方文档。论文实验结论与 Maxma 的工程建议分开记录。

## 结论

低额外成本的可行路径是把“学习”拆成四层，并按风险从低到高启用：

1. **会话内修正**：在一次任务中生成候选、得到反馈、有限次数反思并重试；不产生持久状态。
2. **长期记忆**：只写入经过结构化和门控的事实、偏好、失败模式与解决办法；后续按相关性和新鲜度检索。
3. **策略/偏好更新**：先更新可回滚的规则、提示片段或偏好档案，定期离线评估后再采纳；不要让单次对话直接改变全局策略。
4. **参数更新**：只有在有稳定数据集、固定评测集、回滚版本和人工/自动安全门槛时，才考虑小规模适配器或离线偏好训练。

这一路径与一手研究的共同启示一致：不改权重的语言反馈和外部记忆可以带来跨试次改进，且成本远低于传统强化学习或频繁微调；真正的参数更新应是批处理、可评估、可回滚的发布流程，而不是每次任务后的即时副作用。

## 一手研究发现

### 1. 测试时训练与持续学习：能学，但必须隔离更新范围

Sun 等人的 Test-Time Training 将一个无标签测试样本转成自监督任务，在预测前更新模型参数，并说明该方法可自然扩展到在线数据流；论文目标是应对训练分布与测试分布偏移。[Sun et al., *Test-Time Training with Self-Supervision for Generalization under Distribution Shifts*](https://arxiv.org/abs/1909.13231)

对 Agent 的直接启示是：测试时更新适合“当前环境适配”，不等于安全的永久人格学习。Maxma 若采用该思路，应把更新限制在任务级临时状态或可丢弃适配器，并在任务结束后通过固定回归集检查是否出现遗忘、漂移或安全退化。论文来自视觉分布偏移场景，不能直接证明语言 Agent 的人格会因此变好；这里的产品映射属于工程推论。

**低成本采用方式**：先不改基础模型权重，只更新本次任务的结构化上下文、工具使用策略草稿或临时 adapter；按任务边界销毁或回滚。只有当“更新后固定评测集不退化”时，才允许进入候选版本。

### 2. 记忆写入与检索：外部记忆是低成本的长期学习载体

Generative Agents 把观察、规划和反思组织成记忆流；记忆检索综合相关性、时间新鲜度和重要性，反思结果会被写回记忆并影响后续规划。[Park et al., *Generative Agents: Interactive Simulacra of Human Behavior*](https://arxiv.org/abs/2304.03442)

MemGPT 把有限上下文视为主存，把外部存储视为分页/层级记忆，并由 Agent 决定何时换入、换出上下文。[Packer et al., *MemGPT: Towards LLMs as Operating Systems*](https://arxiv.org/abs/2310.08560)

这两项工作支持一个低成本、可审计的设计：把长期学习放到外部存储，模型每次只支付少量检索 token；记忆条目带来源、时间、置信度、作用域和撤销状态。它们没有证明自动写入的事实始终正确，因此 Maxma 需要写入门槛和冲突处理。

**推荐记忆记录结构**：

```text
memory_id
scope: session | user | project | global
kind: fact | preference | strategy | failure | correction
content
source_event_ids
confidence
created_at / last_confirmed_at
status: candidate | accepted | superseded | revoked
sensitivity: normal | sensitive
```

### 3. 反思与自我修正：先用语言反馈，避免昂贵训练

Reflexion 明确提出：通过语言反馈强化 Agent，而不是更新模型权重；Agent 对任务反馈做文字反思，把反思文本放入 episodic memory，在后续试次影响决策。论文指出传统强化学习需要大量样本和昂贵微调，并报告了在顺序决策、代码和语言推理任务上的改进。[Shinn et al., *Reflexion: Language Agents with Verbal Reinforcement Learning*](https://arxiv.org/abs/2303.11366)

Self-Refine 使用同一个语言模型作为生成器、反馈器和改写器，通过迭代反馈和改写改善输出，不需要额外监督数据、训练或强化学习。[Madaan et al., *Self-Refine: Iterative Refinement with Self-Feedback*](https://arxiv.org/abs/2303.17651)；作者代码仓库：[madaan/self-refine](https://github.com/madaan/self-refine)

这些结果支持 Maxma 的第一阶段闭环：任务失败或用户纠正后，生成一条短的、结构化的“下次怎么做”记录，在下一次相似任务前检索；不要把完整思维链持久化。反思不能替代外部验证：如果反馈来源只是模型自评，错误可能被循环放大，所以应优先使用测试结果、工具返回值、编译器、用户明确纠正等可观察信号。

### 4. 偏好学习与策略更新：离线、批量、可回滚

InstructGPT 工作采用示范数据、人工排序和 RLHF，使模型更好地遵循用户意图；其流程是单独收集数据并训练奖励模型和策略，而不是让一次交互即时改写生产策略。[Ouyang et al., *Training language models to follow instructions with human feedback*](https://arxiv.org/abs/2203.02155)

DPO 把偏好优化改写成直接在偏好数据上的分类式目标，不需要显式训练独立奖励模型或在线强化学习循环；论文仍然讨论的是训练阶段的离线偏好数据，而不是无门槛的在线自我修改。[Rafailov et al., *Direct Preference Optimization: Your Language Model is Secretly a Reward Model*](https://arxiv.org/abs/2305.18290)

Maxma 的工程含义是：用户的显式选择、接受/拒绝、编辑和纠正可累计为偏好事件，但先进入候选偏好集；按批次去重、脱敏、分层评估，再更新可回滚的偏好档案或 adapter。全局行为变化至少需要固定回归集、偏好一致性检查和人工撤销入口。

### 5. 安全边界：把反馈、记忆和策略视为不可信输入

Constitutional AI 通过原则驱动的自我批评、改写和 AI 反馈训练来减少对人工标签的依赖；其核心方法仍然依赖明确原则和评估流程，而不是允许模型自行决定全部价值边界。[Bai et al., *Constitutional AI: Harmlessness from AI Feedback*](https://arxiv.org/abs/2212.08073)

据此，Maxma 的安全边界应固定在系统外部：不可由记忆条目或单次反思覆盖。尤其要防止“提示注入→写入记忆→未来检索→扩大权限”的闭环。安全相关记忆必须带来源、作用域和审批状态；工具权限、文件路径白名单、网络与外部副作用规则由系统策略执行，不能由 Agent 自我更新。

## Maxma 可验证的最小机制（MVP）

### A. 事件到记忆的最小闭环

1. 每次任务结束只提取三类候选：用户明确偏好、可复现失败与修正、稳定的项目事实。
2. 候选必须包含来源事件 ID、作用域、时间和置信度；默认状态为 `candidate`。
3. 只有用户明确纠正/确认，或同一事实在独立任务中重复得到外部验证，才转为 `accepted`。
4. 检索只返回与当前任务相关、未撤销且作用域匹配的少量条目；冲突时优先最新确认记录，并提示冲突。
5. 记忆可被用户查看、撤销和导出；敏感信息默认不写入长期记忆。

### B. 任务内自我修正

- 首次结果后，仅在存在可观察失败信号或用户要求时触发一次反思；最多 2 次修正循环。
- 反思输出固定为：`failure`、`evidence`、`next_action`、`confidence`，不保存完整隐藏推理。
- 只有修正后的结果通过原始验证器，才计为成功；模型自评不能单独作为通过条件。

### C. 偏好与策略更新

- 把接受/拒绝/编辑转为偏好事件，不直接更新全局提示词或模型权重。
- 每个版本绑定数据快照、评测结果和回滚点。
- 先更新用户/项目级偏好档案；全局策略只通过离线批处理候选发布。

### D. 成本闸门

- 默认路径：一次生成 + 必要时一次反思 + 一次检索；不为每轮对话运行训练。
- 记忆检索设置 token 上限、条目数上限和 TTL/衰减；重复或低价值条目合并。
- 只有出现稳定的任务级收益，才允许启用更昂贵的离线 DPO/adapter 实验。
- 对每个自我改进动作记录额外 token、延迟、工具调用次数和失败率，以便计算净收益。

## 指标与验收标准

### 质量

- **重复纠正率**：同一用户/项目规则在后续相似任务中再次被纠正的比例；目标是随版本下降。
- **任务成功率**：通过外部测试器、编译、API 响应或人工验收的比例。
- **反思收益**：启用反思后的成功率减去匹配任务上不启用反思的成功率。
- **记忆有效命中率**：被检索且实际影响正确决策的记忆条目数 / 被检索条目数。
- **遗忘率**：更新或新增记忆后，固定回归集原有能力下降比例。

### 成本

- **每次成功的增量成本**：`(额外 token 成本 + 额外延迟成本 + 失败重试成本) / 新增成功任务数`。
- **反思开销**：触发反思的任务中，额外模型调用数、token 数和 p95 延迟。
- **记忆开销**：每次请求检索 token、存储条目数、过期/合并比例。
- **更新收益密度**：单位额外 token 带来的成功率提升或重复纠正下降。

### 安全与可控性

- **越权改写率**：记忆或反思导致权限、工具白名单或安全策略发生改变的次数；目标为 0。
- **污染接受率**：含提示注入、错误事实或敏感数据的候选被写入 `accepted` 的比例。
- **撤销生效时间**：用户撤销记忆后，后续请求不再使用该记忆的时间。
- **回滚成功率**：发布候选策略后，能否恢复到上一个稳定版本。
- **安全回归通过率**：候选版本在固定安全测试集上的通过比例，且不得低于当前生产版本。

## 分阶段实施建议

**阶段 1：只做记忆与任务内反思。** 目标是验证“有证据的修正是否减少重复错误”，不更新模型权重。实现候选记忆、检索、撤销、一次反思和外部验证器。

**阶段 2：做用户/项目级偏好档案。** 把显式确认和稳定编辑模式转为可回滚档案，测量偏好一致性和错误适配率。全局提示和工具策略保持冻结。

**阶段 3：离线评估适配器或 DPO。** 仅使用脱敏、去重、带 provenance 的数据；每个候选版本先跑质量、成本和安全回归，再由发布闸门决定是否可用。

**不建议作为 MVP 的机制**：每轮对话后直接微调基础模型；允许模型自动写入全局人格；把模型自评当作唯一奖励；把完整隐藏推理长期存储；让记忆内容改变权限或安全规则。

## 参考来源

1. Sun, Yu et al. *Test-Time Training with Self-Supervision for Generalization under Distribution Shifts*. ICML 2020. https://arxiv.org/abs/1909.13231
2. Park, Joon Sung et al. *Generative Agents: Interactive Simulacra of Human Behavior*. UIST 2023. https://arxiv.org/abs/2304.03442
3. Packer, Charles et al. *MemGPT: Towards LLMs as Operating Systems*. arXiv 2023. https://arxiv.org/abs/2310.08560
4. Shinn, Noah et al. *Reflexion: Language Agents with Verbal Reinforcement Learning*. arXiv 2023. https://arxiv.org/abs/2303.11366
5. Madaan, Aman et al. *Self-Refine: Iterative Refinement with Self-Feedback*. NeurIPS 2023. https://arxiv.org/abs/2303.17651
6. Ouyang, Long et al. *Training language models to follow instructions with human feedback*. NeurIPS 2022. https://arxiv.org/abs/2203.02155
7. Rafailov, Rafael et al. *Direct Preference Optimization: Your Language Model is Secretly a Reward Model*. NeurIPS 2023. https://arxiv.org/abs/2305.18290
8. Bai, Yuntao et al. *Constitutional AI: Harmlessness from AI Feedback*. Anthropic / arXiv 2022. https://arxiv.org/abs/2212.08073
9. Madaan et al. official Self-Refine repository. https://github.com/madaan/self-refine

## 证据边界

上述论文证明的是特定实验设置下的改进或训练方法，不能直接推出 Maxma 在所有任务上会提升，也不能证明“人格”是稳定、真实的内部属性。Maxma 的最小机制应以外部可观察结果、固定回归集、成本记录和安全闸门验收；任何参数更新都应被视为候选版本发布流程，而不是 Agent 自主权力。
