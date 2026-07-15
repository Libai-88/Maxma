"""安全适配器 — 使 oh-my-pi 的工具遵守 Maxma 的安全策略。

包括：
- 路径白名单：限制 AI 可读写的文件目录范围
- MaxmaBlocker：在敏感目录下放置 .maxma_blocker 标记文件，发现即阻断
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

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


def check_path_access(path: str) -> str | None:
    """检查路径是否在白名单内。
    
    委托给 tools/path_security.py 的现有实现。
    
    Returns:
        None 表示允许，字符串表示阻断原因。
    """
    try:
        from tools.path_security import check_path_access as _check
        return _check(path)
    except Exception:
        # fail-closed: 安全检查失败时拒绝访问
        logger.error("[security] path_security check failed for %s — denying access", path, exc_info=True)
        return f"安全检查失败，拒绝访问: {path}"


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
