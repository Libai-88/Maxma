"""RAG 失败诊断工具 — 将故障描述映射到 P01-P12 诊断模式。

来源：rag_failure_diagnostics_clinic 的 12 模式分类法。
职责：输入故障描述，返回最匹配的诊断模式 + 最小修复建议。
纯规则匹配，不调用 LLM、不依赖向量库。

P01-P12 覆盖了 Maxma 已踩过的坑：
- P10（ChromaDB 标量元数据）— 项目记忆中明确记录
- P11（代理拦截 localhost）— 项目记忆中明确记录
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool


# ── P01-P12 诊断模式数据库 ──
RAG_FAILURE_PATTERNS: dict[str, dict] = {
    "P01": {
        "name": "检索零结果",
        "symptoms": ["空结果", "没有匹配", "零结果", "无返回", "count=0", "找不到"],
        "fix": "检查知识库是否为空；确认 embedding 引擎已加载；验证查询文本非空；检查 collection 是否正确创建。",
    },
    "P02": {
        "name": "对话式查询 embed 效果差",
        "symptoms": ["那个东西", "它支持", "之前聊的", "上下文", "指代", "代词"],
        "fix": "启用查询重写（query_rewrite_enabled），将对话式查询重写为自包含查询后再 embed。",
    },
    "P03": {
        "name": "低相关度结果",
        "symptoms": ["不相关", "相似度低", "阈值过滤", "相关性差", "答非所问"],
        "fix": "启用 CRAG grading（crag_enabled）过滤不相关结果；或调高 threshold；考虑引入重排器。",
    },
    "P04": {
        "name": "切块过大",
        "symptoms": ["切块太大", "chunk size", "上下文过长", "截断", "overflow"],
        "fix": "减小 chunk_size（建议 500-800 tokens）；调整 chunk_overlap（建议 50-100 tokens）。",
    },
    "P05": {
        "name": "embedding 模型不匹配",
        "symptoms": ["embedding 模型", "维度不匹配", "model mismatch", "ONNX"],
        "fix": "确认查询和索引使用相同的 embedding 模型；检查 ONNX 模型版本一致性。",
    },
    "P06": {
        "name": "索引未更新",
        "symptoms": ["索引过期", "未更新", "stale", "新文档没搜到", "添加后搜不到"],
        "fix": "确认文档添加后 index 已刷新；检查 upsert 是否成功；验证 collection.count() 增加。",
    },
    "P07": {
        "name": "查询过短或过长",
        "symptoms": ["查询太短", "查询太长", "单字查询", "超长查询"],
        "fix": "对过短查询添加上下文；对过长查询提取关键词；设置查询长度上下限。",
    },
    "P08": {
        "name": "阈值设置不当",
        "symptoms": ["阈值", "threshold", "过滤太严", "过滤太松"],
        "fix": "调整 threshold：0.2-0.4 适合宽松检索，0.5-0.7 适合精确匹配；或启用 CRAG grading 替代硬阈值。",
    },
    "P09": {
        "name": "top_k 过小或过大",
        "symptoms": ["top_k", "结果太少", "结果太多"],
        "fix": "调整 top_k：3-5 适合精确问答，10-20 适合研究型查询；CRAG 场景建议 top_k=20 召回 + grading 筛选。",
    },
    "P10": {
        "name": "ChromaDB 元数据类型错误",
        "symptoms": ["元数据", "metadata", "嵌套字典", "upsert 失败", "scalar", "标量"],
        "fix": "ChromaDB metadata 值必须是标量类型（str/int/float/bool/None）；嵌套字典会导致 upsert 失败，需扁平化或 JSON 序列化。",
    },
    "P11": {
        "name": "代理拦截本地请求",
        "symptoms": ["代理", "proxy", "localhost", "127.0.0.1", "连接失败", "timeout", "Clash", "V2Ray"],
        "fix": "设置 NO_PROXY=127.0.0.1,localhost,::1；或在 HTTP 客户端配置 .no_proxy()；关闭 Clash/V2Ray 测试。",
    },
    "P12": {
        "name": "未分类故障",
        "symptoms": [],
        "fix": "检查日志获取详细错误信息；确认 chromadb/onnxruntime 版本；验证 .venv 隔离环境；参考 rag_failure_diagnostics_clinic 文档。",
    },
}


def diagnose_failure(failure_description: str) -> dict:
    """诊断 RAG 故障，返回最匹配的模式。

    Args:
        failure_description: 故障描述文本

    Returns:
        {"primary_pattern": "P0x", "pattern_name": str, "minimal_fix": str, "confidence": float}
    """
    text = failure_description.lower()

    best_match = "P12"
    best_score = 0

    for key, pattern in RAG_FAILURE_PATTERNS.items():
        score = 0
        for symptom in pattern["symptoms"]:
            if symptom.lower() in text:
                score += 1
        max_possible = max(len(pattern["symptoms"]), 1)
        normalized = score / max_possible
        if normalized > best_score:
            best_score = normalized
            best_match = key

    pattern = RAG_FAILURE_PATTERNS[best_match]
    return {
        "primary_pattern": best_match,
        "pattern_name": pattern["name"],
        "minimal_fix": pattern["fix"],
        "confidence": round(best_score, 2),
    }


class RagDiagnoseInput(BaseModel):
    """rag_diagnose 输入参数"""
    failure_description: str = Field(
        description="RAG 故障的描述（症状、错误信息、复现步骤等）",
    )


@register_tool
class RagDiagnoseTool(ToolBase):
    """RAG 失败诊断工具：将故障描述映射到 P01-P12 诊断模式 + 最小修复建议。"""

    name: str = "rag_diagnose"
    description: str = (
        "诊断 RAG 检索故障。输入故障描述，返回最匹配的 P01-P12 诊断模式、"
        "模式名称、最小修复建议和置信度。"
        "当用户报告知识库检索问题、RAG 质量差、向量库错误时使用。"
        "[调用积极性: 用户报告检索/向量库问题时主动调用] [get_doc: 无]"
    )
    args_schema: type[BaseModel] = RagDiagnoseInput

    def _run(self, failure_description: str = "") -> str:
        if not failure_description.strip():
            return format_error("failure_description 不能为空")

        result = diagnose_failure(failure_description)

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
