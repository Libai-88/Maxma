"""Default-off access to FactStore's exact supplementary retrieval.

The retriever is wired as a separately named ``facts`` layer in
``MemoryCoordinator``. It never replaces the existing Chroma/keyword semantic
path, and must be explicitly enabled by the application feature flag.
"""
from __future__ import annotations

from typing import Any

from memory.fact_store import FactStore


class SupplementaryFactRetriever:
    """Expose FactStore search only when the caller explicitly enables it."""

    def __init__(self, store: FactStore, *, enabled: bool = False) -> None:
        self._store = store
        self._enabled = enabled

    @property
    def enabled(self) -> bool:
        return self._enabled

    def retrieve(
        self,
        query: str,
        *,
        limit: int = 5,
        session_id: str | None = None,
        tags: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Return FTS and tag candidates, or no results while the feature is off."""
        if not self._enabled or not query.strip() or limit < 1:
            return []

        # Preserve the FTS ranking (bm25, then stable timestamp/id) for text
        # matches. Exact-tag-only candidates follow it in their own stable
        # order, so adding tags cannot make a weaker tag match outrank text.
        candidates = self._store.search(query, limit=limit, session_id=session_id)
        seen = {item["id"] for item in candidates}
        tag_candidates: list[dict[str, Any]] = []
        for tag in tags or []:
            for item in self._store.search_by_tag(
                tag, limit=limit, session_id=session_id
            ):
                if item["id"] not in seen:
                    tag_candidates.append(item)
                    seen.add(item["id"])

        tag_candidates.sort(key=lambda item: (-item["created_at"], item["id"]))
        return [*candidates, *tag_candidates][:limit]

    def purge_expired(self) -> int:
        """Purge expired supplementary facts without exposing the backing store."""
        if not self._enabled:
            return 0
        return self._store.purge_expired()
