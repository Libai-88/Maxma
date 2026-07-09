"""资源生命周期管理原语 — VSCode 风格的 Disposable 模式。

提供 IDisposable 接口和组合管理工具，用于统一管理会话清理、
MCP 连接释放、watcher 注销等资源生命周期。
"""
from agent.lifecycle.disposable import (
    IDisposable,
    to_disposable,
    combined_disposable,
    DisposableStore,
    MutableDisposable,
)

__all__ = [
    "IDisposable",
    "to_disposable",
    "combined_disposable",
    "DisposableStore",
    "MutableDisposable",
]
