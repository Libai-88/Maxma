"""Coverage push tests for agent/persona_loader.py.

Targets previously uncovered lines:
- Line 17: return "" when both named and default template files are missing
- Line 30: return {} when both named and default frontmatter files are missing
- Line 34: return {} when file has no frontmatter match
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from agent import persona_loader as pl_mod
from agent.persona_loader import _parse_frontmatter, _read_template


def test_read_template_returns_empty_when_default_missing(tmp_path, monkeypatch):
    """Line 17: when neither the named template nor the default exists,
    _read_template returns an empty string."""
    # Point PERSONA_DIR to an empty tmp_path — no files exist
    monkeypatch.setattr(pl_mod, "PERSONA_DIR", tmp_path)

    result = _read_template("nonexistent", "identity")
    assert result == ""


def test_parse_frontmatter_returns_empty_when_default_missing(tmp_path, monkeypatch):
    """Line 30: when neither the named nor default file exists,
    _parse_frontmatter returns an empty dict."""
    monkeypatch.setattr(pl_mod, "PERSONA_DIR", tmp_path)

    result = _parse_frontmatter("nonexistent", "yuan")
    assert result == {}


def test_parse_frontmatter_returns_empty_when_no_frontmatter(tmp_path, monkeypatch):
    """Line 34: when the file exists but has no frontmatter (no --- match),
    _parse_frontmatter returns an empty dict."""
    # Create a default template file without frontmatter
    (tmp_path / "ishiki_default.md").write_text(
        "This is content without any frontmatter.\nJust plain text.",
        encoding="utf-8",
    )
    monkeypatch.setattr(pl_mod, "PERSONA_DIR", tmp_path)

    result = _parse_frontmatter("nonexistent", "ishiki")
    assert result == {}
