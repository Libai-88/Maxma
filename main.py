"""MaxmaHere — oh-my-pi AI Agent Desktop Backend (FastAPI + Bun sidecar)."""

import logging
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

logger = logging.getLogger(__name__)


def _prepend_embedded_runtime_path() -> None:
    """Make bundled runtimes discoverable by MCP/native child processes.

    Tauri injects the Node/Python/uv directories into the sidecar environment,
    but commands launched by FastAPI inherit the Python process environment.
    In a frozen build Bun lives under PyInstaller's bundle directory, so it
    must be added here as well.
    """
    try:
        from app_paths import BUNDLE_DIR, RUNTIME_DIR
    except Exception:
        return

    candidates = [
        BUNDLE_DIR / "bun-sidecar",
        RUNTIME_DIR / "runtime" / "node",
        RUNTIME_DIR / "runtime" / "python",
        RUNTIME_DIR / "runtime" / "uv",
    ]
    existing = os.environ.get("PATH", "").split(os.pathsep)
    entries = [str(path) for path in candidates if path.is_dir()]
    entries.extend(existing)
    deduplicated = list(dict.fromkeys(entry for entry in entries if entry))
    if deduplicated:
        os.environ["PATH"] = os.pathsep.join(deduplicated)


def _start_parent_watchdog():
    """启动父进程监控守护线程。

    当 Tauri 主进程（maxma-here.exe）退出时，sidecar 可能成为孤儿进程
    （Job Object 在某些场景下可能失效，如主进程已在其他 Job 中）。
    此守护线程每 2 秒检查 Tauri 主进程是否存活，若已退出则立即终止 sidecar。

    这是 Job Object 机制的兜底方案，确保 sidecar 不会在主进程退出后继续运行。

    监控目标优先级：
      1. MAXMA_PARENT_PID 环境变量（Tauri 主进程 PID，由 main.rs 注入）
      2. os.getppid()（直接父进程，开发模式下即为启动本进程的 shell/IDE）

    注意：PyInstaller onefile 模式下 os.getppid() 返回的是 bootloader PID
    而非 Tauri 主进程。若仅监控 bootloader，当 Job Object 失效且 Tauri
    退出但 bootloader 仍存活时，守护线程无法触发。因此生产模式下必须
    使用 MAXMA_PARENT_PID 监控 Tauri 主进程。

    进程存活检测使用 WaitForSingleObject(handle, 0)：
      - 返回 WAIT_OBJECT_0 (0)：进程已退出（被信号/signaled）
      - 返回 WAIT_TIMEOUT (258)：进程仍在运行
      - 返回 WAIT_FAILED (0xFFFFFFFF)：出错（视为已退出，fail-safe）
    不能仅用 OpenProcess 返回值判断，因为 Windows 对已退出但未完全回收的
    "僵尸进程"仍会返回有效句柄。
    """
    if sys.platform != "win32":
        return

    try:
        import ctypes

        # 优先使用 Tauri 注入的主进程 PID，否则回退到直接父进程
        parent_pid_str = os.environ.get("MAXMA_PARENT_PID", "")
        if parent_pid_str.isdigit():
            ppid = int(parent_pid_str)
        else:
            ppid = os.getppid()

        if ppid <= 1:
            return

        kernel32 = ctypes.windll.kernel32
        SYNCHRONIZE = 0x00100000
        WAIT_OBJECT_0 = 0
        WAIT_TIMEOUT = 258
        WAIT_FAILED = 0xFFFFFFFF

        def _watch():
            while True:
                time.sleep(2)
                try:
                    handle = kernel32.OpenProcess(SYNCHRONIZE, False, ppid)
                    if not handle:
                        # 无法打开进程（PID 不存在或无权限），视为已退出
                        print(f"[watchdog] 父进程 (pid={ppid}) 已退出（OpenProcess 返回空），sidecar 自动终止", flush=True)
                        os._exit(0)
                    status = kernel32.WaitForSingleObject(handle, 0)
                    kernel32.CloseHandle(handle)
                    if status == WAIT_OBJECT_0 or status == WAIT_FAILED:
                        print(f"[watchdog] 父进程 (pid={ppid}) 已退出（WaitForSingleObject={status}），sidecar 自动终止", flush=True)
                        os._exit(0)
                except Exception as e:
                    # 检测过程中出错，fail-safe：终止 sidecar 避免孤儿
                    print(f"[watchdog] 检测异常 ({e})，sidecar 自动终止", flush=True)
                    os._exit(0)

        t = threading.Thread(target=_watch, daemon=True, name="parent-watchdog")
        t.start()
    except Exception as e:
        logger.warning("[watchdog] 父进程监控安装失败: %s", e)


def main():
    # 初始化日志系统（在其他模块导入之前）
    setup_logging()
    _prepend_embedded_runtime_path()

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

    app = create_app()

    settings = get_settings()
    dev_mode = "--dev" in sys.argv
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=settings.maxma_api_port,
        reload=dev_mode,
        reload_dirs=["agent", "api"] if dev_mode else None,
    )


if __name__ == "__main__":
    main()
