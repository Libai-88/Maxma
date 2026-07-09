"""Runner 纯函数单元测试 — agent/autonomy/runner.py。"""
from agent.autonomy.runner import _build_self_improve_prompt


class TestBuildSelfImprovePrompt:
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
        # 真实换行符应存在于消息之间
        assert "error one\nerror two" in prompt
        # 不应包含字面量 "chr(10)"
        assert "chr(10)" not in prompt
