"""Tool: ask_user_qa — 向用户提问并等待自由文本回复。"""

import asyncio

from pydantic import BaseModel, Field

from api import interaction
from tools.base import ToolBase, format_error, format_success, register_tool


class AskUserQAInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    question: str = Field(default="", description="需要询问用户的问题")


@register_tool
class AskUserQATool(ToolBase):
    name: str = "ask_user_qa"
    description: str = (
        "向用户提问并等待文字回复。用于需要用户自由输入信息的场景。"
        "[调用积极性: 可自由看情况调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = AskUserQAInput

    def _run(self, get_doc: bool = False, question: str = "") -> str:
        raise NotImplementedError("ask_user_qa 仅支持异步模式")

    async def _arun(self, get_doc: bool = False, question: str = "") -> str:
        if get_doc:
            return self._load_doc()
        if not question:
            return format_error("question 不能为空")

        ws = interaction.current_ws.get(None)
        if ws is None:
            return format_error("当前无 WebSocket 连接，无法向用户提问")

        interaction_id, future = await interaction.register()

        try:
            await ws.send_json(
                {
                    "type": "ask_user",
                    "payload": {
                        "tool_name": self.name,
                        "question": question,
                        "mode": "qa",
                        "options": [],
                        "interaction_id": interaction_id,
                    },
                }
            )
            # 修复：此前无超时 → 用户不回复则 Agent 任务永久挂起，session._active_task
            # 无法完成，直到 TTL 清理（30 分钟）才被取消。QA 给 10 分钟超时。
            answer = await asyncio.wait_for(future, timeout=600)
            return format_success({"question": question, "answer": answer})
        except asyncio.TimeoutError:
            return format_error("用户回复超时（600 秒），问题已取消")
        except asyncio.CancelledError:
            return format_error("用户取消了回复")
        finally:
            await interaction.cleanup(interaction_id)
