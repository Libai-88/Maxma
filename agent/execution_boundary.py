# agent/execution_boundary.py
"""不可变执行边界契约。

执行边界定义了一次 Agent 执行的"运行环境边界"：
- 在哪个服务器节点上执行
- 工作目录是什么
- 沙盒是否启用
- 文件系统可访问范围
- 网络是否可用

一旦创建不可修改（deepFreeze），跨函数/进程传递时保持语义一致。
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any


def _deep_freeze(obj: Any) -> Any:
    """递归冻结对象，使其完全不可变。"""
    if isinstance(obj, dict):
        frozen = {k: _deep_freeze(v) for k, v in obj.items()}
        return frozenset(frozen.items())  # type: ignore
    if isinstance(obj, list):
        return tuple(_deep_freeze(item) for item in obj)
    if isinstance(obj, set):
        return frozenset(_deep_freeze(item) for item in obj)
    return obj


class ExecutionBoundary:
    """不可变执行边界。所有字段 readonly。"""

    __slots__ = (
        "_boundary_id", "_server_node_id", "_workbench",
        "_sandbox_enabled", "_filesystem_scope", "_network_enabled",
        "_created_at",
    )

    def __init__(
        self,
        *,
        boundary_id: str,
        server_node_id: str,
        workbench: str,
        sandbox_enabled: bool = False,
        filesystem_scope: tuple[str, ...] = (),
        network_enabled: bool = True,
        created_at: float | None = None,
    ) -> None:
        import time
        object.__setattr__(self, "_boundary_id", boundary_id)
        object.__setattr__(self, "_server_node_id", server_node_id)
        object.__setattr__(self, "_workbench", workbench)
        object.__setattr__(self, "_sandbox_enabled", sandbox_enabled)
        object.__setattr__(self, "_filesystem_scope", tuple(filesystem_scope))
        object.__setattr__(self, "_network_enabled", network_enabled)
        object.__setattr__(self, "_created_at", created_at or time.time())

    @property
    def boundary_id(self) -> str: return self._boundary_id
    @property
    def server_node_id(self) -> str: return self._server_node_id
    @property
    def workbench(self) -> str: return self._workbench
    @property
    def sandbox_enabled(self) -> bool: return self._sandbox_enabled
    @property
    def filesystem_scope(self) -> tuple[str, ...]: return self._filesystem_scope
    @property
    def network_enabled(self) -> bool: return self._network_enabled
    @property
    def created_at(self) -> float: return self._created_at

    def __setattr__(self, name: str, value: Any) -> None:
        raise AttributeError(f"ExecutionBoundary is immutable, cannot set {name}")

    def __delattr__(self, name: str) -> None:
        raise AttributeError(f"ExecutionBoundary is immutable, cannot delete {name}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "boundary_id": self._boundary_id,
            "server_node_id": self._server_node_id,
            "workbench": self._workbench,
            "sandbox_enabled": self._sandbox_enabled,
            "filesystem_scope": list(self._filesystem_scope),
            "network_enabled": self._network_enabled,
            "created_at": self._created_at,
        }


def create_local_execution_boundary(
    *,
    server_node_id: str,
    workbench: str,
    sandbox_enabled: bool = False,
    filesystem_scope: list[str] | None = None,
    network_enabled: bool = True,
) -> ExecutionBoundary:
    """创建本地执行边界。"""
    return ExecutionBoundary(
        boundary_id=f"eb-{uuid.uuid4().hex[:12]}",
        server_node_id=server_node_id,
        workbench=workbench,
        sandbox_enabled=sandbox_enabled,
        filesystem_scope=tuple(filesystem_scope or [workbench]),
        network_enabled=network_enabled,
    )
