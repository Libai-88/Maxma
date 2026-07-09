"""Runner 纯函数单元测试 — agent/autonomy/runner.py。"""
import pytest
from unittest.mock import MagicMock

from agent.autonomy.runner import (
    _build_self_improve_prompt,
    _extract_final_answer,
    _filter_tools_for_headless,
)


class TestBuildSelfImprovePrompt:
    def test_prompt_contains_diagnostic_sections(self):
        """提示词包含诊断报告各部分。"""
        report = {
            "issues": [
                {"priority": "high", "component": "llm", "description": "LLM down"},
            ],
            "error_summary": {
                "total": 3,
                "by_category": {"tool_error": 3},
                "recent_messages": ["err1", "err2", "err3"],
            },
            "health_summary": {"overall_status": "degraded", "degraded_components": ["llm"]},
        }
        prompt = _build_self_improve_prompt(report)
        assert "自治自改进任务" in prompt
        assert "LLM down" in prompt
        assert "tool_error" in prompt
        assert "degraded" in prompt
        assert "llm" in prompt

    def test_prompt_with_empty_report(self):
        """空报告也能生成提示词。"""
        report = {}
        prompt = _build_self_improve_prompt(report)
        assert "自治自改进任务" in prompt
        assert "无错误" in prompt
        assert "无问题" in prompt

    def test_recent_messages_joined_by_newline(self):
        """最近错误消息由真实换行符连接，不是字面量 chr(10)。"""
        report = {
            "issues": [],
            "error_summary": {
                "total": 3,
                "by_category": {"tool_error": 3},
                "recent_messages": ["error one", "error two", "error three"],
            },
            "health_summary": {"overall_status": "ok", "degraded_components": []},
        }
        prompt = _build_self_improve_prompt(report)
        assert "error one\nerror two" in prompt
        assert "chr(10)" not in prompt

    def test_prompt_includes_task_instructions(self):
        """提示词包含任务指令。"""
        report = {}
        prompt = _build_self_improve_prompt(report)
        assert "manage_skills" in prompt
        # 实际提示词标题为 [自治自改进任务]；"自治自改进模式" 是在
        # run_self_improvement_agent() 中拼接到 system_prompt 的，不在本函数输出中。
        assert "自治自改进任务" in prompt
        assert "## 你的任务" in prompt


class TestExtractFinalAnswer:
    def test_returns_ai_message_content(self):
        """返回 type='ai' 的消息内容。"""
        msg1 = MagicMock()
        msg1.content = "tool output"
        msg1.type = "tool"

        msg2 = MagicMock()
        msg2.content = "Final answer here"
        msg2.type = "ai"

        output = {"messages": [msg1, msg2]}
        result = _extract_final_answer(output)
        assert result == "Final answer here"

    def test_fallback_to_last_message_if_no_ai(self):
        """无 ai 消息时回退到最后一条。"""
        msg1 = MagicMock()
        msg1.content = "tool output 1"
        msg1.type = "tool"

        msg2 = MagicMock()
        msg2.content = "tool output 2"
        msg2.type = "tool"

        output = {"messages": [msg1, msg2]}
        result = _extract_final_answer(output)
        assert result == "tool output 2"

    def test_skips_empty_content(self):
        """跳过空内容消息，回退到前一条非空 ai 消息。"""
        # 最后一条 ai 内容为空 → reversed 迭代时先遇到空消息并跳过，
        # 再回到前一条非空 ai 消息。
        msg1 = MagicMock()
        msg1.content = "Real answer"
        msg1.type = "ai"

        msg2 = MagicMock()
        msg2.content = ""
        msg2.type = "ai"

        output = {"messages": [msg1, msg2]}
        result = _extract_final_answer(output)
        assert result == "Real answer"

    def test_empty_output_returns_empty_string(self):
        """空输出返回空字符串。"""
        assert _extract_final_answer({}) == ""
        assert _extract_final_answer({"messages": []}) == ""

    def test_non_string_content_skipped(self):
        """非字符串 content 被跳过，回退到前一条字符串 ai 消息。"""
        # 最后一条 ai content 是 dict → reversed 迭代时跳过，回到前一条 str。
        msg1 = MagicMock()
        msg1.content = "String answer"
        msg1.type = "ai"

        msg2 = MagicMock()
        msg2.content = {"key": "value"}  # dict, not str — 应被跳过
        msg2.type = "ai"

        output = {"messages": [msg1, msg2]}
        result = _extract_final_answer(output)
        assert result == "String answer"

    def test_exception_returns_empty_string(self):
        """异常时返回空字符串。"""
        result = _extract_final_answer(None)
        assert result == ""


class TestFilterToolsForHeadless:
    def test_whitelisted_tools_retained(self):
        """白名单内工具被保留。"""
        mock_tools = []
        for name in ["manage_skills", "system_diagnose", "rag_diagnose", "kb_search"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        result = _filter_tools_for_headless(mock_tools)
        assert len(result) == 4

    def test_dangerous_tools_filtered_out(self):
        """危险工具被过滤。"""
        mock_tools = []
        for name in ["run_python", "file_write", "git_commit", "manage_mcp", "manage_skills"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        result = _filter_tools_for_headless(mock_tools)
        result_names = [getattr(t, "name", "") for t in result]
        assert "manage_skills" in result_names
        assert "run_python" not in result_names
        assert "file_write" not in result_names

    def test_empty_input_returns_empty(self):
        """空输入返回空列表。"""
        assert _filter_tools_for_headless([]) == []
