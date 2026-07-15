"""Web API 共享资源 — LLM、系统提示词、工具集的惰性单例。"""

from agent.prompts import build_system_prompt

# tools/ 目录已删除（工具已重写为 oh-my-pi AgentTool）
# Python 端不再需要 get_all_tools()
try:
    from tools import get_all_tools as _get_all_tools
except ImportError:
    _get_all_tools = lambda: []

_system_prompt: str | None = None
_tools: list | None = None


def get_llm(provider_manager=None):
    """获取 LLM。

    阶段 3.3：从 ProviderManager 中取优先级最高的健康 provider 创建 LLM
    （使用 get_healthy 跳过 health_status == error 的 provider）。
    若无可用的 provider 则抛出 RuntimeError。
    LLM 配置统一由 providers.yaml 管理，不再降级到 .env。
    """
    if provider_manager is not None and provider_manager.count > 0:
        # 阶段 3.3：优先返回健康 provider
        provider = provider_manager.get_healthy()
        if provider is not None:
            return provider.create_llm(
                provider.default_model,
                temperature=0.7,
                streaming=True,
            )
        # 全部 unhealthy 时回退到 iter_enabled 第一个（让调用方得到错误）
        for provider in provider_manager.iter_enabled():
            return provider.create_llm(
                provider.default_model,
                temperature=0.7,
                streaming=True,
            )

    raise RuntimeError(
        "No enabled LLM provider configured. Add one via the providers panel (/providers)."
    )


def get_system_prompt() -> str:
    global _system_prompt
    if _system_prompt is None:
        _system_prompt = build_system_prompt()
    return _system_prompt


def get_tools() -> list:
    global _tools
    if _tools is None:
        _tools = _get_all_tools()
    return _tools
