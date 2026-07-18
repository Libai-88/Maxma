"""YAML 文件读写辅助：原子写入 + 可选文件锁。"""

from __future__ import annotations

import os
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import yaml

# portalocker 在 Windows 上需要 pywin32 的 C 扩展（pywintypes），
# 如果缺失则运行时崩溃。延迟检测：仅在首次使用时验证。
_HAS_PORTALOCKER_CACHED: bool | None = None


def _check_portalocker() -> bool:
    """检查 portalocker 是否真正可用（而非仅模块级别可 import）。"""
    global _HAS_PORTALOCKER_CACHED
    if _HAS_PORTALOCKER_CACHED is not None:
        return _HAS_PORTALOCKER_CACHED
    try:
        import portalocker
        # 尝试实际创建 Lock 实例来验证运行时可用性
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".lock", delete=False) as f:
            lock_path = f.name
        try:
            with portalocker.Lock(lock_path, timeout=1):
                pass
            _HAS_PORTALOCKER_CACHED = True
        except Exception:
            _HAS_PORTALOCKER_CACHED = False
        finally:
            try:
                os.unlink(lock_path)
            except OSError:
                pass
    except ImportError:
        _HAS_PORTALOCKER_CACHED = False
    return _HAS_PORTALOCKER_CACHED


def _lock_path(path: str | Path) -> Path:
    p = Path(path)
    return Path(str(p) + ".lock")


# 进程内锁字典：按 path 区分，弥补 portalocker 在同进程内可重入不互斥的问题
# portalocker 是 OS 进程级锁，同进程内多次 acquire 会重入成功，无法阻止
# FastAPI 单进程多协程下的并发写。叠加 threading.Lock 实现「同进程内互斥 +
# 跨进程互斥」双重保障。
_inproc_locks: dict[str, threading.Lock] = {}
_inproc_locks_guard = threading.Lock()


def _get_inproc_lock(path_str: str) -> threading.Lock:
    """获取或创建指定路径对应的进程内锁。"""
    with _inproc_locks_guard:
        lock = _inproc_locks.get(path_str)
        if lock is None:
            lock = threading.Lock()
            _inproc_locks[path_str] = lock
        return lock


@contextmanager
def yaml_file_lock(path: str | Path, timeout: int = 5) -> Iterator[None]:
    """对 YAML 文件关联的 lock 文件加锁。

    双重保障（portalocker 可用时）：
    1. 进程内 threading.Lock —— 防止同进程多协程/线程并发写
    2. portalocker（OS 文件锁）—— 防止多进程并发写

    portalocker 不可用时（Windows 缺少 pywin32），仅使用进程内锁，
    在单进程开发模式下仍然安全。
    """
    path_str = str(Path(path))
    inproc_lock = _get_inproc_lock(path_str)
    inproc_lock.acquire()
    lock_path = _lock_path(path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if _check_portalocker():
            import portalocker
            with portalocker.Lock(str(lock_path), timeout=timeout):
                yield
        else:
            yield
    finally:
        inproc_lock.release()


def load_yaml(path: str | Path, default: Any = None) -> Any:
    """读取 YAML；文件不存在或为空时返回 default。"""
    p = Path(path)
    if not p.exists():
        return default
    try:
        with open(p, encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except (yaml.YAMLError, OSError):
        return default
    return default if data is None else data


def dump_yaml_atomic(path: str | Path, data: Any) -> None:
    """将 YAML 原子写入目标路径。"""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_name = tempfile.mkstemp(
        dir=str(p.parent),
        prefix=f".{p.name}.",
        suffix=".tmp",
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, p)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def dump_yaml_backup_once(path: str | Path, data: Any) -> bool:
    """Publish an encrypted migration backup once without overwriting it."""
    backup_path = Path(path)
    if backup_path.exists():
        return False
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(backup_path.parent),
        prefix=f".{backup_path.name}.",
        suffix=".tmp",
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as destination:
            yaml.dump(data, destination, allow_unicode=True, default_flow_style=False)
            destination.flush()
            os.fsync(destination.fileno())
        # Hard-link publication fails if another process created the first
        # backup after our exists() check, which preserves the older backup.
        try:
            os.link(tmp_name, backup_path)
        except FileExistsError:
            return False
        os.unlink(tmp_name)
        try:
            os.chmod(backup_path, 0o600)
        except OSError:
            pass
        return True
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
