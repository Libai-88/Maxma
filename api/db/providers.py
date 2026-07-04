"""
Provider 配置的 SQLite 存储层 — 替代 YAML 的 ProviderConfigStore。

渐进式迁移：启动时尝试从旧 YAML 导数据到 SQLite。
写入只走 SQLite，读取可以暂时兼容 YAML。
"""

import json
import logging
from pathlib import Path
from typing import Any

from api.db.core import transaction, row_to_dict, rows_to_dicts
from api.providers import ProviderConfig
from app_paths import PROVIDERS_YAML_PATH
from tools.crypto import decrypt_value, is_encrypted

logger = logging.getLogger(__name__)


class ProviderDbStore:
    """Provider 配置的 SQLite 存储，替换旧的 ProviderConfigStore。"""

    def load_all(self) -> list[ProviderConfig]:
        """返回所有配置（不论 enabled 与否）。"""
        with transaction() as db:
            rows = db.execute(
                "SELECT * FROM providers ORDER BY created_at"
            ).fetchall()
        return [self._row_to_config(r) for r in rows]

    def get(self, provider_id: str) -> ProviderConfig | None:
        """按 id 查找配置。"""
        with transaction() as db:
            row = db.execute(
                "SELECT * FROM providers WHERE id = ?", (provider_id,)
            ).fetchone()
        return self._row_to_config(row) if row else None

    def save(self, config: ProviderConfig) -> None:
        """新增或更新配置。"""
        models_json = json.dumps(config.models, ensure_ascii=False)
        with transaction() as db:
            db.execute(
                """INSERT INTO providers (id, provider_type, label, api_key, base_url,
                     models, enabled, context_window, priority, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, julianday('now'))
                   ON CONFLICT(id) DO UPDATE SET
                     provider_type=excluded.provider_type,
                     label=excluded.label,
                     api_key=excluded.api_key,
                     base_url=excluded.base_url,
                     models=excluded.models,
                     enabled=excluded.enabled,
                     context_window=excluded.context_window,
                     priority=excluded.priority,
                     updated_at=julianday('now')""",
                (config.id, config.provider_type, config.label,
                 config.api_key, config.base_url, models_json,
                 1 if config.enabled else 0, config.context_window,
                 config.priority),
            )

    def delete(self, provider_id: str) -> bool:
        """删除配置。返回是否实际删除了项目。"""
        with transaction() as db:
            cur = db.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
            return cur.rowcount > 0

    @property
    def is_empty(self) -> bool:
        with transaction() as db:
            row = db.execute("SELECT COUNT(*) as cnt FROM providers").fetchone()
            return row["cnt"] == 0

    def migrate_from_yaml(self) -> int:
        """从旧 YAML 文件导入已有配置。返回导入数量。"""
        if not PROVIDERS_YAML_PATH.exists():
            return 0
        try:
            import yaml
            with open(PROVIDERS_YAML_PATH, encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
            items = raw.get("providers", []) if isinstance(raw, dict) else []
            if not items:
                return 0
            count = 0
            for item in items:
                api_key = item.get("api_key", "")
                if is_encrypted(api_key):
                    api_key = decrypt_value(api_key)
                config = ProviderConfig(
                    id=item["id"],
                    provider_type=item.get("provider_type", "openai"),
                    label=item.get("label", item["id"]),
                    api_key=api_key,
                    base_url=item.get("base_url", ""),
                    models=item.get("models", []),
                    enabled=item.get("enabled", True),
                    context_window=item.get("context_window", 256000),
                    priority=item.get("priority", 0),
                )
                self.save(config)
                count += 1
            if count:
                logger.info("[provider] Migrated %d provider(s) from YAML to SQLite", count)
            return count
        except Exception as e:
            logger.warning("[provider] YAML migration failed: %s", e)
            return 0

    @staticmethod
    def _row_to_config(row: Any) -> ProviderConfig:
        models = json.loads(row["models"]) if isinstance(row["models"], str) else (row["models"] or [])
        # priority 列在 v3 迁移后存在；用 keys() 兼容旧数据库快照
        priority = row["priority"] if "priority" in row.keys() else 0
        return ProviderConfig(
            id=row["id"],
            provider_type=row["provider_type"],
            label=row["label"],
            api_key=row["api_key"],
            base_url=row["base_url"],
            models=models,
            enabled=bool(row["enabled"]),
            context_window=row["context_window"],
            priority=priority,
        )
