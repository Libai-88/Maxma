"""自治 Runner Transcript 集成测试。"""
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from agent.autonomy.runner import run_self_improvement_agent


@pytest.mark.asyncio
async def test_run_creates_transcript_file(tmp_path):
    """自治 run 产出 JSONL transcript。"""
    transcript_path = tmp_path / "autonomy-run-test.jsonl"

    # Mock app
    app = MagicMock()
    app.state.llm = MagicMock()
    app.state.session_manager = AsyncMock()
    session = MagicMock()
    session.session_id = "test-session"
    session.checkpointer = None
    app.state.session_manager.create = AsyncMock(return_value=session)
    app.state.session_manager.delete = AsyncMock()
    app.state.tools = []
    app.state.system_prompt = "test"
    app.state.episodic_mm = None

    # Mock build_agent
    mock_graph = AsyncMock()
    mock_graph.ainvoke = AsyncMock(
        return_value={"messages": [MagicMock(content="done", type="ai")]}
    )

    with patch("agent.autonomy.runner.build_agent", return_value=mock_graph):
        result = await run_self_improvement_agent(
            app=app,
            diagnostic_report={"issues": [], "error_summary": {"total": 0}, "health_summary": {"overall_status": "ok"}},
            timeout=30,
            transcript_path=transcript_path,
        )

    assert transcript_path.exists()
    lines = transcript_path.read_text(encoding="utf-8").strip().split("\n")
    # 首行是 metadata，后续是消息
    assert len(lines) >= 2
    first = json.loads(lines[0])
    assert first["type"] == "metadata"
    assert first["trigger"] == "autonomy"
