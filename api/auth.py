"""Token 认证管理 — 生成、加载、轮换。"""

import logging
import secrets

import yaml

from app_paths import AUTH_TOKEN_PATH, API_DATA_DIR
from api.yaml_store import dump_yaml_atomic, yaml_file_lock

logger = logging.getLogger(__name__)


def _write_token_file(token: str) -> None:
    API_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with yaml_file_lock(AUTH_TOKEN_PATH):
        dump_yaml_atomic(AUTH_TOKEN_PATH, {"token": token})


def load_or_create_token() -> str:
    """从 auth_token.yaml 加载 Token，不存在则生成并持久化。"""
    with yaml_file_lock(AUTH_TOKEN_PATH):
        if AUTH_TOKEN_PATH.exists():
            try:
                data = yaml.safe_load(AUTH_TOKEN_PATH.read_text(encoding="utf-8"))
            except yaml.YAMLError:
                logger.warning("auth_token.yaml 已损坏，重新生成 Token", exc_info=True)
            except OSError:
                logger.warning("读取 auth_token.yaml 失败，重新生成 Token", exc_info=True)
            else:
                if data and "token" in data:
                    return str(data["token"])

        token = secrets.token_urlsafe(32)
        dump_yaml_atomic(AUTH_TOKEN_PATH, {"token": token})
        return token


def rotate_token() -> str:
    """轮换 Token，覆盖写入文件并返回新值。"""
    token = secrets.token_urlsafe(32)
    _write_token_file(token)
    return token
