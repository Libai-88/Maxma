"""system_diagnose 边界情况测试 — 验证 S01-S08 模式匹配。"""
import pytest

from tools.system.tool_system_diagnose import (
    SYSTEM_FAILURE_PATTERNS,
    diagnose_system_failure,
)


class TestSystemDiagnosePatterns:
    def test_s01_llm_unavailable(self):
        """S01: LLM Provider 不可用。"""
        result = diagnose_system_failure("LLM is none, provider 不可用")
        assert result["primary_pattern"] == "S01"
        assert result["confidence"] > 0

    def test_s01_runtime_not_initialized(self):
        """S01: runtime 未初始化。"""
        result = diagnose_system_failure("模型未加载，runtime 未初始化")
        assert result["primary_pattern"] == "S01"

    def test_s02_api_timeout(self):
        """S02: LLM API 超时。"""
        result = diagnose_system_failure("请求超时，429 rate limit")
        assert result["primary_pattern"] == "S02"

    def test_s07_websocket_disconnect(self):
        """S07: 会话/连接错误。"""
        result = diagnose_system_failure("websocket 连接断开，4001")
        assert result["primary_pattern"] == "S07"

    def test_s07_session_error(self):
        """S07: session 错误。"""
        result = diagnose_system_failure("session disconnect")
        assert result["primary_pattern"] == "S07"

    def test_s08_fallback_no_match(self):
        """S08: 无匹配时回退。"""
        result = diagnose_system_failure("一个完全不相关的描述 xyz123")
        assert result["primary_pattern"] == "S08"
        assert result["confidence"] == 0.0

    def test_case_insensitive(self):
        """匹配不区分大小写。"""
        result = diagnose_system_failure("TIMEOUT 429")
        assert result["primary_pattern"] == "S02"

    def test_multi_symptom_higher_score_wins(self):
        """多症状匹配时得分高的优先。"""
        # S03 有 7 个症状，匹配 "工具" + "tool" + "执行失败" = 3/7 ≈ 0.43
        # S02 有 8 个症状，匹配 "timeout" = 1/8 = 0.125
        result = diagnose_system_failure("工具 tool 执行失败 timeout")
        # S03 score = 3/7 ≈ 0.43, S02 score = 1/8 = 0.125
        assert result["primary_pattern"] == "S03"

    def test_result_structure(self):
        """结果包含所有必要字段。"""
        result = diagnose_system_failure("LLM 不可用")
        assert "primary_pattern" in result
        assert "pattern_name" in result
        assert "minimal_fix" in result
        assert "confidence" in result
        assert isinstance(result["confidence"], float)

    def test_all_patterns_have_required_fields(self):
        """所有模式都有 name/symptoms/fix 字段。"""
        for key, pattern in SYSTEM_FAILURE_PATTERNS.items():
            assert "name" in pattern, f"{key} missing name"
            assert "symptoms" in pattern, f"{key} missing symptoms"
            assert "fix" in pattern, f"{key} missing fix"
            assert isinstance(pattern["symptoms"], list)
