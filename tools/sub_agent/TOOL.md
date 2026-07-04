# 子 Agent 领域知识

## call_sub_agent
创建一个独立的子 Agent 会话，将任务委派给子 Agent 执行单轮对话，子 Agent 的最终回答会作为工具返回值。

**使用场景**：
- 需要独立上下文窗口的复杂分析任务（如分析大文件）
- 多步骤搜索 + 汇总，需要子 Agent 独立进行工具调用
- 并行调用多个子 Agent 处理不同子问题

**参数**：
- `task`：子 Agent 的用户提示词（完整任务描述）
- `name`：可选，子会话的显示名称（用于侧边栏标识）

**注意事项**：
- 子 Agent 拥有独立上下文，不会污染主对话
- 子 Agent 只能执行一轮对话（单 turn）
- 子会话在前端侧边栏中以只读模式展示
- 嵌套深度限制为 2 层

## parallel_execute
并行启动多个子 Agent 执行独立任务，等待全部完成后聚合结果返回。

**使用场景**：
- 任务可拆分为多个互不依赖的子任务
- 需要同时搜索多个主题并汇总
- 同时分析多个文件或执行多个不相关查询

**参数**：
- `tasks`：JSON 数组字符串，每个元素包含 `task`（任务描述）和可选的 `name`（显示名称）

**示例**：
```json
[
  {"task": "搜索 Python 3.12 新特性", "name": "搜索 Python"},
  {"task": "分析项目目录结构", "name": "架构分析"}
]
```

**注意事项**：
- 最多同时并行 5 个子任务
- 每个子任务拥有独立上下文窗口
- 所有子任务完成后才返回聚合结果
- 超时时间为 180 秒

## executor 自动触发 parallel_execute（阶段 2.2）

当 Plan-and-Execute 模式（`enable_executor=True`）下的 planner 生成结构化计划时，
planner 会用 `[并行]` 标记互不依赖的步骤（详见 `agent/planner.py::extract_parallel_groups`）。
executor 节点检测到当前步骤属于并行组后，会自动注入 `[并行执行建议]` SystemMessage，
其中包含构造好的 `tasks` JSON 参数，**LLM 应直接调用 `parallel_execute` 工具**完成整组步骤，
无需自行拆分任务或逐个调用 `call_sub_agent`。

**触发条件**：
- 当前 `PlanStep.is_parallel == True`（planner 在解析阶段已标记）
- 同 `parallel_group` 的所有步骤会被一次性标记为 RUNNING 并推送 `plan_step_start` 事件

**LLM 行为约定**：
- 收到 `[并行执行建议]` 消息后，**必须**调用 `parallel_execute` 工具
- `tasks` 参数直接复用 SystemMessage 中给出的 JSON 数组（已按步骤顺序构造）
- 不要修改 `tasks` 内容（顺序/命名由 executor 保证与计划一致）
- 等待 `parallel_execute` 返回后汇总结果，再由 executor 推进到下一组步骤

**非并行步骤**：仍走原 `agent_node` 推理路径（ReAct 范式），不强制使用子 Agent。

**失败处理**：
- `parallel_execute` 失败时，executor 会按 `replan_threshold` 判断是否触发重规划
- 整组并行步骤会被一起标记为 FAILED/SKIPPED（详见 `agent/executor.py` 中并行组处理逻辑）
