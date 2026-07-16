"""
Provider 配置的 SQLite 存储层 — 替代 YAML 的 ProviderConfigStore。

渐进式迁移：启动时尝试从旧 YAML 导数据到 SQLite。
写入只走 SQLite，读取可以暂时兼容 YAML。
"""

import json
import logging
import os
import sqlite3
from typing import Any

from api.db.core import transaction
from api.providers import ProviderConfig
from app_paths import PROVIDER_DB_CREDENTIAL_BACKUP_PATH, PROVIDERS_YAML_PATH

logger = logging.getLogger(__name__)


class ProviderDbStore:
    """Provider 配置的 SQLite 存储，替换旧的 ProviderConfigStore。"""

    def load_all(self) -> list[ProviderConfig]:
        """返回所有配置（不论 enabled 与否）。"""
        with transaction() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute(
                "SELECT * FROM providers ORDER BY created_at"
            ).fetchall()
            return self._migrate_rows_in_transaction(db, rows)

    def get(self, provider_id: str) -> ProviderConfig | None:
        """按 id 查找配置。"""
        with transaction() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM providers WHERE id = ?", (provider_id,)
            ).fetchone()
            configs = self._migrate_rows_in_transaction(db, [row] if row else [])
            return configs[0] if configs else None

    def save(self, config: ProviderConfig) -> None:
        """新增或更新配置。API Key 落盘前加密存储。"""
        models_json = json.dumps(config.models, ensure_ascii=False)
        # 加密 API Key，避免明文落盘（与 ProviderConfigStore YAML 路径保持一致）
        api_key_stored = encrypt_value(config.api_key) if config.api_key else ""
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
                 api_key_stored, config.base_url, models_json,
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
    def _create_migration_backup(db: sqlite3.Connection) -> bool:
        """Snapshot SQLite before rewriting a legacy credential format.

        This runs while the caller holds ``BEGIN IMMEDIATE``.  A failed backup
        means no migration is applied, but normal credential reads continue.
        """
        backup_path = PROVIDER_DB_CREDENTIAL_BACKUP_PATH
        if backup_path.exists():
            return True
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        db_path = db.execute("PRAGMA database_list").fetchone()[2]
        source = sqlite3.connect(db_path)
        destination = sqlite3.connect(str(backup_path))
        try:
            # ``Connection.backup`` on the active write transaction can wait
            # forever on SQLite.  A second read connection sees the last
            # committed state while BEGIN IMMEDIATE prevents another writer
            # from racing the following envelope update.
            source.backup(destination)
            try:
                os.chmod(backup_path, 0o600)
            except OSError:
                pass
            return True
        except sqlite3.Error as exc:
            logger.warning("Provider credential database migration deferred: %s", exc)
            return False
        finally:
            destination.close()
            source.close()
            if not backup_path.exists():
                try:
                    backup_path.unlink()
                except OSError:
                    pass

    def _migrate_rows_in_transaction(
        self, db: sqlite3.Connection, rows: list[Any]
    ) -> list[ProviderConfig]:
        """Return decrypted configs and rewrite old values in the same commit."""
        configs: list[ProviderConfig] = []
        rewrites: list[tuple[str, str]] = []
        for row in rows:
            api_key_raw = row["api_key"]
            api_key, stored_value, did_migrate = migrate_credential_value(api_key_raw)
            configs.append(self._row_to_config(row, api_key=api_key))
            if did_migrate:
                rewrites.append((stored_value, row["id"]))

        if rewrites:
            if self._create_migration_backup(db):
                db.executemany(
                    "UPDATE providers SET api_key = ?, updated_at = julianday('now') WHERE id = ?",
                    rewrites,
                )
                logger.info("Migrated %d provider credential envelope(s) in SQLite", len(rewrites))
            else:
                logger.warning("Provider credential migration skipped until a backup can be created")
        return configs

    @staticmethod
    def _row_to_config(row: Any, *, api_key: str | None = None) -> ProviderConfig:
        models = json.loads(row["models"]) if isinstance(row["models"], str) else (row["models"] or [])
        # priority 列在 v3 迁移后存在；用 keys() 兼容旧数据库快照
        priority = row["priority"] if "priority" in row.keys() else 0
        # 读取时解密 API Key（兼容历史明文数据：未加密则原样返回）
        if api_key is None:
            api_key_raw = row["api_key"]
            api_key = decrypt_value(api_key_raw) if is_encrypted(api_key_raw) else api_key_raw
        return ProviderConfig(
            id=row["id"],
            provider_type=row["provider_type"],
            label=row["label"],
            api_key=api_key,
            base_url=row["base_url"],
            models=models,
            enabled=bool(row["enabled"]),
            context_window=row["context_window"],
            priority=priority,
        )
