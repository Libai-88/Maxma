"""覆盖 — api/routes/persona.py 防御性分支（lines 73, 92）。"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from api.routes import persona


@pytest.fixture
def persona_dir(monkeypatch, tmp_path: Path) -> Path:
    monkeypatch.setattr(persona, "PERSONAS_DIR", tmp_path)
    (tmp_path / "SOUL.md").write_text("default", encoding="utf-8")
    return tmp_path


class TestGetPersonaVariantPathTraversal:
    async def test_rejects_non_relative_path(self, persona_dir: Path, monkeypatch):
        r"""Line 73: is_relative_to 返回 False 时抛 400。

        正则 ^SOUL\.[\w\u4e00-\u9fff\-]+\.md$ 不允许 / 或 ..，
        所以 is_relative_to 检查在正常输入下永不为 False。
        通过 monkeypatch 模拟该防御性分支。
        """
        (persona_dir / "SOUL.test.md").write_text("x", encoding="utf-8")
        target_resolved = (persona_dir / "SOUL.test.md").resolve()
        original = Path.is_relative_to

        def fake_is_relative_to(self, other):
            if self == target_resolved:
                return False
            return original(self, other)

        monkeypatch.setattr(Path, "is_relative_to", fake_is_relative_to)
        with pytest.raises(HTTPException) as exc:
            persona._get_persona_variant_path("SOUL.test.md")
        assert exc.value.status_code == 400
        assert "非法路径" in exc.value.detail


class TestWriteTextAtomicallyCleanup:
    async def test_cleans_temp_file_when_replace_fails(
        self, persona_dir: Path, monkeypatch
    ):
        """Line 92: os.replace 失败时 finally 清理临时文件。"""
        target = persona_dir / "SOUL.cleanup.md"

        def fail_replace(*_args, **_kwargs):
            raise OSError("replace failed")

        monkeypatch.setattr(os, "replace", fail_replace)
        with pytest.raises(OSError):
            persona._write_text_atomically(target, "content")
        # 临时文件应被清理
        tmp_files = list(persona_dir.glob(".*.tmp"))
        assert tmp_files == []
