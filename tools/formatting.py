"""统一的成功/错误响应格式化工具。"""

import json


def format_success(data: dict) -> str:
    """统一成功响应格式。"""
    return json.dumps({"success": True, "data": data}, ensure_ascii=False)


def format_error(message: str) -> str:
    """统一错误响应格式。"""
    return json.dumps({"success": False, "error": message}, ensure_ascii=False)
