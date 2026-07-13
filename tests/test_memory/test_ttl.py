"""TTL 遗忘机制测试 — memory/memory_manager.py TTL 字段 + purge_expired + memory/ttl.py 调度器。"""

import asyncio
import time
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from memory import ttl as ttl_module
from memory.memory_manager import (
    MemoryItem,
    MemoryManager,
    _compute_expires_at,
    _is_expired,
)


async def _poll_purge_count(mm, min_count: int = 1, timeout: float = 5.0) -> None:
    """轮询等待 purge_expired 被调用至少 min_count 次。"""
    for _ in range(int(timeout / 0.1)):
        if mm.purge_count >= min_count:
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"purge_count did not reach {min_count} (got {mm.purge_count})")


async def _poll_call_count(mm, min_count: int = 1, timeout: float = 5.0) -> None:
    """轮询等待 call_count 至少 min_count 次。"""
    for _ in range(int(timeout / 0.1)):
        if mm.call_count >= min_count:
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"call_count did not reach {min_count} (got {mm.call_count})")


# ── _compute_expires_at / _is_expired ────────────────────────────


class TestExpiresAtHelpers:
    """过期时间计算辅助函数测试。"""

    def test_compute_expires_at_returns_future_time(self):
        expires_at = _compute_expires_at(3600)  # 1 小时后
        expires_dt = datetime.strptime(expires_at, "%Y-%m-%d %H:%M:%S")
        now = datetime.now()
        # 应在 1 小时前后误差 5 秒内
        delta = expires_dt - now
        assert 3595 <= delta.total_seconds() <= 3605

    def test_is_expired_none_returns_false(self):
        """None 表示永久，永不过期。"""
        assert _is_expired(None) is False
        assert _is_expired("") is False

    def test_is_expired_future_returns_false(self):
        """未来时间未过期。"""
        future = (datetime.now() + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        assert _is_expired(future) is False

    def test_is_expired_past_returns_true(self):
        """过去时间已过期。"""
        past = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        assert _is_expired(past) is True

    def test_is_expired_invalid_format_returns_false(self):
        """格式错误时返回 False（容错）。"""
        assert _is_expired("invalid-format") is False


# ── MemoryItem TTL 字段 ─────────────────────────────────────────


class TestMemoryItemTtl:
    """MemoryItem TTL 字段处理测试。"""

    def test_init_no_ttl_defaults_permanent(self):
        """无 TTL 时默认永久。"""
        item = MemoryItem("desc", "theme")
        assert item.ttl is None
        assert item.expires_at is None

    def test_init_with_ttl_sets_expires_at(self):
        """构造时传入 ttl 应同时设置 expires_at。"""
        item = MemoryItem("desc", "theme", ttl=3600, expires_at="2026-12-31 23:59:59")
        assert item.ttl == 3600
        assert item.expires_at == "2026-12-31 23:59:59"

    def test_update_with_new_ttl_resets_expires_at(self):
        """update 时传入 new_ttl>0 应重置过期时间。"""
        item = MemoryItem("desc", "theme", ttl=3600, expires_at="2020-01-01 00:00:00")
        # 原本已过期
        assert _is_expired(item.expires_at) is True
        # 重置为 1 小时后
        item.update("重置 TTL", new_ttl=3600)
        assert item.ttl == 3600
        assert _is_expired(item.expires_at) is False

    def test_update_with_ttl_zero_makes_permanent(self):
        """update 时传入 new_ttl=0 应改为永久。"""
        item = MemoryItem("desc", "theme", ttl=3600, expires_at="2020-01-01 00:00:00")
        item.update("改为永久", new_ttl=0)
        assert item.ttl is None
        assert item.expires_at is None

    def test_update_with_ttl_none_keeps_original(self):
        """update 时不传 new_ttl 应保留原过期时间。"""
        original_expires = "2026-12-31 23:59:59"
        item = MemoryItem("desc", "theme", ttl=3600, expires_at=original_expires)
        item.update("仅更新内容", new_description="new desc")
        assert item.ttl == 3600
        assert item.expires_at == original_expires


# ── MemoryManager TTL 集成 ──────────────────────────────────────


class TestMemoryManagerTtl:
    """MemoryManager add/update/list_expired/purge_expired 测试。"""

    def test_add_with_ttl_stores_expires_at(self, tmp_path):
        """add 时传入 ttl 应持久化 ttl 和 expires_at。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        new_id = mm.add(description="临时观察", theme="瞬间", ttl=3600)
        items = mm.show(include_expired=True)
        # 找到刚创建的条目
        target = next(it for it in items if it["id"] == new_id)
        assert target["ttl"] == 3600
        assert target["expires_at"] is not None
        assert _is_expired(target["expires_at"]) is False

    def test_add_without_ttl_is_permanent(self, tmp_path):
        """add 不传 ttl 应为永久。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        new_id = mm.add(description="永久身份", theme="身份")
        items = mm.show(include_expired=True)
        target = next(it for it in items if it["id"] == new_id)
        assert target["ttl"] is None
        assert target["expires_at"] is None

    def test_update_resets_ttl(self, tmp_path):
        """update 通过 new_ttl 重置过期时间。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        new_id = mm.add(description="旧", theme="瞬间", ttl=1)
        mm.update(new_id, reason="重置", new_description="新", new_ttl=86400)
        items = mm.show(include_expired=True)
        target = next(it for it in items if it["id"] == new_id)
        assert target["ttl"] == 86400
        assert _is_expired(target["expires_at"]) is False

    def test_show_filters_expired(self, tmp_path):
        """show 默认过滤已过期条目。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        # 创建一条已过期 + 一条未过期
        past = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        # 通过 add 后再手工修改 YAML 注入过期时间
        expired_id = mm.add(description="过期", theme="瞬间", ttl=3600)
        # 直接构造已过期 MemoryItem 并写入
        import portalocker
        with portalocker.Lock(str(tmp_path / "memory.yaml") + ".lock", timeout=5):
            with open(tmp_path / "memory.yaml", "r", encoding="utf-8") as f:
                import yaml
                data = yaml.safe_load(f)
            data[expired_id]["expires_at"] = past
            with open(tmp_path / "memory.yaml", "w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

        permanent_id = mm.add(description="永久", theme="身份")

        visible = mm.show()  # 默认 include_expired=False
        visible_ids = {it["id"] for it in visible}
        assert permanent_id in visible_ids
        assert expired_id not in visible_ids

        # include_expired=True 时应能看到
        all_items = mm.show(include_expired=True)
        all_ids = {it["id"] for it in all_items}
        assert expired_id in all_ids
        assert permanent_id in all_ids

    def test_search_filters_expired(self, tmp_path):
        """search 应过滤已过期条目。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        past = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        expired_id = mm.add(description="过期天气", theme="瞬间", ttl=3600)
        # 手动修改为已过期
        import portalocker
        import yaml
        lock_path = str(tmp_path / "memory.yaml") + ".lock"
        with portalocker.Lock(lock_path, timeout=5):
            with open(tmp_path / "memory.yaml", "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            data[expired_id]["expires_at"] = past
            with open(tmp_path / "memory.yaml", "w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

        permanent_id = mm.add(description="永久天气", theme="瞬间")

        results = mm.search(keyword="天气")
        result_ids = {it["id"] for it in results}
        assert permanent_id in result_ids
        assert expired_id not in result_ids

    def test_list_expired(self, tmp_path):
        """list_expired 返回所有已过期条目。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        past = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        expired_id = mm.add(description="过期", theme="瞬间", ttl=3600)
        mm.add(description="永久", theme="身份")
        # 手动改第一项为已过期
        import portalocker
        import yaml
        lock_path = str(tmp_path / "memory.yaml") + ".lock"
        with portalocker.Lock(lock_path, timeout=5):
            with open(tmp_path / "memory.yaml", "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            data[expired_id]["expires_at"] = past
            with open(tmp_path / "memory.yaml", "w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

        expired_list = mm.list_expired()
        assert len(expired_list) == 1
        assert expired_list[0]["id"] == expired_id

    def test_purge_expired_removes_expired(self, tmp_path):
        """purge_expired 删除已过期条目并返回数量。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        past = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        expired_id = mm.add(description="过期", theme="瞬间", ttl=3600)
        permanent_id = mm.add(description="永久", theme="身份")
        # 手动改第一项为已过期
        import portalocker
        import yaml
        lock_path = str(tmp_path / "memory.yaml") + ".lock"
        with portalocker.Lock(lock_path, timeout=5):
            with open(tmp_path / "memory.yaml", "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            data[expired_id]["expires_at"] = past
            with open(tmp_path / "memory.yaml", "w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

        purged = mm.purge_expired()
        assert purged == 1

        # 验证过期项已删除，永久项保留
        items = mm.show(include_expired=True)
        ids = {it["id"] for it in items}
        assert expired_id not in ids
        assert permanent_id in ids

    def test_purge_expired_nothing_to_purge(self, tmp_path):
        """无过期条目时 purge_expired 返回 0。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        mm.add(description="永久", theme="身份")
        assert mm.purge_expired() == 0

    def test_purge_expired_removes_from_vector_store(self, tmp_path):
        """purge_expired 应同步从向量库删除已过期条目。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        past = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        expired_id = mm.add(description="过期", theme="瞬间", ttl=3600)
        # 手动改过期
        import portalocker
        import yaml
        lock_path = str(tmp_path / "memory.yaml") + ".lock"
        with portalocker.Lock(lock_path, timeout=5):
            with open(tmp_path / "memory.yaml", "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            data[expired_id]["expires_at"] = past
            with open(tmp_path / "memory.yaml", "w", encoding="utf-8") as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

        with patch("memory.rag.indexer.remove_memory") as mock_remove:
            purged = mm.purge_expired()
            assert purged == 1
            mock_remove.assert_called_once_with(expired_id)


# ── 调度器 memory/ttl.py ────────────────────────────────────────


class TestTtlScheduler:
    """memory/ttl.py 调度器测试。"""

    def setup_method(self):
        """每个测试前确保全局 task 已清理。"""
        ttl_module._purge_task = None

    def teardown_method(self):
        """每个测试后清理全局 task。"""
        if ttl_module._purge_task is not None and not ttl_module._purge_task.done():
            ttl_module._purge_task.cancel()
        ttl_module._purge_task = None

    def test_schedule_purge_starts_task(self):
        """schedule_purge 应启动后台任务。"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            mm = MemoryManager.__new__(MemoryManager)  # 不创建文件，仅用作占位
            task = ttl_module.schedule_purge(interval_seconds=60, mm_list=[mm])
            assert isinstance(task, asyncio.Task)
            assert ttl_module.is_running() is True
        finally:
            # 清理
            loop.run_until_complete(ttl_module.stop_purge())
            loop.close()

    def test_stop_purge_idempotent(self):
        """stop_purge 在无任务时也应安全。"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(ttl_module.stop_purge())  # 不应抛错
        finally:
            loop.close()

    def test_purge_loop_calls_purge_expired(self):
        """调度循环应调用 mm.purge_expired。"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        class _FakeMM:
            def __init__(self):
                self.purge_count = 0
            def purge_expired(self) -> int:
                self.purge_count += 1
                return 1

        fake_mm = _FakeMM()
        try:
            ttl_module.schedule_purge(interval_seconds=0.05, mm_list=[fake_mm])
            # 轮询等待 purge 至少执行一次（替代固定 sleep）
            loop.run_until_complete(_poll_purge_count(fake_mm, min_count=1, timeout=5))
            assert fake_mm.purge_count >= 1
        finally:
            loop.run_until_complete(ttl_module.stop_purge())
            loop.close()

    def test_purge_loop_continues_on_error(self):
        """单次 purge_expired 异常不应杀死调度循环。"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        class _FailingMM:
            def __init__(self):
                self.call_count = 0
            def purge_expired(self) -> int:
                self.call_count += 1
                if self.call_count == 1:
                    raise RuntimeError("simulated failure")
                return 0

        failing_mm = _FailingMM()
        try:
            ttl_module.schedule_purge(interval_seconds=0.05, mm_list=[failing_mm])
            loop.run_until_complete(_poll_call_count(failing_mm, min_count=2, timeout=5))
            # 应至少被调用 2 次（第 1 次异常后继续）
            assert failing_mm.call_count >= 2
        finally:
            loop.run_until_complete(ttl_module.stop_purge())
            loop.close()


# ── 向后兼容性 ─────────────────────────────────────────────────


class TestBackwardCompat:
    """向后兼容性测试：旧调用方不传 ttl 参数应正常工作。"""

    def test_add_without_ttl_works(self, tmp_path):
        """add 不传 ttl 应正常工作。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        new_id = mm.add(description="内容", theme="身份")
        assert new_id

    def test_update_without_ttl_works(self, tmp_path):
        """update 不传 new_ttl 应正常工作。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        new_id = mm.add(description="旧", theme="身份")
        mm.update(new_id, reason="更新", new_description="新")
        items = mm.show()
        target = next(it for it in items if it["id"] == new_id)
        assert target["description"] == "新"

    def test_existing_yaml_without_ttl_loads_fine(self, tmp_path):
        """加载无 ttl 字段的旧 YAML 应正常工作。"""
        import yaml
        path = tmp_path / "memory.yaml"
        # 写入无 ttl 字段的旧格式数据
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(
                {"abc12345": {
                    "description": "旧数据",
                    "theme": "身份",
                    "history": [],
                    "latest_update_time": "2026-01-01 00:00:00",
                }},
                f,
                default_flow_style=False,
                allow_unicode=True,
            )
        mm = MemoryManager(yaml_file=str(path))
        items = mm.show()
        assert len(items) == 1
        assert items[0]["description"] == "旧数据"
        # ttl/expires_at 应为 None
        assert items[0]["ttl"] is None
        assert items[0]["expires_at"] is None
