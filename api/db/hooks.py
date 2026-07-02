"""
事件钩子配置的 SQLite 存储层 — 替代 YAML 持久化。
"""

import json
import logging
import time

from api.db.core import transaction, row_to_dict, rows_to_dicts

logger = logging.getLogger(__name__)


class HookDbStore:
    """事件钩子配置的 SQLite 存储。"""

    def load_all(self) -> list[dict]:
        """返回所有钩子配置。"""
        with transaction() as db:
            rows = db.execute("SELECT * FROM event_hooks ORDER BY created_at").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["config"] = json.loads(d.get("config", "{}"))
            d["enabled"] = bool(d["enabled"])
            result.append(d)
        return result

    def get(self, hook_id: str) -> dict | None:
        with transaction() as db:
            row = db.execute("SELECT * FROM event_hooks WHERE hook_id = ?", (hook_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["config"] = json.loads(d.get("config", "{}"))
        d["enabled"] = bool(d["enabled"])
        return d

    def save(self, hook: dict) -> None:
        config_json = json.dumps(hook.get("config", {}), ensure_ascii=False)
        with transaction() as db:
            db.execute(
                """INSERT INTO event_hooks (hook_id, name, hook_type, config, action, status, enabled, created_at, last_triggered, trigger_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(hook_id) DO UPDATE SET
                     name=excluded.name, hook_type=excluded.hook_type,
                     config=excluded.config, action=excluded.action,
                     status=excluded.status, enabled=excluded.enabled,
                     last_triggered=excluded.last_triggered,
                     trigger_count=excluded.trigger_count""",
                (
                    hook["hook_id"], hook.get("name", ""), hook.get("hook_type", ""),
                    config_json, hook.get("action", ""),
                    hook.get("status", "active"),
                    1 if hook.get("enabled", True) else 0,
                    hook.get("created_at", time.time()),
                    hook.get("last_triggered"),
                    hook.get("trigger_count", 0),
                ),
            )

    def delete(self, hook_id: str) -> bool:
        with transaction() as db:
            cur = db.execute("DELETE FROM event_hooks WHERE hook_id = ?", (hook_id,))
            return cur.rowcount > 0
