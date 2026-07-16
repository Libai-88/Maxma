"""共享诊断基类测试 — tools/base_diagnose.py。"""
import pytest
try:
    from tools.base_diagnose import diagnose_by_patterns, DiagnoseToolBase
except ImportError:
    diagnose_by_patterns = None
    DiagnoseToolBase = None


class TestDiagnoseByPatterns:
    def test_best_match_returned(self):
        """返回得分最高的模式。"""
        patterns = {
            "A01": {"name": "Pattern A", "symptoms": ["alpha", "beta"], "fix": "Fix A"},
            "A02": {"name": "Pattern B", "symptoms": ["gamma"], "fix": "Fix B"},
            "A99": {"name": "Uncategorized", "symptoms": [], "fix": "Generic fix"},
        }
        result = diagnose_by_patterns("alpha beta problem", patterns, "A99")
        assert result["primary_pattern"] == "A01"
        assert result["pattern_name"] == "Pattern A"
        assert result["minimal_fix"] == "Fix A"
        assert result["confidence"] == 1.0

    def test_fallback_when_no_match(self):
        """无匹配时返回 fallback 模式。"""
        patterns = {
            "A01": {"name": "Pattern A", "symptoms": ["alpha"], "fix": "Fix A"},
            "A99": {"name": "Uncategorized", "symptoms": [], "fix": "Generic fix"},
        }
        result = diagnose_by_patterns("completely unrelated text", patterns, "A99")
        assert result["primary_pattern"] == "A99"
        assert result["confidence"] == 0.0

    def test_case_insensitive(self):
        """匹配不区分大小写。"""
        patterns = {
            "A01": {"name": "Pattern A", "symptoms": ["timeout"], "fix": "Fix A"},
            "A99": {"name": "Uncategorized", "symptoms": [], "fix": "Generic fix"},
        }
        result = diagnose_by_patterns("TIMEOUT occurred", patterns, "A99")
        assert result["primary_pattern"] == "A01"

    def test_partial_match(self):
        """部分匹配返回归一化置信度。"""
        patterns = {
            "A01": {"name": "Pattern A", "symptoms": ["alpha", "beta", "gamma"], "fix": "Fix A"},
            "A99": {"name": "Uncategorized", "symptoms": [], "fix": "Generic fix"},
        }
        result = diagnose_by_patterns("alpha problem", patterns, "A99")
        assert result["primary_pattern"] == "A01"
        assert result["confidence"] == round(1 / 3, 2)
