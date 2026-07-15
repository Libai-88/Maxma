"""Pi Bridge — Maxma ↔ oh-my-pi sidecar 通信层。

本模块管理 Bun sidecar 进程的启动/停止，提供 JSON-RPC 客户端接口，
并在 sidecar 事件与 Maxma WS 协议之间做映射。
"""

from api.pi_bridge.sidecar_manager import SidecarManager
from api.pi_bridge.rpc_client import JsonRpcClient, JsonRpcError
from api.pi_bridge.session_adapter import SessionMap
from api.pi_bridge.ws_event_mapper import (
    validate_event,
    enrich_event,
    make_done_event,
    make_error_event,
    make_context_usage_event,
    EVENT_TYPES,
)

__all__ = [
    "SidecarManager",
    "JsonRpcClient",
    "JsonRpcError",
    "SessionMap",
    "validate_event",
    "enrich_event",
    "make_done_event",
    "make_error_event",
    "make_context_usage_event",
    "EVENT_TYPES",
]
