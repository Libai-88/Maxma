"""
Provider 健康监控 — STUB（已弃用）。

OMP ModelRegistry 管理所有 provider 健康检查。
此模块仅保留函数签名以兼容遗留测试导入。
"""

from typing import Any


async def _check_provider_health(provider_manager: Any, provider_id: str) -> None:
    """已弃用。"""
    pass


async def _health_check_loop(provider_manager: Any) -> None:
    """已弃用。"""
    pass


def start_health_monitor(*args, **kwargs) -> None:
    """已弃用。"""
    pass


async def stop_health_monitor() -> None:
    """已弃用。"""
    pass
