"""YAML 文件读写辅助：原子写入 + 可选文件锁。"""

from __future__ import annotations

import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import portalocker
import yaml


def _lock_path(path: str | Path) -> Path:
    p = Path(path)
    return Path(str(p) + ".lock")


@contextmanager
def yaml_file_lock(path: str | Path, timeout: int = 5) -> Iterator[None]:
    """对 YAML 文件关联的 lock 文件加锁。"""
    lock_path = _lock_path(path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with portalocker.Lock(str(lock_path), timeout=timeout):
        yield


def load_yaml(path: str | Path, default: Any = None) -> Any:
    """读取 YAML；文件不存在或为空时返回 default。"""
    p = Path(path)
    if not p.exists():
        return default
    with open(p, encoding="utf-8") as f:
        data = yaml.safe_load(f)
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
