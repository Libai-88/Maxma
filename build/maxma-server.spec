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

from PyInstaller.utils.hooks import collect_dynamic_libs, collect_submodules

block_cipher = None
project_root = Path(SPECPATH).parent  # SPECPATH = build/ 目录的父目录

# ── 数据文件：打包进 _MEIPASS 临时目录的资源 ──

# Keep this manifest explicit.  The project config directory also contains
# user personas, memory snapshots, lock files, and SQLite WAL files during a
# developer run.  A recursive config entry would silently publish that data
# in every one-file executable.
datas = [
    # 前端构建产物
    (str(project_root / "web" / "dist"), "web/dist"),
    # 内置人格说明和首次运行模板；真实 SOUL/USER/memory 不属于 bundle。
    (str(project_root / "config" / "personas" / "AGENTS.md"), "config/personas"),
    (str(project_root / "config" / "personas" / "SOUL.example.md"), "config/personas"),
    (str(project_root / "config" / "personas" / "USER.example.md"), "config/personas"),
    # 内置贴纸；config/stickers/custom 是用户上传目录，故不打包。
    # Anthropic Skills
    (str(project_root / ".omp" / "skills"), ".omp/skills"),
    # Macros
    (str(project_root / "macros"), "macros"),
]

_config_stickers_dir = project_root / "config" / "stickers"
_sticker_categories = (
    sorted(
        path
        for path in _config_stickers_dir.iterdir()
        if path.is_dir() and path.name != "custom"
    )
    if _config_stickers_dir.is_dir()
    else []
)
datas.extend(
    (str(category), f"config/stickers/{category.name}")
    for category in _sticker_categories
)

# These inputs are required for a runnable backend. Failing while evaluating
# the spec is safer than producing an executable with silently missing data.
_required_sources = [
    project_root / "web" / "dist",
    project_root / "config" / "personas" / "AGENTS.md",
    project_root / "config" / "personas" / "SOUL.example.md",
    project_root / "config" / "personas" / "USER.example.md",
    project_root / "config" / "stickers",
]
_missing_required = [str(path) for path in _required_sources if not path.exists()]
if not _sticker_categories:
    _missing_required.append(str(_config_stickers_dir / "<builtin-category>"))
if _missing_required:
    raise SystemExit(
        "[ERROR] Missing required PyInstaller data:\n" + "\n".join(_missing_required)
    )

# Optional local content may be absent in a clean checkout; omit it explicitly
# while keeping the required runtime inputs above fail-fast.
datas = [(src, dst) for src, dst in datas if Path(src).exists()]

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

# cffi's native backend is a top-level extension in site-packages, while any
# package-local native libraries are collected through PyInstaller's hook API.
cffi_hiddenimports = ["_cffi_backend"] + collect_submodules("cffi")
cffi_binaries = collect_dynamic_libs("cffi")


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
hiddenimports.extend(cffi_hiddenimports)

# tools/ 包内子模块在函数体内动态 import，PyInstaller 静态分析无法发现。
# collect_submodules 自动发现全部子模块，避免打包后 ModuleNotFoundError。
# 参见 project_memory: PyInstaller spec 必须 collect_submodules("tools")。
hiddenimports.extend(collect_submodules("tools"))

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
    binaries=local_extension_binaries + cffi_binaries,
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

# PyInstaller onedir 模式：首次启动解压到 _internal/，后续启动直接使用（2-3秒）
# 替代 onefile 模式（每次启动都解压，5-10秒）
exe = EXE(
    pyz,
    a.scripts,
    # 移除 a.binaries 和 a.datas 的内嵌，改为 COLLECT 收集到 _internal/
    exclude_binaries=True,  # ← 关键改动：不嵌入到单一 EXE
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

# COLLECT: 将二进制和数据文件收集到 dist/maxma-server/_internal/ 目录
# 便携版布局：MaxmaHere-Portable/
#   ├── maxma-here.exe       (Tauri 主程序)
#   ├── maxma-server.exe     (PyInstaller bootloader，轻量)
#   ├── _internal/           (Python 运行时 + 依赖，一次解压)
#   │   ├── python313.dll
#   │   ├── api/
#   │   ├── config/
#   │   └── ...
#   └── resources/           (嵌入式运行时)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="maxma-server",
)
