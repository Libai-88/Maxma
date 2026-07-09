"""系统诊断工具测试 — tools/system/tool_system_diagnose.py。

测试策略：
- 验证 S01-S08 诊断模式数据库完整
- 验证诊断逻辑：输入故障描述 → 返回 primary_pattern + fix
- 验证未知故障的回退
- 验证工具注册
"""
import pytest


class TestSystemDiagnosePatterns:
    def test_all_patterns_exist(self):
        """S01-S08 模式数据库完整。"""
        from tools.system.tool_system_diagnose import SYSTEM_FAILURE_PATTERNS

        assert len(SYSTEM_FAILURE_PATTERNS) == 8
        for key in SYSTEM_FAILURE_PATTERNS:
            pattern = SYSTEM_FAILURE_PATTERNS[key]
            assert "name" in pattern
            assert "symptoms" in pattern
            assert "fix" in pattern

    def test_s01_pattern_content(self):
        """S01（LLM 不可用）模式内容正确。"""
        from tools.system.tool_system_diagnose import SYSTEM_FAILURE_PATTERNS

        s01 = SYSTEM_FAILURE_PATTERNS["S01"]
        assert "LLM" in s01["name"] or "llm" in s01["name"].lower()
        assert isinstance(s01["symptoms"], list)


class TestDiagnoseSystemFailure:
    def test_diagnose_llm_timeout(self):
        """诊断 LLM 超时 → S02。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("LLM API 请求超时，返回 timeout 错误")
        assert result["primary_pattern"] == "S02"
        assert "minimal_fix" in result

    def test_diagnose_tool_error(self):
        """诊断工具错误 → S03。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("工具执行失败，run_python 报错")
        assert result["primary_pattern"] == "S03"

    def test_diagnose_provider_error(self):
        """诊断 provider 配置错误 → S04。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("provider API key 无效，认证失败 401")
        assert result["primary_pattern"] == "S04"

    def test_diagnose_memory_error(self):
        """诊断记忆错误 → S05。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("记忆写入失败，ChromaDB 连接错误")
        assert result["primary_pattern"] == "S05"

    def test_diagnose_loop(self):
        """诊断死循环 → S06。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("Agent 反复调用同一工具，陷入死循环")
        assert result["primary_pattern"] == "S06"

    def test_diagnose_unknown_returns_s08(self):
        """未知故障回退到 S08。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("一个完全无法归类的奇怪问题")
        assert result["primary_pattern"] == "S08"


class TestSystemDiagnoseTool:
    def test_tool_registration(self):
        """工具能正常实例化。"""
        from tools.system.tool_system_diagnose import SystemDiagnoseTool

        tool = SystemDiagnoseTool()
        assert tool.name == "system_diagnose"

    def test_tool_run_returns_formatted(self):
        """工具 _run 返回格式化结果。"""
        from tools.system.tool_system_diagnose import SystemDiagnoseTool

        tool = SystemDiagnoseTool()
        result_str = tool._run(failure_description="LLM API 超时")
        assert "S02" in result_str or "超时" in result_str

    def test_tool_run_empty_returns_error(self):
        """空描述返回错误。"""
        from tools.system.tool_system_diagnose import SystemDiagnoseTool

        tool = SystemDiagnoseTool()
        result_str = tool._run(failure_description="")
        assert "错误" in result_str or "error" in result_str.lower()
