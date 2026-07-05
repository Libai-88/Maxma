"""MaxmaHere — LangGraph ReAct AI Agent Web 入口。"""

import os
import sys
import threading
import time

import uvicorn
from version import __version__

from api.logging_config import setup_logging
from api.server import create_app
from app_paths import ensure_data_dirs
from config.settings import get_settings
from memory.user_init import ensure_all


def _start_parent_watchdog():
    """启动父进程监控守护线程。

    当 Tauri 主进程（maxma-here.exe）退出时，sidecar 可能成为孤儿进程
    （Job Object 在某些场景下可能失效，如主进程已在其他 Job 中）。
    此守护线程每 2 秒检查父进程是否存活，若已退出则立即终止 sidecar。

    这是 Job Object 机制的兜底方案，确保 sidecar 不会在主进程退出后继续运行。
    """
    if sys.platform != "win32":
        return

    try:
        import ctypes

        ppid = os.getppid()
        if ppid <= 1:
            return

        kernel32 = ctypes.windll.kernel32
        SYNCHRONIZE = 0x00100000

        def _watch():
            while True:
                time.sleep(2)
                try:
                    handle = kernel32.OpenProcess(SYNCHRONIZE, False, ppid)
                    if not handle:
                        print("[watchdog] 父进程已退出，sidecar 自动终止", flush=True)
                        os._exit(0)
                    kernel32.CloseHandle(handle)
                except Exception:
                    pass

        t = threading.Thread(target=_watch, daemon=True, name="parent-watchdog")
        t.start()
    except Exception:
        pass


def main():
    # 初始化日志系统（在其他模块导入之前）
    setup_logging()

    # CLI：轮换 Token
    if "--rotate-token" in sys.argv:
        from api.auth import rotate_token

        rotated = rotate_token()
        print(f"[auth] Token rotated: {rotated}")
        return

    import logging
    logger = logging.getLogger(__name__)
    logger.info("MaxmaHere %s starting", __version__)

    # 启动父进程监控（防止 sidecar 成为孤儿进程）
    _start_parent_watchdog()

    # 确保所有用户数据目录存在（打包模式下首次运行时自动创建）
    ensure_data_dirs()

    ensure_all()

    app = create_app()

    settings = get_settings()
    dev_mode = "--dev" in sys.argv
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=settings.maxma_api_port,
        reload=dev_mode,
        reload_dirs=["agent", "api", "tools", "memory"] if dev_mode else None,
    )


if __name__ == "__main__":
    main()
