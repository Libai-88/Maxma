"""统一错误分类体系。"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class ErrorCode(str, Enum):
    """错误代码枚举。"""

    # 用户错误 (4xx) — 用户输入问题，需要引导修正
    INVALID_INPUT = "INVALID_INPUT"
    PATH_BLOCKED = "PATH_BLOCKED"
    PATH_NOT_WHITELISTED = "PATH_NOT_WHITELISTED"
    MISSING_PARAMETER = "MISSING_PARAMETER"

    # 工具错误 — 工具执行失败
    TOOL_ERROR = "TOOL_ERROR"
    TOOL_TIMEOUT = "TOOL_TIMEOUT"
    TOOL_NOT_FOUND = "TOOL_NOT_FOUND"

    # 系统错误 (5xx) — 内部错误
    INTERNAL_ERROR = "INTERNAL_ERROR"
    LLM_ERROR = "LLM_ERROR"
    DATABASE_ERROR = "DATABASE_ERROR"

    # 限流错误 (429)
    RATE_LIMITED = "RATE_LIMITED"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"

    # 会话错误
    SESSION_NOT_FOUND = "SESSION_NOT_FOUND"
    SESSION_EXPIRED = "SESSION_EXPIRED"

    # 认证错误
    UNAUTHORIZED = "UNAUTHORIZED"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"

    # 操作错误
    CANCELLED = "CANCELLED"
    NO_LLM = "NO_LLM"
    AGENT_ERROR = "AGENT_ERROR"


@dataclass
class AppError:
    """应用错误基类。"""

    code: ErrorCode
    message: str
    details: Optional[dict] = None
    trace_id: Optional[str] = None

    def to_dict(self) -> dict:
        """转换为前端可用的字典格式。"""
        result = {
            "code": self.code.value if isinstance(self.code, ErrorCode) else self.code,
            "message": self.message,
            "category": self.category,
        }
        if self.details:
            result["details"] = self.details
        if self.trace_id:
            result["trace_id"] = self.trace_id
        return result

    @property
    def category(self) -> str:
        """错误分类，用于前端样式区分。"""
        code = self.code.value if isinstance(self.code, ErrorCode) else self.code
        if code in (
            ErrorCode.INVALID_INPUT.value,
            ErrorCode.PATH_BLOCKED.value,
            ErrorCode.PATH_NOT_WHITELISTED.value,
            ErrorCode.MISSING_PARAMETER.value,
        ):
            return "user_error"
        elif code in (
            ErrorCode.TOOL_ERROR.value,
            ErrorCode.TOOL_TIMEOUT.value,
            ErrorCode.TOOL_NOT_FOUND.value,
        ):
            return "tool_error"
        elif code in (
            ErrorCode.RATE_LIMITED.value,
            ErrorCode.QUOTA_EXCEEDED.value,
        ):
            return "rate_limit"
        elif code == ErrorCode.CANCELLED.value:
            return "cancelled"
        else:
            return "system_error"


def make_error(
    code: ErrorCode | str,
    message: str,
    details: Optional[dict] = None,
    trace_id: Optional[str] = None,
) -> dict:
    """快速构造错误响应字典。"""
    err = AppError(
        code=code if isinstance(code, ErrorCode) else ErrorCode(code),
        message=message,
        details=details,
        trace_id=trace_id,
    )
    return err.to_dict()


def format_ws_error(code: ErrorCode | str, message: str, **kwargs) -> dict:
    """格式化 WebSocket 错误事件。"""
    return {
        "type": "error",
        "payload": make_error(code, message, **kwargs),
    }
