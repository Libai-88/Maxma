"""安全原语层 — 凭据掩码、加密辅助。

设计参考 Halo 的 config-encryption.ts：
- 掩码始终启用（不依赖加密开关）
- 写回时用 sentinel 回填（客户端发回 *** → 用现有明文回填）
- 敏感字段显式列举 + 名称正则二级门控
"""
from api.security.credential_mask import (
    mask_sensitive_fields,
    unmask_sentinels,
    is_sensitive_key,
    MASK_SENTINEL,
)

__all__ = [
    "mask_sensitive_fields",
    "unmask_sentinels",
    "is_sensitive_key",
    "MASK_SENTINEL",
]
