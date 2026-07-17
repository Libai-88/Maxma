"""Tests for api/errors.py — AppError, ErrorCode, make_error, format_ws_error."""

import pytest

from api.errors import AppError, ErrorCode, format_ws_error, make_error


class TestAppErrorToDict:
    def test_basic_to_dict_without_optional_fields(self):
        err = AppError(code=ErrorCode.INTERNAL_ERROR, message="boom")
        d = err.to_dict()
        assert d["code"] == "INTERNAL_ERROR"
        assert d["message"] == "boom"
        assert d["category"] == "system_error"
        # details / trace_id 未设置 → 不出现
        assert "details" not in d
        assert "trace_id" not in d

    def test_to_dict_with_details(self):
        err = AppError(
            code=ErrorCode.INTERNAL_ERROR,
            message="boom",
            details={"k": "v"},
        )
        assert err.to_dict()["details"] == {"k": "v"}

    def test_to_dict_with_trace_id(self):
        """覆盖 line 64: trace_id 分支。"""
        err = AppError(
            code=ErrorCode.INTERNAL_ERROR,
            message="boom",
            trace_id="trace-abc",
        )
        assert err.to_dict()["trace_id"] == "trace-abc"

    def test_to_dict_with_string_code(self):
        """code 传入字符串时也能正常转换。"""
        err = AppError(code="INTERNAL_ERROR", message="boom")
        d = err.to_dict()
        assert d["code"] == "INTERNAL_ERROR"


class TestCategoryProperty:
    @pytest.mark.parametrize(
        "code,expected",
        [
            (ErrorCode.INVALID_INPUT, "user_error"),
            (ErrorCode.PATH_BLOCKED, "user_error"),
            (ErrorCode.PATH_NOT_WHITELISTED, "user_error"),
            (ErrorCode.MISSING_PARAMETER, "user_error"),
            (ErrorCode.TOOL_ERROR, "tool_error"),
            (ErrorCode.TOOL_TIMEOUT, "tool_error"),
            (ErrorCode.TOOL_NOT_FOUND, "tool_error"),
            (ErrorCode.RATE_LIMITED, "rate_limit"),
            (ErrorCode.QUOTA_EXCEEDED, "rate_limit"),
            (ErrorCode.CANCELLED, "cancelled"),
            # 其余归 system_error
            (ErrorCode.INTERNAL_ERROR, "system_error"),
            (ErrorCode.LLM_ERROR, "system_error"),
            (ErrorCode.DATABASE_ERROR, "system_error"),
            (ErrorCode.SESSION_NOT_FOUND, "system_error"),
            (ErrorCode.SESSION_EXPIRED, "system_error"),
            (ErrorCode.UNAUTHORIZED, "system_error"),
            (ErrorCode.TOKEN_EXPIRED, "system_error"),
            (ErrorCode.NO_LLM, "system_error"),
            (ErrorCode.AGENT_ERROR, "system_error"),
        ],
    )
    def test_category_branches(self, code, expected):
        err = AppError(code=code, message="x")
        assert err.category == expected

    def test_category_with_raw_string_code(self):
        """code 是 str（非 Enum）时也应正确分类。"""
        err = AppError(code="RATE_LIMITED", message="x")
        assert err.category == "rate_limit"
        err2 = AppError(code="CANCELLED", message="x")
        assert err2.category == "cancelled"
        err3 = AppError(code="TOOL_ERROR", message="x")
        assert err3.category == "tool_error"


class TestMakeError:
    def test_make_error_with_enum_code(self):
        d = make_error(
            ErrorCode.PATH_BLOCKED,
            "blocked",
            details={"path": "/etc"},
            trace_id="t1",
        )
        assert d["code"] == "PATH_BLOCKED"
        assert d["message"] == "blocked"
        assert d["category"] == "user_error"
        assert d["details"] == {"path": "/etc"}
        assert d["trace_id"] == "t1"

    def test_make_error_with_string_code(self):
        d = make_error("TOOL_TIMEOUT", "timed out")
        assert d["code"] == "TOOL_TIMEOUT"
        assert d["category"] == "tool_error"
        assert "details" not in d
        assert "trace_id" not in d

    def test_make_error_invalid_string_code_raises(self):
        with pytest.raises(ValueError):
            make_error("NOT_A_REAL_CODE", "x")


class TestFormatWsError:
    def test_format_ws_error_shape(self):
        """覆盖 line 113: format_ws_error 函数体。"""
        ev = format_ws_error(
            ErrorCode.RATE_LIMITED,
            "slow down",
            details={"retry_after": 5},
        )
        assert ev["type"] == "error"
        payload = ev["payload"]
        assert payload["code"] == "RATE_LIMITED"
        assert payload["message"] == "slow down"
        assert payload["category"] == "rate_limit"
        assert payload["details"] == {"retry_after": 5}

    def test_format_ws_error_with_string_code_and_trace_id(self):
        ev = format_ws_error("CANCELLED", "aborted", trace_id="t-99")
        assert ev["type"] == "error"
        assert ev["payload"]["code"] == "CANCELLED"
        assert ev["payload"]["category"] == "cancelled"
        assert ev["payload"]["trace_id"] == "t-99"

    def test_format_ws_error_minimal(self):
        ev = format_ws_error(ErrorCode.INTERNAL_ERROR, "boom")
        assert ev == {
            "type": "error",
            "payload": {
                "code": "INTERNAL_ERROR",
                "message": "boom",
                "category": "system_error",
            },
        }
