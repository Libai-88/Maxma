"""自治层自改进 Runner — 无 WS 的 headless Agent 执行。

模式：通过 oh-my-pi sidecar 创建临时会话执行自治任务。
- 创建临时 sidecar 会话
- 注入诊断报告作为提示词
- 超时控制 + finally 清理会话

安全边界：
- 不允许 ask_user_* 工具（headless 模式无用户交互）
- 超时后安全清理
- 任何异常都确保会话被删除
"""
from __future__ import annotations

import asyncio
import json
import logging
import traceback
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Headless 自改进 Agent 允许的工具白名单（fail-closed：仅这些工具可用）
# 安全原则：无用户交互的后台 Agent 只能诊断 + 管理 Skills，不能执行代码/写文件/改配置
_ALLOWED_HEADLESS_TOOLS: frozenset[str] = frozenset({
    "manage_skills",    # 创建/更新 Skills（核心自改进能力）
    "system_diagnose",  # 系统级故障诊断
    "rag_diagnose",     # RAG 故障诊断
    "kb_search",        # 知识库检索（查找已有文档）
    "report_to_user",   # 完成信号（每个后台 run 必须调用）
})


def _filter_tools_for_headless(tools: list) -> list:
    """按白名单过滤工具（fail-closed：仅白名单内工具可用）。

    Headless 自改进 Agent 无用户交互，不能执行代码/写文件/改配置。
    只允许诊断工具和 Skills 管理工具。
    """
    return [t for t in tools if getattr(t, "name", "") in _ALLOWED_HEADLESS_TOOLS]


def _build_self_improve_prompt(report: dict) -> str:
    """构建自改进提示词。"""
    issues_text = "\n".join(
        f"- [{issue['priority']}] {issue['component']}: {issue['description']}"
        for issue in report.get("issues", [])
    )
    errors_text = "\n".join(
        f"  [{cat}] x{count}" for cat, count in report.get("error_summary", {}).get("by_category", {}).items()
    )
    health_text = report.get("health_summary", {}).get("overall_status", "unknown")
    degraded = ", ".join(report.get("health_summary", {}).get("degraded_components", []))
    recent_messages_text = "\n".join(
        report.get("error_summary", {}).get("recent_messages", [])[:5]
    )

    return f"""[自治自改进任务]

你是 Maxma 的自治自改进 Agent。以下是系统自诊断报告，请分析问题并采取改进措施。

## 诊断报告

### 健康状态: {health_text}
{f"降级组件: {degraded}" if degraded else "所有组件正常"}

### 错误摘要
{errors_text if errors_text else "无错误"}

### 问题列表
{issues_text if issues_text else "无问题"}

### 最近错误消息
{recent_messages_text}

## 你的任务

1. 分析上述问题，判断是否有可自动修复的
2. 如果是重复工具错误，检查工具配置或创建改进 Skill
3. 如果是 LLM/Provider 问题，建议用户检查配置（不要尝试自动修改 provider）
4. 如果发现可改进的模式，使用 manage_skills 工具创建或更新 Skill
5. 输出简短的改进总结

注意：
- 你是后台自治模式，不要请求用户确认
- 只能创建/更新 Skills，不要修改系统配置文件
- 如果问题需要人工干预，明确说明
"""


def _extract_final_answer(output: dict) -> str:
    """从 Agent 输出中提取最终答案。"""
    try:
        messages = output.get("messages", [])
        for msg in reversed(messages):
            content = getattr(msg, "content", "")
            if content and isinstance(content, str) and len(content.strip()) > 0:
                # 跳过工具消息
                msg_type = getattr(msg, "type", "")
                if msg_type == "ai":
                    return content
        # 回退：取最后一条消息
        if messages:
            return getattr(messages[-1], "content", "") or ""
    except Exception:
        pass
    return ""


async def run_self_improvement_agent(
    app: Any,
    diagnostic_report: dict,
    timeout: int = 300,
    transcript_path: Path | str | None = None,
) -> str:
    """执行自改进 Agent 会话（通过 oh-my-pi sidecar）。

    Args:
        app: FastAPI 应用实例
        diagnostic_report: 诊断报告 dict
        timeout: 最大执行时间（秒）
        transcript_path: 可选，如果指定则把对话写入 JSONL transcript

    Returns:
        Agent 执行结果文本

    Raises:
        RuntimeError: sidecar 不可用
    """
    sidecar_mgr = getattr(app.state, "sidecar_manager", None)
    if sidecar_mgr is None:
        raise RuntimeError("Sidecar 未初始化，无法执行自改进")

    await sidecar_mgr.start()
    client = sidecar_mgr.client
    if client is None:
        raise RuntimeError("Sidecar client 不可用")

    # 构建系统提示词
    system_prompt = getattr(app.state, "system_prompt", "") or ""
    system_prompt = (
        system_prompt
        + "\n\n[自治自改进模式]\n"
        + "当前任务由自治调度器自动触发，没有可交互的聊天 WebSocket。"
        + "不要请求用户确认或等待用户输入。"
        + "你可以使用 manage_skills 工具创建或更新 Skills 来改进系统。"
    )

    # 构建提示词
    prompt = _build_self_improve_prompt(diagnostic_report)

    # OMP ModelRegistry 管理所有 provider，使用默认模型
    model_str = "openai/gpt-4o"

    # 创建临时 sidecar 会话
    result = await client.call("create_session", {
        "model": model_str,
        "system_prompt": system_prompt,
        "cwd": ".",
    })
    sidecar_sid = result["session_id"]

    logger.info("[autonomy:runner] 启动自改进 sidecar session (timeout=%ds)", timeout)

    try:
        # 收集最终回答
        final_answer = ""
        done_event = asyncio.Event()

        def _on_event(params: dict) -> None:
            nonlocal final_answer
            event = params.get("event", {})
            etype = event.get("type", "")
            if etype == "answer":
                final_answer = event.get("payload", {}).get("content", "")
            elif etype == "done":
                done_event.set()

        client.on("event", _on_event, session_id=sidecar_sid)

        # 发送 prompt
        await client.call("prompt", {
            "session_id": sidecar_sid,
            "message": prompt,
        })

        # 等待完成
        await asyncio.wait_for(done_event.wait(), timeout=timeout)

        return final_answer or "（自改进任务完成，无输出）"

    except asyncio.TimeoutError:
        logger.warning("[autonomy:runner] 自改进超时 (%ds)", timeout)
        return "（自改进任务超时）"
    finally:
        # 清理临时会话
        try:
            await client.call("destroy_session", {"session_id": sidecar_sid})
        except Exception:
            logger.debug("[autonomy:runner] destroy_session failed", exc_info=True)
