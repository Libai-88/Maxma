"""加密模块 — 敏感配置加密存储。

Windows: 使用 DPAPI (CryptProtectData/CryptUnprotectData)
其他平台: 使用 Fernet 对称加密（密钥从机器特征派生）
"""

import base64
import hashlib
import logging
import os
import platform

from api.security.credential_envelope import (
    CredentialEnvelopeError,
    create_credential_envelope,
    decrypt_credential_envelope,
    is_credential_envelope,
    is_legacy_encrypted,
)

logger = logging.getLogger(__name__)

# 加密标记前缀 — 用于识别已加密的值
_ENCRYPTED_PREFIX = "enc:"
_ENV_FERNET_KEY = "MAXMAHERE_FERNET_KEY"
_ENV_FERNET_PREVIOUS_KEYS = "MAXMAHERE_FERNET_PREVIOUS_KEYS"


def is_encrypted(value: str) -> bool:
    """Return whether ``value`` is a legacy or current encrypted credential."""
    return is_legacy_encrypted(value) or is_credential_envelope(value)


def encrypt_value(plaintext: str) -> str:
    """Encrypt a credential in the current versioned storage envelope.

    Existing ``enc:`` values are upgraded when they can be decrypted.  An
    unreadable legacy ciphertext is deliberately left untouched so a failed
    migration cannot destroy the user's only recoverable configuration.
    """
    if not plaintext or is_credential_envelope(plaintext):
        return plaintext
    if is_legacy_encrypted(plaintext):
        legacy_value = plaintext
        plaintext = _decrypt_legacy_value(legacy_value)
        if not plaintext:
            return legacy_value
    algorithm, key_id = credential_storage_metadata()
    return create_credential_envelope(
        plaintext,
        encrypt_payload=_encrypt_legacy_value,
        algorithm=algorithm,
        key_id=key_id,
    )


def decrypt_value(ciphertext: str) -> str:
    """解密字符串。如果不是加密值，原样返回。"""
    if not ciphertext or not is_encrypted(ciphertext):
        return ciphertext
    if is_credential_envelope(ciphertext):
        algorithm, _key_id = credential_storage_metadata()
        try:
            return decrypt_credential_envelope(
                ciphertext,
                decrypt_payload=_decrypt_legacy_value,
                supported_algorithm=algorithm,
            )
        except CredentialEnvelopeError as exc:
            logger.warning("Credential envelope cannot be decrypted: %s", exc)
            return ""
    return _decrypt_legacy_value(ciphertext)


def credential_storage_metadata() -> tuple[str, str]:
    """Return non-secret backend metadata embedded in new envelopes.

    DPAPI owns its master key and supports Windows account recovery.  Fernet's
    key id is only a short fingerprint, never key material; previous Fernet
    keys may be supplied through ``MAXMAHERE_FERNET_PREVIOUS_KEYS`` during a
    controlled rotation.
    """
    if platform.system() == "Windows":
        return "dpapi-current-user", "windows-dpapi-current-user-v1"
    key = _get_machine_key()
    source = "env" if os.environ.get(_ENV_FERNET_KEY) else "machine"
    return "fernet", f"fernet-{source}-{hashlib.sha256(key).hexdigest()[:16]}"


def migrate_credential_value(value: str) -> tuple[str, str, bool]:
    """Read a credential and return ``(plaintext, stored_value, migrated)``.

    The caller owns the transaction or atomic file replacement.  No rewrite is
    proposed for a corrupt ciphertext, and a current envelope is never changed
    as a side effect of a read.
    """
    if not value:
        return value, value, False
    if is_credential_envelope(value):
        return decrypt_value(value), value, False
    if is_legacy_encrypted(value):
        plaintext = decrypt_value(value)
        if not plaintext:
            return plaintext, value, False
        return plaintext, encrypt_value(plaintext), True
    return value, encrypt_value(value), True


def _encrypt_legacy_value(plaintext: str) -> str:
    if platform.system() == "Windows":
        return _encrypt_dpapi(plaintext)
    return _encrypt_fernet(plaintext)


def _decrypt_legacy_value(ciphertext: str) -> str:
    encoded = ciphertext[len(_ENCRYPTED_PREFIX):]
    if platform.system() == "Windows":
        return _decrypt_dpapi(encoded)
    return _decrypt_fernet(encoded)


# ── Windows DPAPI ──────────────────────────────────────────

def _encrypt_dpapi(plaintext: str) -> str:
    """使用 Windows DPAPI 加密。"""
    try:
        import ctypes
        import ctypes.wintypes

        class DATA_BLOB(ctypes.Structure):
            _fields_ = [
                ("cbData", ctypes.wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_char)),
            ]

        data = plaintext.encode("utf-8")
        blob_in = DATA_BLOB(len(data), ctypes.create_string_buffer(data, len(data)))
        blob_out = DATA_BLOB()

        if ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in), "MaxmaHere", None, None, None, 0, ctypes.byref(blob_out)
        ):
            encrypted = ctypes.string_at(blob_out.pbData, blob_out.cbData)
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
            return _ENCRYPTED_PREFIX + base64.b64encode(encrypted).decode("ascii")
        else:
            raise RuntimeError("DPAPI CryptProtectData failed")
    except Exception as e:
        raise RuntimeError(f"加密失败: {e}") from e


def _decrypt_dpapi(encoded: str) -> str:
    """使用 Windows DPAPI 解密。"""
    try:
        import ctypes
        import ctypes.wintypes

        class DATA_BLOB(ctypes.Structure):
            _fields_ = [
                ("cbData", ctypes.wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_char)),
            ]

        data = base64.b64decode(encoded)
        blob_in = DATA_BLOB(len(data), ctypes.create_string_buffer(data, len(data)))
        blob_out = DATA_BLOB()

        if ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
        ):
            decrypted = ctypes.string_at(blob_out.pbData, blob_out.cbData)
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
            return decrypted.decode("utf-8")
        else:
            logger.warning("DPAPI decryption failed")
            return ""
    except Exception as e:
        logger.warning(f"DPAPI decryption error: {e}")
        return ""


# ── Fernet 回退（非 Windows）──────────────────────────────

def _get_machine_key() -> bytes:
    """从机器特征派生加密密钥。"""
    env_key = os.environ.get(_ENV_FERNET_KEY)
    if env_key:
        try:
            raw = base64.urlsafe_b64decode(env_key.encode("ascii"))
            if len(raw) == 32:
                return raw
            logger.warning("%s must decode to 32 bytes; falling back to machine key", _ENV_FERNET_KEY)
        except Exception as e:
            logger.warning("%s is invalid, falling back to machine key: %s", _ENV_FERNET_KEY, e)
    try:
        username = os.getlogin()
    except OSError:
        username = os.environ.get("USERNAME") or os.environ.get("USER") or "unknown"
    logger.warning(
        "Using machine-derived Fernet key on non-Windows platform; set %s for stable cross-session decryption",
        _ENV_FERNET_KEY,
    )
    seed = f"MaxmaHere-{platform.node()}-{username}"
    return hashlib.sha256(seed.encode()).digest()


def _get_fernet_keys() -> list[bytes]:
    """Return the active key followed by explicitly retained rotation keys."""
    keys = [_get_machine_key()]
    previous_values = os.environ.get(_ENV_FERNET_PREVIOUS_KEYS, "")
    for encoded in previous_values.split(","):
        encoded = encoded.strip()
        if not encoded:
            continue
        try:
            key = base64.urlsafe_b64decode(encoded.encode("ascii"))
        except Exception:
            logger.warning("Ignoring invalid previous Fernet key configuration")
            continue
        if len(key) != 32:
            logger.warning("Ignoring previous Fernet key with invalid length")
            continue
        if key not in keys:
            keys.append(key)
    return keys


def _encrypt_fernet(plaintext: str) -> str:
    """使用 Fernet 对称加密。"""
    try:
        from cryptography.fernet import Fernet
        key = base64.urlsafe_b64encode(_get_machine_key())
        f = Fernet(key)
        encrypted = f.encrypt(plaintext.encode("utf-8"))
        return _ENCRYPTED_PREFIX + encrypted.decode("ascii")
    except ImportError:
        raise RuntimeError("cryptography 库未安装，无法加密。请运行: pip install cryptography")
    except Exception as e:
        raise RuntimeError(f"Fernet 加密失败: {e}") from e


def _decrypt_fernet(encoded: str) -> str:
    """使用 Fernet 对称解密。"""
    try:
        from cryptography.fernet import Fernet
        for raw_key in _get_fernet_keys():
            try:
                f = Fernet(base64.urlsafe_b64encode(raw_key))
                decrypted = f.decrypt(encoded.encode("ascii"))
                return decrypted.decode("utf-8")
            except Exception:
                continue
        logger.warning("Fernet decryption failed with active and retained keys")
        return ""
    except ImportError:
        logger.warning("cryptography not installed, cannot decrypt")
        return ""
    except Exception as e:
        logger.warning(f"Fernet decryption error: {e}")
        return ""


# ── 批量加密/解密 providers.yaml ──────────────────────────

def encrypt_providers_yaml(yaml_path) -> int:
    """加密 providers.yaml 中所有 api_key 字段。返回加密的数量。"""
    import yaml

    if not yaml_path.exists():
        return 0

    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    providers = data.get("providers", [])
    count = 0
    for p in providers:
        key = p.get("api_key", "")
        if key and not is_encrypted(key):
            p["api_key"] = encrypt_value(key)
            count += 1

    if count > 0:
        with open(yaml_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

    return count


def decrypt_providers_yaml(yaml_path) -> dict:
    """读取 providers.yaml 并解密所有 api_key。返回解密后的数据。"""
    import yaml

    if not yaml_path.exists():
        return {"providers": []}

    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    providers = data.get("providers", [])
    for p in providers:
        key = p.get("api_key", "")
        if is_encrypted(key):
            p["api_key"] = decrypt_value(key)

    return data
