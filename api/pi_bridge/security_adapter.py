"""安全适配器 — 使 oh-my-pi 的工具遵守 Maxma 的安全策略。

包括：
- 路径白名单：限制 AI 可读写的文件目录范围
- MaxmaBlocker：在敏感目录下放置 .maxma_blocker 标记文件，发现即阻断
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app_paths import PATH_WHITELIST_YAML_PATH
from api.yaml_store import load_yaml

logger = logging.getLogger(__name__)


def check_tool_security(tool_name: str, tool_args: dict[str, Any]) -> str | None:
    """检查工具调用是否违反安全策略。
    
    Args:
        tool_name: oh-my-pi 工具名 (read, write, bash, edit, glob)
        tool_args: 工具参数字典
        
    Returns:
        None 表示允许，字符串表示阻断原因
    """
    # 提取路径参数
    paths = _extract_paths(tool_name, tool_args)
    
    for path_str in paths:
        if not path_str or not isinstance(path_str, str):
            continue
        
        # 检查路径白名单
        blocked = check_path_access(path_str)
        if blocked:
            return blocked
        
        # 检查 MaxmaBlocker
        if _is_blocker_present(path_str):
            return f"安全阻断：路径 '{path_str}' 包含 MaxmaBlocker 拒止锚，已拒绝访问"
    
    return None


def _extract_paths(tool_name: str, args: dict[str, Any]) -> list[str]:
    """从工具参数中提取文件路径。"""
    paths = []
    if tool_name == "read":
        paths.append(args.get("path", ""))
    elif tool_name == "write":
        paths.append(args.get("path", ""))
    elif tool_name == "edit":
        paths.append(args.get("path", ""))
    elif tool_name == "glob":
        paths.append(args.get("pattern", ""))
    elif tool_name == "bash":
        # bash 命令不直接提取路径（太复杂），但可以记录审计日志
        logger.debug("[security] bash command: %s", str(args.get("command", ""))[:100])
    return paths


def _load_whitelist() -> list[tuple[str, bool]]:
    """从 path_whitelist.yaml 加载白名单条目。

    Returns:
        (path, recursive) 元组列表。
    """
    if not PATH_WHITELIST_YAML_PATH.exists():
        return []
    raw = load_yaml(PATH_WHITELIST_YAML_PATH, default={}) or {}
    entries = raw.get("whitelist", []) or []
    result: list[tuple[str, bool]] = []
    for e in entries:
        if isinstance(e, dict) and "path" in e:
            recursive = e.get("recursive", True)
            result.append((str(e["path"]), bool(recursive)))
    return result


def check_path_access(path: str) -> str | None:
    """检查路径是否在白名单内（fail-secure）。

    空白名单拒绝所有访问。路径解析失败也拒绝。

    Returns:
        None 表示允许，字符串表示阻断原因。
    """
    if not path:
        return "路径为空，拒绝访问"

    whitelist = _load_whitelist()
    if not whitelist:
        return "白名单为空，拒绝所有访问"

    try:
        resolved = Path(path).resolve(strict=False)
    except (OSError, ValueError) as exc:
        logger.warning("[security] 路径解析失败（fail-closed）%s: %s", path, exc)
        return f"路径解析失败，拒绝访问: {exc}"

    for allowed_raw, recursive in whitelist:
        try:
            allowed = Path(allowed_raw).resolve(strict=False)
        except (OSError, ValueError):
            continue

        if resolved == allowed:
            return None  # 精确匹配

        if recursive:
            try:
                resolved.relative_to(allowed)
                return None  # 在递归白名单目录下
            except ValueError:
                pass

    return f"路径 '{path}' 不在白名单中"


def _is_blocker_present(path: str) -> bool:
    """检查路径或其父目录中是否存在 .maxma_blocker。"""
    try:
        p = Path(path).resolve()
        for parent in [p] + list(p.parents):
            if (parent / ".maxma_blocker").exists():
                logger.warning("[security] MaxmaBlocker found at %s", parent)
                return True
    except Exception:
        pass
    return False
