"""Focused tests for the opt-in structured artifact protocol."""

import pytest
from pydantic import ValidationError

from api.artifacts.schema import (
    ArtifactAction,
    ArtifactActionAuthorizer,
    ArtifactActionResponse,
    InteractiveArtifact,
    build_choice_artifact,
    build_confirmation_artifact,
)


def test_confirmation_artifact_has_only_allow_listed_actions():
    authorizer = ArtifactActionAuthorizer(secret=b"a" * 32)

    artifact = build_confirmation_artifact(
        session_id="session-a",
        interaction_id="interaction-a",
        title="Allow file write",
        body="This change writes one file.",
        authorizer=authorizer,
    )

    assert artifact.type == "confirmation"
    assert {action.id for action in artifact.actions} == {"approve", "reject"}
    assert all(action.token for action in artifact.actions)


def test_choice_action_token_is_session_bound_and_one_time():
    authorizer = ArtifactActionAuthorizer(secret=b"b" * 32)
    artifact = build_choice_artifact(
        session_id="session-a",
        interaction_id="interaction-a",
        title="Pick a depth",
        body="Choose one option.",
        choices=(("brief", "Brief"), ("detailed", "Detailed")),
        authorizer=authorizer,
    )
    action = artifact.actions[0]
    response = ArtifactActionResponse(
        artifact_id=artifact.id, action_id=action.id, token=action.token
    )

    authorized = authorizer.authorize(response, session_id="session-a")

    assert authorized is not None
    assert authorized.interaction_id == "interaction-a"
    assert authorizer.authorize(response, session_id="session-b") is None
    authorizer.consume(authorized)
    assert authorizer.authorize(response, session_id="session-a") is None


def test_artifact_schema_rejects_markup_unknown_fields_and_invalid_actions():
    with pytest.raises(ValidationError):
        InteractiveArtifact.model_validate(
            {
                "version": 1,
                "id": "a" * 32,
                "type": "confirmation",
                "title": "<script>alert(1)</script>",
                "body": "bad",
                "actions": [],
            }
        )

    with pytest.raises(ValidationError):
        ArtifactAction.model_validate(
            {"id": "approve", "label": "Allow", "token": "x" * 32, "script": "alert(1)"}
        )

    with pytest.raises(ValidationError):
        InteractiveArtifact.model_validate(
            {
                "version": 1,
                "id": "a" * 32,
                "type": "confirmation",
                "title": "Confirm",
                "body": "Continue?",
                "actions": [
                    {"id": "approve", "label": "Allow", "token": "x" * 32},
                    {"id": "later", "label": "Later", "token": "y" * 32},
                ],
            }
        )


def test_tampered_token_never_authorizes_an_interaction():
    authorizer = ArtifactActionAuthorizer(secret=b"c" * 32)
    artifact = build_confirmation_artifact(
        session_id="session-a",
        interaction_id="interaction-a",
        title="Confirm",
        body="Continue?",
        authorizer=authorizer,
    )
    action = artifact.actions[0]
    tampered = ArtifactActionResponse(
        artifact_id=artifact.id,
        action_id="reject",
        token=action.token,
    )

    assert authorizer.authorize(tampered, session_id="session-a") is None
