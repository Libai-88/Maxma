"""REST API — 重启后端进程。"""

import subprocess
import sys

from fastapi import APIRouter

router = APIRouter()


@router.post("/restart")
async def restart_server():
    """重启后端进程。

    打包桌面模式下，后端作为 Tauri sidecar 运行，重启责任只属于
    Tauri 进程监控器；这里仅退出当前进程，避免同时拉起两个后端竞争端口。

    开发模式下没有 Tauri sidecar 监控，因此保留 Python + main.py 自重启。
    前端检测到服务恢复后应自动刷新页面。
    """
    if getattr(sys, "frozen", False):
        sys.exit(0)
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
