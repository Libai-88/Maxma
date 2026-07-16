"""
ProviderManager — STUB（已弃用）。

Provider 管理已迁移至 OMP ModelRegistry（oh-my-pi Bun sidecar）。
此模块仅保留类型定义以兼容遗留测试导入。
"""

import logging

logger = logging.getLogger(__name__)


class ProviderManager:
    """Provider 管理器。已弃用 — 由 OMP ModelRegistry 替代。"""

    def __init__(self, store=None):
        self._store = store

    @property
    def count(self) -> int:
        return 0

    def load_all(self):
        pass

    def list_configs(self):
        return []

    def get_config(self, provider_id: str):
        return None

    def save_config(self, config):
        pass

    def delete_config(self, provider_id: str) -> bool:
        return False

    def get(self, provider_id: str):
        raise KeyError(provider_id)

    def get_healthy(self):
        return None

    def get_fallback(self, exclude_ids=None):
        return None

    def iter_enabled(self):
        return iter([])

    def iter_all(self):
        return iter([])

    def select_for_role(self, role):
        return None

    def get_health_status(self, provider_id: str):
        return None

    def get_failure_snapshot(self, provider_id: str):
        return 0, None

    def mark_healthy(self, provider_id: str, latency_ms: float | None = None):
        pass

    def mark_degraded(self, provider_id: str, detail: str = ""):
        pass

    def mark_unhealthy(self, provider_id: str, detail: str = ""):
        pass
