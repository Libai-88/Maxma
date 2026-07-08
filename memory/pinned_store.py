# memory/pinned_store.py
"""Pinned Memory 双写：markdown + json。

markdown 优先级：mtime 比较，markdown 新则覆盖 json。
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class PinnedMemoryStore:
    """固定记忆双写存储。"""

    def __init__(self, *, md_path: str | None = None, json_path: str | None = None) -> None:
        if md_path is None:
            from app_paths import DATA_DIR
            md_path = str(Path(DATA_DIR) / "pinned.md")
            json_path = str(Path(DATA_DIR) / "pinned.json")
        self._md_path = md_path
        self._json_path = json_path
        self._ensure_files()
        self._sync_from_md_if_newer()

    def _ensure_files(self) -> None:
        Path(self._md_path).parent.mkdir(parents=True, exist_ok=True)
        if not Path(self._md_path).exists():
            Path(self._md_path).write_text("# Pinned Memory\n\n", encoding="utf-8")
        if not Path(self._json_path).exists():
            self._write_json([])

    def _write_json(self, items: list[dict[str, Any]]) -> None:
        Path(self._json_path).write_text(
            json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _read_json(self) -> list[dict[str, Any]]:
        try:
            return json.loads(Path(self._json_path).read_text(encoding="utf-8"))
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _sync_from_md_if_newer(self) -> None:
        """如果 markdown 比 json 新，从 markdown 同步到 json。"""
        try:
            md_mtime = os.path.getmtime(self._md_path)
            json_mtime = os.path.getmtime(self._json_path) if Path(self._json_path).exists() else 0
        except OSError:
            return

        if md_mtime > json_mtime:
            items = self._parse_markdown()
            self._write_json(items)

    def _parse_markdown(self) -> list[dict[str, Any]]:
        """解析 markdown 为 items 列表。"""
        content = Path(self._md_path).read_text(encoding="utf-8")
        items: list[dict[str, Any]] = []
        for line in content.split('\n'):
            line = line.strip()
            if line.startswith('- '):
                text = line[2:].strip()
                items.append({
                    "id": f"pin_{uuid.uuid4().hex[:8]}",
                    "content": text,
                    "created_at": time.time(),
                })
        return items

    def add(self, content: str) -> str:
        """添加固定记忆。"""
        # 去重检查
        existing = self._read_json()
        for item in existing:
            if item.get("content") == content:
                return item["id"]

        pin_id = f"pin_{uuid.uuid4().hex[:12]}"
        now = time.time()
        new_item = {"id": pin_id, "content": content, "created_at": now}

        # 写 JSON
        existing.append(new_item)
        self._write_json(existing)

        # 写 Markdown
        md_content = Path(self._md_path).read_text(encoding="utf-8")
        if not md_content.endswith('\n'):
            md_content += '\n'
        md_content += f"- {content}\n"
        Path(self._md_path).write_text(md_content, encoding="utf-8")

        return pin_id

    def remove(self, pin_id: str) -> bool:
        """删除固定记忆。"""
        items = self._read_json()
        new_items = [i for i in items if i["id"] != pin_id]
        if len(new_items) == len(items):
            return False

        self._write_json(new_items)
        # 重写 markdown
        md_lines = ["# Pinned Memory", ""]
        for item in new_items:
            md_lines.append(f"- {item['content']}")
        md_lines.append("")
        Path(self._md_path).write_text('\n'.join(md_lines), encoding="utf-8")
        return True

    def list_all(self) -> list[dict[str, Any]]:
        """列出所有固定记忆。"""
        self._sync_from_md_if_newer()
        return self._read_json()
