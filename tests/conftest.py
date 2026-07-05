"""共享 fixtures — FastAPI TestClient、认证 Token、最小测试 app。"""

import os
import sys
import warnings

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from api.middleware.auth import AuthMiddleware


def _in_venv() -> bool:
    """检测当前 Python 是否运行在虚拟环境内（venv / virtualenv / conda）。"""
    # 1. venv/virtualenv 会设置 VIRTUAL_ENV 环境变量
    if os.environ.get("VIRTUAL_ENV"):
        return True
    # 2. conda 环境会设置 CONDA_PREFIX
    if os.environ.get("CONDA_PREFIX"):
        return True
    # 3. 通用检测：sys.prefix 与 sys.base_prefix 不同（PEP 405）
    if hasattr(sys, "real_prefix") or sys.base_prefix != sys.prefix:
        return True
    # 4. 路径包含 venv 标记
    prefix_lower = sys.prefix.lower().replace("\\", "/")
    if "/.venv/" in prefix_lower or "/venv/" in prefix_lower or "/env/" in prefix_lower:
        return True
    return False


def pytest_configure(config):
    """collection 前检查解释器——非 venv 环境打印警告。

    避免 CI 阻断；本地用户看到警告后应改用 pytest.bat 或
    .venv\\Scripts\\python.exe -m pytest。
    """
    if not _in_venv():
        warnings.warn(
            "\n"
            "============================================================\n"
            "  [警告] 当前 Python 不是项目 .venv，依赖可能缺失！\n"
            "  推荐：  pytest.bat          （一键运行）\n"
            "  或：    .venv\\Scripts\\python.exe -m pytest\n"
            f"  当前解释器：{sys.executable}\n"
            "============================================================",
            stacklevel=2,
        )


@pytest.fixture
def auth_token() -> str:
    """固定测试 Token。"""
    return "test-token-123"


@pytest.fixture
def minimal_app(auth_token: str) -> FastAPI:
    """创建一个最小化的 FastAPI app 用于测试 AuthMiddleware。

    包含：
    - 一个受保护的 /api/test 路由
    - 一个白名单 /api/health 路由
    - 一个不受保护的 /open 路由
    - 一个 /ws/test 路由（WebSocket 路径受保护）
    - AuthMiddleware
    """
    app = FastAPI()

    @app.get("/api/test")
    async def test_endpoint():
        return {"status": "ok"}

    @app.get("/api/health")
    async def health():
        return {"status": "healthy"}

    @app.get("/open")
    async def open_endpoint():
        return {"status": "public"}

    @app.get("/ws/test")
    async def ws_endpoint():
        return {"status": "ws"}

    app.state.auth_token = auth_token
    app.add_middleware(AuthMiddleware)
    return app


@pytest.fixture
def client(minimal_app: FastAPI) -> TestClient:
    """Starlette TestClient 实例。"""
    return TestClient(minimal_app)
