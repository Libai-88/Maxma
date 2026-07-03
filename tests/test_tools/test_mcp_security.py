"""Tests for tools/mcp_security.py stdio command whitelist."""

import pytest

from tools.mcp_security import validate_stdio_command


class TestValidateStdioCommand:
    """Tests for validate_stdio_command()."""

    @pytest.mark.parametrize(
        "command",
        ["npx", "node", "python", "python3", "uvx", "NPX", "Python.exe", "uvx.exe"],
    )
    def test_whitelisted_commands_are_valid(self, command):
        assert validate_stdio_command(command) is None

    @pytest.mark.parametrize(
        "command",
        [
            "cmd.exe",
            "powershell",
            "bash",
            "sh",
            "curl",
            "wget",
            "rm",
            "del",
        ],
    )
    def test_arbitrary_commands_are_rejected(self, command):
        result = validate_stdio_command(command)
        assert result is not None
        assert "不在白名单中" in result

    @pytest.mark.parametrize(
        "command",
        [
            "./npx",
            "../node",
            "~/python",
            "C:\\Windows\\System32\\cmd.exe",
            "/usr/bin/python3",
            "node/bin/node",
        ],
    )
    def test_paths_are_rejected(self, command):
        result = validate_stdio_command(command)
        assert result is not None
        assert "路径" in result

    def test_empty_command_is_rejected(self):
        assert validate_stdio_command("") is not None
        assert validate_stdio_command(None) is not None
        assert validate_stdio_command("   ") is not None
