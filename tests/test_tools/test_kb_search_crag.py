"""kb_search 工具的 CRAG 集成测试。

测试策略：
- mock KBRetriever.retrieve_with_correction 和 retrieve
- 验证 use_correction=False 时调用 retrieve（向后兼容）
- 验证 use_correction=True 时调用 retrieve_with_correction
"""
from unittest.mock import AsyncMock, patch


class TestKbSearchCorrectionFlag:
    def test_default_no_correction(self):
        """默认 use_correction=False，调用 retrieve（向后兼容）。"""
        from tools.kb.tool_kb_search import KbSearchTool

        with patch("memory.kb.retriever.KBRetriever.retrieve", return_value=[]) as mock_retrieve:
            with patch("memory.kb.retriever.KBRetriever.retrieve_with_correction", new_callable=AsyncMock) as mock_crag:
                tool = KbSearchTool()
                tool._run(query="test")
                mock_retrieve.assert_called_once()
                mock_crag.assert_not_called()

    def test_use_correction_calls_crag(self):
        """use_correction=True 时调用 retrieve_with_correction。"""
        from tools.kb.tool_kb_search import KbSearchTool

        async def mock_crag(*args, **kwargs):
            return [{"text": "结果", "source": "kb", "source_filename": "f.txt", "score_percent": 90.0}]

        with patch("memory.kb.retriever.KBRetriever.retrieve", return_value=[]) as mock_retrieve:
            with patch("memory.kb.retriever.KBRetriever.retrieve_with_correction", new=mock_crag):
                tool = KbSearchTool()
                result = tool._run(query="test", use_correction=True)
                mock_retrieve.assert_not_called()
                assert "结果" in result or "count" in result
