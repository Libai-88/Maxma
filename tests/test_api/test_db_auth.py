"""测试 — api/db/auth.py SQLite 认证 Token 存储。

覆盖 load_or_create_token / rotate_token，使用隔离的 tmp DB 避免污染真实数据。
"""

from __future__ import annotations

import re
import secrets
from pathlib import Path

import pytest

from api.db import auth as auth_db
from api.db.core import transaction


# ── DB 隔离 fixture ──────────────────────────────────────────────


@pytest.fixture
def isolated_db(tmp_path: Path, monkeypatch) -> Path:
    """重定向 DB_PATH 到 tmp_path，并初始化 schema（每次测试独立）。"""
    import api.db.core as db_core

    test_db = tmp_path / "test_auth.db"
    monkeypatch.setattr(db_core, "DB_PATH", test_db)
    # 重置初始化标志，让 initialize_database() 在新路径下重新建表
    monkeypatch.setattr(db_core, "_db_initialized", False)
    db_core.initialize_database()
    yield test_db


def _insert_token(token: str) -> None:
    """直接插入一行 auth_token，绕过被测代码。"""
    with transaction() as conn:
        conn.execute("INSERT INTO auth_tokens (token) VALUES (?)", (token,))


def _count_tokens() -> int:
    """查询 auth_tokens 表行数。"""
    with transaction() as conn:
        cur = conn.execute("SELECT COUNT(*) FROM auth_tokens")
        return cur.fetchone()[0]


def _all_tokens() -> list[str]:
    """查询所有 token（按 id 升序）。"""
    with transaction() as conn:
        cur = conn.execute("SELECT token FROM auth_tokens ORDER BY id ASC")
        return [row[0] for row in cur.fetchall()]


# ── load_or_create_token ─────────────────────────────────────────


class TestLoadOrCreateToken:
    def test_load_existing_token(self, isolated_db):
        """表中已有 token → 返回该值，不新增行。"""
        _insert_token("existing-token-value")
        before_count = _count_tokens()

        result = auth_db.load_or_create_token()

        assert result == "existing-token-value"
        assert _count_tokens() == before_count  # 未新增

    def test_creates_new_when_table_empty(self, isolated_db):
        """空表 → 生成新 token 并插入。"""
        assert _count_tokens() == 0

        result = auth_db.load_or_create_token()

        assert isinstance(result, str)
        assert len(result) > 0
        assert _count_tokens() == 1
        # 验证写入的内容
        assert _all_tokens() == [result]

    def test_returns_latest_when_multiple_rows(self, isolated_db):
        """多行时返回最新插入的（ORDER BY id DESC LIMIT 1）。"""
        _insert_token("old-token")
        _insert_token("middle-token")
        _insert_token("newest-token")

        result = auth_db.load_or_create_token()

        assert result == "newest-token"
        # load 不应新增行
        assert _count_tokens() == 3

    def test_new_token_is_64_char_hex(self, isolated_db):
        """空表场景下生成的新 token 应是 secrets.token_hex(32) → 64 字符 hex。"""
        result = auth_db.load_or_create_token()

        assert len(result) == 64
        # 仅含 0-9a-f
        assert re.fullmatch(r"[0-9a-f]+", result) is not None

    def test_load_after_rotate_returns_latest(self, isolated_db):
        """rotate 后 load 返回新值。"""
        first = auth_db.load_or_create_token()
        rotated = auth_db.rotate_token()
        loaded = auth_db.load_or_create_token()

        assert loaded == rotated
        assert loaded != first

    def test_idempotent_load_returns_same_value(self, isolated_db):
        """多次调用 load_or_create_token 返回相同值（无新增）。"""
        first = auth_db.load_or_create_token()
        second = auth_db.load_or_create_token()
        third = auth_db.load_or_create_token()

        assert first == second == third
        assert _count_tokens() == 1


# ── rotate_token ─────────────────────────────────────────────────


class TestRotateToken:
    def test_returns_new_token(self, isolated_db):
        """rotate 返回 64 字符 hex（secrets.token_hex(32)）。"""
        result = auth_db.rotate_token()

        assert isinstance(result, str)
        assert len(result) == 64
        assert re.fullmatch(r"[0-9a-f]+", result) is not None

    def test_inserts_new_row(self, isolated_db):
        """rotate 后表多一行。"""
        assert _count_tokens() == 0
        auth_db.rotate_token()
        assert _count_tokens() == 1

    def test_does_not_delete_old_tokens(self, isolated_db):
        """旧 token 仍在表中（rotate 是追加，不删除）。"""
        _insert_token("old-token-still-here")
        auth_db.rotate_token()

        tokens = _all_tokens()
        assert "old-token-still-here" in tokens
        assert len(tokens) == 2

    def test_rotate_creates_new_token_each_time(self, isolated_db):
        """两次 rotate 产生不同的 token（极低概率碰撞，secrets 保证）。"""
        first = auth_db.rotate_token()
        second = auth_db.rotate_token()

        assert first != second
        assert _count_tokens() == 2

    def test_rotate_differs_from_load_created(self, isolated_db):
        """load 创建后 rotate 产生不同值。"""
        loaded = auth_db.load_or_create_token()
        rotated = auth_db.rotate_token()

        assert loaded != rotated

    def test_rotate_when_table_empty(self, isolated_db):
        """表为空时 rotate 也能正常工作。"""
        assert _count_tokens() == 0
        result = auth_db.rotate_token()
        assert len(result) == 64
        assert _count_tokens() == 1

    def test_rotate_multiple_times_all_distinct(self, isolated_db):
        """连续 rotate 5 次，所有 token 互不相同。"""
        tokens = [auth_db.rotate_token() for _ in range(5)]
        assert len(set(tokens)) == 5
        assert _count_tokens() == 5


# ── Token 格式与安全边界 ─────────────────────────────────────────


class TestTokenFormatAndSecurity:
    def test_token_is_hex_no_special_chars(self, isolated_db):
        """token 仅含 [0-9a-f]，无 + / = 等特殊字符（不会破坏 URL/JSON）。"""
        token = auth_db.load_or_create_token()
        # 不应含 URL 危险字符
        for ch in "+/= \t\n\r":
            assert ch not in token

    def test_token_uses_secrets_module(self, isolated_db, monkeypatch):
        """token 来自 secrets.token_hex(32)（64 字符 hex）。
        通过替换 secrets.token_hex 验证调用链。"""
        # 注意：因为 load_or_create_token 在空表时才生成新 token，
        # 我们需要确保表为空才会调用 token_hex。
        call_count = {"n": 0}
        original_token_hex = secrets.token_hex

        def fake_token_hex(nbytes: int) -> str:
            call_count["n"] += 1
            assert nbytes == 32  # load_or_create_token 调用时传 32
            return original_token_hex(32)

        monkeypatch.setattr(secrets, "token_hex", fake_token_hex)
        auth_db.load_or_create_token()
        assert call_count["n"] == 1

    def test_rotate_uses_secrets_module(self, isolated_db, monkeypatch):
        """rotate 调用 secrets.token_hex(32)。"""
        call_count = {"n": 0}
        original_token_hex = secrets.token_hex

        def fake_token_hex(nbytes: int) -> str:
            call_count["n"] += 1
            assert nbytes == 32
            return original_token_hex(32)

        monkeypatch.setattr(secrets, "token_hex", fake_token_hex)
        auth_db.rotate_token()
        assert call_count["n"] == 1

    def test_no_plaintext_password_patterns(self, isolated_db):
        """token 不应包含常见弱密码模式。"""
        token = auth_db.load_or_create_token()
        weak_patterns = ["password", "123456", "admin", "root", "0000"]
        lower = token.lower()
        for pat in weak_patterns:
            assert pat not in lower

    def test_load_does_not_modify_existing_token(self, isolated_db):
        """load 时表中已有 token 不应被改写。"""
        _insert_token("preserved-token-value")
        auth_db.load_or_create_token()
        tokens = _all_tokens()
        assert tokens == ["preserved-token-value"]


# ── 与真实数据库交互的端到端场景 ────────────────────────────────────


class TestEndToEndScenarios:
    def test_full_lifecycle_load_then_rotate_then_load(self, isolated_db):
        """完整生命周期：load（创建）→ rotate → load（返回新）。"""
        # 1. 初始 load 创建第一个 token
        token1 = auth_db.load_or_create_token()
        assert _count_tokens() == 1

        # 2. rotate 生成新 token
        token2 = auth_db.rotate_token()
        assert token2 != token1
        assert _count_tokens() == 2

        # 3. 后续 load 返回最新（rotate 后的）
        token3 = auth_db.load_or_create_token()
        assert token3 == token2
        assert _count_tokens() == 2  # load 未新增

    def test_concurrent_rotates_all_visible(self, isolated_db):
        """连续 rotate 多次，所有 token 都应可查到。"""
        tokens = [auth_db.rotate_token() for _ in range(3)]
        all_db_tokens = _all_tokens()
        for t in tokens:
            assert t in all_db_tokens
        assert len(all_db_tokens) == 3

    def test_table_schema_uses_autoincrement_id(self, isolated_db):
        """auth_tokens 表使用 AUTOINCREMENT id（隐含 ORDER BY id DESC 取最新）。"""
        _insert_token("first")
        _insert_token("second")
        _insert_token("third")

        with transaction() as conn:
            cur = conn.execute("SELECT id, token FROM auth_tokens ORDER BY id")
            rows = cur.fetchall()
            # id 应为 1, 2, 3
            assert [r[0] for r in rows] == [1, 2, 3]
            assert [r[1] for r in rows] == ["first", "second", "third"]
