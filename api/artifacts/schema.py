"""Restricted UI artifact contracts.

Artifacts are data, never executable UI.  The backend can only select a
registered card type and declared action IDs; the browser renders them through
its local registry and returns a signed, session-bound action token.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ARTIFACT_VERSION = 1
MAX_ARTIFACT_BYTES = 16 * 1024
_TOKEN_TTL_SECONDS = 300
_FORBIDDEN_TEXT = ("<", ">")


def _assert_plain_text(value: str) -> str:
    if any(character in value for character in _FORBIDDEN_TEXT):
        raise ValueError("artifact text may not contain HTML markup")
    return value


class ArtifactAction(BaseModel):
    """One registered user action. Tokens are issued only by this module."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    label: str = Field(min_length=1, max_length=80)
    token: str = Field(min_length=32, max_length=1024)
    style: Literal["primary", "secondary", "danger"] = "secondary"

    @model_validator(mode="after")
    def validate_plain_text(self) -> "ArtifactAction":
        _assert_plain_text(self.label)
        return self


class InteractiveArtifact(BaseModel):
    """Versioned browser-safe artifact sent over the authenticated WebSocket."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal[ARTIFACT_VERSION] = ARTIFACT_VERSION
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    type: Literal["confirmation", "choice"]
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=4_000)
    actions: tuple[ArtifactAction, ...] = Field(min_length=2, max_length=6)

    @model_validator(mode="after")
    def validate_contract(self) -> "InteractiveArtifact":
        _assert_plain_text(self.title)
        _assert_plain_text(self.body)
        action_ids = [action.id for action in self.actions]
        if len(action_ids) != len(set(action_ids)):
            raise ValueError("artifact action IDs must be unique")
        if self.type == "confirmation" and set(action_ids) != {"approve", "reject"}:
            raise ValueError("confirmation artifacts require approve and reject actions")
        serialized = self.model_dump_json().encode("utf-8")
        if len(serialized) > MAX_ARTIFACT_BYTES:
            raise ValueError("artifact payload exceeds the size limit")
        return self


class ArtifactActionResponse(BaseModel):
    """The only client-to-server message accepted for an artifact action."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    artifact_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    action_id: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    token: str = Field(min_length=32, max_length=1024)


@dataclass(frozen=True)
class AuthorizedArtifactAction:
    artifact_id: str
    interaction_id: str
    action_id: str
    nonce: str


class ArtifactActionAuthorizer:
    """Issues short-lived, one-time action tokens without trusting the browser."""

    def __init__(self, secret: bytes | None = None) -> None:
        self._secret = secret or secrets.token_bytes(32)
        self._used_nonces: set[str] = set()

    def issue(
        self,
        *,
        artifact_id: str,
        session_id: str,
        interaction_id: str,
        action_id: str,
        now: int | None = None,
    ) -> str:
        issued_at = int(time.time() if now is None else now)
        claims = {
            "a": artifact_id,
            "s": session_id,
            "i": interaction_id,
            "x": action_id,
            "e": issued_at + _TOKEN_TTL_SECONDS,
            "n": secrets.token_urlsafe(16),
        }
        encoded = _b64encode(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode())
        signature = hmac.new(self._secret, encoded.encode(), hashlib.sha256).digest()
        return f"{encoded}.{_b64encode(signature)}"

    def authorize(
        self,
        response: ArtifactActionResponse,
        *,
        session_id: str,
        now: int | None = None,
    ) -> AuthorizedArtifactAction | None:
        try:
            encoded, provided_signature = response.token.split(".", 1)
            expected_signature = hmac.new(self._secret, encoded.encode(), hashlib.sha256).digest()
            if not hmac.compare_digest(_b64encode(expected_signature), provided_signature):
                return None
            claims = json.loads(_b64decode(encoded))
            timestamp = int(time.time() if now is None else now)
            if claims.get("e", 0) < timestamp:
                return None
            if (
                claims.get("a") != response.artifact_id
                or claims.get("s") != session_id
                or claims.get("x") != response.action_id
                or not isinstance(claims.get("i"), str)
                or not isinstance(claims.get("n"), str)
                or claims["n"] in self._used_nonces
            ):
                return None
            return AuthorizedArtifactAction(
                artifact_id=response.artifact_id,
                interaction_id=claims["i"],
                action_id=response.action_id,
                nonce=claims["n"],
            )
        except (AttributeError, TypeError, ValueError, json.JSONDecodeError):
            return None

    def consume(self, authorized: AuthorizedArtifactAction) -> None:
        self._used_nonces.add(authorized.nonce)


def build_confirmation_artifact(
    *,
    session_id: str,
    interaction_id: str,
    title: str,
    body: str,
    authorizer: ArtifactActionAuthorizer,
) -> InteractiveArtifact:
    """Build a confirmation card for an existing interaction/approval Future."""
    artifact_id = secrets.token_hex(16)
    return InteractiveArtifact(
        id=artifact_id,
        type="confirmation",
        title=title,
        body=body,
        actions=(
            ArtifactAction(
                id="approve",
                label="允许执行",
                style="primary",
                token=authorizer.issue(
                    artifact_id=artifact_id,
                    session_id=session_id,
                    interaction_id=interaction_id,
                    action_id="approve",
                ),
            ),
            ArtifactAction(
                id="reject",
                label="拒绝",
                style="danger",
                token=authorizer.issue(
                    artifact_id=artifact_id,
                    session_id=session_id,
                    interaction_id=interaction_id,
                    action_id="reject",
                ),
            ),
        ),
    )


def build_choice_artifact(
    *,
    session_id: str,
    interaction_id: str,
    title: str,
    body: str,
    choices: tuple[tuple[str, str], ...],
    authorizer: ArtifactActionAuthorizer,
) -> InteractiveArtifact:
    """Build the initial non-destructive interactive card from declared choices."""
    artifact_id = secrets.token_hex(16)
    actions = tuple(
        ArtifactAction(
            id=choice_id,
            label=label,
            style="primary" if index == 0 else "secondary",
            token=authorizer.issue(
                artifact_id=artifact_id,
                session_id=session_id,
                interaction_id=interaction_id,
                action_id=choice_id,
            ),
        )
        for index, (choice_id, label) in enumerate(choices)
    )
    return InteractiveArtifact(
        id=artifact_id,
        type="choice",
        title=title,
        body=body,
        actions=actions,
    )


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> str:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode("utf-8")


artifact_action_authorizer = ArtifactActionAuthorizer()
