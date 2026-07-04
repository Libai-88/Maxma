# 生产打包实现计划:完全自包含 Windows 安装包

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 dev 模式打包链路升级为完全自包含的生产打包,用户双击 NSIS 安装包后无需安装任何额外运行时即可使用全部功能(Agent 对话、工具调用、RAG、Playwright、MCP)。

**Architecture:** 分层打包 — PyInstaller onefile exe 保持精简(~210MB),嵌入式运行时(Node.js + Python embeddable + uv)和资源(Playwright Chromium + ONNX 模型)作为 Tauri resources 打包到 NSIS 安装包。新增第三层路径 `RUNTIME_DIR`,通过 `MAXMA_RESOURCES_DIR` 环境变量从 Tauri main.rs 注入到 Python 后端。

**Tech Stack:** PyInstaller / Tauri 2 / NSIS / PowerShell / Python embeddable / Node.js win-x64 zip / uv / Playwright / HuggingFace Hub

**设计文档:** [docs/production-packaging-design.md](file:///d:/Maxma/MaxmaHere/docs/production-packaging-design.md)

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `app_paths.py` 新增 `RUNTIME_DIR` 段 | 第三层路径常量(嵌入式运行时绝对路径) |
| `tools/mcp_runtime.py` | MCP 命令解析层 + 子进程环境变量构造 |
| `api/routes/mcp_test.py` | `POST /api/mcp/test-connection` 接口 |
| `build/prepare-runtime.ps1` | 下载 Node.js + Python embeddable + uv |
| `build/prepare-assets.ps1` | 下载 Playwright Chromium + ONNX 模型 |
| `tests/test_api/test_mcp_runtime.py` | mcp_runtime 单元测试 |
| `tests/test_api/test_mcp_test_route.py` | test-connection 接口测试 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `tools/mcp.py` | `StdioServerConfig.to_connection()` 调用 `resolve_mcp_command()` + `build_mcp_env()` |
| `tools/network/playwright_tools/browser_manager.py` | `chromium.launch()` 前设置 `PLAYWRIGHT_BROWSERS_PATH` 环境变量 |
| `memory/rag/embedding.py` | `_ensure_model()` 优先用 `ONNX_MODEL_PATH`(打包模式) |
| `config/settings.py` | `embedding_model_local_path` 默认值改为打包路径 |
| `desktop/src-tauri/src/main.rs` | `spawn_sidecar_with_monitor()` 注入 `MAXMA_RESOURCES_DIR` |
| `desktop/src-tauri/tauri.conf.json` | `bundle.resources` 新增 `runtime/**` + `assets/**`,`publisher` 字段 |
| `desktop/src-tauri/Cargo.toml` | 无需改动(已有 shell 插件) |
| `build/build-desktop.bat` | 流程中加入 prepare-runtime 和 prepare-assets 步骤 |
| `.gitignore` | 新增 `desktop/src-tauri/resources/runtime/` 和 `assets/` |
| `web/src/views/McpView.vue` | 新增"测试连接"按钮 + 调用逻辑 |
| `web/src/api/index.ts`(或对应文件) | 新增 `testMcpConnection()` API 函数 |

---

## Task 1: app_paths.py 新增 RUNTIME_DIR 路径常量

**Files:**
- Modify: `app_paths.py:48-91`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_app_paths/test_runtime_dir.py`:

```python
"""Tests for RUNTIME_DIR path constants in app_paths.py."""

import os
import sys
from pathlib import Path
from unittest import mock

import app_paths


class TestRuntimeDir:
    def test_runtime_dir_from_env_var(self, monkeypatch):
        """打包模式: MAXMA_RESOURCES_DIR 环境变量优先。"""
        fake_resources = "C:/fake/resources"
        monkeypatch.setenv("MAXMA_RESOURCES_DIR", fake_resources)
        # 重新加载模块以读取环境变量
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv\Scripts\python.exe -m pytest tests/test_app_paths/test_runtime_dir.py -v`
Expected: FAIL with `AttributeError: module 'app_paths' has no attribute 'RUNTIME_DIR'`

- [ ] **Step 3: 实现 RUNTIME_DIR**

在 `app_paths.py` 第 91 行 `PROJECT_ROOT` 之后、`ensure_data_dirs()` 之前插入:

```python
# ── 运行时资源目录（嵌入式运行时 + 大文件） ──
# 打包模式: Tauri 安装目录下的 resources/ 目录（由 main.rs 通过 MAXMA_RESOURCES_DIR 注入）
# 开发模式: BUNDLE_DIR/../resources/（便于调试，目录不存在时不影响功能）
RUNTIME_DIR: Path = Path(os.environ.get("MAXMA_RESOURCES_DIR") or (BUNDLE_DIR.parent / "resources"))

# 嵌入式运行时二进制路径
NODE_EXE = RUNTIME_DIR / "runtime" / "node" / "node.exe"
NODE_NPX_CMD = RUNTIME_DIR / "runtime" / "node" / "npx.cmd"
PYTHON_EMBED_EXE = RUNTIME_DIR / "runtime" / "python" / "python.exe"
UV_EXE = RUNTIME_DIR / "runtime" / "uv" / "uv.exe"

# 资源层路径
PLAYWRIGHT_BROWSERS_PATH = RUNTIME_DIR / "assets" / "playwright"
ONNX_MODEL_PATH = RUNTIME_DIR / "assets" / "models" / "paraphrase-multilingual-MiniLM-L12-v2"
```

- [ ] **Step 4: 运行测试确认通过**

Run: `.venv\Scripts\python.exe -m pytest tests/test_app_paths/test_runtime_dir.py -v`
Expected: PASS (7 个测试)

- [ ] **Step 5: 提交**

```bash
git add app_paths.py tests/test_app_paths/test_runtime_dir.py
git commit -m "feat(app_paths): 新增 RUNTIME_DIR 路径常量支持嵌入式运行时"
```

---

## Task 2: tools/mcp_runtime.py MCP 命令解析层

**Files:**
- Create: `tools/mcp_runtime.py`
- Test: `tests/test_api/test_mcp_runtime.py`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_api/test_mcp_runtime.py`:

```python
"""Tests for tools/mcp_runtime.py — MCP 命令解析 + 环境变量构造。"""

import os
from pathlib import Path
from unittest import mock

import pytest

from tools.mcp_runtime import (
    build_mcp_env,
    resolve_mcp_command,
)


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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_runtime.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tools.mcp_runtime'`

- [ ] **Step 3: 实现 mcp_runtime.py**

创建 `tools/mcp_runtime.py`:

```python
"""MCP 运行时命令解析 — 把白名单命令解析到嵌入式运行时绝对路径。

打包模式下，用户机器可能没有 Node.js / Python / uv，
本模块负责把 MCP 配置中的命令名（如 "npx"）解析到 RUNTIME_DIR 下的绝对路径，
并构造子进程环境变量（PLAYWRIGHT_BROWSERS_PATH、PATH 前置等）。

开发模式下回退到系统 PATH 查找，保持开发体验。
"""

import logging
import shutil
from pathlib import Path

from app_paths import (
    BUNDLE_DIR,
    NODE_EXE,
    NODE_NPX_CMD,
    PLAYWRIGHT_BROWSERS_PATH,
    PYTHON_EMBED_EXE,
    RUNTIME_DIR,
    UV_EXE,
    _is_frozen,
)

logger = logging.getLogger(__name__)

# PyInstaller 打包模式标志
IS_FROZEN: bool = _is_frozen()

# 命令名 → 嵌入式运行时绝对路径的映射
_RUNTIME_MAP: dict[str, Path] = {
    "node": NODE_EXE,
    "npx": NODE_NPX_CMD,
    "python": PYTHON_EMBED_EXE,
    "python3": PYTHON_EMBED_EXE,
    "uvx": UV_EXE,
}


def resolve_mcp_command(command: str) -> str:
    """把 MCP 配置中的命令名解析为嵌入式运行时的绝对路径。

    打包模式：优先使用 RUNTIME_DIR 下的二进制
    开发模式：回退到系统 PATH 查找（保持开发体验）

    Args:
        command: 用户配置的命令名（如 "npx" / "node" / "python"）

    Returns:
        解析后的命令路径（绝对路径或系统 PATH 查找结果）
    """
    if not command:
        return command

    if IS_FROZEN and command in _RUNTIME_MAP:
        resolved = _RUNTIME_MAP[command]
        if resolved.exists():
            return str(resolved)
        # 运行时文件不存在时降级到系统 PATH
        logger.warning(
            "[mcp_runtime] 嵌入式运行时缺失: %s, 回退到系统 PATH",
            resolved,
        )

    # 开发模式或回退：系统 PATH 查找
    return shutil.which(command) or command


def build_mcp_env(base_env: dict | None = None) -> dict:
    """构造 MCP 子进程环境变量。

    打包模式下注入：
    - PLAYWRIGHT_BROWSERS_PATH: 指向嵌入式 Chromium
    - PATH 前置嵌入式运行时目录（node / python / uv）

    Args:
        base_env: 用户配置的环境变量（来自 YAML）

    Returns:
        合并后的环境变量字典
    """
    env = (base_env or {}).copy()

    if not IS_FROZEN:
        return env

    # 注入 Playwright 浏览器路径
    env["PLAYWRIGHT_BROWSERS_PATH"] = str(PLAYWRIGHT_BROWSERS_PATH)

    # PATH 前置嵌入式运行时目录
    runtime_dirs = [
        str(NODE_EXE.parent),
        str(PYTHON_EMBED_EXE.parent),
        str(UV_EXE.parent),
    ]
    existing_path = env.get("PATH", "")
    env["PATH"] = ";".join([*runtime_dirs, existing_path]) if existing_path else ";".join(runtime_dirs)

    return env
```

- [ ] **Step 4: 运行测试确认通过**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_runtime.py -v`
Expected: PASS (11 个测试)

- [ ] **Step 5: 提交**

```bash
git add tools/mcp_runtime.py tests/test_api/test_mcp_runtime.py
git commit -m "feat(mcp): 新增 mcp_runtime.py 命令解析层"
```

---

## Task 3: tools/mcp.py 接入命令解析

**Files:**
- Modify: `tools/mcp.py:86-96` (StdioServerConfig.to_connection)

- [ ] **Step 1: 读取现有 to_connection 方法**

Run: `.venv\Scripts\python.exe -c "import tools.mcp; import inspect; print(inspect.getsource(tools.mcp.StdioServerConfig.to_connection))"`

预期输出:
```python
def to_connection(self) -> dict[str, Any]:
    conn: dict[str, Any] = {
        "transport": "stdio",
        "command": self.command,
        "args": self.args,
    }
    if self.env is not None:
        conn["env"] = self.env
    if self.cwd is not None:
        conn["cwd"] = self.cwd
    return conn
```

- [ ] **Step 2: 修改 to_connection 接入命令解析**

在 `tools/mcp.py` 顶部导入区添加:
```python
from tools.mcp_runtime import build_mcp_env, resolve_mcp_command
```

修改 `StdioServerConfig.to_connection()` (第 86-96 行) 为:
```python
def to_connection(self) -> dict[str, Any]:
    # 阶段 5.3：命令解析 + 环境变量注入（嵌入式运行时支持）
    resolved_command = resolve_mcp_command(self.command)
    merged_env = build_mcp_env(self.env if self.env is not None else {})

    conn: dict[str, Any] = {
        "transport": "stdio",
        "command": resolved_command,
        "args": self.args,
        "env": merged_env,
    }
    if self.cwd is not None:
        conn["cwd"] = self.cwd
    return conn
```

- [ ] **Step 3: 验证现有 MCP 测试不破坏**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_mcp.py -v --tb=short`
Expected: PASS (所有现有测试通过)

- [ ] **Step 4: 提交**

```bash
git add tools/mcp.py
git commit -m "feat(mcp): to_connection 接入命令解析与环境变量注入"
```

---

## Task 4: api/routes/mcp_test.py 测试连接接口

**Files:**
- Create: `api/routes/mcp_test.py`
- Test: `tests/test_api/test_mcp_test_route.py`

- [ ] **Step 1: 写失败测试**

创建 `tests/test_api/test_mcp_test_route.py`:

```python
"""Tests for POST /api/mcp/test-connection endpoint."""

import pytest
from httpx import AsyncClient, ASGITransport

from api.app import create_app


@pytest.fixture
async def client():
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class TestTestConnection:
    @pytest.mark.asyncio
    async def test_returns_400_on_empty_command(self, client):
        """空命令返回 400。"""
        resp = await client.post("/api/mcp/test-connection", json={
            "command": "",
            "args": [],
            "env": {},
        })
        assert resp.status_code == 400
        data = resp.json()
        assert "command" in data["detail"].lower()

    @pytest.mark.asyncio
    async def test_returns_400_on_non_whitelisted_command(self, client):
        """非白名单命令返回 400。"""
        resp = await client.post("/api/mcp/test-connection", json={
            "command": "malicious_command",
            "args": [],
            "env": {},
        })
        assert resp.status_code == 400
        data = resp.json()
        assert "白名单" in data["detail"] or "whitelist" in data["detail"].lower()

    @pytest.mark.asyncio
    async def test_returns_200_on_valid_command(self, client):
        """有效命令(如 node --version)返回 200 + success=True。"""
        resp = await client.post("/api/mcp/test-connection", json={
            "command": "node",
            "args": ["--version"],
            "env": {},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data
        assert "resolved_command" in data
        assert "error" in data

    @pytest.mark.asyncio
    async def test_returns_200_on_failed_startup(self, client):
        """命令启动失败(如 npx 不存在的包)返回 200 + success=False。"""
        resp = await client.post("/api/mcp/test-connection", json={
            "command": "npx",
            "args": ["--nonexistent-flag-xyz"],
            "env": {},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is False
        assert data["error"] is not None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_test_route.py -v`
Expected: FAIL with 404 (路由未注册)

- [ ] **Step 3: 实现 mcp_test.py 路由**

创建 `api/routes/mcp_test.py`:

```python
"""POST /api/mcp/test-connection — 测试 MCP 服务器连接。

启动子进程，5 秒内未崩溃视为成功，超时后终止子进程。
"""

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from tools.mcp_runtime import build_mcp_env, resolve_mcp_command
from tools.mcp_security import validate_stdio_command

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


class TestConnectionRequest(BaseModel):
    """测试连接请求。"""
    command: str
    args: list[str] = []
    env: dict[str, str] = {}


class TestConnectionResponse(BaseModel):
    """测试连接响应。"""
    success: bool
    error: str | None = None
    resolved_command: str


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(req: TestConnectionRequest) -> TestConnectionResponse:
    """测试 MCP 服务器连接。

    1. 校验命令白名单
    2. 解析命令到嵌入式运行时绝对路径
    3. 构造子进程环境变量
    4. 启动子进程，5 秒内未崩溃视为成功
    """
    # 1. 白名单校验
    err = validate_stdio_command(req.command)
    if err:
        raise HTTPException(status_code=400, detail=err)

    # 2. 命令解析
    resolved = resolve_mcp_command(req.command)

    # 3. 环境变量构造
    env = build_mcp_env(req.env)

    # 4. 启动子进程测试
    try:
        proc = await asyncio.create_subprocess_exec(
            resolved,
            *req.args,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as e:
        return TestConnectionResponse(
            success=False,
            error=f"命令不存在: {e}",
            resolved_command=resolved,
        )
    except Exception as e:
        return TestConnectionResponse(
            success=False,
            error=f"启动失败: {e}",
            resolved_command=resolved,
        )

    # 5 秒内未崩溃视为成功
    try:
        await asyncio.wait_for(proc.wait(), timeout=5.0)
        # 进程已退出
        if proc.returncode == 0:
            return TestConnectionResponse(
                success=True,
                error=None,
                resolved_command=resolved,
            )
        # 非零退出码
        stderr_data = await proc.stderr.read() if proc.stderr else b""
        error_msg = stderr_data.decode("utf-8", errors="replace").strip()[:500]
        return TestConnectionResponse(
            success=False,
            error=f"进程退出码 {proc.returncode}: {error_msg}",
            resolved_command=resolved,
        )
    except asyncio.TimeoutError:
        # 超时未退出 = 进程在运行 = 连接成功
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            proc.kill()
        return TestConnectionResponse(
            success=True,
            error=None,
            resolved_command=resolved,
        )
```

- [ ] **Step 4: 注册路由到 app**

在 `api/routes/__init__.py` 或 `api/app.py` 中注册。先读取现有注册方式:

Run: `grep -n "mcp" api/routes/__init__.py api/app.py 2>nul`

根据现有模式,在 app 创建处添加:
```python
from api.routes.mcp_test import router as mcp_test_router
app.include_router(mcp_test_router)
```

- [ ] **Step 5: 运行测试确认通过**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_test_route.py -v`
Expected: PASS (4 个测试,其中 node --version 测试需要开发机有 node)

- [ ] **Step 6: 提交**

```bash
git add api/routes/mcp_test.py tests/test_api/test_mcp_test_route.py api/app.py
git commit -m "feat(api): 新增 POST /api/mcp/test-connection 测试连接接口"
```

---

## Task 5: Playwright 浏览器路径配置

**Files:**
- Modify: `tools/network/playwright_tools/browser_manager.py:41-43`

- [ ] **Step 1: 读取现有 chromium.launch 调用**

确认 `browser_manager.py` 第 41-43 行:
```python
self._browser = self._playwright.chromium.launch(
    headless=True,
)
```

- [ ] **Step 2: 修改为设置环境变量**

修改 `tools/network/playwright_tools/browser_manager.py` 的 `_ensure_browser` 方法:

在文件顶部导入区添加:
```python
import os
```

修改 `_ensure_browser` 方法(第 38-45 行)为:
```python
def _ensure_browser(self) -> Browser:
    """懒加载初始化 Playwright + Chromium。线程安全。

    打包模式下通过 PLAYWRIGHT_BROWSERS_PATH 环境变量指向嵌入式 Chromium，
    必须在 sync_playwright().start() 之前设置（Playwright 启动时读取该变量）。
    """
    with self._browser_lock:
        if self._browser is None:
            # 阶段 5.3：打包模式下注入嵌入式 Chromium 路径
            from app_paths import PLAYWRIGHT_BROWSERS_PATH, _is_frozen
            if _is_frozen() and PLAYWRIGHT_BROWSERS_PATH.exists():
                os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(PLAYWRIGHT_BROWSERS_PATH)

            self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.launch(
                headless=True,
            )
        return self._browser
```

- [ ] **Step 3: 验证现有 Playwright 测试不破坏**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_playwright*.py -v --tb=short`
Expected: PASS (或所有现有测试不破坏)

- [ ] **Step 4: 提交**

```bash
git add tools/network/playwright_tools/browser_manager.py
git commit -m "feat(playwright): 打包模式下注入嵌入式 Chromium 路径"
```

---

## Task 6: ONNX 模型路径配置

**Files:**
- Modify: `config/settings.py:38`
- Modify: `memory/rag/embedding.py:57-83`

- [ ] **Step 1: 修改 settings.py 默认值**

在 `config/settings.py` 第 38 行修改 `embedding_model_local_path`:

```python
# RAG 子系统配置
embedding_model_name: str = "paraphrase-multilingual-MiniLM-L12-v2"
embedding_model_local_path: str = ""  # 留空则从 HuggingFace 下载；打包模式下由 app_paths.ONNX_MODEL_PATH 注入
```

注释更新即可,默认值保持空字符串(开发模式不预置)。

- [ ] **Step 2: 修改 embedding.py 优先用 ONNX_MODEL_PATH**

在 `memory/rag/embedding.py` 的 `EmbeddingEngine._ensure_model` 方法(第 57-83 行)中,修改模型目录确定逻辑:

找到:
```python
if self._local_path and Path(self._local_path).exists():
    model_dir = Path(self._local_path)
else:
    model_dir = self._download_model()
```

替换为:
```python
# 阶段 5.3：优先级：显式配置 > 打包预置 > 在线下载
if self._local_path and Path(self._local_path).exists():
    model_dir = Path(self._local_path)
else:
    # 打包模式：尝试使用 RUNTIME_DIR 下的预置模型
    from app_paths import ONNX_MODEL_PATH, _is_frozen
    if _is_frozen() and ONNX_MODEL_PATH.exists():
        model_dir = ONNX_MODEL_PATH
        logger.info("[rag] 使用打包预置 ONNX 模型: %s", model_dir)
    else:
        model_dir = self._download_model()
```

- [ ] **Step 3: 验证现有 RAG 测试不破坏**

Run: `.venv\Scripts\python.exe -m pytest tests/test_memory/test_embedding*.py -v --tb=short`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add config/settings.py memory/rag/embedding.py
git commit -m "feat(rag): 打包模式下优先使用预置 ONNX 模型"
```

---

## Task 7: Tauri main.rs 注入 MAXMA_RESOURCES_DIR

**Files:**
- Modify: `desktop/src-tauri/src/main.rs:141-159`

- [ ] **Step 1: 读取现有 spawn_sidecar_with_monitor**

确认第 141-159 行的 `spawn_sidecar_with_monitor` 函数,特别是 `.env("MAXMA_API_PORT", port.to_string())` 那行。

- [ ] **Step 2: 修改注入 MAXMA_RESOURCES_DIR**

在 `desktop/src-tauri/src/main.rs` 的 `spawn_sidecar_with_monitor` 函数中,找到:

```rust
let sidecar = sidecar.env("MAXMA_API_PORT", port.to_string());
```

替换为:

```rust
let resource_dir = app
    .path()
    .resource_dir()
    .unwrap_or_else(|_| std::path::PathBuf::from("."));

let sidecar = sidecar
    .env("MAXMA_API_PORT", port.to_string())
    .env("MAXMA_RESOURCES_DIR", resource_dir.to_string_lossy().to_string());
```

- [ ] **Step 3: 验证 Rust 编译通过**

Run: `cd desktop\src-tauri && cargo check`
Expected: 编译成功无错误

- [ ] **Step 4: 提交**

```bash
git add desktop/src-tauri/src/main.rs
git commit -m "feat(tauri): sidecar 启动时注入 MAXMA_RESOURCES_DIR 环境变量"
```

---

## Task 8: tauri.conf.json 配置更新

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: 读取现有 tauri.conf.json**

Run: Read `desktop/src-tauri/tauri.conf.json`

- [ ] **Step 2: 修改 bundle.resources 和新增 publisher**

在 `tauri.conf.json` 的 `bundle` 对象中:

找到:
```json
"resources": [
    "resources/default-config/*"
],
```

替换为:
```json
"resources": [
    "resources/default-config/*",
    "resources/runtime/**/*",
    "resources/assets/**/*"
],
"publisher": "MaxmaHere",
```

- [ ] **Step 3: 提交**

```bash
git add desktop/src-tauri/tauri.conf.json
git commit -m "feat(tauri): bundle.resources 新增 runtime/assets, 补充 publisher"
```

---

## Task 9: prepare-runtime.ps1 构建脚本

**Files:**
- Create: `build/prepare-runtime.ps1`

- [ ] **Step 1: 创建脚本**

创建 `build/prepare-runtime.ps1`:

```powershell
<#
.SYNOPSIS
    下载并解压嵌入式运行时（Node.js + Python embeddable + uv）到 Tauri resources 目录。
.DESCRIPTION
    构建时调用，产物释放到 desktop/src-tauri/resources/runtime/。
    下载缓存到 %LOCALAPPDATA%/MaxmaBuildCache/ 避免重复下载。
#>

param(
    [string]$ResourcesDir = "$PSScriptRoot\..\desktop\src-tauri\resources",
    [string]$CacheDir = "$env:LOCALAPPDATA\MaxmaBuildCache"
)

$ErrorActionPreference = "Stop"

# ── 版本固定 ──
$NodeVersion = "v20.18.1"
$PythonVersion = "3.13.13"
$UvVersion = "0.5.11"

$NodeUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
$PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$UvUrl = "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip"

$RuntimeDir = Join-Path $ResourcesDir "runtime"
$NodeDir = Join-Path $RuntimeDir "node"
$PythonDir = Join-Path $RuntimeDir "python"
$UvDir = Join-Path $RuntimeDir "uv"

# ── 工具函数 ──

function Invoke-DownloadWithCache {
    param([string]$Url, [string]$CachePath)
    if (Test-Path $CachePath) {
        Write-Host "[cache] 命中缓存: $CachePath"
        return $CachePath
    }
    Write-Host "[download] $Url"
    New-Item -ItemType Directory -Force -Path (Split-Path $CachePath) | Out-Null
    Invoke-WebRequest -Uri $Url -OutFile $CachePath -UseBasicParsing
    return $CachePath
}

function Expand-ZipToDir {
    param([string]$ZipPath, [string]$DestDir)
    if (Test-Path $DestDir) { Remove-Item $DestDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $DestDir -Force
}

# ── 主流程 ──

Write-Host "=== prepare-runtime: 下载嵌入式运行时 ===" -ForegroundColor Cyan

# 1. Node.js
Write-Host "`n[1/3] Node.js $NodeVersion" -ForegroundColor Yellow
$nodeZip = Invoke-DownloadWithCache -Url $NodeUrl -CachePath (Join-Path $CacheDir "node-$NodeVersion-win-x64.zip")
Expand-ZipToDir -ZipPath $nodeZip -DestDir $NodeDir
# Node.js zip 解压后有一层 node-vX.Y.Z-win-x64/ 子目录，需要提升
$nodeSubDir = Get-ChildItem $NodeDir -Directory | Select-Object -First 1
if ($nodeSubDir) {
    Move-Item "$($nodeSubDir.FullName)\*" $NodeDir -Force
    Remove-Item $nodeSubDir.FullName -Force
}
Write-Host "[ok] Node.js -> $NodeDir"

# 2. Python embeddable
Write-Host "`n[2/3] Python $PythonVersion embeddable" -ForegroundColor Yellow
$pyZip = Invoke-DownloadWithCache -Url $PythonUrl -CachePath (Join-Path $CacheDir "python-$PythonVersion-embed-amd64.zip")
Expand-ZipToDir -ZipPath $pyZip -DestDir $PythonDir

# Python embeddable 后处理：启用 site-packages + 安装 pip
$pthFile = Get-ChildItem $PythonDir -Filter "python*._pth" | Select-Object -First 1
if ($pthFile) {
    $content = Get-Content $pthFile.FullName
    # 取消 import site 注释
    $content = $content | ForEach-Object { if ($_ -match "^#\s*import site") { "import site" } else { $_ } }
    Set-Content $pthFile.FullName -Value $content
    Write-Host "[ok] 已启用 site-packages: $($pthFile.Name)"
}

# 安装 pip
$getPipUrl = "https://bootstrap.pypa.io/get-pip.py"
$getPipPath = Join-Path $env:TEMP "get-pip.py"
Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipPath -UseBasicParsing
& "$PythonDir\python.exe" $getPipPath --quiet
Remove-Item $getPipPath -Force
Write-Host "[ok] pip 已安装"

# 3. uv
Write-Host "`n[3/3] uv $UvVersion" -ForegroundColor Yellow
$uvZip = Invoke-DownloadWithCache -Url $UvUrl -CachePath (Join-Path $CacheDir "uv-$UvVersion.zip")
Expand-ZipToDir -ZipPath $uvZip -DestDir $UvDir
Write-Host "[ok] uv -> $UvDir"

Write-Host "`n=== prepare-runtime 完成 ===" -ForegroundColor Green
Write-Host "产物目录: $RuntimeDir"
```

- [ ] **Step 2: 验证脚本语法**

Run: `powershell -NoProfile -Command "& { . .\build\prepare-runtime.ps1 -WhatIf } 2>&1"`
Expected: 无语法错误(实际下载会因 -WhatIf 跳过)

- [ ] **Step 3: 提交**

```bash
git add build/prepare-runtime.ps1
git commit -m "feat(build): 新增 prepare-runtime.ps1 下载嵌入式运行时"
```

---

## Task 10: prepare-assets.ps1 构建脚本

**Files:**
- Create: `build/prepare-assets.ps1`

- [ ] **Step 1: 创建脚本**

创建 `build/prepare-assets.ps1`:

```powershell
<#
.SYNOPSIS
    下载 Playwright Chromium + ONNX 嵌入模型到 Tauri resources 目录。
.DESCRIPTION
    构建时调用，产物释放到 desktop/src-tauri/resources/assets/。
#>

param(
    [string]$ResourcesDir = "$PSScriptRoot\..\desktop\src-tauri\resources",
    [string]$VenvPython = "$PSScriptRoot\..\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"

$AssetsDir = Join-Path $ResourcesDir "assets"
$PlaywrightDir = Join-Path $AssetsDir "playwright"
$ModelsDir = Join-Path $AssetsDir "models"

# ── 主流程 ──

Write-Host "=== prepare-assets: 下载 Playwright + ONNX 模型 ===" -ForegroundColor Cyan

# 1. Playwright Chromium
Write-Host "`n[1/2] Playwright Chromium" -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $PlaywrightDir | Out-Null
$env:PLAYWRIGHT_BROWSERS_PATH = $PlaywrightDir
& $VenvPython -m playwright install chromium
if ($LASTEXITCODE -ne 0) {
    Write-Host "[error] Playwright Chromium 下载失败" -ForegroundColor Red
    exit 1
}
Write-Host "[ok] Chromium -> $PlaywrightDir"

# 2. ONNX 嵌入模型
Write-Host "`n[2/2] ONNX 模型 (paraphrase-multilingual-MiniLM-L12-v2)" -ForegroundColor Yellow
$ModelDir = Join-Path $ModelsDir "paraphrase-multilingual-MiniLM-L12-v2"
New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null

& $VenvPython -c @"
import sys
from pathlib import Path
from huggingface_hub import snapshot_download

model_name = 'paraphrase-multilingual-MiniLM-L12-v2'
target_dir = Path(r'$ModelDir')

print(f'[download] {model_name} -> {target_dir}')
snapshot_download(
    repo_id=model_name,
    local_dir=str(target_dir),
    allow_patterns=['config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt', 'onnx/*'],
)
print('[ok] ONNX 模型下载完成')
"@

if ($LASTEXITCODE -ne 0) {
    Write-Host "[error] ONNX 模型下载失败" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== prepare-assets 完成 ===" -ForegroundColor Green
Write-Host "产物目录: $AssetsDir"
```

- [ ] **Step 2: 验证脚本语法**

Run: `powershell -NoProfile -Command "& { . .\build\prepare-assets.ps1 -WhatIf } 2>&1"`
Expected: 无语法错误

- [ ] **Step 3: 提交**

```bash
git add build/prepare-assets.ps1
git commit -m "feat(build): 新增 prepare-assets.ps1 下载 Playwright + ONNX 模型"
```

---

## Task 11: build-desktop.bat 流程更新

**Files:**
- Modify: `build/build-desktop.bat`

- [ ] **Step 1: 读取现有 build-desktop.bat**

确认现有 2/2 流程(setup-dev-env → build-server → cargo tauri build)。

- [ ] **Step 2: 修改为 4/4 流程**

修改 `build/build-desktop.bat` 为:

```bat
@echo off
REM MaxmaHere Windows 桌面构建脚本（生产打包）
REM 产物：desktop\src-tauri\target\release\bundle\nsis\*.exe

setlocal
cd /d "%~dp0\.."

call build\setup-dev-env.bat
if errorlevel 1 exit /b 1

echo [1/4] 构建 Python sidecar 可执行文件...
call build\build-server.bat
if errorlevel 1 exit /b 1

echo.
echo [2/4] 准备嵌入式运行时（Node.js + Python embeddable + uv）...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-runtime.ps1
if errorlevel 1 (
    echo [ERROR] 嵌入式运行时准备失败
    exit /b 1
)

echo.
echo [3/4] 准备资源（Playwright Chromium + ONNX 模型）...
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-assets.ps1
if errorlevel 1 (
    echo [ERROR] 资源准备失败
    exit /b 1
)

echo.
echo [4/4] 构建 Tauri 安装包...
cd desktop\src-tauri
cargo tauri build
if errorlevel 1 (
    echo [ERROR] Tauri 构建失败
    exit /b 1
)

echo.
echo === 构建完成 ===
echo 产物目录：desktop\src-tauri\target\release\bundle\nsis
```

- [ ] **Step 3: 提交**

```bash
git add build/build-desktop.bat
git commit -m "feat(build): build-desktop.bat 接入 prepare-runtime + prepare-assets"
```

---

## Task 12: .gitignore 配置

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 追加忽略规则**

在 `.gitignore` 末尾追加:

```gitignore
# 生产打包：构建时下载的嵌入式运行时和资源（不进 git）
desktop/src-tauri/resources/runtime/
desktop/src-tauri/resources/assets/
```

- [ ] **Step 2: 提交**

```bash
git add .gitignore
git commit -m "chore: gitignore 排除构建时下载的运行时和资源"
```

---

## Task 13: 前端测试连接按钮

**Files:**
- Modify: `web/src/views/McpView.vue`
- Modify: `web/src/api/index.ts` (或对应 API 模块)

- [ ] **Step 1: 查找前端 API 模块位置**

Run: `grep -rn "listMcpServers\|createMcpServer" web/src/api/`

确认 API 函数定义位置(如 `web/src/api/index.ts` 或 `web/src/api/mcp.ts`)。

- [ ] **Step 2: 新增 testMcpConnection API 函数**

在 API 模块中追加:

```typescript
/** 测试 MCP 服务器连接 */
export async function testMcpConnection(
  command: string,
  args: string[],
  env: Record<string, string>
): Promise<{ success: boolean; error: string | null; resolved_command: string }> {
  const resp = await axios.post('/api/mcp/test-connection', { command, args, env });
  return resp.data;
}
```

- [ ] **Step 3: 在 McpView.vue 表单中新增测试连接按钮**

在 `McpView.vue` 的表单模式(stdio transport)中,在"保存"按钮前新增"测试连接"按钮:

```vue
<button
  v-if="form.transport === 'stdio'"
  type="button"
  class="btn btn-secondary"
  :disabled="testing"
  @click="handleTestConnection"
>
  {{ testing ? '测试中...' : '测试连接' }}
</button>
```

在 `<script setup>` 中新增:

```typescript
import { testMcpConnection } from '@/api';

const testing = ref(false);

async function handleTestConnection() {
  if (!form.command) {
    errorMsg.value = '请填写命令';
    return;
  }
  testing.value = true;
  errorMsg.value = '';
  try {
    const result = await testMcpConnection(
      form.command,
      form.args.filter(a => a.key).map(a => a.value),
      Object.fromEntries(form.env.filter(e => e.key).map(e => [e.key, e.value]))
    );
    if (result.success) {
      errorMsg.value = '';
      // 显示成功提示（用现有的 toast 或 alert 机制）
      alert(`连接成功!\n解析命令: ${result.resolved_command}`);
    } else {
      errorMsg.value = result.error || '连接失败';
    }
  } catch (e: any) {
    errorMsg.value = e.response?.data?.detail || e.message || '请求失败';
  } finally {
    testing.value = false;
  }
}
```

- [ ] **Step 4: 验证前端编译通过**

Run: `cd web && npm run build`
Expected: 编译成功无错误

- [ ] **Step 5: 提交**

```bash
git add web/src/views/McpView.vue web/src/api/
git commit -m "feat(web): MCP 配置页面新增测试连接按钮"
```

---

## Task 14: maxma-server.spec 补充 hiddenimports

**Files:**
- Modify: `build/maxma-server.spec`

- [ ] **Step 1: 读取现有 spec 文件**

确认 hiddenimports 列表位置。

- [ ] **Step 2: 新增 mcp_runtime 和 mcp_test 模块**

在 `build/maxma-server.spec` 的 hiddenimports 列表中,在 `api.interaction` 之后添加:

```python
# 阶段 5.3：嵌入式运行时支持
"tools.mcp_runtime",
"api.routes.mcp_test",
```

- [ ] **Step 3: 提交**

```bash
git add build/maxma-server.spec
git commit -m "feat(build): spec 补充 mcp_runtime 和 mcp_test hiddenimports"
```

---

## Task 15: 全量测试 + dev 模式启动验证

**Files:**
- 无修改,仅验证

- [ ] **Step 1: 运行全量测试套件**

Run: `.venv\Scripts\python.exe -m pytest --tb=short -q`
Expected: 所有测试通过(新增测试 + 现有测试)

- [ ] **Step 2: dev 模式启动验证**

Run: `cmd /c build\run-desktop-dev.bat`
Expected: Tauri 窗口正常启动,后端 health 检查通过,无 ImportError

- [ ] **Step 3: 提交最终验证结果(如有修复)**

如果发现任何问题,修复后提交:
```bash
git add -A
git commit -m "fix: 全量测试验证修复"
```

---

## 自检清单

- [ ] spec 覆盖:设计文档每个章节都有对应 Task
- [ ] 无占位符:每个 Step 都有完整代码
- [ ] 类型一致性:`resolve_mcp_command` / `build_mcp_env` 在所有 Task 中签名一致
- [ ] 提交粒度:每个 Task 独立提交,便于回滚
- [ ] 测试先行:每个新增模块都有对应单元测试
