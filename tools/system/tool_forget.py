"""Tool: forget — 选择性遗忘，从上下文中移除与指定关键词相关的消息。"""

from pydantic import BaseModel, Field

from api import interaction
from tools.base import ToolBase, format_error, format_success
from langchain_core.messages import RemoveMessage


class ForgetInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    topic: str = Field(
        default="",
        description="要遗忘的主题或关键词，Agent 将从上下文中移除包含此关键词的消息",
    )


class ForgetTool(ToolBase):
    name: str = "forget"
    description: str = (
        "选择性遗忘：从当前对话上下文中移除与指定主题相关的所有消息。"
        "用于用户要求'忘记关于 XX 的讨论'时。"
        "注意：这不会删除记忆系统中的记忆，仅影响当前对话的上下文窗口。"
        "[调用积极性: 用户明确要求忘记某些内容时调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = ForgetInput

    def _run(self, get_doc: bool = False, topic: str = "") -> str:
        raise NotImplementedError("forget 仅支持异步模式")

    async def _arun(self, get_doc: bool = False, topic: str = "") -> str:
        if get_doc:
            return self._load_doc()
        if not topic:
            return format_error("topic 不能为空")

        try:
            ws = interaction.current_ws.get()
            session_id = interaction.current_session_id.get()
            if not session_id:
                return format_error("无法获取当前会话 ID")

            sm = ws.app.state.session_manager
            session = await sm.get(session_id)
            if not session or not session._graph:
                return format_error("当前会话不存在或没有活跃的图")

            graph = session._graph
            config = {"configurable": {"thread_id": session_id}}

            # 获取当前 checkpoint 状态
            state = await graph.aget_state(config)

            if not state or not state.values:
                return format_error("当前没有对话上下文")

            messages = state.values.get("messages", [])
            if not messages:
                return format_error("当前没有对话消息")

            # 过滤掉包含关键词的消息，生成 RemoveMessage 删除列表
            keyword = topic.lower()
            remove_msgs = []
            removed_count = 0
            for msg in messages:
                content = str(getattr(msg, "content", ""))
                if keyword in content.lower():
                    msg_id = getattr(msg, "id", None)
                    if msg_id:
                        remove_msgs.append(RemoveMessage(id=msg_id))
                    removed_count += 1

            if removed_count == 0:
                return format_success({
                    "topic": topic,
                    "removed_count": 0,
                    "message": f"未找到与 '{topic}' 相关的消息",
                })

            # 使用 RemoveMessage 删除旧消息（add_messages reducer 正确识别）
            await graph.aupdate_state(config, {"messages": remove_msgs})

            return format_success({
                "topic": topic,
                "removed_count": removed_count,
                "remaining_count": len(kept),
                "message": f"已移除 {removed_count} 条与 '{topic}' 相关的消息，剩余 {len(kept)} 条",
            })

        except LookupError:
            return format_error("无法获取 WebSocket 上下文")
        except Exception as e:
            return format_error(f"遗忘操作失败: {e}")
