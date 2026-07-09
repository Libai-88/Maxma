"""KB 文档相关性评分单元测试 — memory/kb/grading.py。

测试策略：
- mock BaseChatModel，不依赖真实 LLM
- 覆盖：单文档评分、多文档批量评分、JSON 解析失败回退、LLM 异常回退
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage

from memory.kb.grading import DocGrade, grade_documents, grade_single_doc, filter_relevant


class TestDocGrade:
    def test_relevant_grade(self):
        g = DocGrade(relevant=True, reasoning="直接回答了问题")
        assert g.is_relevant() is True

    def test_irrelevant_grade(self):
        g = DocGrade(relevant=False, reasoning="与问题无关")
        assert g.is_relevant() is False


class TestGradeSingleDoc:
    @pytest.mark.asyncio
    async def test_relevant_from_llm_json(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content='{"relevant":true,"reasoning":"直接回答了问题"}')
        )
        grade = await grade_single_doc(mock_model, "LangGraph 是什么？", "LangGraph 是用于构建状态机的框架。")
        assert grade.is_relevant() is True

    @pytest.mark.asyncio
    async def test_irrelevant_from_llm_json(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content='{"relevant":false,"reasoning":"内容是关于天气的，与问题无关"}')
        )
        grade = await grade_single_doc(mock_model, "LangGraph 是什么？", "今天天气晴朗，适合出行。")
        assert grade.is_relevant() is False

    @pytest.mark.asyncio
    async def test_invalid_json_falls_back_to_relevant(self):
        """JSON 解析失败时回退到 relevant（不丢弃可能有用的文档）。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content="我无法判断。")
        )
        grade = await grade_single_doc(mock_model, "问题", "文档内容")
        assert grade.is_relevant() is True

    @pytest.mark.asyncio
    async def test_llm_exception_falls_back_to_relevant(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(side_effect=RuntimeError("API 超时"))
        grade = await grade_single_doc(mock_model, "问题", "文档内容")
        assert grade.is_relevant() is True


class TestGradeDocuments:
    @pytest.mark.asyncio
    async def test_batch_grading_returns_list(self):
        mock_model = MagicMock(spec=BaseChatModel)
        responses = iter([
            AIMessage(content='{"relevant":true,"reasoning":"相关"}'),
            AIMessage(content='{"relevant":false,"reasoning":"无关"}'),
            AIMessage(content='{"relevant":true,"reasoning":"相关"}'),
        ])
        mock_model.ainvoke = AsyncMock(side_effect=lambda msgs: next(responses))

        docs = [
            {"text": "文档1", "source_filename": "f1.txt"},
            {"text": "文档2", "source_filename": "f2.txt"},
            {"text": "文档3", "source_filename": "f3.txt"},
        ]
        grades = await grade_documents(mock_model, "查询", docs)
        assert len(grades) == 3
        assert grades[0].is_relevant() is True
        assert grades[1].is_relevant() is False
        assert grades[2].is_relevant() is True

    @pytest.mark.asyncio
    async def test_empty_docs_returns_empty_list(self):
        mock_model = MagicMock(spec=BaseChatModel)
        grades = await grade_documents(mock_model, "查询", [])
        assert grades == []


class TestFilterRelevant:
    def test_filter_relevant_docs(self):
        """辅助函数：从 docs + grades 中筛选相关文档。"""
        docs = [
            {"text": "相关文档", "source_filename": "f1.txt"},
            {"text": "无关文档", "source_filename": "f2.txt"},
            {"text": "另一相关文档", "source_filename": "f3.txt"},
        ]
        grades = [
            DocGrade(relevant=True, reasoning=""),
            DocGrade(relevant=False, reasoning=""),
            DocGrade(relevant=True, reasoning=""),
        ]
        relevant = filter_relevant(docs, grades)
        assert len(relevant) == 2
        assert relevant[0]["text"] == "相关文档"
        assert relevant[1]["text"] == "另一相关文档"
