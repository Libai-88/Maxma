"""POST /api/mcp/test-connection — 测试 MCP 服务器连接。

启动子进程，5 秒内未崩溃视为成功，超时后终止子进程。
"""

import asyncio
import logging
import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mcp", tags=["mcp"])

# 子进程环境变量黑名单 — 与 mcp.py 保持同步
_BLOCKED_ENV_KEYS: frozenset[str] = frozenset({
    "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "LD_DEBUG",
    "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
    "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONPYCACHEPREFIX",
    "PATH", "IFS", "BASH_ENV", "ENV",
    "COMSPEC", "SHELL", "PATHEXT",
    "NODE_PATH", "NODE_OPTIONS",
    "HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP",
})

# 命令白名单 — 仅允许常见 MCP server runtime 可执行文件名。
# 使用 frozenset + lower-case 比较以保持大小写不敏感（Windows 上 npx vs NPX）。
_ALLOWED_COMMANDS: frozenset[str] = frozenset({
    "npx", "node", "npm",
    "uvx", "uv", "python", "python3", "py",
    "bun", "deno",
    "docker",
})

# 命令名合法字符 — 用于拒绝路径穿越/绝对路径/shell 元字符。
# 允许字母数字、下划线、短横线、点；不允许斜杠、反斜杠、冒号、空格等。
_COMMAND_NAME_RE = re.compile(r"^[A-Za-z0-9_.\-]+$")


def _resolve_command(raw: str) -> str:
    """校验命令并返回可执行的命令字符串。

    规则：
    1. 拒绝空命令。
    2. 取 basename（防御性 — 防止传入绝对路径或含路径分隔符的字符串）。
    3. basename 必须匹配 _COMMAND_NAME_RE（拒绝 shell 元字符、路径穿越）。
    4. basename（lower-case）必须在 _ALLOWED_COMMANDS 白名单中。

    返回 basename（不解析 PATH），由 asyncio.create_subprocess_exec 自行在 PATH 中查找。
    """
    if not raw or not raw.strip():
        raise HTTPException(status_code=400, detail="command 不能为空")
    # basename 防御性提取 — 即使调用方传入 "/usr/bin/npx" 也只保留 "npx"
    name = os.path.basename(raw.strip())
    if not _COMMAND_NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail=f"命令名含非法字符: {name!r}（仅允许字母数字、下划线、短横线、点）",
        )
    if name.lower() not in _ALLOWED_COMMANDS:
        raise HTTPException(
            status_code=400,
            detail=f"命令 {name!r} 不在白名单中，允许: {sorted(_ALLOWED_COMMANDS)}",
        )
    return name


def _validate_args(args: list[str]) -> list[str]:
    """校验 args 列表 — 拒绝 shell 元字符注入。

    虽然 asyncio.create_subprocess_exec 不经过 shell 解释，但仍拒绝包含
    换行符、NUL、明显 shell 元字符的 arg 以防御下游解析逻辑（如 log 注入）。
    """
    forbidden = {"\n", "\r", "\x00"}
    # 不允许的 shell 元字符序列（与 shell 注入相关；单字符即可触发）
    shell_meta_pattern = re.compile(r"[`$|;&<>]")
    cleaned: list[str] = []
    for idx, a in enumerate(args):
        if not isinstance(a, str):
            raise HTTPException(
                status_code=400,
                detail=f"args[{idx}] 必须是字符串",
            )
        if any(ch in a for ch in forbidden):
            raise HTTPException(
                status_code=400,
                detail=f"args[{idx}] 含控制字符（换行/NUL）",
            )
        if shell_meta_pattern.search(a):
            raise HTTPException(
                status_code=400,
                detail=f"args[{idx}] 含 shell 元字符 (`$|;&<>)",
            )
        cleaned.append(a)
    return cleaned


class TestConnectionRequest(BaseModel):
    """测试连接请求。"""
    command: str
    args: list[str] = []
    env: dict[str, str] = {}


class TestConnectionResponse(BaseModel):
    """测试连接响应。"""
    success: bool
    error: str | None = None
    resolved_command: str


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(req: TestConnectionRequest) -> TestConnectionResponse:
    """测试 MCP 服务器连接。

    1. 校验命令白名单 + 拒绝 shell 元字符
    2. 解析命令（取 basename，由 subprocess 在 PATH 中查找）
    3. 校验并构造子进程环境变量
    4. 启动子进程，5 秒内未崩溃视为成功
    """
    # 1. 命令白名单校验
    resolved = _resolve_command(req.command)
    # 2. args 元字符校验
    safe_args = _validate_args(req.args)

    # 3. 环境变量校验 + 构造
    blocked = [k for k in req.env if k.upper() in _BLOCKED_ENV_KEYS]
    if blocked:
        raise HTTPException(
            status_code=400,
            detail=f"环境变量包含禁止设置的敏感 key: {', '.join(blocked)}",
        )
    env = {**os.environ, **req.env}

    # 4. 启动子进程测试
    try:
        proc = await asyncio.create_subprocess_exec(
            resolved,
            *safe_args,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as e:
        return TestConnectionResponse(
            success=False,
            error=f"命令不存在: {e}",
            resolved_command=resolved,
        )
    except Exception as e:
        return TestConnectionResponse(
            success=False,
            error=f"启动失败: {e}",
            resolved_command=resolved,
        )

    # 5 秒内未崩溃视为成功

    try:
        await asyncio.wait_for(proc.wait(), timeout=5.0)
        # 进程已退出
        if proc.returncode == 0:
            return TestConnectionResponse(
                success=True,
                error=None,
                resolved_command=resolved,
            )
        # 非零退出码
        stderr_data = await proc.stderr.read() if proc.stderr else b""
        error_msg = stderr_data.decode("utf-8", errors="replace").strip()[:500]
        return TestConnectionResponse(
            success=False,
            error=f"进程退出码 {proc.returncode}: {error_msg}",
            resolved_command=resolved,
        )
    except asyncio.TimeoutError:
        # 超时未退出 = 进程在运行 = 连接成功
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            proc.kill()
        return TestConnectionResponse(
            success=True,
            error=None,
            resolved_command=resolved,
        )
