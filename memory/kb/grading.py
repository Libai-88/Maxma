"""KB 文档相关性评分 — CRAG 的 grading 步骤。

来源：corrective_rag 的 grade_documents 模式。
职责：取查询 + 检索到的文档，逐个判定是否相关。
不修改检索器状态。检索器（retriever.py）负责调用本模块并据结果决定是否回退。

安全回退策略：任何异常（LLM 错误 / JSON 解析失败）都回退到 relevant=True，
不丢弃可能有用的文档——grading 是质量增强，不是硬过滤器。
"""
from __future__ import annotations

import json
import logging
import re

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class DocGrade(BaseModel):
    """单文档相关性判定。"""
    relevant: bool = Field(description="是否与查询相关")
    reasoning: str = Field(default="", description="判定理由")

    def is_relevant(self) -> bool:
        return self.relevant


async def grade_single_doc(
    model: BaseChatModel,
    query: str,
    doc_text: str,
) -> DocGrade:
    """评分单个文档与查询的相关性。

    任何异常安全回退到 relevant=True（不丢弃可能有用的文档）。

    Args:
        model: LLM 模型（建议用廉价模型，grading 是分类任务）
        query: 用户查询
        doc_text: 文档文本

    Returns:
        DocGrade
    """
    try:
        from agent.prompts import build_rag_grader_prompt

        prompt = build_rag_grader_prompt()
        user_msg = f"## 查询\n{query}\n\n## 文档\n{doc_text[:500]}"
        messages = [SystemMessage(content=prompt), HumanMessage(content=user_msg)]
        response = await model.ainvoke(messages)
        content = (
            response.content
            if isinstance(response.content, str)
            else str(response.content)
        )

        grade = _parse_grade_json(content)
        if grade is not None:
            return grade

        logger.warning("[grading] JSON 解析失败，回退到 relevant: %s", content[:200])
        return DocGrade(relevant=True, reasoning="JSON 解析失败，安全回退")
    except Exception as e:
        logger.warning("[grading] LLM 调用失败，回退到 relevant: %s", e)
        return DocGrade(relevant=True, reasoning=f"LLM 异常，安全回退: {type(e).__name__}")


async def grade_documents(
    model: BaseChatModel,
    query: str,
    docs: list[dict],
) -> list[DocGrade]:
    """批量评分多个文档。

    Args:
        model: LLM 模型
        query: 用户查询
        docs: 检索到的文档列表，每项至少包含 "text" 字段

    Returns:
        DocGrade 列表，顺序与 docs 一一对应
    """
    if not docs:
        return []
    grades = []
    for doc in docs:
        text = doc.get("text", doc.get("document", ""))
        grade = await grade_single_doc(model, query, text)
        grades.append(grade)
    return grades


def filter_relevant(docs: list[dict], grades: list[DocGrade]) -> list[dict]:
    """从 docs + grades 中筛选相关文档。

    Args:
        docs: 文档列表
        grades: 对应的 DocGrade 列表（长度需与 docs 一致）

    Returns:
        相关文档列表
    """
    if len(docs) != len(grades):
        logger.warning("[grading] docs/grades 长度不匹配: %d vs %d, 返回全部", len(docs), len(grades))
        return docs
    return [doc for doc, grade in zip(docs, grades) if grade.is_relevant()]


def _parse_grade_json(content: str) -> DocGrade | None:
    """从 LLM 输出解析判定 JSON，容错处理。"""
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if json_match:
        content = json_match.group(1)
    else:
        brace_match = re.search(r"\{[^{}]*\}", content, re.DOTALL)
        if brace_match:
            content = brace_match.group(0)

    try:
        data = json.loads(content)
        return DocGrade(
            relevant=bool(data.get("relevant", True)),
            reasoning=data.get("reasoning", ""),
        )
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
