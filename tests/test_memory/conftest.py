"""pytest conftest — 跳过所有 memory 测试（memory/ 包已移除）。"""

import pytest


def pytest_ignore_collect(collection_path, config):
    """跳过整个 test_memory 目录的收集，因为 memory/ 包已被移除。"""
    return True
