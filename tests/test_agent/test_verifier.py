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
            answer="一个正常的答案，足够长的内容",
            evidence="",
        )
        assert v.is_sufficient() is True
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
        assert v.is_sufficient() is True

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
        assert v.is_sufficient() is True
        mock_model.ainvoke.assert_not_called()
