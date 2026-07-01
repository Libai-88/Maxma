"""Tool: context_strategy — 设置上下文管理策略。"""

from pydantic import BaseModel, Field

from api import interaction
from tools.base import ToolBase, format_error, format_success


class ContextStrategyInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    strategy: str = Field(
        default="",
        description=(
            "策略设置，支持以下值：\n"
            "- 'keep_recent:N' — 保留最近 N 轮对话（如 'keep_recent:10'）\n"
            "- 'no_compress' — 禁止自动压缩上下文\n"
            "- 'default' — 恢复默认策略（自动压缩，动态保留 3-6 轮）"
        ),
    )


class ContextStrategyTool(ToolBase):
    name: str = "context_strategy"
    description: str = (
        "设置当前会话的上下文管理策略。"
        "用户可以指定保留最近 N 轮对话、禁止自动压缩、或恢复默认策略。"
        "[调用积极性: 用户对上下文管理有明确要求时调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = ContextStrategyInput

    def _run(self, get_doc: bool = False, strategy: str = "") -> str:
        if get_doc:
            return self._load_doc()
        if not strategy:
            return format_error("strategy 不能为空")

        # 解析策略
        if strategy == "default":
            parsed = {"type": "default"}
        elif strategy == "no_compress":
            parsed = {"type": "no_compress"}
        elif strategy.startswith("keep_recent:"):
            try:
                n = int(strategy.split(":")[1])
                if n < 1 or n > 50:
                    return format_error("keep_recent 的轮数必须在 1-50 之间")
                parsed = {"type": "keep_recent", "turns": n}
            except (ValueError, IndexError):
                return format_error("keep_recent 格式错误，应为 'keep_recent:N'，N 为 1-50 的整数")
        else:
            return format_error(
                f"未知策略: {strategy}。支持: 'keep_recent:N', 'no_compress', 'default'"
            )

        # 存储到会话设置
        session_id = interaction.current_session_id.get()
        if not session_id:
            return format_error("无法获取当前会话 ID")

        try:
            ws = interaction.current_ws.get()
            sm = ws.app.state.session_manager
            session = sm.get(session_id)
            if session:
                session.context_strategy = parsed
                self._save_strategy(session_id, parsed)
                return format_success({
                    "strategy": strategy,
                    "parsed": parsed,
                    "message": f"上下文策略已设置为: {strategy}",
                })
            return format_error("未找到当前会话")
        except Exception as e:
            return format_error(f"设置策略失败: {e}")

    def _save_strategy(self, session_id: str, strategy: dict):
        """持久化策略到会话元数据。"""
        import json
        from pathlib import Path
        from app_paths import API_DATA_DIR

        strategy_file = API_DATA_DIR / "context_strategies.json"
        strategies = {}
        if strategy_file.exists():
            try:
                strategies = json.loads(strategy_file.read_text(encoding="utf-8"))
            except Exception:
                strategies = {}
        strategies[session_id] = strategy
        strategy_file.write_text(
            json.dumps(strategies, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
