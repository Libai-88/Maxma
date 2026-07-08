# agent/execution_lease.py
"""执行租约状态机。

租约是一次 Agent 执行的"授权凭证"：
- issued: 已签发，待使用
- consumed: 已使用（工具已执行）
- expired: 过期未使用
- revoked: 被撤销

TTL 默认 5 分钟，超时自动过期。
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass
from enum import Enum
from typing import Any


class LeaseStatus(Enum):
    ISSUED = "issued"
    CONSUMED = "consumed"
    EXPIRED = "expired"
    REVOKED = "revoked"


@dataclass
class ExecutionLease:
    """执行租约。"""
    lease_id: str
    boundary_id: str
    session_id: str
    status: LeaseStatus
    issued_at: float
    expires_at: float
    consumed_at: float | None = None

    def is_valid(self) -> bool:
        """检查租约是否有效（未过期、未消费、未撤销）。"""
        if self.status != LeaseStatus.ISSUED:
            return False
        if time.time() > self.expires_at:
            return False
        return True

    def to_dict(self) -> dict[str, Any]:
        return {
            "lease_id": self.lease_id,
            "boundary_id": self.boundary_id,
            "session_id": self.session_id,
            "status": self.status.value,
            "issued_at": self.issued_at,
            "expires_at": self.expires_at,
            "consumed_at": self.consumed_at,
        }


class LeaseRegistry:
    """租约注册表（内存版，线程安全）。"""

    def __init__(self) -> None:
        self._leases: dict[str, ExecutionLease] = {}
        self._lock = threading.Lock()

    def issue(self, *, boundary_id: str, session_id: str, ttl: int = 300) -> ExecutionLease:
        """签发租约。"""
        now = time.time()
        lease = ExecutionLease(
            lease_id=f"lease-{uuid.uuid4().hex[:12]}",
            boundary_id=boundary_id,
            session_id=session_id,
            status=LeaseStatus.ISSUED,
            issued_at=now,
            expires_at=now + ttl,
        )
        with self._lock:
            self._leases[lease.lease_id] = lease
        return lease

    def consume(self, lease_id: str) -> bool:
        """消费租约（标记为已使用）。"""
        with self._lock:
            lease = self._leases.get(lease_id)
            if lease is None:
                return False
            if not lease.is_valid():
                if lease.status == LeaseStatus.ISSUED and time.time() > lease.expires_at:
                    lease.status = LeaseStatus.EXPIRED
                return False
            lease.status = LeaseStatus.CONSUMED
            lease.consumed_at = time.time()
            return True

    def revoke(self, lease_id: str) -> bool:
        """撤销租约。"""
        with self._lock:
            lease = self._leases.get(lease_id)
            if lease is None:
                return False
            lease.status = LeaseStatus.REVOKED
            return True

    def get(self, lease_id: str) -> ExecutionLease | None:
        """获取租约。"""
        with self._lock:
            lease = self._leases.get(lease_id)
            if lease and lease.status == LeaseStatus.ISSUED and time.time() > lease.expires_at:
                lease.status = LeaseStatus.EXPIRED
            return lease

    def cleanup_expired(self) -> int:
        """清理过期租约，返回清理数量。"""
        now = time.time()
        with self._lock:
            expired_ids = [
                lid for lid, lease in self._leases.items()
                if lease.status == LeaseStatus.ISSUED and now > lease.expires_at
            ]
            for lid in expired_ids:
                self._leases[lid].status = LeaseStatus.EXPIRED
            return len(expired_ids)
