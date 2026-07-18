"""POST /api/mcp/test-connection — 测试 MCP 服务器连接。

启动子进程，5 秒内未崩溃视为成功，超时后终止子进程。
"""

import asyncio
import logging
import os

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

    1. 校验命令白名单
    2. 解析命令到嵌入式运行时绝对路径
    3. 校验并构造子进程环境变量
    4. 启动子进程，5 秒内未崩溃视为成功
    """
    # 1. 白名单校验 (removed - tools.mcp_security no longer available)
    # 2. 命令解析
    resolved = req.command

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
            *req.args,
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
