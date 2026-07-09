"""Disposable 资源管理原语。

设计参考 VSCode 的 IDisposable 模式：
- IDisposable: 单个资源的释放接口
- to_disposable(fn): 把清理函数包装成 IDisposable
- combined_disposable(...): 组合多个 disposable，逆序释放
- DisposableStore: 集合管理，clear() 释放但保持可用，dispose() 释放且禁止未来添加
- MutableDisposable<T>: 持有单个可替换的 disposable，set 新值时自动释放旧值
"""
from __future__ import annotations

from typing import Callable, List, Optional, Protocol


class IDisposable(Protocol):
    """资源释放协议。"""

    def dispose(self) -> None: ...


class _FunctionDisposable:
    """把清理函数包装成 IDisposable。"""

    def __init__(self, fn: Callable[[], None]):
        self._fn = fn
        self._disposed = False

    def dispose(self) -> None:
        if self._disposed:
            return
        self._disposed = True
        self._fn()


def to_disposable(fn: Callable[[], None]) -> IDisposable:
    """把清理函数包装成 IDisposable（幂等：多次 dispose 只执行一次）。"""
    return _FunctionDisposable(fn)


def combined_disposable(*disposables: IDisposable) -> IDisposable:
    """组合多个 disposable，dispose 时按注册的逆序释放。"""
    items = list(disposables)
    _disposed = [False]

    def _dispose():
        if _disposed[0]:
            return
        _disposed[0] = True
        for d in reversed(items):
            try:
                d.dispose()
            except Exception:
                pass  # 单个释放失败不影响其他

    return to_disposable(_dispose)


class DisposableStore:
    """Disposable 集合管理器。

    - add(): 添加 disposable
    - clear(): 释放所有已添加的 disposable，但 store 仍可继续使用
    - dispose(): 释放所有并标记为已销毁，之后 add() 抛 RuntimeError
    """

    def __init__(self):
        self._items: List[IDisposable] = []
        self._disposed = False

    def add(self, disposable: IDisposable) -> IDisposable:
        """添加 disposable 到集合。"""
        if self._disposed:
            raise RuntimeError("Cannot add to a disposed DisposableStore")
        self._items.append(disposable)
        return disposable

    def clear(self) -> None:
        """释放所有已添加的 disposable，但保持 store 可用。"""
        items = self._items
        self._items = []
        for d in reversed(items):
            try:
                d.dispose()
            except Exception:
                pass

    def dispose(self) -> None:
        """释放所有并标记为已销毁。"""
        self._disposed = True
        self.clear()


class MutableDisposable:
    """持有单个可替换的 disposable。

    set 新值时自动释放旧值；dispose 时释放当前值并禁止未来 set。
    """

    def __init__(self, value: Optional[IDisposable]):
        self._value = value
        self._disposed = False

    def set(self, value: Optional[IDisposable]) -> None:
        """设置新值，自动释放旧值。"""
        if self._disposed:
            if value is not None:
                value.dispose()
            return
        old = self._value
        self._value = value
        if old is not None:
            old.dispose()

    def dispose(self) -> None:
        """释放当前值并标记为已销毁。"""
        if self._disposed:
            return
        self._disposed = True
        if self._value is not None:
            self._value.dispose()
            self._value = None
