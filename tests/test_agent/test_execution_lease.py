# tests/test_agent/test_execution_lease.py
import pytest
import time
from agent.execution_lease import ExecutionLease, LeaseStatus, LeaseRegistry

def test_lease_lifecycle():
    """租约生命周期：issued → consumed"""
    registry = LeaseRegistry()
    lease = registry.issue(
        boundary_id="eb-1",
        session_id="sess-1",
        ttl=300,
    )
    assert lease.status == LeaseStatus.ISSUED

    consumed = registry.consume(lease.lease_id)
    assert consumed is True
    updated = registry.get(lease.lease_id)
    assert updated.status == LeaseStatus.CONSUMED

def test_lease_expiry():
    """租约过期"""
    registry = LeaseRegistry()
    lease = registry.issue(
        boundary_id="eb-1",
        session_id="sess-1",
        ttl=0,  # 立即过期
    )
    time.sleep(0.1)
    consumed = registry.consume(lease.lease_id)
    assert consumed is False
    assert registry.get(lease.lease_id).status == LeaseStatus.EXPIRED

def test_lease_revocation():
    """租约撤销"""
    registry = LeaseRegistry()
    lease = registry.issue(
        boundary_id="eb-1",
        session_id="sess-1",
        ttl=300,
    )
    assert registry.revoke(lease.lease_id) is True
    assert registry.get(lease.lease_id).status == LeaseStatus.REVOKED

def test_consume_unknown_lease():
    """消费不存在的租约"""
    registry = LeaseRegistry()
    assert registry.consume("unknown-id") is False
