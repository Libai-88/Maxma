"""Tests for api/session_manager.py — Session 生命周期管理。"""

import time
import pytest
from unittest.mock import MagicMock, patch

from api.session_manager import SessionManager, SessionState


class TestSessionManager:
    """SessionManager 单元测试。"""

    def test_create_returns_session_state(self):
        """create() 返回 SessionState 实例。"""
        sm = SessionManager()
        session = sm.create()
        
        assert isinstance(session, SessionState)
        assert session.session_id is not None
        assert session.message_count == 0
        assert session.is_const is False

    def test_create_increments_count(self):
        """create() 增加内部会话计数。"""
        sm = SessionManager()
        initial_count = len(sm._sessions)
        
        sm.create()
        
        assert len(sm._sessions) == initial_count + 1

    def test_get_returns_existing(self):
        """get() 返回已创建的会话。"""
        sm = SessionManager()
        created = sm.create()
        
        retrieved = sm.get(created.session_id)
        
        assert retrieved is created

    def test_get_returns_none_for_missing(self):
        """get() 对不存在的会话返回 None。"""
        sm = SessionManager()
        
        result = sm.get("nonexistent-id")
        
        assert result is None

    def test_delete_removes_session(self):
        """delete() 移除指定会话。"""
        sm = SessionManager()
        session = sm.create()
        session_id = session.session_id
        
        deleted = sm.delete(session_id)
        
        assert deleted is True
        assert sm.get(session_id) is None

    def test_delete_returns_false_for_missing(self):
        """delete() 对不存在的会话返回 False。"""
        sm = SessionManager()
        
        deleted = sm.delete("nonexistent-id")
        
        assert deleted is False

    def test_cleanup_expired_removes_old_sessions(self):
        """cleanup_expired() 移除超过 TTL 的会话。"""
        sm = SessionManager()
        sm._ttl = 60  # 1 分钟 TTL
        
        # 创建一个会话并手动设置 last_active 为过去
        session = sm.create()
        session.last_active = time.time() - 120  # 2 分钟前
        
        removed = sm.cleanup_expired()
        
        assert removed == 1
        assert sm.get(session.session_id) is None

    def test_cleanup_expired_keeps_recent_sessions(self):
        """cleanup_expired() 保留最近活跃的会话。"""
        sm = SessionManager()
        sm._ttl = 60
        
        session = sm.create()
        session.last_active = time.time()  # 刚刚活跃
        
        removed = sm.cleanup_expired()
        
        assert removed == 0
        assert sm.get(session.session_id) is not None

    def test_cleanup_expired_ignores_const_sessions(self):
        """cleanup_expired() 不清理 const 会话。"""
        sm = SessionManager()
        sm._ttl = 60
        
        # 创建 const 会话
        session = sm.create()
        session.is_const = True
        session.last_active = time.time() - 120  # 过期
        
        removed = sm.cleanup_expired()
        
        assert removed == 0
        assert sm.get(session.session_id) is not None

    def test_list_sessions_returns_all(self):
        """list_sessions() 返回所有会话。"""
        sm = SessionManager()
        sm.create()
        sm.create()
        sm.create()
        
        sessions = sm.list_sessions()
        
        assert len(sessions) == 3

    def test_list_sessions_sorted_by_last_active(self):
        """list_sessions() 按 last_active 降序排列。"""
        sm = SessionManager()
        
        s1 = sm.create()
        time.sleep(0.01)
        s2 = sm.create()
        time.sleep(0.01)
        s3 = sm.create()
        
        sessions = sm.list_sessions()
        
        # 最新的在前
        assert sessions[0]["session_id"] == s3.session_id
        assert sessions[1]["session_id"] == s2.session_id
        assert sessions[2]["session_id"] == s1.session_id


class TestSessionState:
    """SessionState 单元测试。"""

    def test_session_state_has_required_fields(self):
        """SessionState 包含所有必需字段。"""
        session = SessionState(
            session_id="test-id",
            created_at=time.time(),
            last_active=time.time(),
            message_count=0,
            checkpointer=MagicMock(),
        )
        
        assert session.session_id == "test-id"
        assert session.message_count == 0
        assert session.is_const is False

    def test_session_state_const_flag(self):
        """SessionState 可以标记为 const。"""
        session = SessionState(
            session_id="const-id",
            created_at=time.time(),
            last_active=time.time(),
            message_count=0,
            checkpointer=MagicMock(),
            is_const=True,
            const_name="TestConst",
        )
        
        assert session.is_const is True
        assert session.const_name == "TestConst"
