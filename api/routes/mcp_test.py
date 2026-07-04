"""POST /api/mcp/test-connection — 测试 MCP 服务器连接。

启动子进程，5 秒内未崩溃视为成功，超时后终止子进程。
"""

import asyncio
import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from tools.mcp_runtime import build_mcp_env, resolve_mcp_command
from tools.mcp_security import validate_stdio_command

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


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
    3. 构造子进程环境变量
    4. 启动子进程，5 秒内未崩溃视为成功
    """
    # 1. 白名单校验
    err = validate_stdio_command(req.command)
    if err:
        raise HTTPException(status_code=400, detail=err)

    # 2. 命令解析
    resolved = resolve_mcp_command(req.command)

    # 3. 环境变量构造
    # build_mcp_env 在开发模式仅返回用户 env（可能为空），
    # 需与 os.environ 合并以确保子进程有 PATH/SYSTEMROOT 等。
    env = {**os.environ, **build_mcp_env(req.env)}

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
