"""Tool: ask_user_confirm — 危险操作确认，需用户输入'确认'才能继续。"""

import asyncio

from pydantic import BaseModel, Field

from api import interaction
from tools.base import ToolBase, format_error, format_success


class AskUserConfirmInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    question: str = Field(default="", description="需要用户确认的危险操作描述")
    detail: str = Field(
        default="",
        description="可选的补充说明（如影响范围、后果等）",
    )


class AskUserConfirmTool(ToolBase):
    name: str = "ask_user_confirm"
    description: str = (
        "向用户展示危险操作确认卡片，需要用户输入'确认'才能继续执行。"
        "用于删除文件、推送代码、修改配置等不可逆或高风险操作。"
        "[调用积极性: 危险操作前必须调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = AskUserConfirmInput

    def _run(
        self,
        get_doc: bool = False,
        question: str = "",
        detail: str = "",
    ) -> str:
        raise NotImplementedError("ask_user_confirm 仅支持异步模式")

    async def _arun(
        self,
        get_doc: bool = False,
        question: str = "",
        detail: str = "",
    ) -> str:
        if get_doc:
            return self._load_doc()
        if not question:
            return format_error("question 不能为空")

        ws = interaction.current_ws.get()

        interaction_id, future = await interaction.register()

        try:
            await ws.send_json(
                {
                    "type": "ask_user",
                    "payload": {
                        "tool_name": self.name,
                        "question": question,
                        "mode": "confirm",
                        "options": [],
                        "interaction_id": interaction_id,
                        "detail": detail,
                    },
                }
            )
            answer = await asyncio.wait_for(future, timeout=300)
            # 校验用户是否输入了'确认'
            if isinstance(answer, str) and answer.strip() in ("确认", "确认执行", "confirm"):
                return format_success(
                    {"question": question, "confirmed": True, "answer": answer}
                )
            else:
                return format_success(
                    {"question": question, "confirmed": False, "answer": answer}
                )
        except asyncio.TimeoutError:
            return format_error("确认超时（300 秒），操作已取消")
        except asyncio.CancelledError:
            return format_error("用户取消了确认")
        finally:
            await interaction.cleanup(interaction_id)
