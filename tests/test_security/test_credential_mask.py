"""凭据掩码统一层测试 — 所有离开进程边界的配置都掩码。"""
import pytest
from api.security.credential_mask import (
    mask_sensitive_fields,
    unmask_sentinels,
    is_sensitive_key,
    MASK_SENTINEL,
)


def test_masks_api_key():
    data = {"api_key": "sk-1234567890abcdef", "label": "DeepSeek"}
    masked = mask_sensitive_fields(data)
    assert masked["api_key"] == MASK_SENTINEL
    assert masked["label"] == "DeepSeek"


def test_masks_nested_env():
    data = {
        "mcpServers": {
            "server1": {"env": {"API_KEY": "secret123", "TOKEN": "tok456"}}
        }
    }
    masked = mask_sensitive_fields(data)
    env = masked["mcpServers"]["server1"]["env"]
    assert env["API_KEY"] == MASK_SENTINEL
    assert env["TOKEN"] == MASK_SENTINEL


def test_masks_token_secret_password():
    data = {
        "token": "abc",
        "secret": "def",
        "password": "ghi",
        "credential": "jkl",
        "normal_field": "untouched",
    }
    masked = mask_sensitive_fields(data)
    for key in ["token", "secret", "password", "credential"]:
        assert masked[key] == MASK_SENTINEL
    assert masked["normal_field"] == "untouched"


def test_unmask_sentinels_restores_original():
    """客户端原样发回 *** → 用现有明文回填。"""
    original = {"api_key": "sk-real-key", "label": "DeepSeek"}
    from_client = {"api_key": MASK_SENTINEL, "label": "DeepSeek-updated"}
    restored = unmask_sentinels(from_client, original)
    assert restored["api_key"] == "sk-real-key"
    assert restored["label"] == "DeepSeek-updated"


def test_unmask_sentinels_keeps_new_value():
    """客户端发回新值（非 sentinel）→ 使用新值。"""
    original = {"api_key": "sk-old-key"}
    from_client = {"api_key": "sk-new-key"}
    restored = unmask_sentinels(from_client, original)
    assert restored["api_key"] == "sk-new-key"


def test_is_sensitive_key_patterns():
    assert is_sensitive_key("api_key") is True
    assert is_sensitive_key("API_KEY") is True
    assert is_sensitive_key("token") is True
    assert is_sensitive_key("accessToken") is True
    assert is_sensitive_key("password") is True
    assert is_sensitive_key("label") is False
    assert is_sensitive_key("model_name") is False
