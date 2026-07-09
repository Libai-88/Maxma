"""凭据掩码统一层 — 所有离开进程边界的配置都掩码。

设计原则（参考 Halo config-encryption.ts）：
1. 掩码始终启用：不依赖加密开关，所有经过 IPC/HTTP 输出的配置都掩码
2. 写回时 sentinel 回填：客户端原样发回 *** → 用现有明文回填，避免误存空值
3. 敏感字段显式列举 + 名称正则二级门控（应对动态 map 如 mcpServers.*.env）

与现有 ProviderConfig.to_dict() 的关系：
- to_dict() 已做 api_key 脱敏，本模块是更通用的统一层
- 逐步迁移各处序列化逻辑到本模块
"""
from __future__ import annotations

import re
from typing import Any, Dict

# 掩码哨兵值 — 客户端发回此值表示"未修改"
MASK_SENTINEL = "***"

# 显式敏感字段名（全小写匹配）
_EXPLICIT_SENSITIVE_FIELDS: frozenset[str] = frozenset({
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
})

# 二级正则：动态 map 的 key 名匹配（如 mcpServers.*.env 里的 KEY/TOKEN）
_SENSITIVE_KEY_PATTERN = re.compile(
    r"(?:^|_)(key|token|secret|password|credential|auth)(?:$|_)",
    re.IGNORECASE,
)


def is_sensitive_key(key: str) -> bool:
    """判断字段名是否敏感。

    两级检查：
    1. 显式列表匹配（全小写）
    2. 名称正则匹配（key/token/secret/password/credential/auth 词根）
    """
    if not key:
        return False
    lower = key.lower()
    if lower in _EXPLICIT_SENSITIVE_FIELDS:
        return True
    return bool(_SENSITIVE_KEY_PATTERN.search(key))


def mask_sensitive_fields(data: Any) -> Any:
    """递归掩码所有敏感字段。

    遍历 dict 的所有 key，对敏感 key 的值替换为 MASK_SENTINEL。
    递归处理嵌套 dict 和 dict 值。

    Args:
        data: 任意数据（dict/list/scalar）

    Returns:
        掩码后的数据（深拷贝，不修改原数据）
    """
    if isinstance(data, dict):
        result: Dict[str, Any] = {}
        for k, v in data.items():
            if is_sensitive_key(k) and v:
                result[k] = MASK_SENTINEL
            else:
                result[k] = mask_sensitive_fields(v)
        return result
    if isinstance(data, list):
        return [mask_sensitive_fields(item) for item in data]
    return data


def unmask_sentinels(
    received: dict,
    original: dict,
) -> dict:
    """用现有明文回填客户端发回的 sentinel 值。

    场景：前端表单加载时拿到掩码值 ***，提交时原样发回。
    如果直接存储会把 *** 当成新密钥存入，导致凭据丢失。
    本函数检测 sentinel 值并用 original 中的明文回填。

    Args:
        received: 客户端发回的数据（可能含 ***）
        original: 服务端已有的原始数据（明文）

    Returns:
        回填后的数据（received 的副本，sentinel 被替换为明文）
    """
    result = dict(received)
    for key, value in result.items():
        if value == MASK_SENTINEL:
            # 用原始明文回填
            result[key] = original.get(key, "")
        elif isinstance(value, dict) and key in original and isinstance(original[key], dict):
            # 递归处理嵌套 dict（如 mcpServers.server1.env）
            result[key] = unmask_sentinels(value, original[key])
    return result
