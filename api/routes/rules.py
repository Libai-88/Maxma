"""Rules API — OMP 质量规则管理（内置 + 自定义）。

暴露 OMP 后端的语言特定质量规则供前端浏览和管理。
内置规则为静态数据，自定义规则为内存存储（重启后丢失）。
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app_paths import API_DATA_DIR

logger = logging.getLogger(__name__)

router = APIRouter()

# 用户自定义规则持久化路径
_USER_RULES_PATH = API_DATA_DIR / "user_rules.json"

# ─── Pydantic Models ───────────────────────────────────────────────────────────


class RuleCreate(BaseModel):
    """创建自定义规则的请求体。"""
    id: str | None = Field(None, description="规则 ID，留空则自动生成")
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(..., min_length=1, max_length=500)
    language: str = Field(..., min_length=1)
    severity: Literal["error", "warning", "info"] = "warning"
    pattern: str = Field("", max_length=1000)
    enabled: bool = True


class RuleUpdate(BaseModel):
    """更新自定义规则的请求体（所有字段可选）。"""
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, min_length=1, max_length=500)
    language: str | None = Field(None, min_length=1)
    severity: Literal["error", "warning", "info"] | None = None
    pattern: str | None = Field(None, max_length=1000)
    enabled: bool | None = None


class RuleToggle(BaseModel):
    """启用/禁用规则的请求体。"""
    enabled: bool


class RuleResponse(BaseModel):
    """规则响应体。"""
    id: str
    name: str
    description: str
    language: str
    severity: str
    pattern: str = ""
    enabled: bool
    source: Literal["builtin", "custom"]
    editable: bool


# ─── Data Stores ───────────────────────────────────────────────────────────────

# OMP 内置质量规则（按语言分组）— 不可删除，但可切换启用状态
_BUILTIN_RULES: list[dict] = [
    # Python
    {"id": "py-type-hints", "language": "python", "name": "类型提示完整性", "description": "函数参数和返回值必须有类型注解", "severity": "warning", "pattern": "", "enabled": True},
    {"id": "py-async-safety", "language": "python", "name": "异步安全", "description": "async 函数中禁止阻塞调用（time.sleep, open 等）", "severity": "error", "pattern": "", "enabled": True},
    {"id": "py-import-order", "language": "python", "name": "导入排序", "description": "标准库 → 第三方 → 本地，各组间空行分隔", "severity": "info", "pattern": "", "enabled": True},
    {"id": "py-docstring", "language": "python", "name": "公共 API 文档", "description": "公共函数/类必须有 docstring", "severity": "info", "pattern": "", "enabled": False},
    {"id": "py-error-handling", "language": "python", "name": "异常处理规范", "description": "禁止裸 except，必须指定异常类型", "severity": "warning", "pattern": "", "enabled": True},
    # TypeScript / JavaScript
    {"id": "ts-strict-null", "language": "typescript", "name": "严格空检查", "description": "禁止隐式 any，必须处理 null/undefined", "severity": "error", "pattern": "", "enabled": True},
    {"id": "ts-no-unused", "language": "typescript", "name": "未使用变量", "description": "声明但未使用的变量/导入应移除", "severity": "warning", "pattern": "", "enabled": True},
    {"id": "ts-async-await", "language": "typescript", "name": "Promise 处理", "description": "异步操作必须 await 或显式 .catch()，禁止浮空 Promise", "severity": "error", "pattern": "", "enabled": True},
    {"id": "ts-explicit-return", "language": "typescript", "name": "显式返回类型", "description": "导出函数必须声明返回类型", "severity": "info", "pattern": "", "enabled": False},
    # General
    {"id": "gen-naming", "language": "general", "name": "命名规范", "description": "变量/函数 camelCase，类 PascalCase，常量 UPPER_SNAKE", "severity": "info", "pattern": "", "enabled": True},
    {"id": "gen-max-complexity", "language": "general", "name": "圈复杂度", "description": "单函数圈复杂度不超过 15", "severity": "warning", "pattern": "", "enabled": True},
    {"id": "gen-max-lines", "language": "general", "name": "函数长度", "description": "单函数不超过 80 行（不含注释）", "severity": "warning", "pattern": "", "enabled": True},
    {"id": "gen-no-magic-numbers", "language": "general", "name": "魔法数字", "description": "数字字面量应提取为命名常量", "severity": "info", "pattern": "", "enabled": False},
    # Rust
    {"id": "rust-unwrap", "language": "rust", "name": "禁止 unwrap", "description": "生产代码禁止 .unwrap()，使用 expect 或 ? 操作符", "severity": "error", "pattern": "", "enabled": True},
    {"id": "rust-lifetime", "language": "rust", "name": "生命周期标注", "description": "公共 API 的引用参数必须显式标注生命周期", "severity": "warning", "pattern": "", "enabled": True},
    # Shell
    {"id": "sh-quote-vars", "language": "shell", "name": "变量引用", "description": "Shell 变量展开必须加双引号防止词分割", "severity": "warning", "pattern": "", "enabled": True},
    {"id": "sh-set-flags", "language": "shell", "name": "安全标志", "description": "脚本开头必须 set -euo pipefail", "severity": "error", "pattern": "", "enabled": True},
]

# 用户自定义规则（文件持久化）
_USER_RULES: list[dict] = []


def _load_user_rules() -> None:
    """从持久化文件加载自定义规则。"""
    global _USER_RULES
    if _USER_RULES_PATH.exists():
        try:
            with open(_USER_RULES_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                _USER_RULES = data
        except Exception as e:
            logger.warning("Failed to load user rules from %s: %s", _USER_RULES_PATH, e)


def _save_user_rules() -> None:
    """将自定义规则持久化到文件。"""
    _USER_RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(_USER_RULES_PATH, "w", encoding="utf-8") as f:
            json.dump(_USER_RULES, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning("Failed to save user rules to %s: %s", _USER_RULES_PATH, e)


# 模块加载时自动恢复持久化规则
_load_user_rules()


# ─── Helpers ───────────────────────────────────────────────────────────────────


def _all_rules() -> list[dict]:
    """合并内置 + 自定义规则，附加 source 和 editable 字段。"""
    result: list[dict] = []
    for r in _BUILTIN_RULES:
        result.append({**r, "source": "builtin", "editable": False})
    for r in _USER_RULES:
        result.append({**r, "source": "custom", "editable": True})
    return result


def _find_builtin(rule_id: str) -> dict | None:
    for r in _BUILTIN_RULES:
        if r["id"] == rule_id:
            return r
    return None


def _find_custom(rule_id: str) -> dict | None:
    for r in _USER_RULES:
        if r["id"] == rule_id:
            return r
    return None


def _find_custom_index(rule_id: str) -> int | None:
    for i, r in enumerate(_USER_RULES):
        if r["id"] == rule_id:
            return i
    return None


# ─── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/rules")
async def list_rules(request: Request, language: str | None = None):
    """列出所有质量规则（内置 + 自定义），可按语言过滤。"""
    rules = _all_rules()
    if language:
        rules = [r for r in rules if r["language"] == language]
    return {"rules": rules, "total": len(rules)}


@router.get("/rules/languages")
async def list_rule_languages(request: Request):
    """列出所有有规则的语言。"""
    all_rules = _all_rules()
    languages = sorted(set(r["language"] for r in all_rules))
    return {"languages": languages}


@router.post("/rules", status_code=201)
async def create_rule(body: RuleCreate, request: Request):
    """创建一条自定义规则。"""
    rule_id = body.id or f"custom-{uuid.uuid4().hex[:8]}"

    # 检查 ID 唯一性
    if _find_builtin(rule_id) or _find_custom(rule_id):
        raise HTTPException(status_code=409, detail=f"规则 ID '{rule_id}' 已存在")

    new_rule = {
        "id": rule_id,
        "name": body.name,
        "description": body.description,
        "language": body.language,
        "severity": body.severity,
        "pattern": body.pattern,
        "enabled": body.enabled,
    }
    _USER_RULES.append(new_rule)
    _save_user_rules()
    logger.info("Created custom rule: %s", rule_id)
    return {**new_rule, "source": "custom", "editable": True}


@router.put("/rules/{rule_id}")
async def update_rule(rule_id: str, body: RuleUpdate, request: Request):
    """更新一条自定义规则（不可更新内置规则）。"""
    rule = _find_custom(rule_id)
    if rule is None:
        if _find_builtin(rule_id):
            raise HTTPException(status_code=403, detail="内置规则不可编辑")
        raise HTTPException(status_code=404, detail=f"规则 '{rule_id}' 不存在")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="未提供任何更新字段")

    rule.update(updates)
    _save_user_rules()
    logger.info("Updated custom rule: %s", rule_id)
    return {**rule, "source": "custom", "editable": True}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, request: Request):
    """删除一条自定义规则（不可删除内置规则）。"""
    if _find_builtin(rule_id):
        raise HTTPException(status_code=403, detail="内置规则不可删除")

    idx = _find_custom_index(rule_id)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"规则 '{rule_id}' 不存在")

    _USER_RULES.pop(idx)
    _save_user_rules()
    logger.info("Deleted custom rule: %s", rule_id)
    return {"status": "deleted", "id": rule_id}


@router.patch("/rules/{rule_id}/toggle")
async def toggle_rule(rule_id: str, body: RuleToggle, request: Request):
    """启用或禁用一条规则（内置和自定义均可）。"""
    rule = _find_builtin(rule_id) or _find_custom(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"规则 '{rule_id}' 不存在")

    rule["enabled"] = body.enabled
    source = "builtin" if _find_builtin(rule_id) else "custom"
    logger.info("Toggled rule %s -> enabled=%s", rule_id, body.enabled)
    return {**rule, "source": source, "editable": source == "custom"}
