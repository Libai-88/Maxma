# agent/stream_repair/__init__.py
"""流式响应修复管道 — 修复国产模型（GLM/DeepSeek/Moonshot）的不规范输出。

设计参考 Halo 的 base-stream-handler.ts：
- 空 turn 占位注入：GLM-4.7/5.1 产生既无文本又无 tool 调用的 turn
- tool 参数 JSON 修复：GLM-5 生成嵌套对象缺少闭合 } 的破损 JSON
- usage 回填：上游不返回 token 数时用字符累积估算

与 Maxma 现有 LangGraph 的关系：
- 在 agent_node 返回 AIMessage 之后做后处理
- 不修改 graph 结构，不影响 ReAct 循环路由逻辑
"""
from agent.stream_repair.empty_turn import is_empty_turn, inject_placeholder_if_needed

__all__ = ["is_empty_turn", "inject_placeholder_if_needed"]
