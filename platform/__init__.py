"""平台原语层 — 零业务知识的通用引擎组件。

注意: 本包名与 Python 标准库 ``platform`` 同名。为避免遮蔽标准库
（httpx / zstandard / packaging 等依赖使用 ``platform.python_implementation()``
等函数），通过模块级 ``__getattr__`` 将未知的属性访问代理给标准库
platform 模块，确保 ``import platform`` 既能访问本包的 ``event_dedup``
子模块，也能调用标准库的全部公开函数。
"""
from __future__ import annotations

import importlib.util
import os
import sys

_this_dir = os.path.dirname(os.path.abspath(__file__))
_stdlib_platform = None


def _load_stdlib_platform():
    """从 sys.path 中找到标准库 platform.py 并加载（跳过本项目目录）。

    标准库 platform 是单文件模块（platform.py），不是包，因此可安全地
    用 spec_from_file_location 以独立模块名加载，不会与 ``sys.modules['platform']``
    发生循环引用。
    """
    global _stdlib_platform
    if _stdlib_platform is not None:
        return _stdlib_platform
    for _path in sys.path:
        if not _path:
            continue
        try:
            _abs = os.path.abspath(_path)
        except (ValueError, OSError):
            continue
        if _abs == _this_dir:
            continue
        _candidate = os.path.join(_abs, "platform.py")
        if os.path.isfile(_candidate):
            _spec = importlib.util.spec_from_file_location(
                "_stdlib_platform", _candidate
            )
            _stdlib_platform = importlib.util.module_from_spec(_spec)
            _spec.loader.exec_module(_stdlib_platform)
            return _stdlib_platform
    return None


def __getattr__(name: str):
    """将包中未定义的属性代理给标准库 platform 模块。

    首次访问后缓存到 ``globals()``，后续直接命中 ``__dict__``，零额外开销。
    """
    _mod = _load_stdlib_platform()
    if _mod is not None and hasattr(_mod, name):
        _val = getattr(_mod, name)
        globals()[name] = _val
        return _val
    raise AttributeError(f"module 'platform' has no attribute {name!r}")
