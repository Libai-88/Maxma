"""Application-level capability policy for the Python sandbox.

This policy is intentionally small: the untrusted-code boundary supports only
pure computation.  New filesystem, network, or process capabilities must be
introduced here explicitly and then receive a separate security review.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


class SandboxCapabilityError(PermissionError):
    """Raised when code execution requests a capability outside the contract."""


@dataclass(frozen=True)
class SandboxCapabilityAllowlist:
    """Fail-closed capability allowlist for one sandbox execution boundary."""

    allowed: frozenset[str]

    def require(self, requested: Iterable[str]) -> frozenset[str]:
        requested_set = frozenset(requested)
        denied = requested_set - self.allowed
        if denied:
            names = ", ".join(sorted(denied))
            raise SandboxCapabilityError(
                f"Sandbox capability is not allowed: {names}"
            )
        return requested_set


# The Python sandbox is deliberately compute-only.  These labels describe
# enforced application-level controls, not an assertion of OS-level isolation.
PYTHON_SANDBOX_CAPABILITIES = SandboxCapabilityAllowlist(
    allowed=frozenset(
        {
            "environment.minimal",
            "filesystem.none",
            "network.none",
            "python.safe_builtins",
        }
    )
)


DEFAULT_PYTHON_SANDBOX_REQUEST = frozenset(
    {
        "environment.minimal",
        "filesystem.none",
        "network.none",
        "python.safe_builtins",
    }
)
