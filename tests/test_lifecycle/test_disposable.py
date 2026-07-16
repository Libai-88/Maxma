# GUARD: agent.lifecycle.disposable
try:
    import agent.lifecycle.disposable
except ImportError:
    import pytest
    pytest.skip("agent.lifecycle.disposable module removed — OMP replaces it", allow_module_level=True)

"""Disposable 资源管理原语测试 — VSCode 风格的资源生命周期管理。"""
import pytest
from agent.lifecycle.disposable import (
    IDisposable,
    to_disposable,
    combined_disposable,
    DisposableStore,
    MutableDisposable,
)


def test_to_disposable_calls_fn_on_dispose():
    called = []
    d = to_disposable(lambda: called.append(True))
    d.dispose()
    assert called == [True]


def test_disposable_idempotent():
    """dispose 多次只执行一次清理。"""

import pytest
try:
    import agent.lifecycle
except ImportError:
    pytest.skip("agent.lifecycle module removed — OMP replaces it", allow_module_level=True)

    called = []
    d = to_disposable(lambda: called.append(True))
    d.dispose()
    d.dispose()
    assert called == [True]


def test_combined_disposable_releases_in_reverse_order():
    """组合 disposable 按注册的逆序释放。"""
    order = []
    d1 = to_disposable(lambda: order.append("d1"))
    d2 = to_disposable(lambda: order.append("d2"))
    d3 = to_disposable(lambda: order.append("d3"))
    combined = combined_disposable(d1, d2, d3)
    combined.dispose()
    assert order == ["d3", "d2", "d1"]


def test_disposable_store_add_and_clear():
    store = DisposableStore()
    called = []
    store.add(to_disposable(lambda: called.append("a")))
    store.add(to_disposable(lambda: called.append("b")))
    store.clear()
    assert sorted(called) == ["a", "b"]
    # clear 后 store 仍可用
    store.add(to_disposable(lambda: called.append("c")))
    store.clear()
    assert "c" in called


def test_disposable_store_dispose_prevents_future_add():
    store = DisposableStore()
    store.add(to_disposable(lambda: None))
    store.dispose()
    with pytest.raises(RuntimeError, match="disposed"):
        store.add(to_disposable(lambda: None))


def test_mutable_disposable_set_replaces_old():
    """set 新值时自动释放旧值。"""
    released = []
    m = MutableDisposable(to_disposable(lambda: released.append("old")))
    m.set(to_disposable(lambda: released.append("new")))
    assert released == ["old"]
    m.dispose()
    assert released == ["old", "new"]


def test_mutable_dispose_without_value():
    m = MutableDisposable(None)
    m.dispose()  # 不应抛异常
