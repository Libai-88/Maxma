"""系统级故障诊断工具 — 将系统故障描述映射到 S01-S08 诊断模式。

来源：autonomy layer 的 self-diagnosis 能力，扩展自 rag_diagnose 的 P01-P12 模式。
职责：输入系统故障描述，返回最匹配的诊断模式 + 最小修复建议。
纯规则匹配，不调用 LLM、不依赖外部服务。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool


# ── S01-S08 系统诊断模式数据库 ──
SYSTEM_FAILURE_PATTERNS: dict[str, dict] = {
    "S01": {
        "name": "LLM Provider 不可用",
        "symptoms": ["llm 不可用", "未配置", "provider 不可用", "llm is none", "模型未加载", "runtime 未初始化"],
        "fix": "检查 providers.yaml 配置；确认 API key 有效；通过 Web UI 添加至少一个 provider；重启后端等待 LLM 后台初始化完成。",
    },
    "S02": {
        "name": "LLM API 超时/限流",
        "symptoms": ["超时", "timeout", "限流", "rate limit", "429", "503", "api 请求失败", "连接重置"],
        "fix": "检查网络连接；降低请求频率；确认 API 额度未耗尽；尝试切换到其他 provider 或模型。",
    },
    "S03": {
        "name": "工具执行错误",
        "symptoms": ["工具", "tool", "执行失败", "run_python", "报错", "工具调用", "tool error"],
        "fix": "检查工具输入参数；确认依赖环境（Python 包、文件路径）正确；查看 tool_error 详细日志；使用 system_diagnose 进一步定位。",
    },
    "S04": {
        "name": "Provider 认证/配置错误",
        "symptoms": ["api key", "认证失败", "401", "403", "unauthorized", "无效", "key 无效", "配置错误"],
        "fix": "通过 Web UI 重新配置 provider API key；确认 key 未过期；检查 base_url 是否正确；确认模型名称拼写正确。",
    },
    "S05": {
        "name": "记忆/向量库错误",
        "symptoms": ["记忆", "memory", "chromadb", "向量库", "embedding", "upsert", "collection"],
        "fix": "检查 ChromaDB 进程状态；确认 embedding 模型已加载；使用 rag_diagnose 工具进一步诊断 RAG 问题；检查磁盘空间。",
    },
    "S06": {
        "name": "Agent 死循环",
        "symptoms": ["死循环", "loop", "反复调用", "重复", "recursion", "循环检测", "同一工具"],
        "fix": "调整 loop_detection_threshold（默认 3）；检查工具输出是否导致 Agent 误判；优化系统提示词减少循环倾向；降低 recursion_limit。",
    },
    "S07": {
        "name": "会话/连接错误",
        "symptoms": ["websocket", "ws", "连接断开", "session", "会话", "断开", "disconnect", "4001"],
        "fix": "检查网络稳定性；确认 Token 未过期；查看 ws_registry 日志；重启后端恢复连接。",
    },
    "S08": {
        "name": "未分类系统故障",
        "symptoms": [],
        "fix": "查看 /api/diagnostics/error-log 获取详细错误信息；检查 maxma.log 日志文件；确认 Python 版本和依赖包版本；重启后端。",
    },
}


def diagnose_system_failure(failure_description: str) -> dict:
    """诊断系统故障，返回最匹配的模式。

    Args:
        failure_description: 故障描述文本

    Returns:
        {"primary_pattern": "S0x", "pattern_name": str, "minimal_fix": str, "confidence": float}
    """
    text = failure_description.lower()

    best_match = "S08"
    best_score = 0

    for key, pattern in SYSTEM_FAILURE_PATTERNS.items():
        score = 0
        for symptom in pattern["symptoms"]:
            if symptom.lower() in text:
                score += 1
        max_possible = max(len(pattern["symptoms"]), 1)
        normalized = score / max_possible
        if normalized > best_score:
            best_score = normalized
            best_match = key

    pattern = SYSTEM_FAILURE_PATTERNS[best_match]
    return {
        "primary_pattern": best_match,
        "pattern_name": pattern["name"],
        "minimal_fix": pattern["fix"],
        "confidence": round(best_score, 2),
    }


class SystemDiagnoseInput(BaseModel):
    """system_diagnose 输入参数"""
    failure_description: str = Field(
        description="系统故障的描述（错误信息、症状、复现步骤等）",
    )


@register_tool
class SystemDiagnoseTool(ToolBase):
    """系统级故障诊断工具：将系统故障描述映射到 S01-S08 诊断模式 + 最小修复建议。"""

    name: str = "system_diagnose"
    description: str = (
        "诊断系统级故障。输入故障描述，返回最匹配的 S01-S08 诊断模式、"
        "模式名称、最小修复建议和置信度。"
        "当用户报告系统错误、LLM 不可用、工具失败、provider 问题时使用。"
        "[调用积极性: 用户报告系统级问题时主动调用] [get_doc: 无]"
    )
    args_schema: type[BaseModel] = SystemDiagnoseInput

    def _run(self, failure_description: str = "") -> str:
        if not failure_description.strip():
            return format_error("failure_description 不能为空")

        result = diagnose_system_failure(failure_description)

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
