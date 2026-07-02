"""加密模块 — 敏感配置加密存储。

Windows: 使用 DPAPI (CryptProtectData/CryptUnprotectData)
其他平台: 使用 Fernet 对称加密（密钥从机器特征派生）
"""

import base64
import hashlib
import logging
import os
import platform
import struct

logger = logging.getLogger(__name__)

# 加密标记前缀 — 用于识别已加密的值
_ENCRYPTED_PREFIX = "enc:"
_ENV_FERNET_KEY = "MAXMAHERE_FERNET_KEY"


def is_encrypted(value: str) -> bool:
    """检查值是否已加密。"""
    return isinstance(value, str) and value.startswith(_ENCRYPTED_PREFIX)


def encrypt_value(plaintext: str) -> str:
    """加密字符串，返回带前缀的密文。

    Windows: 使用 DPAPI
    其他: 使用 Fernet（密钥从机器特征派生）
    """
    if not plaintext or is_encrypted(plaintext):
        return plaintext

    if platform.system() == "Windows":
        return _encrypt_dpapi(plaintext)
    else:
        return _encrypt_fernet(plaintext)


def decrypt_value(ciphertext: str) -> str:
    """解密字符串。如果不是加密值，原样返回。"""
    if not ciphertext or not is_encrypted(ciphertext):
        return ciphertext

    encoded = ciphertext[len(_ENCRYPTED_PREFIX):]

    if platform.system() == "Windows":
        return _decrypt_dpapi(encoded)
    else:
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
        key = base64.urlsafe_b64encode(_get_machine_key())
        f = Fernet(key)
        decrypted = f.decrypt(encoded.encode("ascii"))
        return decrypted.decode("utf-8")
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
