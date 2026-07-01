"""Git 工具共享工具函数。"""

from pathlib import Path

from tools.path_security import check_path_access


def validate_repo_path(repo_path: str) -> tuple[str | None, str | None]:
    """验证仓库路径：存在性 + 路径安全检查。

    Returns:
        (cwd, error): 成功时 error 为 None，失败时 cwd 为 None
    """
    cwd = repo_path.strip() if repo_path.strip() else None
    if cwd:
        if not Path(cwd).is_dir():
            return None, f"目录不存在: {cwd}"
        # 路径安全检查（白名单 + 拒止锚）
        blocked = check_path_access(cwd)
        if blocked:
            return None, f"路径被安全策略阻止: {cwd}"
    return cwd, None


def validate_git_arg(value: str, name: str = "参数") -> tuple[str, str | None]:
    """验证 git 参数：拒绝以 - 开头的值（防止参数注入）。

    Returns:
        (clean_value, error): 成功时 error 为 None
    """
    clean = value.strip()
    if clean.startswith("-"):
        return "", f"{name} 不能以 '-' 开头（防止参数注入）: {clean}"
    return clean, None
