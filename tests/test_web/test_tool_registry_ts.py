"""Lightweight checks for the Vue tool bubble registry."""

from pathlib import Path


def test_ask_user_confirm_uses_ask_user_bubble():
    repo_root = Path(__file__).resolve().parents[2]
    registry = repo_root / "web" / "src" / "components" / "tools" / "registry.ts"

    content = registry.read_text(encoding="utf-8")

    assert "import AskUserBubble from './AskUserBubble.vue'" in content
    assert "'ask_user_confirm': AskUserBubble" in content
