"""测试 — api/security/credential_mask.py 凭据脱敏层。

覆盖 is_sensitive_key / mask_sensitive_fields / unmask_sentinels，
包括显式字段列表、正则模式匹配、嵌套结构递归、sentinel 回填逻辑
及安全边界场景。
"""

from __future__ import annotations

import pytest

from api.security.credential_mask import (
    MASK_SENTINEL,
    is_sensitive_key,
    mask_sensitive_fields,
    unmask_sentinels,
)


# ── 常量验证 ──────────────────────────────────────────────────────


class TestConstants:
    def test_mask_sentinel_value(self):
        assert MASK_SENTINEL == "***"


# ── is_sensitive_key ─────────────────────────────────────────────


class TestIsSensitiveKey:
    """is_sensitive_key — 显式列表 + 正则模式两级检查。"""

    # ── 显式列表匹配 ──
    @pytest.mark.parametrize(
        "field",
        [
            "api_key",
            "apikey",
            "token",
            "secret",
            "password",
            "credential",
            "credentials",
            "access_token",
            "accesstoken",
            "refresh_token",
            "refreshtoken",
            "auth_token",
            "authtoken",
            "private_key",
            "privatekey",
        ],
    )
    def test_explicit_fields_sensitive(self, field):
        assert is_sensitive_key(field) is True

    @pytest.mark.parametrize(
        "field",
        [
            "API_KEY",
            "ApiKey",
            "TOKEN",
            "Secret",
            "PASSWORD",
            "Credential",
            "CREDENTIALS",
            "Access_Token",
            "ACCESS_TOKEN",
            "REFRESH_TOKEN",
            "Auth_Token",
            "PRIVATE_KEY",
        ],
    )
    def test_explicit_fields_case_insensitive(self, field):
        """显式字段列表全小写匹配 — 大小写不敏感。"""
        assert is_sensitive_key(field) is True

    # ── 正则模式匹配 ──
    @pytest.mark.parametrize(
        "field",
        [
            "my_key",  # key 前缀 _ 后缀 end
            "api_key_id",  # key 前后都有 _
            "key",  # 单独 key
            "_key",  # 前缀 _ 后缀 end
            "key_",  # 前缀 start 后缀 _
            "auth_token_value",  # token 前后 _
            "client_secret_v2",  # secret 前后 _
            "user_password",  # password 前缀 _ 后缀 end
            "aws_credential",  # credential 前后 _
            "auth_header",  # auth 前缀 start 后缀 _
            "_auth_",  # auth 前后 _
            "x_token_y",  # token 前后 _
        ],
    )
    def test_pattern_match_sensitive(self, field):
        assert is_sensitive_key(field) is True

    # ── 非敏感字段 ──
    @pytest.mark.parametrize(
        "field",
        [
            "name",
            "label",
            "base_url",
            "enabled",
            "models",
            "created_at",
            "id",
            "provider_type",
            "context_window",
            "foo",
            "bar",
            "description",
            "status",
        ],
    )
    def test_safe_keys_not_sensitive(self, field):
        assert is_sensitive_key(field) is False

    def test_empty_string_returns_false(self):
        assert is_sensitive_key("") is False

    @pytest.mark.parametrize(
        "field",
        [
            "keyword",  # key 后跟 word，不匹配（不是 _ 或 end）
            "tokens",  # token 后跟 s，不匹配
            "secrets",  # secret 后跟 s，不匹配
            "passwords",
            "credentials_extra",  # 注意：含 _ 但 credential 后跟 s
            "authmode",  # auth 后跟 mode，不匹配
            "keychain",  # key 后跟 chain
            "tokenizer",  # token 后跟 izer
        ],
    )
    def test_partial_word_no_match(self, field):
        """词根前后必须是 _ 或字符串边界，子串不算。"""
        assert is_sensitive_key(field) is False

    def test_random_string_returns_false(self):
        assert is_sensitive_key("randomstuff") is False


# ── mask_sensitive_fields ────────────────────────────────────────


class TestMaskSensitiveFields:
    """mask_sensitive_fields — 递归脱敏。"""

    def test_simple_dict_masks_api_key(self):
        result = mask_sensitive_fields({"api_key": "sk-xxx", "name": "foo"})
        assert result == {"api_key": MASK_SENTINEL, "name": "foo"}

    def test_simple_dict_masks_token(self):
        result = mask_sensitive_fields({"token": "tok", "label": "x"})
        assert result == {"token": MASK_SENTINEL, "label": "x"}

    def test_masks_multiple_sensitive_keys(self):
        result = mask_sensitive_fields(
            {"api_key": "a", "token": "b", "secret": "c", "name": "n"}
        )
        assert result == {
            "api_key": MASK_SENTINEL,
            "token": MASK_SENTINEL,
            "secret": MASK_SENTINEL,
            "name": "n",
        }

    def test_nested_dict_recursive(self):
        result = mask_sensitive_fields(
            {"outer": {"token": "abc", "label": "x"}, "api_key": "k"}
        )
        assert result == {
            "outer": {"token": MASK_SENTINEL, "label": "x"},
            "api_key": MASK_SENTINEL,
        }

    def test_does_not_modify_original(self):
        original = {"api_key": "sk-xxx", "name": "foo"}
        mask_sensitive_fields(original)
        # 原始 dict 引用不变
        assert original == {"api_key": "sk-xxx", "name": "foo"}

    def test_none_value_preserved(self):
        """敏感字段值为 None 时不替换为 sentinel。"""
        result = mask_sensitive_fields({"api_key": None, "name": "x"})
        assert result == {"api_key": None, "name": "x"}

    def test_empty_dict_returns_empty_dict(self):
        assert mask_sensitive_fields({}) == {}

    def test_empty_list_returns_empty_list(self):
        assert mask_sensitive_fields([]) == []

    def test_list_of_dicts_recursive(self):
        result = mask_sensitive_fields(
            [{"api_key": "a"}, {"name": "b"}, {"token": "t"}]
        )
        assert result == [
            {"api_key": MASK_SENTINEL},
            {"name": "b"},
            {"token": MASK_SENTINEL},
        ]

    def test_scalar_passthrough_string(self):
        assert mask_sensitive_fields("hello") == "hello"

    def test_scalar_passthrough_int(self):
        assert mask_sensitive_fields(42) == 42

    def test_scalar_passthrough_bool(self):
        assert mask_sensitive_fields(True) is True

    def test_scalar_passthrough_none(self):
        assert mask_sensitive_fields(None) is None

    def test_nested_list_in_dict(self):
        result = mask_sensitive_fields(
            {"items": [{"token": "a"}, {"name": "b"}]}
        )
        assert result == {
            "items": [{"token": MASK_SENTINEL}, {"name": "b"}]
        }

    def test_deeply_nested_three_levels(self):
        data = {
            "level1": {
                "level2": {
                    "level3": {"secret": "deep-secret", "name": "deep-name"}
                }
            }
        }
        result = mask_sensitive_fields(data)
        assert result == {
            "level1": {
                "level2": {
                    "level3": {"secret": MASK_SENTINEL, "name": "deep-name"}
                }
            }
        }

    def test_dict_with_non_sensitive_value_being_dict(self):
        """非敏感 key 的值是 dict 时，递归处理内部。"""
        result = mask_sensitive_fields(
            {"config": {"api_key": "x", "name": "y"}}
        )
        assert result == {"config": {"api_key": MASK_SENTINEL, "name": "y"}}

    def test_sensitive_key_with_dict_value_recurses_into_dict(self):
        """敏感 key 的值是 dict 时，按当前实现会先看 is_sensitive_key，
        如果是敏感 key 且 v is not None → 直接替换为 sentinel，不递归。
        验证此行为。"""
        result = mask_sensitive_fields(
            {"api_key": {"nested": "value"}}
        )
        # api_key 是敏感 key，v 是 dict 非 None → 整个替换为 sentinel
        assert result == {"api_key": MASK_SENTINEL}

    def test_sensitive_key_with_list_value_replaced(self):
        """敏感 key 的值是 list 时，按当前实现替换为 sentinel。"""
        result = mask_sensitive_fields({"api_key": ["a", "b"]})
        assert result == {"api_key": MASK_SENTINEL}

    def test_sensitive_key_with_zero_value(self):
        """0 不是 None，应替换为 sentinel。"""
        result = mask_sensitive_fields({"api_key": 0})
        assert result == {"api_key": MASK_SENTINEL}

    def test_sensitive_key_with_empty_string(self):
        """空字符串不是 None，应替换为 sentinel。"""
        result = mask_sensitive_fields({"api_key": ""})
        assert result == {"api_key": MASK_SENTINEL}

    def test_returns_new_dict_object(self):
        """返回的 dict 与输入不是同一对象。"""
        original = {"api_key": "x"}
        result = mask_sensitive_fields(original)
        assert result is not original


# ── unmask_sentinels ─────────────────────────────────────────────


class TestUnmaskSentinels:
    """unmask_sentinels — 用明文回填客户端发回的 sentinel 值。"""

    def test_replaces_sentinel_with_original(self):
        received = {"api_key": MASK_SENTINEL, "name": "x"}
        original = {"api_key": "sk-real", "name": "x"}
        result = unmask_sentinels(received, original)
        assert result == {"api_key": "sk-real", "name": "x"}

    def test_keeps_non_sentinel_values(self):
        """received 中不是 *** 的值原样保留（即使与 original 不同）。"""
        received = {"api_key": "new-val", "name": "x"}
        original = {"api_key": "old-val", "name": "x"}
        result = unmask_sentinels(received, original)
        assert result == {"api_key": "new-val", "name": "x"}

    def test_sentinel_missing_in_original_defaults_to_empty_string(self):
        received = {"api_key": MASK_SENTINEL}
        original = {"name": "x"}  # original 中无 api_key
        result = unmask_sentinels(received, original)
        assert result == {"api_key": ""}

    def test_recurses_nested_dict(self):
        received = {"env": {"token": MASK_SENTINEL}}
        original = {"env": {"token": "real-token"}}
        result = unmask_sentinels(received, original)
        assert result == {"env": {"token": "real-token"}}

    def test_skips_nested_when_original_not_dict(self):
        """received 嵌套 dict 但 original[key] 不是 dict → 不递归，保留 received 值。"""
        received = {"env": {"token": MASK_SENTINEL}}
        original = {"env": "str-value"}
        result = unmask_sentinels(received, original)
        # received.env 是 dict 但 original.env 是 str → 不进入递归分支
        # result.env 保持为 received.env（dict 原样）
        assert result == {"env": {"token": MASK_SENTINEL}}

    def test_skips_nested_when_original_missing_key(self):
        """received 嵌套 dict 但 original 中无该 key → 不递归。"""
        received = {"env": {"token": MASK_SENTINEL}}
        original = {"other": "x"}
        result = unmask_sentinels(received, original)
        # original 中没有 env → 不递归 → result.env 保持 received 中的 dict
        assert result == {"env": {"token": MASK_SENTINEL}}

    def test_does_not_modify_received_input(self):
        """返回结果是 received 的副本，原 received 不变。"""
        received = {"api_key": MASK_SENTINEL}
        original = {"api_key": "real"}
        result = unmask_sentinels(received, original)
        assert received == {"api_key": MASK_SENTINEL}  # 原值未变
        assert result == {"api_key": "real"}
        assert result is not received

    def test_empty_received_returns_empty_dict(self):
        assert unmask_sentinels({}, {"api_key": "x"}) == {}

    def test_no_overlap_returns_received(self):
        """received 和 original 完全不同的 key → received 原样返回。"""
        received = {"a": "1", "b": "2"}
        original = {"x": "10", "y": "20"}
        result = unmask_sentinels(received, original)
        assert result == {"a": "1", "b": "2"}

    def test_only_exact_sentinel_string_replaced(self):
        """只有精确等于 '***' 的字符串才被替换。"""
        received = {
            "k1": "****",  # 4 个星
            "k2": "**",    # 2 个星
            "k3": "******",  # 6 个星
            "k4": MASK_SENTINEL,  # 精确 3 个星
            "k5": " ***",  # 含空格
        }
        original = {"k1": "v1", "k2": "v2", "k3": "v3", "k4": "v4", "k5": "v5"}
        result = unmask_sentinels(received, original)
        # 只有 k4 (精确 ***) 被替换为 original 中的明文
        assert result == {
            "k1": "****",
            "k2": "**",
            "k3": "******",
            "k4": "v4",
            "k5": " ***",
        }

    def test_mixed_sentinel_and_real_values(self):
        received = {
            "api_key": MASK_SENTINEL,
            "name": "new-name",
            "token": MASK_SENTINEL,
            "label": "new-label",
        }
        original = {
            "api_key": "real-key",
            "name": "old-name",
            "token": "real-token",
            "label": "old-label",
        }
        result = unmask_sentinels(received, original)
        assert result == {
            "api_key": "real-key",
            "name": "new-name",
            "token": "real-token",
            "label": "new-label",
        }

    def test_deeply_nested_sentinel_replacement(self):
        received = {"a": {"b": {"c": {"secret": MASK_SENTINEL}}}}
        original = {"a": {"b": {"c": {"secret": "deep-real"}}}}
        result = unmask_sentinels(received, original)
        assert result == {"a": {"b": {"c": {"secret": "deep-real"}}}}

    def test_nested_dict_partial_sentinel(self):
        """嵌套 dict 中部分字段是 sentinel，部分不是。"""
        received = {"env": {"token": MASK_SENTINEL, "name": "x"}}
        original = {"env": {"token": "real", "name": "y"}}
        result = unmask_sentinels(received, original)
        assert result == {"env": {"token": "real", "name": "x"}}


# ── 安全边界场景 ──────────────────────────────────────────────────


class TestSecurityBoundaries:
    """安全边界 — 注入尝试、畸形输入。"""

    def test_sql_injection_in_key_name_not_sensitive(self):
        """key 名含 SQL 注入但不含敏感词根 → False。"""
        key = "name; DROP TABLE users; --"
        # 该字符串不含 (key|token|...) 词根，应返回 False
        assert is_sensitive_key(key) is False

    def test_select_injection_in_key_name(self):
        key = "name; SELECT * FROM users"
        assert is_sensitive_key(key) is False

    def test_xss_attempt_in_key_name(self):
        key = "<script>alert('xss')</script>"
        assert is_sensitive_key(key) is False

    def test_path_traversal_in_value_preserved(self):
        """敏感字段的值含路径穿越字符 → 整体被 sentinel 替换，不传递。"""
        result = mask_sensitive_fields(
            {"api_key": "../../../etc/passwd"}
        )
        assert result == {"api_key": MASK_SENTINEL}

    def test_no_sql_injection_via_value(self):
        """值里的 SQL 注入字符不会影响 mask 行为。"""
        result = mask_sensitive_fields(
            {"api_key": "'; DROP TABLE users; --", "name": "'; SELECT * FROM x"}
        )
        assert result == {"api_key": MASK_SENTINEL, "name": "'; SELECT * FROM x"}

    def test_unicode_in_key_name(self):
        """中文 key 不被识别为敏感（除非匹配词根）。"""
        assert is_sensitive_key("密钥") is False
        assert is_sensitive_key("密码") is False

    def test_unicode_in_sensitive_value(self):
        """敏感值含 Unicode → 被替换为 sentinel。"""
        result = mask_sensitive_fields({"api_key": "你好-secret-🌍"})
        assert result == {"api_key": MASK_SENTINEL}

    def test_very_long_key_name(self):
        """超长 key 名 — 不应崩溃。"""
        long_key = "a" * 10000
        assert is_sensitive_key(long_key) is False

    def test_very_long_key_with_sensitive_root(self):
        """超长 key 名末尾含 _key → True。"""
        long_key = "a" * 10000 + "_key"
        assert is_sensitive_key(long_key) is True

    def test_very_long_value(self):
        """超长值 → 被替换为 sentinel。"""
        long_val = "x" * 10000
        result = mask_sensitive_fields({"api_key": long_val})
        assert result == {"api_key": MASK_SENTINEL}

    def test_dict_with_many_keys(self):
        """含大量 key 的 dict → 性能 / 正确性。"""
        data = {f"k{i}": f"v{i}" for i in range(1000)}
        data["api_key"] = "secret"
        result = mask_sensitive_fields(data)
        assert result["api_key"] == MASK_SENTINEL
        assert result["k0"] == "v0"
        assert result["k999"] == "v999"

    def test_deeply_nested_dict_no_overflow(self):
        """10 层嵌套（非敏感 key 包装）→ 不应栈溢出，最深处的 secret 应被替换。

        注意：若包装 key 本身是敏感词（如 "secret"），mask 会整体替换为
        sentinel，不会递归进入子树。所以这里用 "level" 作为包装 key，
        只在最深处放 "secret" 字段。
        """
        # 构建 10 层嵌套：{level: {level: ... {secret: "x", name: "0"}}}
        inner = {"secret": "x", "name": "0"}
        for i in range(1, 10):
            inner = {"level": inner, "name": str(i)}
        result = mask_sensitive_fields(inner)
        # 沿 level 链下钻到最深处
        cur = result
        for _ in range(9):
            cur = cur["level"]
        assert cur["secret"] == MASK_SENTINEL
        assert cur["name"] == "0"


# ── api.security 包导出验证 ──────────────────────────────────────


class TestSecurityPackageExports:
    """验证 api/security/__init__.py 正确导出子模块。"""

    def test_imports_mask_sensitive_fields(self):
        from api.security import mask_sensitive_fields as fn

        assert callable(fn)
        assert fn is mask_sensitive_fields

    def test_imports_unmask_sentinels(self):
        from api.security import unmask_sentinels as fn

        assert callable(fn)
        assert fn is unmask_sentinels

    def test_imports_is_sensitive_key(self):
        from api.security import is_sensitive_key as fn

        assert callable(fn)
        assert fn is is_sensitive_key

    def test_imports_mask_sentinel(self):
        from api.security import MASK_SENTINEL as sentinel

        assert sentinel == MASK_SENTINEL

    def test_all_list_contains_expected_names(self):
        import api.security as pkg

        assert set(pkg.__all__) == {
            "mask_sensitive_fields",
            "unmask_sentinels",
            "is_sensitive_key",
            "MASK_SENTINEL",
        }
