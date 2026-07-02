"""
认证 Token 的 SQLite 存储层 — 替代 YAML 的 load_or_create_token / rotate_token。
"""

import logging
import secrets

from api.db.core import transaction

logger = logging.getLogger(__name__)


def load_or_create_token() -> str:
    """从 SQLite 加载 Token，不存在则创建。"""
    with transaction() as db:
        row = db.execute(
            "SELECT token FROM auth_tokens ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row:
            return row["token"]
        token = secrets.token_hex(32)
        db.execute(
            "INSERT INTO auth_tokens (token) VALUES (?)", (token,)
        )
        logger.info("[auth] Created new auth token in DB")
        return token


def rotate_token() -> str:
    """生成新 Token 并存入数据库，返回新 Token。"""
    new_token = secrets.token_hex(32)
    with transaction() as db:
        db.execute("INSERT INTO auth_tokens (token) VALUES (?)", (new_token,))
    logger.info("[auth] Token rotated")
    return new_token
