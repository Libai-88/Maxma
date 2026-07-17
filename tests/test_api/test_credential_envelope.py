"""测试 — api/security/credential_envelope.py 凭据封装/解封。

覆盖 create_credential_envelope / parse_credential_envelope /
decrypt_credential_envelope / is_credential_envelope / is_legacy_encrypted，
以及 CredentialEnvelopeError 异常路径与边界场景。
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import FrozenInstanceError

import pytest

from api.security.credential_envelope import (
    ENVELOPE_PREFIX,
    ENVELOPE_VERSION,
    LEGACY_PREFIX,
    CredentialEnvelope,
    CredentialEnvelopeError,
    create_credential_envelope,
    decrypt_credential_envelope,
    is_credential_envelope,
    is_legacy_encrypted,
    parse_credential_envelope,
)


def _encrypt_factory(plaintext: str, ciphertext: str = "ct") -> str:
    """模拟平台加密：返回 legacy enc: 格式。"""

    def _encrypt(payload: str) -> str:
        # 忽略 payload 内容，返回固定 ciphertext（用于稳定测试断言）
        return LEGACY_PREFIX + ciphertext

    return _encrypt


# ── 常量验证 ──────────────────────────────────────────────────────


class TestConstants:
    def test_envelope_prefix_value(self):
        assert ENVELOPE_PREFIX == "encv1:"

    def test_legacy_prefix_value(self):
        assert LEGACY_PREFIX == "enc:"

    def test_envelope_version_value(self):
        assert ENVELOPE_VERSION == 1


class TestCredentialEnvelopeError:
    def test_is_value_error_subclass(self):
        assert issubclass(CredentialEnvelopeError, ValueError)

    def test_message_preserved(self):
        err = CredentialEnvelopeError("boom")
        assert str(err) == "boom"


class TestCredentialEnvelopeDataclass:
    def test_is_frozen(self):
        env = CredentialEnvelope(1, "fernet", "kid", "ct")
        with pytest.raises(FrozenInstanceError):
            env.algorithm = "other"  # type: ignore[misc]

    def test_field_values(self):
        env = CredentialEnvelope(1, "fernet", "kid", "ct")
        assert env.version == 1
        assert env.algorithm == "fernet"
        assert env.key_id == "kid"
        assert env.ciphertext == "ct"


# ── is_credential_envelope / is_legacy_encrypted ─────────────────


class TestIsCredentialEnvelope:
    def test_true_for_envelope_prefix(self):
        assert is_credential_envelope("encv1:abc") is True

    def test_false_for_legacy_enc(self):
        assert is_credential_envelope("enc:abc") is False

    def test_false_for_plain_string(self):
        assert is_credential_envelope("plaintext") is False

    def test_false_for_empty_string(self):
        assert is_credential_envelope("") is False

    def test_false_for_non_string(self):
        assert is_credential_envelope(None) is False
        assert is_credential_envelope(123) is False
        assert is_credential_envelope(b"encv1:x") is False

    def test_false_for_prefix_only_without_colon(self):
        # "encv1" 不含 ":"，不应误判
        assert is_credential_envelope("encv1abc") is False


class TestIsLegacyEncrypted:
    def test_true_for_legacy_prefix(self):
        assert is_legacy_encrypted("enc:abc") is True

    def test_false_for_new_envelope(self):
        assert is_legacy_encrypted("encv1:abc") is False

    def test_false_for_plain_string(self):
        assert is_legacy_encrypted("plaintext") is False

    def test_false_for_empty_string(self):
        assert is_legacy_encrypted("") is False

    def test_false_for_non_string(self):
        assert is_legacy_encrypted(None) is False
        assert is_legacy_encrypted(42) is False


# ── create_credential_envelope ────────────────────────────────────


class TestCreateCredentialEnvelope:
    def test_returns_string_with_envelope_prefix(self):
        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=_encrypt_factory("secret", "ct"),
            algorithm="fernet",
            key_id="kid-1",
        )
        assert env_value.startswith(ENVELOPE_PREFIX)

    def test_payload_includes_alg_kid_v(self):
        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=_encrypt_factory("secret", "ct"),
            algorithm="fernet",
            key_id="kid-1",
        )
        encoded = env_value[len(ENVELOPE_PREFIX):]
        decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        payload = json.loads(decoded.decode("utf-8"))
        assert payload["alg"] == "fernet"
        assert payload["kid"] == "kid-1"
        assert payload["v"] == ENVELOPE_VERSION

    def test_payload_strips_legacy_prefix_from_ciphertext(self):
        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=_encrypt_factory("secret", "ct"),
            algorithm="fernet",
            key_id="kid-1",
        )
        encoded = env_value[len(ENVELOPE_PREFIX):]
        decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        payload = json.loads(decoded.decode("utf-8"))
        # encrypt_payload 返回 "enc:ct"，create 应剥离 "enc:" 前缀
        assert payload["ct"] == "ct"

    def test_raises_when_encrypt_payload_returns_non_legacy(self):
        with pytest.raises(CredentialEnvelopeError, match="did not return a ciphertext"):
            create_credential_envelope(
                "secret",
                encrypt_payload=lambda p: "raw-ct-without-prefix",
                algorithm="fernet",
                key_id="kid",
            )

    def test_raises_when_encrypt_payload_returns_empty_string(self):
        with pytest.raises(CredentialEnvelopeError):
            create_credential_envelope(
                "secret",
                encrypt_payload=lambda p: "",
                algorithm="fernet",
                key_id="kid",
            )

    def test_with_empty_plaintext(self):
        # 边界：空字符串 plaintext 也能封装
        env_value = create_credential_envelope(
            "",
            encrypt_payload=_encrypt_factory("", "ct"),
            algorithm="fernet",
            key_id="kid",
        )
        assert is_credential_envelope(env_value)

    def test_with_unicode_plaintext(self):
        # 边界：中文 + emoji
        env_value = create_credential_envelope(
            "你好🌍",
            encrypt_payload=_encrypt_factory("你好🌍", "ct"),
            algorithm="fernet",
            key_id="kid",
        )
        assert is_credential_envelope(env_value)

    def test_with_long_plaintext(self):
        # 边界：10KB 字符串
        long_str = "x" * 10240
        env_value = create_credential_envelope(
            long_str,
            encrypt_payload=_encrypt_factory(long_str, "ct"),
            algorithm="fernet",
            key_id="kid",
        )
        assert is_credential_envelope(env_value)

    def test_payload_keys_sorted(self):
        # sort_keys=True 时输出 key 顺序为 alg, ct, kid, v
        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=_encrypt_factory("secret", "ct"),
            algorithm="fernet",
            key_id="kid",
        )
        encoded = env_value[len(ENVELOPE_PREFIX):]
        decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        # JSON 字符串按 sort_keys 输出
        raw_json = decoded.decode("utf-8")
        keys = [m.group(0) for m in re.finditer(r'"(alg|ct|kid|v)":', raw_json)]
        assert keys == ['"alg":', '"ct":', '"kid":', '"v":']


# ── parse_credential_envelope ────────────────────────────────────


class TestParseCredentialEnvelope:
    def test_round_trip(self):
        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=_encrypt_factory("secret", "ct"),
            algorithm="fernet",
            key_id="kid-1",
        )
        env = parse_credential_envelope(env_value)
        assert env.version == ENVELOPE_VERSION
        assert env.algorithm == "fernet"
        assert env.key_id == "kid-1"
        assert env.ciphertext == "ct"

    def test_raises_when_not_envelope(self):
        with pytest.raises(CredentialEnvelopeError, match="not a credential envelope"):
            parse_credential_envelope("plaintext")

    def test_raises_when_invalid_base64(self):
        # 含非 base64 字符
        with pytest.raises(CredentialEnvelopeError, match="invalid credential envelope encoding"):
            parse_credential_envelope("encv1:@@@@invalid@@@@")

    def test_raises_when_payload_not_dict(self):
        # base64(JSON list)
        encoded = base64.urlsafe_b64encode(b"[1,2,3]").decode("ascii").rstrip("=")
        with pytest.raises(CredentialEnvelopeError):
            parse_credential_envelope(ENVELOPE_PREFIX + encoded)

    def test_raises_when_wrong_version(self):
        payload = {"alg": "fernet", "kid": "k", "ct": "c", "v": 99}
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload).encode("utf-8")
        ).decode("ascii").rstrip("=")
        with pytest.raises(CredentialEnvelopeError, match="unsupported credential envelope version"):
            parse_credential_envelope(ENVELOPE_PREFIX + encoded)

    def test_raises_when_missing_alg(self):
        payload = {"kid": "k", "ct": "c", "v": 1}
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload).encode("utf-8")
        ).decode("ascii").rstrip("=")
        with pytest.raises(CredentialEnvelopeError, match="invalid credential envelope fields"):
            parse_credential_envelope(ENVELOPE_PREFIX + encoded)

    def test_raises_when_missing_kid(self):
        payload = {"alg": "a", "ct": "c", "v": 1}
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload).encode("utf-8")
        ).decode("ascii").rstrip("=")
        with pytest.raises(CredentialEnvelopeError, match="invalid credential envelope fields"):
            parse_credential_envelope(ENVELOPE_PREFIX + encoded)

    def test_raises_when_missing_ct(self):
        payload = {"alg": "a", "kid": "k", "v": 1}
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload).encode("utf-8")
        ).decode("ascii").rstrip("=")
        with pytest.raises(CredentialEnvelopeError, match="invalid credential envelope fields"):
            parse_credential_envelope(ENVELOPE_PREFIX + encoded)

    def test_raises_when_empty_string_field(self):
        payload = {"alg": "", "kid": "k", "ct": "c", "v": 1}
        encoded = base64.urlsafe_b64encode(
            json.dumps(payload).encode("utf-8")
        ).decode("ascii").rstrip("=")
        with pytest.raises(CredentialEnvelopeError, match="invalid credential envelope fields"):
            parse_credential_envelope(ENVELOPE_PREFIX + encoded)

    def test_handles_missing_base64_padding(self):
        # rstrip("=") 后的 base64 也能解析
        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=_encrypt_factory("secret", "ct"),
            algorithm="fernet",
            key_id="kid",
        )
        # 移除可能的等号（确保测试无 padding 情形）
        stripped = env_value.rstrip("=")
        env = parse_credential_envelope(stripped)
        assert env.algorithm == "fernet"

    def test_raises_when_invalid_utf8_payload(self):
        # base64 编码无效 UTF-8 字节序列（0xff 0xfe 不是合法 UTF-8 起始）
        bad_bytes = b"\xff\xfe\xfd"
        encoded = base64.urlsafe_b64encode(bad_bytes).decode("ascii").rstrip("=")
        with pytest.raises(CredentialEnvelopeError, match="invalid credential envelope encoding"):
            parse_credential_envelope(ENVELOPE_PREFIX + encoded)

    def test_raises_when_invalid_json(self):
        # base64 编码非 JSON 字符串
        encoded = base64.urlsafe_b64encode(b"not-json-at-all").decode("ascii").rstrip("=")
        with pytest.raises(CredentialEnvelopeError, match="invalid credential envelope encoding"):
            parse_credential_envelope(ENVELOPE_PREFIX + encoded)


# ── decrypt_credential_envelope ──────────────────────────────────


class TestDecryptCredentialEnvelope:
    def test_round_trip(self):
        captured_payload = []

        def encrypt(p: str) -> str:
            return LEGACY_PREFIX + "ct"

        def decrypt(legacy_value: str) -> str:
            captured_payload.append(legacy_value)
            return "decrypted-value"

        env_value = create_credential_envelope(
            "secret", encrypt_payload=encrypt, algorithm="fernet", key_id="k"
        )
        result = decrypt_credential_envelope(
            env_value, decrypt_payload=decrypt, supported_algorithm="fernet"
        )
        assert result == "decrypted-value"

    def test_passes_legacy_prefixed_ciphertext_to_decrypt_payload(self):
        captured = []

        def decrypt(legacy_value: str) -> str:
            captured.append(legacy_value)
            return "plain"

        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="fernet",
            key_id="k",
        )
        decrypt_credential_envelope(
            env_value, decrypt_payload=decrypt, supported_algorithm="fernet"
        )
        # decrypt_payload 应该收到 "enc:" + ciphertext
        assert captured == [LEGACY_PREFIX + "ct"]

    def test_raises_when_algorithm_mismatch(self):
        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="fernet",
            key_id="k",
        )
        with pytest.raises(CredentialEnvelopeError, match="algorithm is unavailable"):
            decrypt_credential_envelope(
                env_value,
                decrypt_payload=lambda v: "plain",
                supported_algorithm="dpapi",
            )

    def test_returns_decrypt_payload_result(self):
        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="fernet",
            key_id="k",
        )
        result = decrypt_credential_envelope(
            env_value,
            decrypt_payload=lambda v: "raw-plaintext-result",
            supported_algorithm="fernet",
        )
        assert result == "raw-plaintext-result"

    def test_decrypt_empty_string_result(self):
        # decrypt_payload 返回空字符串也是合法返回值
        env_value = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="fernet",
            key_id="k",
        )
        result = decrypt_credential_envelope(
            env_value,
            decrypt_payload=lambda v: "",
            supported_algorithm="fernet",
        )
        assert result == ""


# ── 安全边界：create 不应将明文泄漏到 payload ────────────────────────


class TestSecurityBoundaries:
    def test_plaintext_not_leaked_into_payload(self):
        """encrypt_payload 返回的 ciphertext 应被 base64 编码，
        原始 plaintext 不应直接出现在 envelope 字符串中。"""
        plaintext = "my-super-secret-api-key-12345"
        env_value = create_credential_envelope(
            plaintext,
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct-data",
            algorithm="fernet",
            key_id="kid",
        )
        # envelope 不应直接包含 plaintext
        assert plaintext not in env_value

    def test_envelope_is_deterministic_for_same_inputs(self):
        """相同输入应产生相同输出（sort_keys + separators 稳定）。"""
        env1 = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="fernet",
            key_id="kid",
        )
        env2 = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="fernet",
            key_id="kid",
        )
        assert env1 == env2

    def test_envelope_differs_for_different_ciphertext(self):
        env1 = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct1",
            algorithm="fernet",
            key_id="kid",
        )
        env2 = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct2",
            algorithm="fernet",
            key_id="kid",
        )
        assert env1 != env2

    def test_envelope_differs_for_different_kid(self):
        env1 = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="fernet",
            key_id="kid1",
        )
        env2 = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="fernet",
            key_id="kid2",
        )
        assert env1 != env2

    def test_envelope_differs_for_different_algorithm(self):
        env1 = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="fernet",
            key_id="kid",
        )
        env2 = create_credential_envelope(
            "secret",
            encrypt_payload=lambda p: LEGACY_PREFIX + "ct",
            algorithm="dpapi",
            key_id="kid",
        )
        assert env1 != env2
