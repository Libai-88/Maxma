"""REST API — 重启后端进程。"""

import subprocess
import sys

from fastapi import APIRouter

router = APIRouter()


@router.post("/restart")
async def restart_server():
    """重启后端进程。

    启动一个新后端进程后优雅退出当前进程。
    sys.exit(0) 会触发 FastAPI lifespan shutdown 释放资源（MCP 连接、后台任务等），
    随后 uvicorn 退出，OS 释放端口，新进程即可绑定。
    前端检测到服务恢复后应自动刷新页面。

    打包模式：直接重启 exe 本身（sys.executable 即为 maxma-server.exe）。
    开发模式：重启 Python + main.py。
    """
    if getattr(sys, "frozen", False):
        # 打包模式：sys.executable 就是 maxma-server.exe
        cmd = [sys.executable]
        cwd = None
    else:
        # 开发模式：找到 main.py 并重启
        from pathlib import Path
        project_root = Path(__file__).resolve().parent.parent.parent
        cmd = [sys.executable, str(project_root / "main.py")]
        cwd = str(project_root)

    subprocess.Popen(
        cmd,
        cwd=cwd,
        creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0,
    )
    sys.exit(0)
