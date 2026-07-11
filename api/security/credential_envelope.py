"""Versioned envelope helpers for credentials stored on disk.

The cryptographic operation remains platform-owned: Windows uses DPAPI and other
platforms use Fernet.  This module only records enough non-secret metadata to
make stored values forward-compatible and to safely distinguish the legacy
``enc:`` format from the current format.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Callable


ENVELOPE_VERSION = 1
ENVELOPE_PREFIX = "encv1:"
LEGACY_PREFIX = "enc:"


class CredentialEnvelopeError(ValueError):
    """The encrypted credential envelope is malformed or unsupported."""


@dataclass(frozen=True)
class CredentialEnvelope:
    """Non-secret metadata plus the opaque platform-encrypted payload."""

    version: int
    algorithm: str
    key_id: str
    ciphertext: str


def is_credential_envelope(value: object) -> bool:
    return isinstance(value, str) and value.startswith(ENVELOPE_PREFIX)


def is_legacy_encrypted(value: object) -> bool:
    return isinstance(value, str) and value.startswith(LEGACY_PREFIX)


def create_credential_envelope(
    plaintext: str,
    *,
    encrypt_payload: Callable[[str], str],
    algorithm: str,
    key_id: str,
) -> str:
    """Encrypt ``plaintext`` and encode a stable, versioned envelope.

    ``encrypt_payload`` returns the legacy ``enc:`` representation so existing
    DPAPI/Fernet implementations remain the sole owners of key material.
    """
    legacy_value = encrypt_payload(plaintext)
    if not is_legacy_encrypted(legacy_value):
        raise CredentialEnvelopeError("credential encryption did not return a ciphertext")

    payload = {
        "alg": algorithm,
        "ct": legacy_value[len(LEGACY_PREFIX):],
        "kid": key_id,
        "v": ENVELOPE_VERSION,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return ENVELOPE_PREFIX + encoded


def parse_credential_envelope(value: str) -> CredentialEnvelope:
    """Parse an envelope without attempting to decrypt it."""
    if not is_credential_envelope(value):
        raise CredentialEnvelopeError("not a credential envelope")

    encoded = value[len(ENVELOPE_PREFIX):]
    try:
        decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        payload = json.loads(decoded.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CredentialEnvelopeError("invalid credential envelope encoding") from exc

    if not isinstance(payload, dict) or payload.get("v") != ENVELOPE_VERSION:
        raise CredentialEnvelopeError("unsupported credential envelope version")
    algorithm = payload.get("alg")
    key_id = payload.get("kid")
    ciphertext = payload.get("ct")
    if not all(isinstance(value, str) and value for value in (algorithm, key_id, ciphertext)):
        raise CredentialEnvelopeError("invalid credential envelope fields")
    return CredentialEnvelope(ENVELOPE_VERSION, algorithm, key_id, ciphertext)


def decrypt_credential_envelope(
    value: str,
    *,
    decrypt_payload: Callable[[str], str],
    supported_algorithm: str,
) -> str:
    """Decrypt an envelope, returning an empty string on an unavailable key.

    A key-id mismatch alone is not fatal: Fernet key rotation can retain a
    previous key temporarily, while the algorithm must match the active
    platform backend to avoid misinterpreting ciphertext.
    """
    envelope = parse_credential_envelope(value)
    if envelope.algorithm != supported_algorithm:
        raise CredentialEnvelopeError("credential envelope algorithm is unavailable")
    return decrypt_payload(LEGACY_PREFIX + envelope.ciphertext)
