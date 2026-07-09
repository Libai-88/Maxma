"""共享诊断工具基类 — 提取 tool_system_diagnose 和 tool_rag_diagnose 的公共逻辑。

职责：
- diagnose_by_patterns: 纯函数，按症状关键词匹配诊断模式
- DiagnoseToolBase: ToolBase 子类，封装统一的 _run 逻辑
"""
from __future__ import annotations

from pydantic import BaseModel

from tools.base import ToolBase, format_error, format_success


def diagnose_by_patterns(
    failure_description: str,
    patterns: dict[str, dict],
    fallback_key: str,
) -> dict:
    """按症状关键词匹配诊断模式。

    Args:
        failure_description: 故障描述文本
        patterns: 诊断模式数据库，格式 {"key": {"name": str, "symptoms": list[str], "fix": str}}
        fallback_key: 无匹配时的回退模式 key

    Returns:
        {"primary_pattern": str, "pattern_name": str, "minimal_fix": str, "confidence": float}
    """
    text = failure_description.lower()

    best_match = fallback_key
    best_score = 0.0

    for key, pattern in patterns.items():
        score = 0
        for symptom in pattern["symptoms"]:
            if symptom.lower() in text:
                score += 1
        max_possible = max(len(pattern["symptoms"]), 1)
        normalized = score / max_possible
        if normalized > best_score:
            best_score = normalized
            best_match = key

    pattern = patterns[best_match]
    return {
        "primary_pattern": best_match,
        "pattern_name": pattern["name"],
        "minimal_fix": pattern["fix"],
        "confidence": round(best_score, 2),
    }


class DiagnoseToolBase(ToolBase):
    """诊断工具共享基类。

    子类需设置：
    - name: 工具名
    - description: 工具描述
    - args_schema: 输入参数模型（需有 failure_description: str 字段）
    - _patterns: 诊断模式数据库 dict
    - _fallback_key: 无匹配时的回退 key
    """
    _patterns: dict[str, dict] = {}
    _fallback_key: str = ""

    def _run(self, failure_description: str = "") -> str:
        if not failure_description.strip():
            return format_error("failure_description 不能为空")

        result = diagnose_by_patterns(
            failure_description, self._patterns, self._fallback_key
        )

        formatted = (
            f"诊断模式: {result['primary_pattern']} - {result['pattern_name']}\n"
            f"置信度: {result['confidence']}\n"
            f"修复建议: {result['minimal_fix']}"
        )

        return format_success({
            "primary_pattern": result["primary_pattern"],
            "pattern_name": result["pattern_name"],
            "minimal_fix": result["minimal_fix"],
            "confidence": result["confidence"],
            "formatted": formatted,
        })
