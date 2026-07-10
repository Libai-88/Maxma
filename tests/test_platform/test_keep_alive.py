"""Keep-alive TTL 安全网测试。"""
import time
import pytest
from maxma_platform.keep_alive import KeepAliveManager


def test_register_returns_disposer():
    """register 返回 disposer 函数。"""
    mgr = KeepAliveManager(ttl_seconds=86400)
    disposer = mgr.register("test-reason")
    assert callable(disposer)


def test_register_and_dispose():
    """注册后调用 disposer 释放。"""
    mgr = KeepAliveManager(ttl_seconds=86400)
    disposer = mgr.register("test-reason")
    assert mgr.should_keep_alive() is True
    disposer()
    assert mgr.should_keep_alive() is False


def test_dispose_is_idempotent():
    """disposer 幂等。"""
    mgr = KeepAliveManager(ttl_seconds=86400)
    disposer = mgr.register("test-reason")
    disposer()
    disposer()  # 不应抛异常
    assert mgr.should_keep_alive() is False


def test_multiple_reasons():
    """多个 reason 同时存在。"""
    mgr = KeepAliveManager(ttl_seconds=86400)
    d1 = mgr.register("reason-1")
    d2 = mgr.register("reason-2")
    assert mgr.should_keep_alive() is True
    d1()
    assert mgr.should_keep_alive() is True  # 还有 reason-2
    d2()
    assert mgr.should_keep_alive() is False


def test_ttl_expiry_prunes_orphan():
    """超时 reason 被自动剪枝。"""
    mgr = KeepAliveManager(ttl_seconds=0.05)  # 50ms TTL
    mgr.register("orphan-reason")
    time.sleep(0.06)
    # should_keep_alive 触发惰性剪枝
    assert mgr.should_keep_alive() is False


def test_clear_all():
    """clear_all 释放所有 reason。"""
    mgr = KeepAliveManager(ttl_seconds=86400)
    mgr.register("r1")
    mgr.register("r2")
    mgr.clear_all()
    assert mgr.should_keep_alive() is False


def test_get_active_reasons():
    """获取活跃 reason 列表。"""
    mgr = KeepAliveManager(ttl_seconds=86400)
    mgr.register("r1")
    mgr.register("r2")
    reasons = mgr.get_active_reasons()
    assert "r1" in reasons
    assert "r2" in reasons


def test_reregister_refreshes_timestamp():
    """重复注册刷新时间戳（续期）。"""
    mgr = KeepAliveManager(ttl_seconds=0.05)
    mgr.register("reason")
    time.sleep(0.03)
    mgr.register("reason")  # 续期
    time.sleep(0.03)
    assert mgr.should_keep_alive() is True  # 未超时
