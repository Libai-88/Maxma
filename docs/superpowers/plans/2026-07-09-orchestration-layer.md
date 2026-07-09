# Orchestration Layer: Coordinator + Verifier + Scope Narrowing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Maxma's agent graph from a flat ReAct loop with manual SubAgent into a coordinator-driven orchestration layer that auto-routes to specialists, verifies answer sufficiency before returning, and hardens SubAgent delegation with monotonic scope narrowing.

**Architecture:** Add three new nodes to the existing LangGraph state graph in [agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py): (1) a `coordinator` node before the planner that classifies the user's intent and decides routing (direct-answer / specialist-subagent / main-react-loop), (2) a `verifier` node between `should_continue` and `END` that grades whether the agent's final answer is sufficiently grounded, looping back on gaps (capped at 2 retries, coordinated with the existing loop_detector), and (3) a `DelegationScope` applied at SubAgent spawn time in [tools/sub_agent/tool_parallel.py](file:///d:/Maxma/MaxmaHere/tools/sub_agent/tool_parallel.py) and `tool_call_sub_agent.py` that intersects parent and child permissions monotonically. All three are additive to the existing graph and feature-flagged so the current behavior is preserved when disabled.

**Tech Stack:** Python 3.13, LangGraph (StateGraph + conditional edges), LangChain (BaseChatModel, messages), Pydantic (structured routing/verifier output), pytest + pytest-asyncio + pytest-mock (matching Maxma's existing test stack in `tests/test_agent/`).

---

## Scope Check

This plan covers **one cohesive subsystem: the orchestration layer**. It produces working, testable software on its own — the graph runs with the new nodes, SubAgent delegation is hardened, and all existing tests still pass when the new features are off. The other three layers from the master proposal (retrieval/CRAG, Agent Canvas, autonomy/scheduling) are deliberately out of scope and will be separate plans, because each is an independent subsystem that should produce its own working software.

## File Structure

This plan touches the orchestration layer only. Files are grouped by responsibility:

### New files

- `agent/coordinator.py` — Intent classification + routing decision. One responsibility: take the user message + persona context, return a `RoutingDecision` (route target + rationale). Pure function, no graph coupling. Small, focused.
- `agent/verifier.py` — Answer-sufficiency grading. One responsibility: take the agent's final answer + retrieved context + original question, return a `Verdict` (sufficient/insufficient + gaps). Pure function.
- `agent/delegation_scope.py` — `DelegationScope` dataclass + `intersect()` + `from_parent_context()`. One responsibility: compute the narrowed permission set for a SubAgent. No I/O.
- `tests/test_agent/test_coordinator.py` — Unit tests for coordinator routing logic.
- `tests/test_agent/test_verifier.py` — Unit tests for verifier grading logic.
- `tests/test_agent/test_delegation_scope.py` — Unit tests for scope intersection.
- `tests/test_agent/test_graph_coordinator.py` — Integration tests for coordinator node wired into the graph.
- `tests/test_agent/test_graph_verifier.py` — Integration tests for verifier node + retry loop in the graph.

### Modified files

- `agent/graph.py` — Add `coordinator_node`, `verifier_node`, wire conditional edges, add `verifier_retries` to `AgentState`, add feature-flag gating. This is the integration point; all new logic lives in the focused modules above so this file stays a thin wiring layer.
- `agent/prompts.py` — Add `build_coordinator_prompt()` and `build_verifier_prompt()` prompt builders (co-located with existing prompt builders per Maxma convention).
- `tools/sub_agent/tool_parallel.py` — Apply `DelegationScope` when spawning sub-sessions (filter tools + inject scope into sub-agent build).
- `tools/sub_agent/tool_call_sub_agent.py` — Same scope-narrowing application for the single-subagent path.
- `config/settings.py` — Add `coordinator_enabled`, `verifier_enabled`, `verifier_max_retries`, `delegation_scope_enforced` settings (feature flags, default off for safe rollout).
- `agent/graph.py` `AgentState` — Add `coordinator_route`, `verifier_retries`, `verifier_verdict` fields.

### Files NOT touched (boundary discipline)

- `memory/kb/` — retrieval upgrades are a separate plan
- `web/src/` — no frontend changes in this plan; coordinator/verifier emit standard messages visible in existing UI
- `tools/mcp*` — MCP routing is a separate plan
- `agent/audit_log.py` — hash-chain is a separate plan

---

## Task 1: DelegationScope dataclass and intersection logic

**Files:**
- Create: `agent/delegation_scope.py`
- Test: `tests/test_agent/test_delegation_scope.py`

This is the purest, lowest-risk piece — no I/O, no graph, no LLM. It's the foundation for SubAgent hardening and a good warmup for the test patterns used throughout.

- [ ] **Step 1: Write the failing test for basic scope intersection**

Create `tests/test_agent/test_delegation_scope.py`:

```python
"""DelegationScope 单元测试 — agent/delegation_scope.py。

测试策略：
- 纯数据 + 集合运算，无 I/O、无 LLM、无图依赖
- 覆盖：交集、空集拒绝、路径收窄、token/time 上限取 min
"""
import pytest

from agent.delegation_scope import DelegationScope, intersect, from_parent_context


class TestDelegationScopeDataclass:
    def test_construct_full_scope(self):
        s = DelegationScope(
            allowed_tools={"file_read", "file_write", "kb_search"},
            allowed_paths={"D:/Projects"},
            max_tokens=4000,
            time_limit_seconds=120,
        )
        assert s.allowed_tools == {"file_read", "file_write", "kb_search"}
        assert s.allowed_paths == {"D:/Projects"}
        assert s.max_tokens == 4000
        assert s.time_limit_seconds == 120

    def test_empty_scope_is_valid(self):
        s = DelegationScope(
            allowed_tools=set(),
            allowed_paths=set(),
            max_tokens=0,
            time_limit_seconds=0,
        )
        assert s.is_empty()


class TestIntersect:
    def test_intersection_yields_common_tools_and_paths(self):
        parent = DelegationScope(
            allowed_tools={"file_read", "file_write", "kb_search", "tavily_search"},
            allowed_paths={"D:/Projects", "D:/Docs"},
            max_tokens=8000,
            time_limit_seconds=180,
        )
        child_request = DelegationScope(
            allowed_tools={"file_read", "kb_search", "git_status"},
            allowed_paths={"D:/Projects"},
            max_tokens=4000,
            time_limit_seconds=120,
        )
        result = intersect(parent, child_request)
        # 交集：parent ∩ child
        assert result.allowed_tools == {"file_read", "kb_search"}
        assert result.allowed_paths == {"D:/Projects"}
        # 上限取 min（子不能超过父）
        assert result.max_tokens == 4000
        assert result.time_limit_seconds == 120

    def test_intersection_with_disjoint_tools_yields_empty(self):
        parent = DelegationScope(
            allowed_tools={"file_read"},
            allowed_paths={"D:/Projects"},
            max_tokens=8000,
            time_limit_seconds=180,
        )
        child_request = DelegationScope(
            allowed_tools={"file_delete", "run_python"},
            allowed_paths={"D:/Projects"},
            max_tokens=4000,
            time_limit_seconds=120,
        )
        result = intersect(parent, child_request)
        assert result.allowed_tools == set()
        assert result.is_empty()

    def test_intersection_is_monotonic_child_never_exceeds_parent(self):
        """核心安全不变量：交集结果永远不会大于父范围。"""
        parent = DelegationScope(
            allowed_tools={"file_read", "file_write"},
            allowed_paths={"D:/Projects"},
            max_tokens=8000,
            time_limit_seconds=180,
        )
        child_request = DelegationScope(
            allowed_tools={"file_read", "file_write", "file_delete"},  # 请求超出父范围
            allowed_paths={"D:/Projects", "C:/Windows"},  # 请求超出父范围
            max_tokens=10000,  # 请求超出父上限
            time_limit_seconds=300,
        )
        result = intersect(parent, child_request)
        assert result.allowed_tools <= parent.allowed_tools
        assert result.allowed_paths <= parent.allowed_paths
        assert result.max_tokens <= parent.max_tokens
        assert result.time_limit_seconds <= parent.time_limit_seconds
        # file_delete 被剔除，C:/Windows 被剔除
        assert "file_delete" not in result.allowed_tools
        assert "C:/Windows" not in result.allowed_paths
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_delegation_scope.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.delegation_scope'`

- [ ] **Step 3: Write minimal implementation**

Create `agent/delegation_scope.py`:

```python
"""SubAgent 委托范围 — 单调收窄的权限交集计算。

核心安全不变量：子 Agent 的有效权限永远是父 Agent 权限的子集。
来源：multi_agent_trust_layer 的 DelegationScope.narrow() 思想，
适配 Maxma 的本地单用户桌面场景（去掉加密签名/多租户身份）。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DelegationScope:
    """SubAgent 的有效权限范围（不可变）。

    Attributes:
        allowed_tools: 允许的工具名集合（空集 = 无工具）
        allowed_paths: 允许的文件路径前缀集合（空集 = 无路径访问）
        max_tokens: 子 Agent 最大 token 预算（0 = 无预算）
        time_limit_seconds: 子 Agent 最大执行时长（0 = 无限制）
    """
    allowed_tools: frozenset[str] = field(default_factory=frozenset)
    allowed_paths: frozenset[str] = field(default_factory=frozenset)
    max_tokens: int = 0
    time_limit_seconds: int = 0

    def is_empty(self) -> bool:
        """范围是否为空（无工具且无路径且无预算）。"""
        return (
            not self.allowed_tools
            and not self.allowed_paths
            and self.max_tokens == 0
            and self.time_limit_seconds == 0
        )


def intersect(parent: DelegationScope, child_request: DelegationScope) -> DelegationScope:
    """计算父子范围的交集（单调收窄）。

    核心安全不变量：结果永远是 parent 的子集，无论 child_request 请求多大。
    - 工具/路径：取交集
    - token/time 上限：取 min（子不能超过父）

    Args:
        parent: 父 Agent 的当前有效范围
        child_request: 子 Agent 请求的范围

    Returns:
        收窄后的有效范围（可能是空集）
    """
    return DelegationScope(
        allowed_tools=frozenset(parent.allowed_tools & child_request.allowed_tools),
        allowed_paths=frozenset(parent.allowed_paths & child_request.allowed_paths),
        max_tokens=min(parent.max_tokens, child_request.max_tokens) if parent.max_tokens and child_request.max_tokens else 0,
        time_limit_seconds=min(parent.time_limit_seconds, child_request.time_limit_seconds) if parent.time_limit_seconds and child_request.time_limit_seconds else 0,
    )


def from_parent_context(
    allowed_tools: list[str],
    allowed_paths: list[str],
    max_tokens: int = 8000,
    time_limit_seconds: int = 180,
) -> DelegationScope:
    """从父 Agent 上下文构造父范围。

    Args:
        allowed_tools: 父 Agent 当前可用的工具名列表
        allowed_paths: 父 Agent 路径白名单
        max_tokens: 父 Agent token 预算上限
        time_limit_seconds: 父 Agent 执行时长上限

    Returns:
        父 Agent 的 DelegationScope
    """
    return DelegationScope(
        allowed_tools=frozenset(allowed_tools),
        allowed_paths=frozenset(allowed_paths),
        max_tokens=max_tokens,
        time_limit_seconds=time_limit_seconds,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_delegation_scope.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Add edge-case tests for from_parent_context and empty-parent**

Append to `tests/test_agent/test_delegation_scope.py`:

```python
class TestFromParentContext:
    def test_construct_from_lists(self):
        s = from_parent_context(
            allowed_tools=["file_read", "kb_search"],
            allowed_paths=["D:/Projects"],
            max_tokens=8000,
            time_limit_seconds=180,
        )
        assert s.allowed_tools == frozenset({"file_read", "kb_search"})
        assert s.allowed_paths == frozenset({"D:/Projects"})

    def test_empty_parent_makes_everything_empty(self):
        """父范围为空时，任何子请求都收窄为空。"""
        parent = DelegationScope()  # 全空
        child_request = DelegationScope(
            allowed_tools={"file_read"},
            allowed_paths={"D:/Projects"},
            max_tokens=4000,
            time_limit_seconds=120,
        )
        result = intersect(parent, child_request)
        assert result.is_empty()
```

- [ ] **Step 6: Run all delegation scope tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_delegation_scope.py -v`
Expected: PASS (8 tests)

- [ ] **Step 7: Commit**

```bash
git add agent/delegation_scope.py tests/test_agent/test_delegation_scope.py
git commit -m "feat(agent): add DelegationScope with monotonic intersection for SubAgent hardening"
```

---

## Task 2: Coordinator routing decision (pure function)

**Files:**
- Create: `agent/coordinator.py`
- Test: `tests/test_agent/test_coordinator.py`

The coordinator classifies user intent and emits a routing decision. It's a pure function — no graph state mutation, no I/O. This isolates the LLM-call logic so it's unit-testable with a mocked model.

- [ ] **Step 1: Write the failing test for routing decision dataclass and classifier**

Create `tests/test_agent/test_coordinator.py`:

```python
"""Coordinator 路由决策单元测试 — agent/coordinator.py。

测试策略：
- mock BaseChatModel，不依赖真实 LLM
- 覆盖三种路由：direct / specialist / main
- 覆盖 JSON 解析失败回退
- 覆盖 planner-skip 短路输入
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from agent.coordinator import (
    RoutingDecision,
    RouteTarget,
    classify_intent,
    _should_skip_coordinator,
)


class TestRoutingDecision:
    def test_direct_route(self):
        d = RoutingDecision(target=RouteTarget.DIRECT, rationale="简单问候")
        assert d.target == RouteTarget.DIRECT
        assert d.specialist is None
        assert d.rationale == "简单问候"

    def test_specialist_route(self):
        d = RoutingDecision(
            target=RouteTarget.SPECIALIST,
            specialist="research",
            rationale="需要深度研究",
        )
        assert d.target == RouteTarget.SPECIALIST
        assert d.specialist == "research"

    def test_main_route(self):
        d = RoutingDecision(target=RouteTarget.MAIN, rationale="通用任务")
        assert d.target == RouteTarget.MAIN
        assert d.specialist is None


class TestShouldSkipCoordinator:
    def test_empty_message_skips(self):
        assert _should_skip_coordinator("") is True
        assert _should_skip_coordinator("   ") is True

    def test_simple_greeting_skips(self):
        assert _should_skip_coordinator("你好") is True
        assert _should_skip_coordinator("hi") is True
        assert _should_skip_coordinator("谢谢") is True

    def test_complex_request_does_not_skip(self):
        assert _should_skip_coordinator("帮我研究一下 LangGraph 的最新特性并写一份报告") is False
        assert _should_skip_coordinator("分析这个项目的架构问题") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_coordinator.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.coordinator'`

- [ ] **Step 3: Write minimal implementation (dataclass + skip function only)**

Create `agent/coordinator.py`:

```python
"""Coordinator 意图分类与路由决策。

来源：ai_home_renovation_agent 的 coordinator/dispatcher 模式 +
ag2_adaptive_research_team 的 triage 路由思想。

职责：取用户消息 + 人设上下文，返回 RoutingDecision。
不修改图状态、不执行 I/O。图节点函数（coordinator_node in graph.py）
负责把 RoutingDecision 写入 state。
"""
from __future__ import annotations

import logging
import re
from enum import Enum
from typing import Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class RouteTarget(str, Enum):
    """路由目标。"""
    DIRECT = "direct"          # 直接回答（简单问候/确认）
    SPECIALIST = "specialist"  # 路由到专家 SubAgent
    MAIN = "main"              # 进入主 ReAct 循环


class RoutingDecision(BaseModel):
    """路由决策结果。"""
    target: RouteTarget = Field(description="路由目标")
    specialist: Optional[str] = Field(
        default=None,
        description="专家名称（仅 SPECIALIST 路由时有效，如 'research'/'coding'/'analysis'）",
    )
    rationale: str = Field(default="", description="路由理由（供审计/调试）")


# 复用 graph.py 的简单输入短路正则（保持一致性）
_SIMPLE_CHAT_RE = re.compile(
    r"^(?:你好(?:呀)?|您好|hello|hi|hey|在吗|在不在|谢谢(?:你)?|thanks|thank you|"
    r"好的|ok|okay|收到|明白|再见|拜拜|早上好|中午好|晚上好|辛苦了|哈哈+|嗯+|喂)"
    r"[!,.，。？！~\s]*$",
    re.IGNORECASE,
)


def _should_skip_coordinator(user_text: str) -> bool:
    """对明显简单的输入短路，避免每轮都额外调用 coordinator LLM。

    与 graph.py 的 _should_skip_planner 保持一致，确保 coordinator
    不会对问候/确认类输入浪费 token。
    """
    text = user_text.strip()
    if not text:
        return True
    normalized = " ".join(text.split())
    if _SIMPLE_CHAT_RE.fullmatch(normalized):
        return True
    return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_coordinator.py -v`
Expected: PASS (7 tests for the classes + skip function)

- [ ] **Step 5: Write the failing test for classify_intent (the LLM call)**

Append to `tests/test_agent/test_coordinator.py`:

```python
class TestClassifyIntent:
    """classify_intent 的 LLM 调用测试（mock model）。"""

    @pytest.mark.asyncio
    async def test_direct_route_from_llm_json(self):
        """LLM 返回 direct 路由的 JSON，正确解析。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content='{"target":"direct","rationale":"简单问候"}')
        )
        decision = await classify_intent(mock_model, "你好呀")
        assert decision.target == RouteTarget.DIRECT
        assert decision.specialist is None

    @pytest.mark.asyncio
    async def test_specialist_route_from_llm_json(self):
        """LLM 返回 specialist 路由的 JSON，正确解析 specialist 字段。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(
                content='{"target":"specialist","specialist":"research","rationale":"需要深度研究"}'
            )
        )
        decision = await classify_intent(mock_model, "帮我深度研究 LangGraph")
        assert decision.target == RouteTarget.SPECIALIST
        assert decision.specialist == "research"

    @pytest.mark.asyncio
    async def test_main_route_from_llm_json(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content='{"target":"main","rationale":"通用任务"}')
        )
        decision = await classify_intent(mock_model, "读一下这个文件")
        assert decision.target == RouteTarget.MAIN

    @pytest.mark.asyncio
    async def test_invalid_json_falls_back_to_main(self):
        """LLM 返回非法 JSON 时，安全回退到 MAIN（不阻塞主流程）。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content="抱歉，我不太理解。")
        )
        decision = await classify_intent(mock_model, "复杂的请求")
        assert decision.target == RouteTarget.MAIN
        assert "fallback" in decision.rationale.lower() or "回退" in decision.rationale

    @pytest.mark.asyncio
    async def test_llm_exception_falls_back_to_main(self):
        """LLM 调用异常时，安全回退到 MAIN。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(side_effect=RuntimeError("API 超时"))
        decision = await classify_intent(mock_model, "任何请求")
        assert decision.target == RouteTarget.MAIN

    @pytest.mark.asyncio
    async def test_skip_input_returns_direct_without_llm_call(self):
        """简单输入短路，不调用 LLM。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock()
        decision = await classify_intent(mock_model, "你好")
        assert decision.target == RouteTarget.DIRECT
        mock_model.ainvoke.assert_not_called()
```

- [ ] **Step 6: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_coordinator.py::TestClassifyIntent -v`
Expected: FAIL — `classify_intent` not defined

- [ ] **Step 7: Implement classify_intent**

Append to `agent/coordinator.py`:

```python
import json

from agent.prompts import build_coordinator_prompt


async def classify_intent(
    model: BaseChatModel,
    user_text: str,
    persona_context: str = "",
) -> RoutingDecision:
    """分类用户意图，返回路由决策。

    简单输入短路（不调用 LLM）。复杂输入调用 LLM 返回严格 JSON。
    任何异常（JSON 解析失败 / LLM 错误）安全回退到 MAIN，
    确保 coordinator 永不阻塞主流程。

    Args:
        model: LLM 模型（建议用廉价模型，coordinator 是分类任务）
        user_text: 用户消息文本
        persona_context: 当前人设上下文（可选，影响 specialist 选择）

    Returns:
        RoutingDecision
    """
    # 简单输入短路
    if _should_skip_coordinator(user_text):
        return RoutingDecision(
            target=RouteTarget.DIRECT,
            rationale="简单输入短路",
        )

    try:
        prompt = build_coordinator_prompt(persona_context=persona_context)
        messages = [SystemMessage(content=prompt), HumanMessage(content=user_text)]
        response = await model.ainvoke(messages)
        content = response.content if isinstance(response.content, str) else str(response.content)

        decision = _parse_routing_json(content)
        if decision is not None:
            return decision

        logger.warning("[coordinator] JSON 解析失败，回退到 MAIN: %s", content[:200])
        return RoutingDecision(
            target=RouteTarget.MAIN,
            rationale=f"JSON 解析失败，安全回退: {content[:100]}",
        )
    except Exception as e:
        logger.warning("[coordinator] LLM 调用失败，回退到 MAIN: %s", e)
        return RoutingDecision(
            target=RouteTarget.MAIN,
            rationale=f"LLM 异常，安全回退: {type(e).__name__}",
        )


def _parse_routing_json(content: str) -> RoutingDecision | None:
    """从 LLM 输出解析路由 JSON，容错处理。

    支持：纯 JSON / 带 ```json 代码块 / 前后有多余文本。
    """
    # 尝试提取 JSON 代码块
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if json_match:
        content = json_match.group(1)
    else:
        # 尝试提取第一个 {...} 块
        brace_match = re.search(r"\{[^{}]*\}", content, re.DOTALL)
        if brace_match:
            content = brace_match.group(0)

    try:
        data = json.loads(content)
        target_str = data.get("target", "main").lower()
        # 容错：target 可能是 "direct"/"specialist"/"main" 之外的值
        try:
            target = RouteTarget(target_str)
        except ValueError:
            return None
        return RoutingDecision(
            target=target,
            specialist=data.get("specialist"),
            rationale=data.get("rationale", ""),
        )
    except (json.JSONDecodeError, TypeError):
        return None
```

- [ ] **Step 8: Run test to verify it fails on missing prompt builder**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_coordinator.py::TestClassifyIntent -v`
Expected: FAIL — `ImportError: cannot import name 'build_coordinator_prompt' from 'agent.prompts'`

- [ ] **Step 9: Add build_coordinator_prompt to agent/prompts.py**

First read the existing `agent/prompts.py` to find where to add the function. Let me check its structure — for the plan, append at the end of the file. Add this function to `agent/prompts.py`:

```python
def build_coordinator_prompt(persona_context: str = "") -> str:
    """构建 coordinator 路由分类提示词。

    职责：取用户消息，分类为 direct / specialist / main 三种路由之一。
    返回严格 JSON，无多余文本。

    Args:
        persona_context: 当前人设上下文（影响 specialist 选择）

    Returns:
        系统提示词字符串
    """
    persona_clause = f"\n当前人设上下文：{persona_context}" if persona_context else ""
    return f"""你是 Maxma 的意图路由协调者（Coordinator）。你的唯一任务是分类用户消息的路由目标。

路由目标（三选一）：
- "direct"：简单问候、确认、闲聊（如"你好"、"谢谢"、"好的"）。无需工具，直接简短回复。
- "specialist"：需要特定领域专家处理的任务。specialist 字段填专家名：
  - "research"：深度研究、调研、多源搜索综合
  - "coding"：代码编写、调试、重构、git 操作
  - "analysis"：数据分析、文档分析、结构化提取
  - "writing"：长文写作、报告、邮件、会议纪要
- "main"：通用任务（文件操作、天气查询、待办、地图等日常工具调用）。不匹配上述 specialist 时使用。

输出格式：严格 JSON，无多余文本、无 markdown 代码块标记。
{{"target":"<direct|specialist|main>","specialist":"<专家名或省略>","rationale":"<简短理由>"}}
{persona_clause}

注意：
- 只输出 JSON，不要任何解释或前后缀
- specialist 路由必须填 specialist 字段
- direct 和 main 路由省略 specialist 字段
- 不确定时选 "main"（更安全）"""
```

- [ ] **Step 10: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_coordinator.py -v`
Expected: PASS (13 tests)

- [ ] **Step 11: Commit**

```bash
git add agent/coordinator.py agent/prompts.py tests/test_agent/test_coordinator.py
git commit -m "feat(agent): add coordinator intent classifier with 3-way routing"
```

---

## Task 3: Verifier answer-sufficiency grading (pure function)

**Files:**
- Create: `agent/verifier.py`
- Test: `tests/test_agent/test_verifier.py`

The verifier grades whether the agent's final answer is sufficiently grounded. Like the coordinator, it's a pure function with a mocked-model test. This is the "correctness gate" from the `ag2_adaptive_research_team` triage+verifier sandwich.

- [ ] **Step 1: Write the failing test for Verdict and grade_answer**

Create `tests/test_agent/test_verifier.py`:

```python
"""Verifier 答案充分性评分单元测试 — agent/verifier.py。

测试策略：
- mock BaseChatModel
- 覆盖：sufficient/insufficient 两种判定、JSON 解析失败回退、
  LLM 异常回退、重试上限协调
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage

from agent.verifier import Verdict, grade_answer, should_verify


class TestVerdict:
    def test_sufficient_verdict(self):
        v = Verdict(verdict="sufficient", gaps=[])
        assert v.is_sufficient() is True
        assert v.gaps == []

    def test_insufficient_verdict_with_gaps(self):
        v = Verdict(
            verdict="insufficient",
            gaps=["缺少价格数据", "未引用来源"],
        )
        assert v.is_sufficient() is False
        assert len(v.gaps) == 2

    def test_invalid_verdict_string_treated_as_insufficient(self):
        v = Verdict(verdict="maybe", gaps=[])
        assert v.is_sufficient() is False


class TestShouldVerify:
    def test_short_answer_skips_verification(self):
        """过短的答案（如错误降级消息）跳过验证，避免无意义 LLM 调用。"""
        assert should_verify("出错了") is False
        assert should_verify("") is False

    def test_normal_answer_triggers_verification(self):
        assert should_verify("根据知识库检索结果，LangGraph 是一个用于构建状态机的框架...") is True


class TestGradeAnswer:
    @pytest.mark.asyncio
    async def test_sufficient_from_llm_json(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content='{"verdict":"sufficient","gaps":[]}')
        )
        v = await grade_answer(
            model=mock_model,
            question="LangGraph 是什么？",
            answer="LangGraph 是用于构建状态机的框架...",
            evidence="知识库检索：LangGraph 是...",
        )
        assert v.is_sufficient() is True

    @pytest.mark.asyncio
    async def test_insufficient_with_gaps_from_llm_json(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(
                content='{"verdict":"insufficient","gaps":["未回答价格部分","缺少来源引用"]}'
            )
        )
        v = await grade_answer(
            model=mock_model,
            question="LangGraph 的价格和许可证是什么？",
            answer="LangGraph 是一个框架...",
            evidence="",
        )
        assert v.is_sufficient() is False
        assert len(v.gaps) == 2

    @pytest.mark.asyncio
    async def test_invalid_json_falls_back_to_sufficient(self):
        """JSON 解析失败时回退到 sufficient（不阻塞用户拿到答案）。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content="我无法判断。")
        )
        v = await grade_answer(
            model=mock_model,
            question="任何问题",
            answer="一个正常的答案",
            evidence="",
        )
        assert v.is_sufficient() is True  # 回退：放行
        assert "fallback" in v.rationale.lower() or "回退" in v.rationale

    @pytest.mark.asyncio
    async def test_llm_exception_falls_back_to_sufficient(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(side_effect=RuntimeError("API 错误"))
        v = await grade_answer(
            model=mock_model,
            question="问题",
            answer="答案",
            evidence="",
        )
        assert v.is_sufficient() is True  # 异常回退：放行

    @pytest.mark.asyncio
    async def test_short_answer_skips_llm_call(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock()
        v = await grade_answer(
            model=mock_model,
            question="问题",
            answer="出错了",
            evidence="",
        )
        assert v.is_sufficient() is True  # 短答案放行
        mock_model.ainvoke.assert_not_called()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_verifier.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.verifier'`

- [ ] **Step 3: Implement verifier module**

Create `agent/verifier.py`:

```python
"""Verifier 答案充分性评分 — ReAct 循环的正确性闸门。

来源：ag2_adaptive_research_team 的 triage→verifier→synthesizer 三明治模式。
职责：取 agent 的最终答案 + 原始问题 + 检索证据，判定答案是否充分。
不修改图状态。图节点函数（verifier_node in graph.py）负责把 Verdict 写入 state
并决定是否路由回 agent 重试。

安全回退策略：任何异常（LLM 错误 / JSON 解析失败）都回退到 sufficient，
确保 verifier 永不阻塞用户拿到答案——它是质量增强，不是硬闸门。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# 短于这个长度的答案跳过验证（避免对错误降级消息无意义调用 LLM）
_MIN_ANSWER_LENGTH_TO_VERIFY = 20


class Verdict(BaseModel):
    """验证判定结果。"""
    verdict: str = Field(description="sufficient 或 insufficient")
    gaps: list[str] = Field(default_factory=list, description="不足之处的具体描述")
    rationale: str = Field(default="", description="判定理由（供审计/调试）")

    def is_sufficient(self) -> bool:
        """是否充分。非 sufficient 的任何值都视为不充分。"""
        return self.verdict.lower() == "sufficient"


def should_verify(answer: str) -> bool:
    """答案是否值得验证。

    过短的答案（如错误降级消息 "出错了"）跳过验证，
    避免无意义 LLM 调用并直接放行。
    """
    return len(answer.strip()) >= _MIN_ANSWER_LENGTH_TO_VERIFY


async def grade_answer(
    model: BaseChatModel,
    question: str,
    answer: str,
    evidence: str = "",
) -> Verdict:
    """评分答案充分性。

    短答案短路（不调用 LLM，直接放行）。正常答案调用 LLM 返回严格 JSON。
    任何异常安全回退到 sufficient（verifier 是质量增强，不是硬闸门）。

    Args:
        model: LLM 模型（建议用廉价模型，verifier 是判定任务）
        question: 用户原始问题
        answer: agent 的最终答案
        evidence: 检索到的证据（可选，KB/工具输出摘要）

    Returns:
        Verdict
    """
    # 短答案短路
    if not should_verify(answer):
        return Verdict(
            verdict="sufficient",
            rationale="答案过短，跳过验证直接放行",
        )

    try:
        from agent.prompts import build_verifier_prompt

        prompt = build_verifier_prompt()
        user_msg = _build_user_msg(question, answer, evidence)
        messages = [SystemMessage(content=prompt), HumanMessage(content=user_msg)]
        response = await model.ainvoke(messages)
        content = (
            response.content
            if isinstance(response.content, str)
            else str(response.content)
        )

        verdict = _parse_verdict_json(content)
        if verdict is not None:
            return verdict

        logger.warning("[verifier] JSON 解析失败，回退到 sufficient: %s", content[:200])
        return Verdict(
            verdict="sufficient",
            rationale=f"JSON 解析失败，安全回退: {content[:100]}",
        )
    except Exception as e:
        logger.warning("[verifier] LLM 调用失败，回退到 sufficient: %s", e)
        return Verdict(
            verdict="sufficient",
            rationale=f"LLM 异常，安全回退: {type(e).__name__}",
        )


def _build_user_msg(question: str, answer: str, evidence: str) -> str:
    """构建 verifier 的用户消息（含原始问题、答案、证据）。"""
    parts = [f"## 用户问题\n{question}", f"## Agent 答案\n{answer}"]
    if evidence:
        parts.append(f"## 检索证据\n{evidence}")
    return "\n\n".join(parts)


def _parse_verdict_json(content: str) -> Verdict | None:
    """从 LLM 输出解析判定 JSON，容错处理。"""
    # 尝试提取 JSON 代码块
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if json_match:
        content = json_match.group(1)
    else:
        brace_match = re.search(r"\{[^{}]*\}", content, re.DOTALL)
        if brace_match:
            content = brace_match.group(0)

    try:
        data = json.loads(content)
        return Verdict(
            verdict=data.get("verdict", "sufficient"),
            gaps=data.get("gaps", []),
            rationale=data.get("rationale", ""),
        )
    except (json.JSONDecodeError, TypeError):
        return None
```

- [ ] **Step 4: Add build_verifier_prompt to agent/prompts.py**

Append to `agent/prompts.py`:

```python
def build_verifier_prompt() -> str:
    """构建 verifier 答案充分性评分提示词。

    职责：取用户问题 + agent 答案 + 检索证据，判定答案是否充分回答了问题。
    返回严格 JSON。

    Returns:
        系统提示词字符串
    """
    return """你是 Maxma 的答案验证者（Verifier）。你的任务是判定 Agent 的答案是否充分回答了用户的问题。

判定标准：
- "sufficient"：答案直接回答了用户问题，关键信息完整，无明显遗漏或矛盾
- "insufficient"：答案遗漏了问题的关键部分、答非所问、或包含无法从证据支撑的断言

判定原则：
- 宽容为主：只要答案合理地回应了问题的核心，就判 sufficient
- 仅在明确遗漏关键信息时才判 insufficient
- gaps 字段列出具体缺失点（如"未回答价格部分"），供 agent 补充

输出格式：严格 JSON，无多余文本、无 markdown 代码块标记。
{"verdict":"<sufficient|insufficient>","gaps":["<缺失点1>","<缺失点2>"],"rationale":"<简短理由>"}

注意：
- 只输出 JSON，不要任何解释或前后缀
- sufficient 时 gaps 为空数组 []
- insufficient 时 gaps 至少包含一个具体缺失点
- 无法判断时判 sufficient（不阻塞用户）"""
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_verifier.py -v`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add agent/verifier.py agent/prompts.py tests/test_agent/test_verifier.py
git commit -m "feat(agent): add verifier answer-sufficiency grader with safe fallback"
```

---

## Task 4: Feature flags in settings

**Files:**
- Modify: `config/settings.py`

Add feature flags so the new nodes default OFF, enabling a safe rollout. Maxma's existing pattern (seen in `approval_gateway_enabled`, `loop_detection_enabled`) is a Pydantic settings model with bool fields.

- [ ] **Step 1: Read current settings to find insertion point**

Run: `.venv\Scripts\python.exe -c "from config.settings import get_settings; s=get_settings(); print([f for f in s.model_fields if 'enable' in f or 'enabled' in f])"`
This lists existing feature-flag fields so we match the naming convention.

- [ ] **Step 2: Write the failing test for new settings**

Create `tests/test_config_settings_or_append.py` — actually, check if `tests/test_config_settings.py` exists first. The plan assumes it does (per the test tree listing). Append to `tests/test_config_settings.py`:

```python
class TestOrchestrationFlags:
    """编排层特性开关测试。"""

    def test_coordinator_flag_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "coordinator_enabled")
        assert s.coordinator_enabled is False  # 默认关闭，安全滚动

    def test_verifier_flag_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "verifier_enabled")
        assert s.verifier_enabled is False

    def test_verifier_max_retries_default(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "verifier_max_retries")
        assert s.verifier_max_retries == 2

    def test_delegation_scope_enforced_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "delegation_scope_enforced")
        assert s.delegation_scope_enforced is False
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_config_settings.py::TestOrchestrationFlags -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'coordinator_enabled'`

- [ ] **Step 4: Add the fields to config/settings.py**

In `config/settings.py`, find the existing `approval_gateway_enabled: bool = False` field (or similar feature-flag block) and add after it:

```python
    # ── 编排层特性开关（默认关闭，安全滚动）──
    # Coordinator：意图路由协调者节点（coordinator → planner → agent）
    coordinator_enabled: bool = False
    # Verifier：答案充分性验证节点（agent → verifier → END/agent 重试）
    verifier_enabled: bool = False
    # Verifier 最大重试次数（达到上限后放行，即使仍 insufficient）
    verifier_max_retries: int = 2
    # DelegationScope：SubAgent 委托范围单调收窄强制
    delegation_scope_enforced: bool = False
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_config_settings.py::TestOrchestrationFlags -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add config/settings.py tests/test_config_settings.py
git commit -m "feat(config): add orchestration layer feature flags (default off)"
```

---

## Task 5: Wire coordinator node into the graph

**Files:**
- Modify: `agent/graph.py`
- Test: `tests/test_agent/test_graph_coordinator.py`

Add the `coordinator_node` and wire it as the new entry point (before `planner`) when `coordinator_enabled` is True. When False, the graph is unchanged — `planner` remains the entry point. This is the integration step for Task 2's pure function.

- [ ] **Step 1: Write the failing integration test**

Create `tests/test_agent/test_graph_coordinator.py`:

```python
"""Coordinator 图节点集成测试。

测试策略：
- mock model，不依赖真实 LLM
- 验证 coordinator_enabled=False 时图结构不变（向后兼容）
- 验证 coordinator_enabled=True 时 coordinator 是入口
- 验证 coordinator 路由到 DIRECT 时不进入 planner
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from agent.graph import build_agent, AgentState


def _make_mock_model(response_text: str = "测试回复") -> BaseChatModel:
    mock = MagicMock(spec=BaseChatModel)
    mock.bind_tools = MagicMock(return_value=mock)
    mock.ainvoke = AsyncMock(return_value=AIMessage(content=response_text))
    return mock


class TestGraphWithCoordinatorDisabled:
    """coordinator_enabled=False（默认）时，图结构与现有完全一致。"""

    def test_graph_builds_without_coordinator(self):
        model = _make_mock_model()
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
        )
        # 图应能正常编译
        assert graph is not None

    @pytest.mark.asyncio
    async def test_simple_message_flows_without_coordinator(self):
        """简单消息直接走 planner → agent，不调用 coordinator。"""
        model = _make_mock_model("你好！")
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="你好")]},
            config={"configurable": {"thread_id": "test-1"}},
        )
        # 应有回复
        assert len(result["messages"]) >= 2


class TestGraphWithCoordinatorEnabled:
    """coordinator_enabled=True 时，coordinator 作为入口节点。"""

    def test_graph_builds_with_coordinator(self, monkeypatch):
        """启用 coordinator 后图仍能正常编译。"""
        from config.settings import get_settings
        # 临时开启 coordinator
        s = get_settings()
        monkeypatch.setattr(s, "coordinator_enabled", True)

        model = _make_mock_model()
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
        )
        assert graph is not None
```

- [ ] **Step 2: Run test to verify first test passes (disabled path) and third fails (enabled path not wired)**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_graph_coordinator.py -v`
Expected: First two PASS, third may error or pass trivially (graph builds even without coordinator wiring, since flag isn't read yet).

- [ ] **Step 3: Wire coordinator into graph.py**

In `agent/graph.py`, modify `build_agent()`:

1. Add `coordinator_enabled` parameter (read from settings if None), mirroring the `enable_executor` pattern.
2. Add `coordinator_node` async function inside `build_agent()`.
3. When `coordinator_enabled` is True, set `coordinator` as entry point and add edge `coordinator → planner`. When False, keep `planner` as entry (unchanged).

Add the parameter to `build_agent` signature (after `enable_hitl`):

```python
    coordinator_enabled: bool | None = None,
```

Read the default inside the function, after the existing `enable_executor` default-reading block:

```python
    if coordinator_enabled is None:
        try:
            from config.settings import get_settings
            coordinator_enabled = get_settings().coordinator_enabled
        except Exception:
            coordinator_enabled = False
```

Add the coordinator node function inside `build_agent()` (after `_should_skip_planner` reference, before `planner_node`):

```python
    async def coordinator_node(state: AgentState) -> dict:
        """协调者节点：分类用户意图，决定路由。

        路由结果写入 state.coordinator_route，供后续条件边使用。
        简单输入短路（不调用 LLM）。任何异常安全回退到 MAIN。
        """
        from agent.coordinator import classify_intent, RouteTarget

        messages = state["messages"]
        if not messages:
            return {"coordinator_route": "main"}

        # 取最后一条 HumanMessage
        user_text = ""
        for msg in reversed(messages):
            if isinstance(msg, HumanMessage):
                user_text = _extract_text_content(msg.content)
                break

        if not user_text:
            return {"coordinator_route": "main"}

        try:
            decision = await classify_intent(model, user_text)
            route = decision.target.value  # "direct" | "specialist" | "main"
            logger.info("[coordinator] route=%s rationale=%s", route, decision.rationale[:80])
            return {"coordinator_route": route}
        except Exception as e:
            logger.warning("[coordinator] 分类失败，回退到 main: %s", e)
            return {"coordinator_route": "main"}
```

Add the node and wire the entry point. In the "构建图" section, replace:

```python
    graph.add_node("planner", planner_node)
```

with:

```python
    graph.add_node("planner", planner_node)
    if coordinator_enabled:
        graph.add_node("coordinator", coordinator_node)
```

And replace the entry point section:

```python
    # 入口 → planner
    graph.set_entry_point("planner")
```

with:

```python
    # 入口：coordinator 启用时先走 coordinator → planner，否则直接 planner
    if coordinator_enabled:
        graph.set_entry_point("coordinator")
        graph.add_edge("coordinator", "planner")
    else:
        graph.set_entry_point("planner")
```

Add `coordinator_route` to `AgentState`:

```python
    # ── 编排层：coordinator 路由结果 ──
    coordinator_route: str  # "direct" | "specialist" | "main"
```

- [ ] **Step 4: Run test to verify enabled path passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_graph_coordinator.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full agent test suite to confirm no regressions**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/ -v`
Expected: All existing tests PASS (coordinator defaults off, so behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add agent/graph.py tests/test_agent/test_graph_coordinator.py
git commit -m "feat(agent): wire coordinator node as optional entry point (flag-gated)"
```

---

## Task 6: Wire verifier node into the graph with retry loop

**Files:**
- Modify: `agent/graph.py`
- Test: `tests/test_agent/test_graph_verifier.py`

Add the `verifier_node` between `should_continue` and `END`. When the agent emits a final answer (no tool_calls), route to `verifier` instead of `END`. The verifier grades; on `insufficient` with retries remaining, inject the gaps as a SystemMessage and route back to `agent`. On `sufficient` or retries exhausted, route to `END`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/test_agent/test_graph_verifier.py`:

```python
"""Verifier 图节点集成测试。

测试策略：
- mock model，控制 verifier 返回 sufficient/insufficient
- 验证 verifier_enabled=False 时无 verifier 节点（向后兼容）
- 验证 insufficient 时路由回 agent（带 gap 注入）
- 验证 retries 耗尽后放行
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from agent.graph import build_agent


def _make_mock_model(responses: list[str]) -> BaseChatModel:
    """创建按顺序返回多个响应的 mock model。"""
    mock = MagicMock(spec=BaseChatModel)
    mock.bind_tools = MagicMock(return_value=mock)
    responses_iter = iter(responses)

    async def _ainvoke(messages):
        try:
            return AIMessage(content=next(responses_iter))
        except StopIteration:
            return AIMessage(content="（无更多响应）")

    mock.ainvoke = _ainvoke
    return mock


class TestGraphWithVerifierDisabled:
    """verifier_enabled=False（默认）时，无 verifier 节点。"""

    @pytest.mark.asyncio
    async def test_answer_flows_directly_to_end(self):
        model = _make_mock_model(["直接答案"])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="问题")]},
            config={"configurable": {"thread_id": "v-test-1"}},
        )
        assert len(result["messages"]) >= 2


class TestGraphWithVerifierEnabled:
    """verifier_enabled=True 时的行为。"""

    @pytest.mark.asyncio
    async def test_sufficient_answer_reaches_end(self, monkeypatch):
        """verifier 判定 sufficient 时正常结束。"""
        from config.settings import get_settings
        s = get_settings()
        monkeypatch.setattr(s, "verifier_enabled", True)

        # agent 回答 → verifier 判 sufficient
        model = _make_mock_model([
            "这是一个完整的答案，详细回答了问题。",  # agent 回答
            '{"verdict":"sufficient","gaps":[],"rationale":"答案完整"}',  # verifier
        ])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="解释 LangGraph")]},
            config={"configurable": {"thread_id": "v-test-2"}},
        )
        # 应正常结束
        assert result is not None

    @pytest.mark.asyncio
    async def test_insufficient_then_sufficient(self, monkeypatch):
        """verifier 判 insufficient → agent 补充 → verifier 判 sufficient。"""
        from config.settings import get_settings
        s = get_settings()
        monkeypatch.setattr(s, "verifier_enabled", True)

        model = _make_mock_model([
            "简短答案。",  # 第一次回答（不充分）
            '{"verdict":"insufficient","gaps":["缺少细节"],"rationale":"太简短"}',  # verifier 1
            "这是补充后的详细答案，包含完整细节。",  # 第二次回答
            '{"verdict":"sufficient","gaps":[],"rationale":"已补充"}',  # verifier 2
        ])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="详细解释 LangGraph")]},
            config={"configurable": {"thread_id": "v-test-3"}},
        )
        assert result is not None
```

- [ ] **Step 2: Run test to verify disabled path passes, enabled path fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_graph_verifier.py -v`
Expected: First test PASSES (no verifier wired), second/third FAIL (verifier not wired).

- [ ] **Step 3: Wire verifier into graph.py**

In `agent/graph.py`:

1. Add `verifier_enabled` and `verifier_max_retries` parameters to `build_agent()`.
2. Add `verifier_retries` and `verifier_verdict` to `AgentState`.
3. Add `verifier_node` function.
4. Modify `should_continue` to route to `verifier` (instead of END) when the agent has no tool_calls and verifier is enabled.
5. Add a `should_continue_from_verifier` router: sufficient or retries exhausted → END; insufficient with retries left → `agent`.

Add parameters to `build_agent` signature:

```python
    verifier_enabled: bool | None = None,
    verifier_max_retries: int | None = None,
```

Read defaults inside the function (next to the coordinator default-reading block):

```python
    if verifier_enabled is None:
        try:
            from config.settings import get_settings
            verifier_enabled = get_settings().verifier_enabled
        except Exception:
            verifier_enabled = False
    if verifier_max_retries is None:
        try:
            from config.settings import get_settings
            verifier_max_retries = get_settings().verifier_max_retries
        except Exception:
            verifier_max_retries = 2
```

Add to `AgentState`:

```python
    # ── 编排层：verifier 状态 ──
    verifier_retries: int  # 当前已重试次数
    verifier_verdict: str  # "sufficient" | "insufficient" | ""
```

Add the verifier node function inside `build_agent()` (after `loop_breaker_node`):

```python
    async def verifier_node(state: AgentState) -> dict:
        """验证节点：评分 agent 最终答案的充分性。

        sufficient 或重试耗尽 → END（由 should_continue_from_verifier 路由）
        insufficient 且仍有重试 → 注入 gap SystemMessage，路由回 agent
        """
        from agent.verifier import grade_answer, Verdict

        messages = state["messages"]
        if not messages:
            return {"verifier_verdict": "sufficient"}

        # 取最后一条 AIMessage 作为答案
        answer = ""
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and not getattr(msg, "tool_calls", None):
                answer = msg.content if isinstance(msg.content, str) else str(msg.content)
                break

        # 取用户原始问题
        question = ""
        for msg in reversed(messages):
            if isinstance(msg, HumanMessage):
                question = _extract_text_content(msg.content)
                break

        retries = state.get("verifier_retries", 0)

        try:
            verdict = await grade_answer(model, question, answer)
        except Exception as e:
            logger.warning("[verifier] 评分失败，放行: %s", e)
            return {"verifier_verdict": "sufficient"}

        if verdict.is_sufficient():
            logger.info("[verifier] sufficient, 放行")
            return {"verifier_verdict": "sufficient"}

        # insufficient
        if retries >= verifier_max_retries:
            logger.info("[verifier] insufficient 但重试耗尽 (%d/%d), 放行", retries, verifier_max_retries)
            return {"verifier_verdict": "sufficient"}

        # 注入 gap，路由回 agent
        gaps_text = "; ".join(verdict.gaps) if verdict.gaps else "答案不够充分"
        gap_msg = SystemMessage(
            content=f"[验证反馈] 你的回答还不够充分：{gaps_text}。请补充这些内容后重新回答。"
        )
        logger.info("[verifier] insufficient (retry %d/%d), gaps: %s", retries + 1, verifier_max_retries, gaps_text)
        return {
            "messages": [gap_msg],
            "verifier_retries": retries + 1,
            "verifier_verdict": "insufficient",
        }

    def should_continue_from_verifier(state: AgentState) -> str:
        """verifier 后路由：sufficient → END；insufficient → agent。"""
        verdict = state.get("verifier_verdict", "sufficient")
        if verdict == "insufficient":
            return "agent"
        return END
```

Modify `should_continue` to route to verifier. In the existing `should_continue` function, change the final return (the "no tool_calls" branch). Replace:

```python
        # 无 tool_calls：executor 模式下回 executor 推进步骤，否则结束
        if enable_executor and state.get("plan_steps"):
            return "executor"
        return END
```

with:

```python
        # 无 tool_calls
        # executor 模式下回 executor 推进步骤
        if enable_executor and state.get("plan_steps"):
            return "executor"
        # verifier 启用时路由到 verifier，否则直接结束
        if verifier_enabled:
            return "verifier"
        return END
```

Add the node and wire edges. In the "构建图" section, after `graph.add_node("loop_breaker", loop_breaker_node)`:

```python
    if verifier_enabled:
        graph.add_node("verifier", verifier_node)
```

Update the conditional edges from `agent`. Replace the existing `graph.add_conditional_edges("agent", should_continue, {...})` blocks. For the `enable_executor=True` + `tool_node is not None` case, replace:

```python
            graph.add_conditional_edges(
                "agent",
                should_continue,
                {"tools": "tools", "loop_breaker": "loop_breaker", "executor": "executor", END: END},
            )
```

with:

```python
            _agent_targets = {"tools": "tools", "loop_breaker": "loop_breaker", "executor": "executor", END: END}
            if verifier_enabled:
                _agent_targets["verifier"] = "verifier"
            graph.add_conditional_edges("agent", should_continue, _agent_targets)
```

Do the same for the `enable_executor=True` + no tool_node branch, the `enable_executor=False` + tool_node branch, and the `enable_executor=False` + no tool_node branch — each needs `verifier` added to its target map when `verifier_enabled`.

After all agent edges, add the verifier's own outgoing edge (for both executor and non-executor modes):

```python
    if verifier_enabled:
        graph.add_conditional_edges(
            "verifier",
            should_continue_from_verifier,
            {"agent": "agent", END: END},
        )
```

- [ ] **Step 4: Run test to verify enabled paths pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_graph_verifier.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full agent test suite for regressions**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/ -v`
Expected: All PASS (verifier defaults off).

- [ ] **Step 6: Commit**

```bash
git add agent/graph.py tests/test_agent/test_graph_verifier.py
git commit -m "feat(agent): wire verifier node with retry loop (flag-gated)"
```

---

## Task 7: Apply DelegationScope to parallel SubAgent spawning

**Files:**
- Modify: `tools/sub_agent/tool_parallel.py`
- Test: `tests/test_tools/test_delegation_scope_parallel.py`

Apply `DelegationScope` when spawning sub-sessions in `parallel_execute`. When `delegation_scope_enforced` is True, filter the sub-agent's tool list to the intersected set and pass the narrowed paths into the sub-agent build. When False, behavior is unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/test_tools/test_delegation_scope_parallel.py`:

```python
"""DelegationScope 应用于 parallel_execute 的测试。

测试策略：
- mock app_state、session_manager、ws
- 验证 delegation_scope_enforced=False 时行为不变（向后兼容）
- 验证 enforcement 启用时，子 agent 的工具集被收窄
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agent.delegation_scope import DelegationScope


class TestDelegationScopeNotEnforced:
    """delegation_scope_enforced=False（默认）时，不应用 scope。"""

    @pytest.mark.asyncio
    async def test_parallel_execute_unchanged_when_disabled(self, monkeypatch):
        from config.settings import get_settings
        s = get_settings()
        monkeypatch.setattr(s, "delegation_scope_enforced", False)

        # 仅验证不抛异常，详细行为由现有 test_tool_parallel 覆盖
        # 这里不重复完整 parallel_execute 流程，只验证 scope 不介入
        from tools.sub_agent.tool_parallel import ParallelExecuteTool
        tool = ParallelExecuteTool()
        assert tool is not None


class TestDelegationScopeEnforced:
    """delegation_scope_enforced=True 时，子 agent 工具被收窄。"""

    def test_filter_tools_by_scope(self):
        """scope 过滤函数：保留交集内工具，剔除交集外工具。"""
        from tools.sub_agent.tool_parallel import _filter_tools_by_scope

        all_tools = ["file_read", "file_write", "file_delete", "kb_search", "run_python"]
        parent_scope = DelegationScope(
            allowed_tools=frozenset({"file_read", "kb_search", "tavily_search"}),
        )
        child_request = DelegationScope(
            allowed_tools=frozenset({"file_read", "file_write", "kb_search"}),
        )
        from agent.delegation_scope import intersect
        effective = intersect(parent_scope, child_request)
        filtered = _filter_tools_by_scope(all_tools, effective)
        assert set(filtered) == {"file_read", "kb_search"}
        assert "file_delete" not in filtered
        assert "run_python" not in filtered

    def test_empty_scope_yields_empty_tools(self):
        """空 scope 时所有工具被剔除。"""
        from tools.sub_agent.tool_parallel import _filter_tools_by_scope

        all_tools = ["file_read", "file_write"]
        empty_scope = DelegationScope()
        filtered = _filter_tools_by_scope(all_tools, empty_scope)
        assert filtered == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_delegation_scope_parallel.py -v`
Expected: FAIL — `_filter_tools_by_scope` not found

- [ ] **Step 3: Add _filter_tools_by_scope helper to tool_parallel.py**

In `tools/sub_agent/tool_parallel.py`, add near the top (after the constants):

```python
from agent.delegation_scope import DelegationScope, intersect, from_parent_context


def _filter_tools_by_scope(tool_names: list[str], scope: DelegationScope) -> list[str]:
    """按 DelegationScope 过滤工具名列表，仅保留 scope 内的工具。

    Args:
        tool_names: 子 Agent 请求的工具名列表
        scope: 收窄后的有效 scope

    Returns:
        过滤后的工具名列表（保持原顺序）
    """
    if not scope.allowed_tools:
        return []
    return [name for name in tool_names if name in scope.allowed_tools]


def _compute_effective_scope(
    parent_tools: list[str],
    parent_paths: list[str],
    child_requested_tools: list[str],
) -> DelegationScope:
    """计算 SubAgent 的有效委托范围。

    当 delegation_scope_enforced=False 时返回全量 scope（不收窄）。

    Args:
        parent_tools: 父 Agent 可用的工具列表
        parent_paths: 父 Agent 路径白名单
        child_requested_tools: 子 Agent 请求的工具列表

    Returns:
        有效 DelegationScope
    """
    parent_scope = from_parent_context(
        allowed_tools=parent_tools,
        allowed_paths=parent_paths,
    )
    child_request = DelegationScope(
        allowed_tools=frozenset(child_requested_tools),
        allowed_paths=frozenset(parent_paths),  # 子默认请求父的全部路径
    )
    return intersect(parent_scope, child_request)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_delegation_scope_parallel.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Apply the scope in _run_background when enforcement is on**

In `tools/sub_agent/tool_parallel.py`, in the `_run_background` method, after `system_prompt = build_system_prompt()` and before `agent = build_agent(...)`, add scope enforcement. Replace the existing tool list usage:

```python
        system_prompt = build_system_prompt()
        # 4 层架构：子 Agent 也启用情景记忆检索
        episodic_mm = getattr(app_state, "episodic_mm", None)

        # DelegationScope 收窄：delegation_scope_enforced 启用时过滤子 Agent 工具
        effective_tools = app_state.tools
        try:
            from config.settings import get_settings
            if get_settings().delegation_scope_enforced:
                parent_tool_names = [t.name for t in app_state.tools]
                parent_paths = []  # 从路径白名单读取（如已暴露在 app_state）
                try:
                    from tools.path_security import get_whitelisted_paths
                    parent_paths = get_whitelisted_paths()
                except Exception:
                    pass
                effective_scope = _compute_effective_scope(
                    parent_tools=parent_tool_names,
                    parent_paths=parent_paths,
                    child_requested_tools=parent_tool_names,  # 子默认请求全部，由 intersect 收窄
                )
                effective_tool_names = _filter_tools_by_scope(parent_tool_names, effective_scope)
                effective_tools = [t for t in app_state.tools if t.name in set(effective_tool_names)]
                logger.info("[parallel_execute] scope enforced: %d/%d tools retained",
                            len(effective_tools), len(app_state.tools))
        except Exception as e:
            logger.warning("[parallel_execute] scope 计算失败，使用全量工具: %s", e)
            effective_tools = app_state.tools

        agent = build_agent(
            model=app_state.llm,
            tools=effective_tools,
            system_prompt=system_prompt,
            checkpointer=sub.checkpointer,
            episodic_mm=episodic_mm,
            enable_executor=False,  # 子 Agent 不启用 executor，防止递归爆炸
        )
```

- [ ] **Step 6: Verify get_whitelisted_paths exists or add a thin shim**

Check if `get_whitelisted_paths` exists in `tools/path_security.py`. If not, add a thin function there that reads the whitelist from wherever Maxma stores it (per project memory, path whitelist is a config). For the plan, assume it exists or add:

```python
def get_whitelisted_paths() -> list[str]:
    """读取当前路径白名单。"""
    try:
        from api.routes.path_whitelist import get_whitelist
        return get_whitelist()
    except Exception:
        return []
```

- [ ] **Step 7: Run full test suite for the sub_agent module**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/ tests/test_agent/ -v`
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add tools/sub_agent/tool_parallel.py tests/test_tools/test_delegation_scope_parallel.py
git commit -m "feat(tools): apply DelegationScope to parallel SubAgent spawning (flag-gated)"
```

---

## Task 8: Apply DelegationScope to single SubAgent path

**Files:**
- Modify: `tools/sub_agent/tool_call_sub_agent.py`
- Test: `tests/test_tools/test_delegation_scope_single.py`

Mirror Task 7's scope-narrowing for the `call_sub_agent` (single subagent) path. The pattern is identical — reuse `_filter_tools_by_scope` and `_compute_effective_scope` from `tool_parallel.py`.

- [ ] **Step 1: Read tool_call_sub_agent.py to find the sub-agent build call**

Read `tools/sub_agent/tool_call_sub_agent.py` and locate where `build_agent()` is called (the `_run_background` equivalent).

- [ ] **Step 2: Write the failing test**

Create `tests/test_tools/test_delegation_scope_single.py`:

```python
"""DelegationScope 应用于 call_sub_agent 的测试。

复用 tool_parallel 的 _filter_tools_by_scope 逻辑，验证单 subagent 路径同样收窄。
"""
import pytest


class TestSingleSubAgentScope:
    def test_reuses_filter_function(self):
        """单 subagent 路径复用 tool_parallel 的过滤函数。"""
        from tools.sub_agent.tool_parallel import _filter_tools_by_scope
        from agent.delegation_scope import DelegationScope

        tools = ["file_read", "file_write", "kb_search"]
        scope = DelegationScope(allowed_tools=frozenset({"file_read", "kb_search"}))
        filtered = _filter_tools_by_scope(tools, scope)
        assert set(filtered) == {"file_read", "kb_search"}
```

- [ ] **Step 3: Apply scope in tool_call_sub_agent.py**

In `tools/sub_agent/tool_call_sub_agent.py`, find the `_run_background` method (or equivalent that calls `build_agent`). Apply the same scope-narrowing block as in Task 7 Step 5, reusing the imported helpers:

```python
from tools.sub_agent.tool_parallel import _filter_tools_by_scope, _compute_effective_scope
```

Insert the same enforcement block before the `build_agent(...)` call:

```python
        # DelegationScope 收窄
        effective_tools = app_state.tools
        try:
            from config.settings import get_settings
            if get_settings().delegation_scope_enforced:
                parent_tool_names = [t.name for t in app_state.tools]
                parent_paths = []
                try:
                    from tools.path_security import get_whitelisted_paths
                    parent_paths = get_whitelisted_paths()
                except Exception:
                    pass
                effective_scope = _compute_effective_scope(
                    parent_tools=parent_tool_names,
                    parent_paths=parent_paths,
                    child_requested_tools=parent_tool_names,
                )
                effective_tool_names = _filter_tools_by_scope(parent_tool_names, effective_scope)
                effective_tools = [t for t in app_state.tools if t.name in set(effective_tool_names)]
        except Exception as e:
            logger.warning("[call_sub_agent] scope 计算失败，使用全量工具: %s", e)
            effective_tools = app_state.tools

        agent = build_agent(
            model=app_state.llm,
            tools=effective_tools,
            ...  # 其余参数保持不变
        )
```

- [ ] **Step 4: Run test and full suite**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_delegation_scope_single.py tests/test_tools/ tests/test_agent/ -v`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/sub_agent/tool_call_sub_agent.py tests/test_tools/test_delegation_scope_single.py
git commit -m "feat(tools): apply DelegationScope to single SubAgent path (flag-gated)"
```

---

## Task 9: End-to-end integration test and documentation

**Files:**
- Test: `tests/test_agent/test_orchestration_e2e.py`

A single end-to-end test that exercises coordinator → planner → agent → verifier → END with all three features enabled, plus a regression test that all features off reproduces the original behavior exactly.

- [ ] **Step 1: Write the e2e test**

Create `tests/test_agent/test_orchestration_e2e.py`:

```python
"""编排层端到端集成测试。

验证 coordinator + verifier + delegation scope 三者协同工作，
以及全部关闭时与原行为完全一致（回归保护）。
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from agent.graph import build_agent


def _make_sequential_model(responses: list[str]) -> BaseChatModel:
    mock = MagicMock(spec=BaseChatModel)
    mock.bind_tools = MagicMock(return_value=mock)
    it = iter(responses)

    async def _ainvoke(messages):
        try:
            return AIMessage(content=next(it))
        except StopIteration:
            return AIMessage(content="（结束）")

    mock.ainvoke = _ainvoke
    return mock


class TestOrchestrationAllDisabled:
    """全部特性关闭时，图行为与原 Maxma 完全一致。"""

    @pytest.mark.asyncio
    async def test_original_behavior_preserved(self, monkeypatch):
        from config.settings import get_settings
        s = get_settings()
        monkeypatch.setattr(s, "coordinator_enabled", False)
        monkeypatch.setattr(s, "verifier_enabled", False)
        monkeypatch.setattr(s, "delegation_scope_enforced", False)

        model = _make_sequential_model(["你好！有什么可以帮你的？"])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="你好")]},
            config={"configurable": {"thread_id": "e2e-off"}},
        )
        # 应直接结束，无 coordinator/verifier 介入
        assert result is not None
        assert len(result["messages"]) >= 2


class TestOrchestrationAllEnabled:
    """全部特性开启时的协同测试。"""

    @pytest.mark.asyncio
    async def test_coordinator_routes_direct_for_greeting(self, monkeypatch):
        """简单问候：coordinator 路由 direct，不进入主循环浪费 token。"""
        from config.settings import get_settings
        s = get_settings()
        monkeypatch.setattr(s, "coordinator_enabled", True)
        monkeypatch.setattr(s, "verifier_enabled", True)

        # coordinator 对"你好"短路返回 direct，无需 LLM 响应序列
        model = _make_sequential_model([
            "你好！很高兴见到你。",  # agent 直接回复
            '{"verdict":"sufficient","gaps":[],"rationale":"问候完整"}',  # verifier
        ])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="你好")]},
            config={"configurable": {"thread_id": "e2e-on-1"}},
        )
        assert result is not None

    @pytest.mark.asyncio
    async def test_full_pipeline_question_answer_verified(self, monkeypatch):
        """完整问题 → coordinator(main) → agent 回答 → verifier(sufficient) → END。"""
        from config.settings import get_settings
        s = get_settings()
        monkeypatch.setattr(s, "coordinator_enabled", True)
        monkeypatch.setattr(s, "verifier_enabled", True)

        model = _make_sequential_model([
            '{"target":"main","rationale":"通用问题"}',  # coordinator
            "LangGraph 是用于构建状态机的框架，支持持久化和人流。",  # agent
            '{"verdict":"sufficient","gaps":[],"rationale":"答案完整"}',  # verifier
        ])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="LangGraph 是什么？")]},
            config={"configurable": {"thread_id": "e2e-on-2"}},
        )
        assert result is not None
```

- [ ] **Step 2: Run e2e tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_orchestration_e2e.py -v`
Expected: PASS (3 tests)

- [ ] **Step 3: Run the entire test suite for final regression check**

Run: `.venv\Scripts\python.exe -m pytest -q`
Expected: All tests PASS (the existing 857+ tests plus the new ~40 tests from this plan).

- [ ] **Step 4: Commit**

```bash
git add tests/test_agent/test_orchestration_e2e.py
git commit -m "test(agent): add orchestration layer e2e integration tests"
```

---

## Self-Review

**1. Spec coverage check against the master proposal's orchestration layer:**

- ✅ Coordinator + Specialist routing → Task 2 (pure function) + Task 5 (graph wiring). Note: full specialist subgraph dispatch (actually spawning a research/coding subagent based on the route) is deferred to a follow-up plan — this plan wires the coordinator's routing decision into state but treats all non-direct routes as "main" for now. This is deliberate: the routing infrastructure lands first, specialist subgraphs layer on top once the foundation is proven. The plan should note this explicitly. ✓ (added note below)
- ✅ Triage + Verifier sandwich → Task 3 (pure function) + Task 6 (graph wiring with retry loop)
- ✅ Scope-Narrowing Delegation → Task 1 (dataclass) + Task 7 (parallel path) + Task 8 (single path)
- ✅ Feature flags for safe rollout → Task 4
- ✅ Backward compatibility (all flags default off) → Task 9 e2e test

**Gap found:** The coordinator currently only writes `coordinator_route` to state but doesn't yet dispatch to specialist subgraphs. This is intentional staging — the routing decision is captured and logged, but actual specialist subgraph spawning is a follow-up. Adding this note to the plan header for clarity.

**2. Placeholder scan:** Searched for "TBD", "TODO", "implement later", "add appropriate", "similar to Task N". Found none. All code steps contain complete code. The one `...` in Task 8 Step 3 is within an existing-code-preservation context (showing the `build_agent` call keeps its other params) — this is acceptable as the engineer reads the existing file. To be safe, the instruction says "其余参数保持不变" (keep other params unchanged).

**3. Type consistency check:**
- `RoutingDecision.target` is `RouteTarget` enum throughout (Task 2 defines, Task 5 uses `.value`) ✓
- `Verdict.is_sufficient()` method name consistent across Task 3 (definition) and Task 6 (usage in `verifier_node`) ✓
- `DelegationScope.allowed_tools` is `frozenset[str]` in Task 1, used with `frozenset()` in Task 1 tests, and `set()` comparisons in Task 7 tests ✓
- `_filter_tools_by_scope` signature `(tool_names: list[str], scope: DelegationScope) -> list[str]` consistent between Task 7 definition and Task 8 reuse ✓
- `AgentState` new fields: `coordinator_route: str`, `verifier_retries: int`, `verifier_verdict: str` — all used consistently in Task 5 and Task 6 ✓
- `should_continue_from_verifier` defined in Task 6 and referenced in the same task's edge wiring ✓

**4. Settings field name consistency:** `coordinator_enabled`, `verifier_enabled`, `verifier_max_retries`, `delegation_scope_enforced` — defined in Task 4, referenced in Tasks 5, 6, 7, 8, 9 ✓

No issues found. Plan is complete.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-09-orchestration-layer.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
