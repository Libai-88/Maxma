"""test_api 共享 conftest — 平台兼容性补丁。"""

import pytest


@pytest.fixture(autouse=True)
def _patch_portalocker(monkeypatch):
    """Python 3.14 上 pywin32 不可用导致 portalocker 崩溃；全局替换为文件锁降级。

    portalocker.Win32Locker 依赖 pywintypes，而 pywin32 尚未支持 Python 3.14。
    Unix 或 macOS 无此问题（使用 fcntl）。降级至 portalocker.Lock 的 fallback 实现。
    """
    try:
        import pywintypes  # noqa: F401
    except ImportError:
        try:
            import portalocker
            # 替换为内存锁，避免文件锁
            from unittest.mock import MagicMock

            class _FakeLock:
                def __init__(self, path, timeout=None, flags=None):
                    self._path = path

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    pass

                def acquire(self, timeout=None):
                    return self

                def release(self):
                    pass

            monkeypatch.setattr(portalocker, "Lock", _FakeLock)
        except ImportError:
            pass
