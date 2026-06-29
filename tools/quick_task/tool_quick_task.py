"""Tool: quick_task — 轻量级 LLM 调用，不创建 session。

适用场景：文本摘要、翻译、格式转换、简单计算等。
直接调用 LLM 完成简单任务，开销远小于 call_sub_agent。
"""

import asyncio
import logging

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_success, format_error

logger = logging.getLogger(__name__)

# 默认配置
DEFAULT_MAX_TOKENS = 2048
DEFAULT_TIMEOUT = 30  # 秒


class QuickTaskInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    task: str = Field(
        default="",
        description="要完成的任务描述，例如：'将以下文本翻译为英文'、'总结这段内容的要点'",
    )
    context: str = Field(
        default="",
        description="可选的上下文文本，任务将基于此上下文执行",
    )
    max_tokens: int = Field(
        default=DEFAULT_MAX_TOKENS,
        description="最大输出 token 数（默认 2048）",
    )


class QuickTaskTool(ToolBase):
    name: str = "quick_task"
    description: str = (
        "直接调用 LLM 完成简单的文本处理任务，无需创建独立会话。"
        "适用于：翻译、摘要、格式转换、文本改写、简单分析等。"
        "比 call_sub_agent 更轻量，响应更快。"
        "不支持工具调用（如需要工具请使用 call_sub_agent）。"
        "[调用积极性: 可自由看情况调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = QuickTaskInput

    def _run(self, **kwargs) -> str:
        raise NotImplementedError("quick_task 仅支持异步模式")

    async def _arun(
        self,
        get_doc: bool = False,
        task: str = "",
        context: str = "",
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> str:
        if get_doc:
            return self._load_doc()
        if not task.strip():
            return format_error("task 不能为空")

        # 获取 LLM 实例
        try:
            from api import interaction

            ws = interaction.current_ws.get()
            app_state = ws.app.state
            llm = app_state.llm
        except Exception:
            return format_error("无法获取 LLM 实例")

        if llm is None:
            return format_error("未配置 LLM 提供商")

        # 构造提示词
        prompt_parts = []
        if context.strip():
            prompt_parts.append(f"## 上下文\n{context.strip()}\n")
        prompt_parts.append(f"## 任务\n{task.strip()}")
        full_prompt = "\n".join(prompt_parts)

        try:
            # 直接调用 LLM，不使用工具，不创建 session
            from langchain_core.messages import HumanMessage

            response = await asyncio.wait_for(
                llm.ainvoke([HumanMessage(content=full_prompt)]),
                timeout=DEFAULT_TIMEOUT,
            )
            result = response.content if isinstance(response.content, str) else str(response.content)

            if not result.strip():
                return format_error("LLM 返回空结果")

            return format_success({"result": result.strip()})

        except asyncio.TimeoutError:
            return format_error(f"LLM 调用超时（{DEFAULT_TIMEOUT}秒）")
        except Exception as e:
            logger.warning(f"quick_task failed: {e}")
            return format_error(f"任务执行失败: {str(e)[:200]}")
