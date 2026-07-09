"""RAG 失败诊断工具测试 — tools/system/tool_rag_diagnose.py。

测试策略：
- 验证工具能正确注册
- 验证 P01-P12 模式数据库完整
- 验证诊断逻辑：输入故障描述 → 返回 primary_pattern + minimal_fix
- 验证未知故障的回退
"""
import pytest


class TestRagDiagnosePatterns:
    def test_all_12_patterns_exist(self):
        """P01-P12 模式数据库完整。"""
        from tools.system.tool_rag_diagnose import RAG_FAILURE_PATTERNS

        assert len(RAG_FAILURE_PATTERNS) == 12
        for i in range(1, 13):
            key = f"P{i:02d}"
            assert key in RAG_FAILURE_PATTERNS
            pattern = RAG_FAILURE_PATTERNS[key]
            assert "name" in pattern
            assert "symptoms" in pattern
            assert "fix" in pattern

    def test_p01_pattern_content(self):
        """P01（检索零结果）模式内容正确。"""
        from tools.system.tool_rag_diagnose import RAG_FAILURE_PATTERNS

        p01 = RAG_FAILURE_PATTERNS["P01"]
        assert "零结果" in p01["name"] or "empty" in p01["name"].lower()
        assert isinstance(p01["symptoms"], list)
        assert isinstance(p01["fix"], str)


class TestRagDiagnoseTool:
    def test_tool_registration(self):
        """工具能正常实例化。"""
        from tools.system.tool_rag_diagnose import RagDiagnoseTool

        tool = RagDiagnoseTool()
        assert tool.name == "rag_diagnose"
        assert tool is not None

    def test_diagnose_zero_results(self):
        """诊断零结果故障 → P01。"""
        from tools.system.tool_rag_diagnose import diagnose_failure

        result = diagnose_failure("检索总是返回空结果，没有任何匹配")
        assert result["primary_pattern"] == "P01"
        assert "minimal_fix" in result

    def test_diagnose_low_relevance(self):
        """诊断低相关度故障 → P03。"""
        from tools.system.tool_rag_diagnose import diagnose_failure

        result = diagnose_failure("检索结果与查询不相关，相似度很低")
        assert result["primary_pattern"] == "P03"

    def test_diagnose_metadata_error(self):
        """诊断元数据错误 → P10。"""
        from tools.system.tool_rag_diagnose import diagnose_failure

        result = diagnose_failure("upsert 失败，元数据包含嵌套字典")
        assert result["primary_pattern"] == "P10"

    def test_diagnose_unknown_returns_p12(self):
        """未知故障回退到 P12（未分类）。"""
        from tools.system.tool_rag_diagnose import diagnose_failure

        result = diagnose_failure("一个完全无法归类的奇怪问题")
        assert result["primary_pattern"] == "P12"

    def test_tool_run_returns_formatted(self):
        """工具 _run 返回格式化结果。"""
        from tools.system.tool_rag_diagnose import RagDiagnoseTool

        tool = RagDiagnoseTool()
        result_str = tool._run(failure_description="检索返回空结果")
        assert "P01" in result_str or "零结果" in result_str
