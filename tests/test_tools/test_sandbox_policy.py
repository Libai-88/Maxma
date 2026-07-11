"""Focused tests for the application-level Python sandbox capability contract."""

import pytest

from tools.system.sandbox_policy import (
    DEFAULT_PYTHON_SANDBOX_REQUEST,
    PYTHON_SANDBOX_CAPABILITIES,
    SandboxCapabilityError,
)


def test_default_python_sandbox_capabilities_are_explicitly_allowed():
    assert (
        PYTHON_SANDBOX_CAPABILITIES.require(DEFAULT_PYTHON_SANDBOX_REQUEST)
        == DEFAULT_PYTHON_SANDBOX_REQUEST
    )


@pytest.mark.parametrize("capability", ["filesystem.write", "network.http", "process.spawn"])
def test_unexpected_capability_is_denied_by_default(capability):
    with pytest.raises(SandboxCapabilityError):
        PYTHON_SANDBOX_CAPABILITIES.require({capability})
