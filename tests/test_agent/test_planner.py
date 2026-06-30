"""Tests for agent/planner.py — Planning Node 测试。"""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from agent.planner import classify_and_plan, PLANNER_PROMPT


class TestClassifyAndPlan:
    """classify_and_plan() 函数测试。"""

    @pytest.mark.asyncio
    async def test_simple_task_returns_empty_string(self):
        """简单任务返回空字符串。"""
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.content = "SIMPLE"
        mock_model.ainvoke = AsyncMock(return_value=mock_response)
        
        result = await classify_and_plan(mock_model, "你好")
        
        assert result == ""
        mock_model.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_complex_task_returns_plan(self):
        """复杂任务返回计划文本。"""
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.content = "1. 第一步\n2. 第二步\n3. 第三步"
        mock_model.ainvoke = AsyncMock(return_value=mock_response)
        
        result = await classify_and_plan(mock_model, "帮我分析这个项目的架构并给出优化建议")
        
        assert "第一步" in result
        assert "第二步" in result
        assert result != ""

    @pytest.mark.asyncio
    async def test_planner_prompt_includes_system_context(self):
        """PLANNER_PROMPT 包含系统上下文。"""
        assert "SIMPLE" in PLANNER_PROMPT
        assert "步骤" in PLANNER_PROMPT

    @pytest.mark.asyncio
    async def test_model_called_with_messages(self):
        """模型被调用时传入消息列表。"""
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.content = "SIMPLE"
        mock_model.ainvoke = AsyncMock(return_value=mock_response)
        
        await classify_and_plan(mock_model, "测试消息")
        
        # 验证调用时传入了消息
        call_args = mock_model.ainvoke.call_args
        assert call_args is not None
        messages = call_args[0][0]
        assert len(messages) >= 1

    @pytest.mark.asyncio
    async def test_handles_model_error_gracefully(self):
        """模型错误时返回空字符串。"""
        mock_model = MagicMock()
        mock_model.ainvoke = AsyncMock(side_effect=Exception("Model error"))
        
        # 实现捕获异常并返回空字符串
        result = await classify_and_plan(mock_model, "测试")
        
        assert result == ""

    @pytest.mark.asyncio
    async def test_strips_whitespace_from_response(self):
        """去除模型响应中的空白字符。"""
        mock_model = MagicMock()
        mock_response = MagicMock()
        mock_response.content = "  SIMPLE  \n"
        mock_model.ainvoke = AsyncMock(return_value=mock_response)
        
        result = await classify_and_plan(mock_model, "你好")
        
        assert result == ""  # SIMPLE 去除空白后为空


class TestPlannerPrompt:
    """PLANNER_PROMPT 常量测试。"""

    def test_prompt_is_not_empty(self):
        """PLANNER_PROMPT 不为空。"""
        assert len(PLANNER_PROMPT) > 0

    def test_prompt_contains_classification_instructions(self):
        """PLANNER_PROMPT 包含分类指令。"""
        # 应该包含简单和复杂的判断标准
        prompt_lower = PLANNER_PROMPT.lower()
        assert "simple" in prompt_lower or "简单" in PLANNER_PROMPT
        assert "complex" in prompt_lower or "复杂" in PLANNER_PROMPT

    def test_prompt_contains_output_format(self):
        """PLANNER_PROMPT 包含输出格式说明。"""
        # 应该说明如何输出计划
        assert "步骤" in PLANNER_PROMPT or "step" in PLANNER_PROMPT.lower()
