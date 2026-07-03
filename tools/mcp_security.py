"""MCP stdio 命令白名单校验。

stdio 传输通过本地子进程执行命令，若允许任意命令则等同于命令执行后门。
这里维护一个最小化白名单，并在配置加载/写入/热重载的各入口统一校验。
"""

import os

# 允许的 stdio 命令基名（大小写不敏感）。
# 仅允许无路径分隔符的简单命令名，由系统 PATH 解析。
# 需要新增时请评估：该命令是否会执行用户可控的任意代码/脚本。
_ALLOWED_STDIO_COMMANDS: frozenset[str] = frozenset({
    "npx",
    "node",
    "python",
    "python3",
    "uvx",
})


def validate_stdio_command(command: str | None) -> str | None:
    """校验 stdio 命令是否在白名单中。

    Args:
        command: 用户配置的命令字符串。

    Returns:
        错误信息（如果无效），None 表示有效。
    """
    if not command or not command.strip():
        return "stdio 命令不能为空"

    cmd = command.strip()

    # 拒绝任何路径分隔符，防止调用任意路径的可执行文件。
    if os.path.sep in cmd or (os.path.altsep and os.path.altsep in cmd):
        return f"stdio 命令不能包含路径分隔符: {command}"

    # 拒绝相对路径修饰符与目录遍历。
    if cmd.startswith((".", "~")) or cmd.startswith(".."):
        return f"stdio 命令不能以相对路径开头: {command}"

    # 统一去除 Windows .exe 后缀后比较。
    basename = cmd
    if basename.lower().endswith(".exe"):
        basename = basename[:-4]

    allowed_lower = {c.lower() for c in _ALLOWED_STDIO_COMMANDS}
    if basename.lower() not in allowed_lower:
        allowed = ", ".join(sorted(_ALLOWED_STDIO_COMMANDS))
        return f"stdio 命令 '{command}' 不在白名单中。允许: {allowed}"

    return None
