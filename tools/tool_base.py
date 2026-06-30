"""Tool 基类 — 所有 LangChain Tool 的统一父类。"""

from pathlib import Path

from langchain_core.tools import BaseTool

from tools.client import SharedAPIClient


class ToolBase(BaseTool):
    """所有 Tool 的基类。提供 get_doc 通用实现和统一错误格式。"""

    client: SharedAPIClient | None = None

    @property
    def _client(self) -> SharedAPIClient:
        """非空 client 访问器，供子类安全使用。"""
        assert self.client is not None, "Tool client not initialized"
        return self.client

    def _load_doc(self) -> str:
        """读取同目录下的 TOOL.md，作为领域知识返回给 LLM。"""
        import sys

        mod = sys.modules.get(self.__class__.__module__)
        if mod is not None and hasattr(mod, "__file__") and mod.__file__ is not None:
            tool_dir = Path(mod.__file__).parent
        else:
            tool_dir = Path(".")
        doc_path = tool_dir / "TOOL.md"
        if doc_path.exists():
            return doc_path.read_text(encoding="utf-8")
        return "（本 Tool 暂无文档）"
