"""自治层自改进 Runner 单元测试 — agent/autonomy/runner.py。

测试策略：
- mock SessionManager、build_agent、app.state
- 验证 runner 创建临时会话、执行、清理
- 验证超时处理
- 验证 LLM 未就绪时的安全回退
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agent.autonomy.runner import run_self_improvement_agent


@pytest.fixture
def mock_app():
    """创建 mock FastAPI app。"""
    app = MagicMock()
    app.state.llm = MagicMock()
    app.state.session_manager = MagicMock()
    app.state.session_manager.create = AsyncMock()
    app.state.session_manager.delete = AsyncMock()
    app.state.system_prompt = "test prompt"
    app.state.episodic_mm = None
    app.state.tools = []
    return app


@pytest.fixture
def sample_report():
    """创建样例诊断报告。"""
    return {
        "generated_at": "2026-07-09T10:00:00",
        "error_summary": {"total": 2, "by_category": {"tool_error": 2}, "recent_messages": ["err1", "err2"]},
        "health_summary": {"overall_status": "ok", "degraded_components": []},
        "issues": [
            {"priority": "medium", "component": "tools", "category": "tool_error", "description": "2 errors"}
        ],
    }


class TestRunSelfImprovementAgent:
    @pytest.mark.asyncio
    async def test_creates_and_deletes_session(self, mock_app, sample_report):
        """runner 创建临时会话并在完成后删除。"""
        mock_session = MagicMock()
        mock_session.session_id = "test-session-123"
        mock_session.checkpointer = MagicMock()
        mock_app.state.session_manager.create.return_value = mock_session

        # 构建真实 AI 消息（type='ai'），让 _extract_final_answer 走主路径
        mock_msg = MagicMock()
        mock_msg.content = "Self-improvement complete"
        mock_msg.type = "ai"

        mock_graph = MagicMock()
        mock_graph.ainvoke = AsyncMock(return_value={
            "messages": [mock_msg]
        })

        with patch("agent.autonomy.runner.build_agent", return_value=mock_graph):
            result = await run_self_improvement_agent(
                app=mock_app,
                diagnostic_report=sample_report,
                timeout=30,
            )

            mock_app.state.session_manager.create.assert_called_once()
            mock_app.state.session_manager.delete.assert_called_once_with("test-session-123")
            assert "Self-improvement" in result

    @pytest.mark.asyncio
    async def test_llm_not_ready_raises(self, mock_app, sample_report):
        """LLM 未就绪时抛出异常。"""
        mock_app.state.llm = None

        with pytest.raises(RuntimeError, match="LLM"):
            await run_self_improvement_agent(
                app=mock_app,
                diagnostic_report=sample_report,
                timeout=30,
            )

    @pytest.mark.asyncio
    async def test_timeout_handling(self, mock_app, sample_report):
        """超时时不崩溃，清理会话。"""
        mock_session = MagicMock()
        mock_session.session_id = "test-session-timeout"
        mock_session.checkpointer = MagicMock()
        mock_app.state.session_manager.create.return_value = mock_session

        mock_graph = MagicMock()
        mock_graph.ainvoke = AsyncMock(side_effect=asyncio.TimeoutError())

        with patch("agent.autonomy.runner.build_agent", return_value=mock_graph):
            result = await run_self_improvement_agent(
                app=mock_app,
                diagnostic_report=sample_report,
                timeout=1,
            )

            # 超时后应清理会话
            mock_app.state.session_manager.delete.assert_called_once_with("test-session-timeout")
            assert "超时" in result or "timeout" in result.lower()

    @pytest.mark.asyncio
    async def test_session_cleanup_on_exception(self, mock_app, sample_report):
        """任何异常都确保会话被清理。"""
        mock_session = MagicMock()
        mock_session.session_id = "test-session-err"
        mock_session.checkpointer = MagicMock()
        mock_app.state.session_manager.create.return_value = mock_session

        mock_graph = MagicMock()
        mock_graph.ainvoke = AsyncMock(side_effect=RuntimeError("Agent crashed"))

        with patch("agent.autonomy.runner.build_agent", return_value=mock_graph):
            try:
                await run_self_improvement_agent(
                    app=mock_app,
                    diagnostic_report=sample_report,
                    timeout=30,
                )
            except Exception:
                pass

            # 无论是否异常，会话都应被清理
            mock_app.state.session_manager.delete.assert_called_once_with("test-session-err")


class TestFilterInteractiveTools:
    def test_whitelisted_tools_retained(self):
        """白名单内工具被保留。"""
        from agent.autonomy.runner import _filter_tools_for_headless

        mock_tools = []
        for name in ["manage_skills", "system_diagnose", "rag_diagnose", "kb_search"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        result = _filter_tools_for_headless(mock_tools)
        assert len(result) == 4

    def test_dangerous_tools_filtered_out(self):
        """危险工具（run_python/file_write/git_commit）被过滤。"""
        from agent.autonomy.runner import _filter_tools_for_headless

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
        assert "git_commit" not in result_names
        assert "manage_mcp" not in result_names

    def test_interactive_tools_filtered_out(self):
        """交互工具（ask_user_*）被过滤。"""
        from agent.autonomy.runner import _filter_tools_for_headless

        mock_tools = []
        for name in ["ask_user_question", "ask_user_approval", "manage_skills"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        result = _filter_tools_for_headless(mock_tools)
        result_names = [getattr(t, "name", "") for t in result]
        assert "manage_skills" in result_names
        assert "ask_user_question" not in result_names
        assert "ask_user_approval" not in result_names

    def test_empty_input_returns_empty(self):
        """空输入返回空列表。"""
        from agent.autonomy.runner import _filter_tools_for_headless
        assert _filter_tools_for_headless([]) == []
