"""首次运行初始化 — 从 example 文件复制用户自述、人设文件、环境变量。"""

import shutil
from pathlib import Path

from app_paths import (
    BUNDLE_DIR,
    DATA_DIR,
    PERSONAS_DIR as _BUNDLE_PERSONAS_DIR,
    PERSONAS_DATA_DIR,
    PROJECT_ROOT,
)

# 模板来自 BUNDLE_DIR（只读），实际文件写入 PERSONAS_DATA_DIR（可写）
_BUNDLE_PERSONAS_DIR = _BUNDLE_PERSONAS_DIR  # 模板目录（BUNDLE_DIR/config/personas）


def _copy_if_missing(src: Path, dst: Path, description: str = "") -> None:
    """若 dst 不存在且 src 存在，复制一份。"""
    if not dst.exists() and src.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        label = f" ({description})" if description else ""
        try:
            rel = dst.relative_to(PROJECT_ROOT)
        except ValueError:
            rel = dst
        print(f"[init] 已创建 {rel}{label}")


def ensure_user_md() -> None:
    """若 USER.md 不存在，从 USER.example.md 复制。"""
    _copy_if_missing(
        _BUNDLE_PERSONAS_DIR / "USER.example.md",
        PERSONAS_DATA_DIR / "USER.md",
        "请编辑 USER.md 填写你的自述信息",
    )


def ensure_soul_md() -> None:
    """若 SOUL.md 不存在，从 SOUL.example.md 复制。"""
    _copy_if_missing(
        _BUNDLE_PERSONAS_DIR / "SOUL.example.md",
        PERSONAS_DATA_DIR / "SOUL.md",
        "请编辑 SOUL.md 自定义人设",
    )


def ensure_env_file() -> None:
    """若 .env 不存在，从 .env.example 复制。"""
    _copy_if_missing(
        BUNDLE_DIR / ".env.example",
        DATA_DIR / ".env",
        "请编辑 .env 填写 API Key",
    )


def ensure_builtin_personas() -> None:
    """将内置人格模板（SOUL.*.md）复制到可写目录，不覆盖已有文件。"""
    if not _BUNDLE_PERSONAS_DIR.is_dir():
        return
    for src in _BUNDLE_PERSONAS_DIR.glob("SOUL*.md"):
        if src.name in ("SOUL.md", "SOUL.example.md"):
            continue  # 这两个由 ensure_soul_md() 单独处理
        dst = PERSONAS_DATA_DIR / src.name
        _copy_if_missing(src, dst, f"内置人格: {src.stem}")


def ensure_agents_md() -> None:
    """若 AGENTS.md 不存在，从内置模板复制。

    打包模式下 PERSONAS_DATA_DIR 与 PERSONAS_DIR（BUNDLE_DIR）分离，
    若不复制，prompts.py 的 _read_persona("AGENTS.md") 会读到空字符串，
    导致系统提示词丢失"行为规则"段。
    """
    _copy_if_missing(
        _BUNDLE_PERSONAS_DIR / "AGENTS.md",
        PERSONAS_DATA_DIR / "AGENTS.md",
        "行为规则",
    )


def ensure_active_persona() -> None:
    """若 active_persona.yaml 不存在，从内置模板复制。

    打包模式下内置模板在 BUNDLE_DIR（只读），需复制到 PERSONAS_DATA_DIR（可写）
    才能支持运行时切换人格。
    """
    _copy_if_missing(
        _BUNDLE_PERSONAS_DIR / "active_persona.yaml",
        PERSONAS_DATA_DIR / "active_persona.yaml",
        "当前人格配置",
    )


def ensure_all() -> None:
    """运行所有文件初始化检查（启动时调用一次）。"""
    ensure_env_file()
    ensure_user_md()
    ensure_soul_md()
    ensure_agents_md()  # 新增：复制 AGENTS.md 到可写目录
    ensure_active_persona()  # 新增：复制 active_persona.yaml
    ensure_builtin_personas()
