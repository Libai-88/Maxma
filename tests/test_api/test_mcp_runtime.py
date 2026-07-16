"""Tests for tools/mcp_runtime.py — MCP 命令解析 + 环境变量构造。"""

from pathlib import Path

import pytest

try:
    from tools.mcp_runtime import (
        build_mcp_env,
        resolve_mcp_command,
    )
except ImportError:
    build_mcp_env = None
    resolve_mcp_command = None


class TestResolveMcpCommand:
    def test_dev_mode_returns_system_path(self, monkeypatch):
        """开发模式(IS_FROZEN=False): 回退到系统 PATH 查找。"""
        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", False)
        # python 在系统 PATH 中应能找到
        result = resolve_mcp_command("python")
        assert result is not None

    def test_frozen_mode_resolves_to_runtime_dir(self, monkeypatch, tmp_path):
        """打包模式: 解析到 RUNTIME_DIR 下的绝对路径。"""
        runtime_dir = tmp_path / "resources"
        node_exe = runtime_dir / "runtime" / "node" / "node.exe"
        node_exe.parent.mkdir(parents=True)
        node_exe.touch()

        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", True)
        monkeypatch.setattr("tools.mcp_runtime.NODE_EXE", node_exe)
        result = resolve_mcp_command("node")
        assert result == str(node_exe)

    def test_frozen_mode_falls_back_when_runtime_missing(self, monkeypatch, tmp_path):
        """打包模式但运行时文件不存在: 回退到系统 PATH。"""
        nonexistent = tmp_path / "nonexistent" / "node.exe"
        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", True)
        monkeypatch.setattr("tools.mcp_runtime.NODE_EXE", nonexistent)
        result = resolve_mcp_command("node")
        # 回退到系统 PATH 查找(node 可能不存在,返回 None 或路径)
        assert result != str(nonexistent)

    def test_unknown_command_returns_input(self, monkeypatch):
        """非白名单命令: 直接返回输入(由 mcp_security 拦截)。"""
        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", True)
        result = resolve_mcp_command("malicious_command")
        assert result == "malicious_command"

    def test_npx_resolves_to_npx_cmd(self, monkeypatch, tmp_path):
        """npx 命令解析到 npx.cmd。"""
        npx_cmd = tmp_path / "runtime" / "node" / "npx.cmd"
        npx_cmd.parent.mkdir(parents=True)
        npx_cmd.touch()

        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", True)
        monkeypatch.setattr("tools.mcp_runtime.NODE_NPX_CMD", npx_cmd)
        result = resolve_mcp_command("npx")
        assert result == str(npx_cmd)

    def test_python3_alias_resolves_to_python_embed(self, monkeypatch, tmp_path):
        """python3 别名解析到 PYTHON_EMBED_EXE。"""
        py_exe = tmp_path / "runtime" / "python" / "python.exe"
        py_exe.parent.mkdir(parents=True)
        py_exe.touch()

        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", True)
        monkeypatch.setattr("tools.mcp_runtime.PYTHON_EMBED_EXE", py_exe)
        result = resolve_mcp_command("python3")
        assert result == str(py_exe)

    def test_uvx_resolves_to_uv_exe(self, monkeypatch, tmp_path):
        """uvx 命令解析到 UV_EXE。"""
        uv_exe = tmp_path / "runtime" / "uv" / "uv.exe"
        uv_exe.parent.mkdir(parents=True)
        uv_exe.touch()

        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", True)
        monkeypatch.setattr("tools.mcp_runtime.UV_EXE", uv_exe)
        result = resolve_mcp_command("uvx")
        assert result == str(uv_exe)


class TestBuildMcpEnv:
    def test_dev_mode_returns_base_env(self, monkeypatch):
        """开发模式: 不注入运行时环境变量。"""
        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", False)
        base = {"PATH": "/usr/bin", "HOME": "/home/user"}
        result = build_mcp_env(base)
        assert result == base

    def test_frozen_mode_injects_playwright_browsers_path(self, monkeypatch, tmp_path):
        """打包模式: 注入 PLAYWRIGHT_BROWSERS_PATH。"""
        pw_path = tmp_path / "playwright"
        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", True)
        monkeypatch.setattr("tools.mcp_runtime.PLAYWRIGHT_BROWSERS_PATH", pw_path)
        result = build_mcp_env({"PATH": "C:/Windows"})
        assert result["PLAYWRIGHT_BROWSERS_PATH"] == str(pw_path)

    def test_frozen_mode_prepends_runtime_to_path(self, monkeypatch, tmp_path):
        """打包模式: PATH 前置嵌入式运行时目录。"""
        node_dir = tmp_path / "runtime" / "node"
        py_dir = tmp_path / "runtime" / "python"
        uv_dir = tmp_path / "runtime" / "uv"
        for d in [node_dir, py_dir, uv_dir]:
            d.mkdir(parents=True)

        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", True)
        monkeypatch.setattr("tools.mcp_runtime.NODE_EXE", node_dir / "node.exe")
        monkeypatch.setattr("tools.mcp_runtime.PYTHON_EMBED_EXE", py_dir / "python.exe")
        monkeypatch.setattr("tools.mcp_runtime.UV_EXE", uv_dir / "uv.exe")
        monkeypatch.setattr("tools.mcp_runtime.PLAYWRIGHT_BROWSERS_PATH", tmp_path / "playwright")

        result = build_mcp_env({"PATH": "C:/Windows"})
        assert str(node_dir) in result["PATH"]
        assert str(py_dir) in result["PATH"]
        assert str(uv_dir) in result["PATH"]
        assert result["PATH"].index(str(node_dir)) < result["PATH"].index("C:/Windows")

    def test_frozen_mode_preserves_existing_env(self, monkeypatch, tmp_path):
        """打包模式: 保留用户配置的 env 变量。"""
        monkeypatch.setattr("tools.mcp_runtime.IS_FROZEN", True)
        monkeypatch.setattr("tools.mcp_runtime.PLAYWRIGHT_BROWSERS_PATH", tmp_path / "playwright")
        base = {"PATH": "C:/Windows", "MY_VAR": "my_value"}
        result = build_mcp_env(base)
        assert result["MY_VAR"] == "my_value"
