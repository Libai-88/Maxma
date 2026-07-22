# -*- mode: python ; coding: utf-8 -*-
"""
MaxmaHere PyInstaller spec — 将后端打包为独立可执行文件。

构建命令（在项目根目录执行）：
    .venv\\Scripts\\pyinstaller.exe build\\maxma-server.spec --clean --noconfirm

产物位于：
    dist/maxma-server.exe
"""

import os
import sys
from pathlib import Path

block_cipher = None
project_root = Path(SPECPATH).parent  # SPECPATH = build/ 目录的父目录

# ── 数据文件：打包进 _MEIPASS 临时目录的资源 ──

datas = [
    # 前端构建产物
    (str(project_root / "web" / "dist"), "web/dist"),
    # 配置文件（personas 目录包含 SOUL.md、USER.md 模板等）
    (str(project_root / "config"), "config"),
    # Anthropic Skills
    (str(project_root / "anthropic_skills"), "anthropic_skills"),
    # Macros
    (str(project_root / "macros"), "macros"),
    # oh-my-pi sidecar（Bun TypeScript 源码 + node_modules）
    # 生产模式需要 bun.exe + sidecar 源码来启动 agent 引擎
    (str(project_root / "bun-sidecar" / "src"), "bun-sidecar/src"),
    (str(project_root / "bun-sidecar" / "package.json"), "bun-sidecar"),
    (str(project_root / "bun-sidecar" / "node_modules"), "bun-sidecar/node_modules"),
    # Bun 运行时本体：_resolve_bun_path() 在 _MEIPASS/bun-sidecar/bun.exe 查找。
    # 由 build/prepare-bun.ps1 在构建期下载官方二进制到此路径。
    (str(project_root / "bun-sidecar" / "bun.exe"), "bun-sidecar"),
]

# These inputs are required for a runnable backend. Failing while evaluating
# the spec is safer than producing an executable with silently missing data.
_required_sources = [
    project_root / "web" / "dist",
    project_root / "config",
    project_root / "bun-sidecar" / "src",
    project_root / "bun-sidecar" / "package.json",
    project_root / "bun-sidecar" / "node_modules",
]
_missing_required = [str(path) for path in _required_sources if not path.exists()]
if _missing_required:
    raise SystemExit(
        "[ERROR] Missing required PyInstaller data:\n" + "\n".join(_missing_required)
    )

# Optional local content may be absent in a clean checkout; omit it explicitly
# while keeping the required runtime inputs above fail-fast.
datas = [(src, dst) for src, dst in datas if Path(src).exists()]

# bun.exe 是打包后端启动 agent 引擎的必需品，缺失则产物不可用 —— 立即失败而非静默跳过
_bun_exe = project_root / "bun-sidecar" / "bun.exe"
if not _bun_exe.exists():
    raise SystemExit(
        "[ERROR] 缺少 bun-sidecar/bun.exe，打包后端需要捆绑的 Bun 运行时来启动 agent 引擎。\n"
        "        请先运行: powershell -NoProfile -ExecutionPolicy Bypass -File build\\prepare-bun.ps1"
    )

site_packages_root = project_root / ".venv" / "Lib" / "site-packages"


def collect_local_extension_modules():
    binaries = []
    hidden = []
    for package_root in site_packages_root.iterdir():
        if not package_root.is_dir():
            continue
        package_name = package_root.name
        for pyd in package_root.glob("*.pyd"):
            binaries.append((str(pyd), package_name))
            module_name = pyd.name.split(".", 1)[0]
            hidden.append(f"{package_name}.{module_name}")
    return binaries, hidden


local_extension_binaries, local_extension_hiddenimports = collect_local_extension_modules()


# ── 隐式导入：PyInstaller 无法自动检测的动态导入 ──

hiddenimports = [
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "fastapi",
    "pydantic",
    "pydantic_settings",
    "yaml",
    "cryptography",
    "aiosqlite",
    "api.pi_bridge.rpc_client",
    "api.pi_bridge.sidecar_manager",
    "api.pi_bridge.session_adapter",
    "api.pi_bridge.ws_event_mapper",
    "api.auth",
    "api.const_session_store",
    "api.db.core",
    "api.db.auth",
]

hiddenimports.extend(local_extension_hiddenimports)

# ── 排除模块：减小打包体积 ──

excludes = [
    "tkinter",          # 文件选择器在桌面模式下由 Tauri 处理
    "matplotlib",
    "numpy.distutils",
    "setuptools",
    "unittest",
    "test",
    "IPython",
    "jupyter",
    "notebook",
    "pytest",
    # Stage 1 RAG 体积优化：已改用 ONNX Runtime 直推，排除 torch 全家桶（省 ~600MB）
    "torch",
    "torchvision",
    "torchaudio",
    "sentence_transformers",
    "scipy",
    "sklearn",
    "scikit_learn",
    "sympy",
    "networkx",
    # chromadb 的云端依赖，桌面端不需要
    "kubernetes",
    # 注意：opentelemetry 不能排除 — chromadb 1.5.x 在运行时 import chromadb
    # 会触发 opentelemetry.instrumentation 的导入，排除后导致 ImportError，
    # 使 vector_store.get_vector_store() 返回 None，知识库功能完全不可用。
]

a = Analysis(
    [str(project_root / "main.py")],
    pathex=[str(project_root)],
    binaries=local_extension_binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="maxma-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # 保留控制台窗口以便查看日志
    disable_windowed_traceback=False,
    argv_emulation=False,
    icon=None,  # 可后续添加 .ico 图标
)
