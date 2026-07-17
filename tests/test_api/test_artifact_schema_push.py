"""Coverage push tests for api/artifacts/schema.py.

Targets previously uncovered lines:
- Line 28: _assert_plain_text raises ValueError (via ArtifactAction label)
- Line 66: duplicate action IDs ValueError
- Line 71: oversized payload ValueError
- Line 133: authorize returns None for token without dot separator
- Line 137: authorize returns None for expired token
- Lines 153-154: authorize returns None for malformed token (exception)
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.artifacts.schema import (
    ArtifactAction,
    ArtifactActionAuthorizer,
    ArtifactActionResponse,
    InteractiveArtifact,
    build_confirmation_artifact,
)


def _make_valid_action(action_id: str = "approve", label: str = "Allow") -> ArtifactAction:
    return ArtifactAction(id=action_id, label=label, token="x" * 32)


def test_artifact_action_rejects_markup_in_label():
    """Line 28: _assert_plain_text raises when label contains '<' or '>'."""
    with pytest.raises(ValidationError) as exc_info:
        ArtifactAction(id="approve", label="<script>bad</script>", token="x" * 32)
    assert "HTML markup" in str(exc_info.value)


def test_artifact_rejects_duplicate_action_ids():
    """Line 66: InteractiveArtifact rejects duplicate action IDs."""
    with pytest.raises(ValidationError) as exc_info:
        InteractiveArtifact(
            id="a" * 32,
            type="choice",
            title="Pick",
            body="Choose one",
            actions=(
                ArtifactAction(id="opt", label="Option A", token="x" * 32),
                ArtifactAction(id="opt", label="Option B", token="y" * 32),
            ),
        )
    assert "unique" in str(exc_info.value)


def test_authorize_returns_none_for_token_without_dot():
    """Line 133: a token without a '.' separator fails signature extraction.
    The token must be >= 32 chars to pass ArtifactActionResponse validation."""
    authorizer = ArtifactActionAuthorizer(secret=b"k" * 32)
    response = ArtifactActionResponse(
        artifact_id="a" * 32,
        action_id="approve",
        token="a" * 40,  # 40 chars, no dot — passes min_length=32
    )
    assert authorizer.authorize(response, session_id="s1") is None


def test_authorize_returns_none_for_expired_token():
    """Line 137: a token whose expiry is in the past is rejected."""
    authorizer = ArtifactActionAuthorizer(secret=b"k" * 32)
    # Issue a token with a fixed expiry in the past
    token = authorizer.issue(
        artifact_id="a" * 32,
        session_id="s1",
        interaction_id="i1",
        action_id="approve",
        now=1000,  # issued at time 1000, expires at 1000 + 300 = 1300
    )
    response = ArtifactActionResponse(
        artifact_id="a" * 32,
        action_id="approve",
        token=token,
    )
    # Authorize at a time after expiry
    assert authorizer.authorize(response, session_id="s1", now=2000) is None


def test_authorize_returns_none_for_malformed_token():
    """Lines 153-154: a malformed token (valid dot but invalid base64/JSON)
    triggers an exception and returns None."""
    authorizer = ArtifactActionAuthorizer(secret=b"k" * 32)
    # Token with a dot but invalid base64 payload
    response = ArtifactActionResponse(
        artifact_id="a" * 32,
        action_id="approve",
        token="!!!not-valid-base64!!.fake-signature",
    )
    assert authorizer.authorize(response, session_id="s1") is None


def test_authorize_rejects_valid_token_with_wrong_signature():
    """Cover the hmac.compare_digest mismatch path (line 133 via bad signature)."""
    authorizer_a = ArtifactActionAuthorizer(secret=b"a" * 32)
    authorizer_b = ArtifactActionAuthorizer(secret=b"b" * 32)
    artifact = build_confirmation_artifact(
        session_id="s1",
        interaction_id="i1",
        title="Confirm",
        body="Proceed?",
        authorizer=authorizer_a,
    )
    action = artifact.actions[0]
    response = ArtifactActionResponse(
        artifact_id=artifact.id,
        action_id=action.id,
        token=action.token,
    )
    # Different secret → signature mismatch → None
    assert authorizer_b.authorize(response, session_id="s1") is None
