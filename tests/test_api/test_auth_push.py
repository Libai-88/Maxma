"""Coverage push tests for api/auth.py.

Targets previously uncovered lines:
- Lines 28-29: except OSError on AUTH_TOKEN_PATH.read_text() → regenerate token
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from api import auth as auth_mod
from api.auth import load_or_create_token


def test_load_or_create_token_oserror_on_read_regenerates(tmp_path, monkeypatch):
    """Lines 28-29: if reading auth_token.yaml raises OSError (e.g. permission
    denied), the token is regenerated and persisted."""
    # Use a temp auth token path to avoid clobbering the real one
    fake_token_path = tmp_path / "auth_token.yaml"
    fake_token_path.write_text("token: existing-token\n", encoding="utf-8")

    # Patch AUTH_TOKEN_PATH in both api.auth and app_paths modules
    monkeypatch.setattr(auth_mod, "AUTH_TOKEN_PATH", fake_token_path)
    monkeypatch.setattr("api.auth.AUTH_TOKEN_PATH", fake_token_path)

    # Also patch API_DATA_DIR to the tmp_path so dump_yaml_atomic parent dir works
    monkeypatch.setattr(auth_mod, "API_DATA_DIR", tmp_path)

    real_read_text = Path.read_text
    # Only raise OSError on the first read (inside load_or_create_token);
    # subsequent reads (for verification) should succeed.
    call_count = {"n": 0}

    def _read_text_raising_oserror_once(self, *args, **kwargs):
        if self == fake_token_path:
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise OSError("permission denied")
        return real_read_text(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", _read_text_raising_oserror_once)

    token = load_or_create_token()
    # A new token was generated (not the existing one)
    assert token != "existing-token"
    assert len(token) > 0
    # The new token was persisted
    data = yaml.safe_load(fake_token_path.read_text(encoding="utf-8"))
    assert data["token"] == token
