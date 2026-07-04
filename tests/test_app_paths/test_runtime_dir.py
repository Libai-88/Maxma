"""Tests for RUNTIME_DIR path constants in app_paths.py."""

import sys
from pathlib import Path

import pytest

import app_paths


class TestRuntimeDir:
    def test_runtime_dir_from_env_var(self, monkeypatch):
        """打包模式: MAXMA_RESOURCES_DIR 环境变量优先。"""
        fake_resources = "C:/fake/resources"
        monkeypatch.setenv("MAXMA_RESOURCES_DIR", fake_resources)
        import importlib
        importlib.reload(app_paths)
        assert str(app_paths.RUNTIME_DIR) == str(Path(fake_resources))

    def test_runtime_dir_dev_mode_fallback(self, monkeypatch):
        """开发模式: 无环境变量时回退到 BUNDLE_DIR/../resources。"""
        monkeypatch.delenv("MAXMA_RESOURCES_DIR", raising=False)
        import importlib
        importlib.reload(app_paths)
        expected = app_paths.BUNDLE_DIR.parent / "resources"
        assert app_paths.RUNTIME_DIR == expected

    def test_node_exe_path(self, monkeypatch):
        """NODE_EXE 派生路径正确。"""
        monkeypatch.setenv("MAXMA_RESOURCES_DIR", "C:/fake/resources")
        import importlib
        importlib.reload(app_paths)
        assert app_paths.NODE_EXE == Path("C:/fake/resources/runtime/node/node.exe")

    def test_python_embed_exe_path(self, monkeypatch):
        """PYTHON_EMBED_EXE 派生路径正确。"""
        monkeypatch.setenv("MAXMA_RESOURCES_DIR", "C:/fake/resources")
        import importlib
        importlib.reload(app_paths)
        assert app_paths.PYTHON_EMBED_EXE == Path("C:/fake/resources/runtime/python/python.exe")

    def test_uv_exe_path(self, monkeypatch):
        """UV_EXE 派生路径正确。"""
        monkeypatch.setenv("MAXMA_RESOURCES_DIR", "C:/fake/resources")
        import importlib
        importlib.reload(app_paths)
        assert app_paths.UV_EXE == Path("C:/fake/resources/runtime/uv/uv.exe")

    def test_playwright_browsers_path(self, monkeypatch):
        """PLAYWRIGHT_BROWSERS_PATH 派生路径正确。"""
        monkeypatch.setenv("MAXMA_RESOURCES_DIR", "C:/fake/resources")
        import importlib
        importlib.reload(app_paths)
        assert app_paths.PLAYWRIGHT_BROWSERS_PATH == Path("C:/fake/resources/assets/playwright")

    def test_onnx_model_path(self, monkeypatch):
        """ONNX_MODEL_PATH 派生路径正确。"""
        monkeypatch.setenv("MAXMA_RESOURCES_DIR", "C:/fake/resources")
        import importlib
        importlib.reload(app_paths)
        assert app_paths.ONNX_MODEL_PATH == Path("C:/fake/resources/assets/models/paraphrase-multilingual-MiniLM-L12-v2")
