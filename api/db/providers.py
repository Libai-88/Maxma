"""
Provider 配置的 SQLite 存储层 — STUB（已弃用）。

OMP ModelRegistry 管理所有 provider 配置。
此模块仅保留类型定义以兼容遗留测试导入。
"""

from typing import Any


class ProviderDbStore:
    """Provider 配置的 SQLite 存储。已弃用 — 由 OMP ModelRegistry 替代。"""

    def load_all(self) -> list:
        return []

    def get(self, provider_id: str) -> Any | None:
        return None

    def save(self, config) -> None:
        pass

    def delete(self, provider_id: str) -> bool:
        return False

    @property
    def is_empty(self) -> bool:
        return True

    def migrate_from_yaml(self) -> int:
        return 0
