"""会话手动压缩 REST 端点。

提供端点：
- POST /api/sessions/{session_id}/compress  手动触发会话上下文压缩
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from agent.context_manager import maybe_trim_checkpoint
from agent.graph import build_agent
from agent.prompts import build_system_prompt
from api.context_usage import count_tokens

router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


def _get_provider_context(app_state) -> tuple[int, str]:
    """从 ProviderManager 获取默认 context_window 和 model_name。

    与 chat._get_provider_context 保持一致，避免跨路由模块导入私有函数。
    """
    mgr = getattr(app_state, "provider_manager", None)
    if mgr is not None and mgr.count > 0:
        for provider in mgr.iter_enabled():
            return provider.config.context_window, provider.default_model
    return 256_000, ""


@router.post("/{session_id}/compress")
async def compress_session(session_id: str, request: Request) -> dict:
    """手动触发会话上下文压缩。

    复用 session 的 checkpointer 构建临时 agent，调用 maybe_trim_checkpoint
    检查并截断过长历史。返回压缩详情 dict；若无需压缩，返回 {"compressed": False}。
    """
    session_manager = request.app.state.session_manager
    session = await session_manager.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    app_state = request.app.state
    llm = getattr(app_state, "llm", None)
    if llm is None:
        raise HTTPException(status_code=503, detail="LLM 未就绪，请先配置 Provider")

    # 获取默认上下文窗口上限（与 chat 流程一致）
    current_max_tokens, _model_name = _get_provider_context(app_state)

    # 系统提示词 token 数（用于判断是否需要截断）
    system_prompt = build_system_prompt()
    system_prompt_tokens = count_tokens(system_prompt)

    # 构建临时 agent：复用 session.checkpointer 以读写同一线程的 checkpoint。
    # 仅做 state 读写，不需要工具/HITL/episodic，故传空工具并禁用 HITL。
    agent_maxma = build_agent(
        model=llm,
        tools=[],
        system_prompt=system_prompt,
        checkpointer=session.checkpointer,
        enable_hitl=False,
    )

    config = {"configurable": {"thread_id": session_id}, "recursion_limit": 120}

    try:
        result = await maybe_trim_checkpoint(
            agent_maxma, config,
            llm=llm, ws_callback=None,
            token_counter=lambda msgs: system_prompt_tokens + sum(
                count_tokens(m.content if isinstance(m.content, str) else str(m.content)) + 4
                for m in msgs
            ),
            max_tokens=current_max_tokens,
        )
        return result
    except Exception as e:
        logger.exception("Manual compress failed for session %s", session_id)
        raise HTTPException(status_code=500, detail=str(e))
