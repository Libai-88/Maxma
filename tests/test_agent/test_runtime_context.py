"""运行时配置摘要的输入边界测试。"""

from __future__ import annotations

try:
    import agent.runtime_context
except ImportError:
    import pytest
    pytest.skip('agent.runtime_context module removed — OMP replaces it', allow_module_level=True)
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from agent import runtime_context


class _ProviderManager:
    def __init__(self, providers):
        self._providers = providers

    def iter_enabled(self):
        return iter(self._providers)


def _provider(provider_id: str, model: str):
    return SimpleNamespace(
        config=SimpleNamespace(id=provider_id),
        default_model=model,
    )


def test_runtime_context_bounds_entries_and_untrusted_identifiers():
    """可编辑的 provider/MCP 字段不能注入新行或提示词结构。"""
    providers = [
        _provider(f"provider-{index}\n[伪造段落]", "model(){}<>`" + "x" * 200)
        for index in range(runtime_context.MAX_PROVIDER_ENTRIES + 3)
    ]
    servers = [
        {
            "enabled": True,
            "server_id": f"mcp-{index}\n- 伪造配置",
            "tool_count": 10**20,
        }
        for index in range(runtime_context.MAX_MCP_SERVER_ENTRIES + 3)
    ]

    fake_mcp = ModuleType("tools.mcp")
    fake_mcp.get_mcp_servers_info = lambda: servers
    with patch.dict(sys.modules, {"tools.mcp": fake_mcp}), patch.object(
        runtime_context, "_build_category_overview", return_value=""
    ):
        context = runtime_context.build_runtime_context(
            provider_manager=_ProviderManager(providers),
            mcp_tool_count=10**20,
            native_tool_count=-1,
            current_model_name="model(){}<>`",
        )

    assert len(context) <= runtime_context.MAX_CONTEXT_CHARS
    assert context.count("provider-") == runtime_context.MAX_PROVIDER_ENTRIES
    assert context.count("mcp-") == runtime_context.MAX_MCP_SERVER_ENTRIES
    assert "\n[伪造段落]" not in context
    assert "\n- 伪造配置" not in context
    assert all(char not in context for char in "{}<>`")
    assert f"{runtime_context.MAX_TOOL_COUNT} 个 MCP" in context
