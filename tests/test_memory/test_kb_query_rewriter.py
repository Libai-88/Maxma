"""KB 查询重写单元测试 — memory/kb/query_rewriter.py。

测试策略：
- mock BaseChatModel
- 覆盖：对话式查询重写、自包含查询保持、JSON 解析失败回退、LLM 异常回退
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from memory.kb.query_rewriter import rewrite_query, is_self_contained


class TestIsSelfContained:
    def test_self_contained_query(self):
        """自包含查询无需重写。"""
        assert is_self_contained("LangGraph 的核心特性是什么？") is True
        assert is_self_contained("如何用 Python 读取 CSV 文件") is True

    def test_conversational_query_not_self_contained(self):
        """对话式查询需要重写。"""
        assert is_self_contained("那个东西怎么用") is False
        assert is_self_contained("我们之前聊的") is False
        assert is_self_contained("它支持吗") is False


class TestRewriteQuery:
    @pytest.mark.asyncio
    async def test_rewrite_conversational_query(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content="LangGraph 的状态机持久化机制怎么用")
        )
        result = await rewrite_query(
            model=mock_model,
            user_message="那个东西怎么用",
            conversation_context="用户之前在问 LangGraph 的状态机",
        )
        assert "LangGraph" in result
        assert result != "那个东西怎么用"

    @pytest.mark.asyncio
    async def test_self_contained_query_returned_as_is(self):
        """自包含查询不调用 LLM，直接返回。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock()
        result = await rewrite_query(
            model=mock_model,
            user_message="LangGraph 是什么？",
            conversation_context="",
        )
        assert result == "LangGraph 是什么？"
        mock_model.ainvoke.assert_not_called()

    @pytest.mark.asyncio
    async def test_llm_exception_falls_back_to_original(self):
        """LLM 异常时返回原始查询。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(side_effect=RuntimeError("API 错误"))
        result = await rewrite_query(
            model=mock_model,
            user_message="那个东西怎么用",
            conversation_context="上下文",
        )
        assert result == "那个东西怎么用"

    @pytest.mark.asyncio
    async def test_empty_message_returns_empty(self):
        mock_model = MagicMock(spec=BaseChatModel)
        result = await rewrite_query(model=mock_model, user_message="", conversation_context="")
        assert result == ""

    @pytest.mark.asyncio
    async def test_whitespace_response_falls_back_to_original(self):
        """LLM 返回空白时回退到原始查询。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content="   ")
        )
        result = await rewrite_query(
            model=mock_model,
            user_message="那个东西怎么用",
            conversation_context="上下文",
        )
        assert result == "那个东西怎么用"
