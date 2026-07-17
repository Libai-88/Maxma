"""Tests for api/activity_hub.py — rehydrate_orphans, list_by_session,
clear_by_session, singleton behavior."""

import threading

import pytest

from api.activity_hub import ActivityHub, ActivityRecord, activity_hub


@pytest.fixture(autouse=True)
def _reset_hub():
    """每个测试前后清空全局 hub。"""
    activity_hub.clear()
    yield
    activity_hub.clear()


class TestSingleton:
    def test_get_returns_singleton(self):
        a = ActivityHub.get()
        b = ActivityHub.get()
        assert a is b
        assert a is activity_hub

    def test_get_thread_safe_concurrent(self):
        """并发调用 get() 也只创建一个实例。"""
        ActivityHub._instance = None  # 强制重建
        results = []

        def worker():
            results.append(ActivityHub.get())

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # 所有线程拿到同一实例
        assert all(r is results[0] for r in results)
        # 清理：恢复全局单例
        ActivityHub._instance = results[0]


class TestListBySession:
    def test_list_by_session_empty(self):
        assert activity_hub.list_by_session("s1") == []

    def test_list_by_session_filters(self):
        """覆盖 lines 129-131。"""
        activity_hub.add("turn", "t1", session_id="s1", message="a")
        activity_hub.add("turn", "t2", session_id="s2", message="b")
        activity_hub.add("turn", "t3", session_id="s1", message="c")
        records = activity_hub.list_by_session("s1")
        assert len(records) == 2
        assert all(r.session_id == "s1" for r in records)
        # 按 append 顺序
        assert [r.event_type for r in records] == ["t1", "t3"]

    def test_list_by_session_limit(self):
        for i in range(5):
            activity_hub.add("turn", f"t{i}", session_id="s1")
        records = activity_hub.list_by_session("s1", limit=2)
        assert len(records) == 2
        # 返回最后 2 条
        assert [r.event_type for r in records] == ["t3", "t4"]

    def test_list_by_session_excludes_other_sessions(self):
        activity_hub.add("turn", "t1", session_id="s1")
        activity_hub.add("turn", "t2", session_id="s2")
        activity_hub.add("tool", "tool1", session_id="s3")
        # s1 只有一条
        records = activity_hub.list_by_session("s1")
        assert len(records) == 1
        assert records[0].event_type == "t1"


class TestClearBySession:
    def test_clear_by_session_no_match_returns_zero(self):
        """覆盖 lines 135-141。"""
        activity_hub.add("turn", "t1", session_id="s1")
        count = activity_hub.clear_by_session("nonexistent")
        assert count == 0
        # 原记录仍在
        assert len(activity_hub.recent()) == 1

    def test_clear_by_session_removes_only_matching(self):
        activity_hub.add("turn", "t1", session_id="s1")
        activity_hub.add("turn", "t2", session_id="s2")
        activity_hub.add("turn", "t3", session_id="s1")
        count = activity_hub.clear_by_session("s1")
        assert count == 2
        remaining = activity_hub.recent()
        assert len(remaining) == 1
        assert remaining[0].session_id == "s2"

    def test_clear_by_session_all(self):
        for i in range(3):
            activity_hub.add("turn", f"t{i}", session_id="sx")
        assert activity_hub.clear_by_session("sx") == 3
        assert activity_hub.recent() == []

    def test_clear_by_session_preserves_maxlen(self):
        """清除后 deque 的 maxlen 仍应保留。"""
        activity_hub.add("turn", "t1", session_id="s1")
        activity_hub.clear_by_session("s1")
        # 仍能添加新记录；recent() 默认 limit=100，需显式放大才能反映 deque 真实大小
        for i in range(ActivityHub.MAX_IN_MEMORY + 10):
            activity_hub.add("turn", f"t{i}", session_id="s1")
        assert len(activity_hub.recent(limit=10000)) == ActivityHub.MAX_IN_MEMORY


class TestRehydrateOrphans:
    def test_rehydrate_orphans_empty_returns_zero(self):
        """覆盖 lines 117-125: 空缓冲区返回 0。"""
        assert activity_hub.rehydrate_orphans() == 0

    def test_rehydrate_orphans_with_records_returns_zero(self):
        """当前实现是 no-op 占位，always returns 0；验证不抛异常。"""
        activity_hub.add("turn", "t1", session_id="s1", message="running task")
        activity_hub.add("tool", "tool_end", message="done")
        # 当前实现不会实际修改记录，只返回 0
        count = activity_hub.rehydrate_orphans()
        assert count == 0
        # 记录未被清除
        assert len(activity_hub.recent()) == 2

    def test_rehydrate_orphans_message_with_running(self):
        """message 含 'running' 的记录进入启发式分支但不修改。"""
        activity_hub.add(
            "tool", "tool_start", message="bash is running", level="info"
        )
        activity_hub.add("tool", "tool_start", message="idle", level="info")
        # 不抛异常即可
        assert activity_hub.rehydrate_orphans() == 0
        assert len(activity_hub.recent()) == 2


class TestActivityRecordToDict:
    """补充 ActivityRecord.to_dict 字段完整性测试。"""

    def test_to_dict_contains_all_fields(self):
        rec = ActivityRecord(
            timestamp=1.0,
            category="turn",
            event_type="turn_start",
            session_id="s1",
            turn_id="t1",
            tool_name="bash",
            level="info",
            message="hello",
            payload={"k": "v"},
        )
        d = rec.to_dict()
        assert d == {
            "timestamp": 1.0,
            "category": "turn",
            "event_type": "turn_start",
            "session_id": "s1",
            "turn_id": "t1",
            "tool_name": "bash",
            "level": "info",
            "message": "hello",
            "payload": {"k": "v"},
        }

    def test_to_dict_default_payload_is_empty(self):
        rec = ActivityRecord(timestamp=1.0, category="turn", event_type="t")
        assert rec.to_dict()["payload"] == {}
        assert rec.to_dict()["session_id"] == ""
        assert rec.to_dict()["level"] == "info"


class TestAddAndRecent:
    """补充 add + recent 的 payload 默认值和 level 测试。"""

    def test_add_default_payload_is_empty_dict(self):
        rec = activity_hub.add("turn", "t1")
        assert rec.payload == {}
        fetched = activity_hub.recent()[0]
        assert fetched.payload == {}

    def test_add_custom_level(self):
        rec = activity_hub.add("tool", "t1", level="warn", message="careful")
        assert rec.level == "warn"
        assert activity_hub.recent()[0].level == "warn"

    def test_add_returns_record_with_timestamp(self):
        rec = activity_hub.add("turn", "t1")
        assert isinstance(rec.timestamp, float)
        assert rec.timestamp > 0
