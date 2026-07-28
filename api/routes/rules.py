"""Rules API — OMP 内置质量规则浏览。

暴露 OMP 后端的语言特定质量规则供前端浏览。
当前为静态数据（规则列表来自 OMP 文档），待 sidecar 支持动态查询后替换。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)

router = APIRouter()

# OMP 内置质量规则（按语言分组）
_BUILTIN_RULES: list[dict] = [
    # Python
    {"id": "py-type-hints", "language": "python", "name": "类型提示完整性", "description": "函数参数和返回值必须有类型注解", "severity": "warning", "enabled": True},
    {"id": "py-async-safety", "language": "python", "name": "异步安全", "description": "async 函数中禁止阻塞调用（time.sleep, open 等）", "severity": "error", "enabled": True},
    {"id": "py-import-order", "language": "python", "name": "导入排序", "description": "标准库 → 第三方 → 本地，各组间空行分隔", "severity": "info", "enabled": True},
    {"id": "py-docstring", "language": "python", "name": "公共 API 文档", "description": "公共函数/类必须有 docstring", "severity": "info", "enabled": False},
    {"id": "py-error-handling", "language": "python", "name": "异常处理规范", "description": "禁止裸 except，必须指定异常类型", "severity": "warning", "enabled": True},
    # TypeScript / JavaScript
    {"id": "ts-strict-null", "language": "typescript", "name": "严格空检查", "description": "禁止隐式 any，必须处理 null/undefined", "severity": "error", "enabled": True},
    {"id": "ts-no-unused", "language": "typescript", "name": "未使用变量", "description": "声明但未使用的变量/导入应移除", "severity": "warning", "enabled": True},
    {"id": "ts-async-await", "language": "typescript", "name": "Promise 处理", "description": "异步操作必须 await 或显式 .catch()，禁止浮空 Promise", "severity": "error", "enabled": True},
    {"id": "ts-explicit-return", "language": "typescript", "name": "显式返回类型", "description": "导出函数必须声明返回类型", "severity": "info", "enabled": False},
    # General
    {"id": "gen-naming", "language": "general", "name": "命名规范", "description": "变量/函数 camelCase，类 PascalCase，常量 UPPER_SNAKE", "severity": "info", "enabled": True},
    {"id": "gen-max-complexity", "language": "general", "name": "圈复杂度", "description": "单函数圈复杂度不超过 15", "severity": "warning", "enabled": True},
    {"id": "gen-max-lines", "language": "general", "name": "函数长度", "description": "单函数不超过 80 行（不含注释）", "severity": "warning", "enabled": True},
    {"id": "gen-no-magic-numbers", "language": "general", "name": "魔法数字", "description": "数字字面量应提取为命名常量", "severity": "info", "enabled": False},
    # Rust
    {"id": "rust-unwrap", "language": "rust", "name": "禁止 unwrap", "description": "生产代码禁止 .unwrap()，使用 expect 或 ? 操作符", "severity": "error", "enabled": True},
    {"id": "rust-lifetime", "language": "rust", "name": "生命周期标注", "description": "公共 API 的引用参数必须显式标注生命周期", "severity": "warning", "enabled": True},
    # Shell
    {"id": "sh-quote-vars", "language": "shell", "name": "变量引用", "description": "Shell 变量展开必须加双引号防止词分割", "severity": "warning", "enabled": True},
    {"id": "sh-set-flags", "language": "shell", "name": "安全标志", "description": "脚本开头必须 set -euo pipefail", "severity": "error", "enabled": True},
]


@router.get("/rules")
async def list_rules(request: Request, language: str | None = None):
    """列出所有内置质量规则，可按语言过滤。"""
    rules = _BUILTIN_RULES
    if language:
        rules = [r for r in rules if r["language"] == language]
    return {"rules": rules, "total": len(rules)}


@router.get("/rules/languages")
async def list_rule_languages(request: Request):
    """列出所有有规则的语言。"""
    languages = sorted(set(r["language"] for r in _BUILTIN_RULES))
    return {"languages": languages}
