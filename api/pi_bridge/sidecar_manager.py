"""Production-grade SidecarManager for Bun subprocess lifecycle.

Manages start/stop/restart of the Bun sidecar process (session-bridge.ts).
Designed to be consumed by JsonRpcClient (Task 1.3) which will use the
stdin/stdout streams for JSON-RPC communication.

Thread-safe: all public mutation methods use asyncio.Lock.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

# Ensure project root is on sys.path for imports when run as a script
_project_root = Path(__file__).resolve().parent.parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from api.pi_bridge.rpc_client import JsonRpcClient
from api.activity_hub import record as record_activity

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SIDECAR_DIR = Path(
    os.environ.get("MAXMA_SIDECAR_DIR")
    or (Path(__file__).resolve().parent.parent.parent / "bun-sidecar")
)
SIDECAR_ENTRY = SIDECAR_DIR / "src" / "session-bridge.ts"
# 当 settings 未初始化时的默认值
_DEFAULT_BUN_PATH = "bun"


def _resolve_bun_path() -> str:
    """从配置读取 Bun 路径，fallback 到默认值。

    生产模式（PyInstaller _MEIPASS）：查找捆绑的 bun.exe。
    开发模式：使用配置文件或默认路径。
    """
    # 生产模式：PyInstaller 打包后 bun.exe 在 _MEIPASS 目录
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        bundled_bun = Path(meipass) / "bun-sidecar" / "bun.exe"
        if bundled_bun.exists():
            return str(bundled_bun)
    try:
        from config.settings import get_settings
        s = get_settings()
        return s.sidecar_bun_path or _DEFAULT_BUN_PATH
    except Exception:
        return _DEFAULT_BUN_PATH


# ---------------------------------------------------------------------------
# SidecarManager
# ---------------------------------------------------------------------------

class SidecarManager:
    """Manages the lifecycle of the Bun sidecar subprocess.

    Provides properties for accessing the process's stdin/stdout streams
    so that a separate JsonRpcClient can perform JSON-RPC communication.
    """

    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._stderr_task: asyncio.Task[None] | None = None
        self._client: JsonRpcClient | None = None

    # -- Properties ---------------------------------------------------------

    @property
    def is_running(self) -> bool:
        """True if the subprocess is started and still alive."""
        return (
            self._process is not None
            and self._process.returncode is None
        )

    @property
    def stdin(self) -> asyncio.StreamWriter | None:
        """The process's stdin stream, or None if not running."""
        return self._process.stdin if self._process else None

    @property
    def stdout(self) -> asyncio.StreamReader | None:
        """The process's stdout stream, or None if not running."""
        return self._process.stdout if self._process else None

    @property
    def client(self) -> JsonRpcClient | None:
        """The JSON-RPC client for this sidecar, or None if not started."""
        return self._client

    # -- Public API ---------------------------------------------------------

    async def start(self) -> None:
        """Start the Bun sidecar subprocess.

        If already running, this is a no-op.
        After starting, stderr is forwarded to the Python logger in a
        background task, and a short sleep allows the process to initialise.
        """
        async with self._lock:
            if self.is_running:
                logger.debug("Sidecar already running, skipping start")
                return

            bun_path = _resolve_bun_path()
            logger.info(
                "Starting sidecar: %s run %s", bun_path, SIDECAR_ENTRY
            )

            # Forward the project root to the sidecar via env var so its config
            # tools (which read/write paths relative to the project root) resolve
            # correctly even though the sidecar process runs with cwd=SIDECAR_DIR.
            # B-001/B-002: previously the sidecar used process.cwd() which pointed
            # at bun-sidecar/ instead of the actual project root.
            sidecar_env = dict(os.environ)
            try:
                from app_paths import PROJECT_ROOT
                sidecar_env["MAXMA_PROJECT_ROOT"] = str(PROJECT_ROOT)
            except Exception:
                logger.debug(
                    "[sidecar] app_paths.PROJECT_ROOT unavailable; "
                    "sidecar will fall back to process.cwd()",
                    exc_info=True,
                )

            self._process = await asyncio.create_subprocess_exec(
                bun_path,
                "run",
                str(SIDECAR_ENTRY),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(SIDECAR_DIR),
                env=sidecar_env,
            )
            logger.info(
                "Sidecar started (pid=%s)", self._process.pid
            )
            record_activity(
                "system", "sidecar_start",
                message=f"OMP sidecar 已启动 (pid={self._process.pid})",
            )

            # Forward stderr in the background
            self._stderr_task = asyncio.create_task(
                self._forward_stderr()
            )

            # Create and start the JSON-RPC client
            assert self._process.stdin is not None
            assert self._process.stdout is not None
            self._client = JsonRpcClient(
                self._process.stdin, self._process.stdout
            )
            await self._client.start_reading()

            # Brief wait for the process to initialise
            await asyncio.sleep(0.5)

    async def stop(self) -> None:
        """Stop the sidecar subprocess gracefully.

        Strategy (Windows-aware):
          0. Stop the JSON-RPC client first.
          1. Send terminate (WM_CLOSE on Windows, SIGTERM on Unix).
          2. Wait up to 5 seconds for clean exit.
          3. On timeout, force-kill (TerminateProcess / SIGKILL).
          4. Ignore ProcessLookupError (already exited).
        """
        async with self._lock:
            # Stop the JSON-RPC client first (inside lock)
            if self._client is not None:
                await self._client.stop()
                self._client = None

            if not self.is_running:
                logger.debug("Sidecar not running, skipping stop")
                return

            proc = self._process
            self._process = None  # Prevent re-use during cleanup

            # Cancel stderr forwarding task
            if self._stderr_task is not None and not self._stderr_task.done():
                self._stderr_task.cancel()
                try:
                    await self._stderr_task
                except asyncio.CancelledError:
                    logger.debug("[sidecar] Stderr forwarding task cancelled during stop()")
            self._stderr_task = None

        # Process termination outside lock (I/O bound, no shared state)
        assert proc is not None
        try:
            proc.terminate()  # SIGTERM on Unix, WM_CLOSE on Windows
            await asyncio.wait_for(proc.wait(), timeout=5)
            logger.info("Sidecar (pid=%s) stopped gracefully", proc.pid)
            record_activity("system", "sidecar_stop", message="OMP sidecar 已停止")
        except asyncio.TimeoutError:
            logger.warning(
                "Sidecar (pid=%s) did not exit in 5s, killing", proc.pid
            )
            proc.kill()  # TerminateProcess on Windows, SIGKILL on Unix
            await proc.wait()
            logger.info("Sidecar (pid=%s) killed", proc.pid)
            record_activity(
                "system", "sidecar_stop",
                level="warn",
                message="OMP sidecar 未按时退出，已被强制终止",
            )
        except ProcessLookupError:
            logger.debug(
                "Sidecar (pid=%s) already exited", proc.pid
            )

    async def restart(self) -> None:
        """Restart the sidecar subprocess (stop then start)."""
        logger.info("Restarting sidecar")
        await self.stop()
        await self.start()

    # -- Internal helpers ---------------------------------------------------

    async def _forward_stderr(self) -> None:
        """Read stderr lines from the process and forward them to the logger."""
        try:
            assert self._process is not None
            assert self._process.stderr is not None
            async for line in self._process.stderr:
                text = line.decode("utf-8", errors="replace").rstrip()
                if text:
                    logger.debug("[sidecar] %s", text)
        except Exception:
            logger.exception("Error forwarding sidecar stderr")


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

async def _test() -> None:
    """Quick integration test: start, verify running, stop, verify stopped."""
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    mgr = SidecarManager()

    # Start
    await mgr.start()
    assert mgr.is_running, "Expected sidecar to be running after start()"
    assert mgr.stdin is not None, "Expected stdin to be available"
    assert mgr.stdout is not None, "Expected stdout to be available"
    print(f"[PASS] Sidecar started (pid={mgr._process.pid})")

    # Stop
    await mgr.stop()
    assert not mgr.is_running, "Expected sidecar to be stopped after stop()"
    print("[PASS] Sidecar stopped")


if __name__ == "__main__":
    asyncio.run(_test())
