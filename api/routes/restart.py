"""REST API — 重启后端进程。"""

import asyncio
import logging
import subprocess
import sys

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

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
        # 桌面模式：Tauri sidecar 监控会重新拉起进程，只需退出
        sys.exit(0)
        return  # noqa: WIM — unreachable, 用于阅读清晰度

    # 开发模式：找到 main.py 并重启
    from pathlib import Path
    project_root = Path(__file__).resolve().parent.parent.parent
    cmd = [sys.executable, str(project_root / "main.py")]
    cwd = str(project_root)

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            creationflags=subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0,
        )
    except (OSError, subprocess.SubprocessError) as e:
        logger.error("[restart] Failed to spawn restart process: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"重启失败：{e}")

    # 等待子进程完成初始化（端口监听就绪）后再退出当前进程，
    # 避免父子进程同时退出或子进程在初始化阶段被作业对象回收。
    await asyncio.sleep(0.5)
    sys.exit(0)
