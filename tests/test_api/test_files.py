"""Tests for api/routes/files.py."""

import pytest
from fastapi import HTTPException

from api.routes.files import _is_local_runtime, select_file


class TestIsLocalRuntime:
    """Tests for _is_local_runtime()."""

    def test_default_is_local(self, monkeypatch):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        assert _is_local_runtime() is True

    def test_development_is_local(self, monkeypatch):
        monkeypatch.setenv("MAXMA_ENV", "development")
        assert _is_local_runtime() is True

    def test_production_is_not_local(self, monkeypatch):
        monkeypatch.setenv("MAXMA_ENV", "production")
        assert _is_local_runtime() is False


class TestSelectFile:
    """Tests for select_file endpoint."""

    @pytest.mark.asyncio
    async def test_blocked_in_production(self, monkeypatch):
        monkeypatch.setenv("MAXMA_ENV", "production")

        with pytest.raises(HTTPException) as exc_info:
            await select_file()

        assert exc_info.value.status_code == 403
        assert "本地开发" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_allowed_in_development(self, monkeypatch):
        monkeypatch.setenv("MAXMA_ENV", "development")

        # We don't actually open the GUI dialog; just verify it doesn't
        # raise the 403 runtime-mode error.
        try:
            await select_file()
        except HTTPException as e:
            assert e.status_code != 403
        except ImportError:
            pytest.skip("tkinter not available")
