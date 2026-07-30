"""Panel configuration REST API — 四个配置面板的持久化端点。

提供 GET/PUT 端点用于读写以下四类面板配置：
- ``/api/memory/hindsight-config``  Hindsight 记忆处理配置
- ``/api/settings/tts``             TTS / 语音配置
- ``/api/settings/browser-tools``   浏览器工具配置
- ``/api/settings/sub-agents``      子代理配置

所有配置以简单的 key-value 形式持久化在 ``api/data/panel_configs.json``，
顶层键为面板名（``hindsight`` / ``tts`` / ``browser_tools`` / ``sub_agents``），
值为该面板的配置对象。读写使用 portalocker 串行化，写入采用临时文件 +
``os.replace`` 原子替换，避免半写文件。
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from contextlib import contextmanager
from typing import Any, Iterator

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app_paths import API_DATA_DIR

logger = logging.getLogger(__name__)

# portalocker 在 Windows 上需要 pywin32 的 C 扩展（pywintypes），
# 如果缺失则运行时崩溃。延迟检测并提供 fallback。
_portalocker_available: bool | None = None
_panel_locks: dict[str, threading.Lock] = {}
_panel_locks_guard = threading.Lock()


def _get_panel_lock(path_str: str) -> threading.Lock:
    """获取或创建指定路径对应的进程内锁。"""
    with _panel_locks_guard:
        lock = _panel_locks.get(path_str)
        if lock is None:
            lock = threading.Lock()
            _panel_locks[path_str] = lock
        return lock


@contextmanager
def _fallback_lock(path: str, timeout: int = 5) -> Iterator[None]:
    """文件锁兜底实现：优先使用 portalocker，不可用时退化为 threading.Lock。"""
    global _portalocker_available
    if _portalocker_available is None:
        try:
            import portalocker
            # 运行时验证 portalocker 是否真正可用（pywintypes 是否就绪）
            with tempfile.NamedTemporaryFile(suffix=".lock", delete=False) as f:
                test_path = f.name
            try:
                with portalocker.Lock(test_path, timeout=1):
                    pass
                _portalocker_available = True
            except Exception:
                _portalocker_available = False
            finally:
                try:
                    os.unlink(test_path)
                except OSError:
                    pass
        except ImportError:
            _portalocker_available = False

    if _portalocker_available:
        import portalocker
        with portalocker.Lock(path, timeout=timeout):
            yield
    else:
        # portalocker 不可用时退化为进程内锁
        lock = _get_panel_lock(path)
        lock.acquire()
        try:
            yield
        finally:
            lock.release()

router = APIRouter()

CONFIG_PATH = API_DATA_DIR / "panel_configs.json"
LOCK_PATH = API_DATA_DIR / "panel_configs.json.lock"

# ── 默认配置 ──
# GET 时若文件不存在或对应面板缺失，返回这些默认值；
# PUT 时这些默认值用于补全请求体中缺失的字段，保证存储对象结构完整。

DEFAULT_HINDSIGHT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "retention_days": 90,
    "importance_threshold": 0.5,
    "processing_mode": "auto",  # auto | manual | scheduled
    "prompt_template": "",
}

DEFAULT_TTS_CONFIG: dict[str, Any] = {
    "enabled": False,
    "provider": "edge-tts",  # edge-tts | openai-tts | custom
    "voice": "",
    "speed": 1.0,
    "pitch": 1.0,
    "auto_read": False,
}

DEFAULT_BROWSER_TOOLS_CONFIG: dict[str, Any] = {
    "enabled": False,
    "chrome_path": "",
    "headless": True,
    "viewport_width": 1280,
    "viewport_height": 800,
    "block_tracking": True,
    "allowed_domains": [],
}

DEFAULT_SUB_AGENTS_CONFIG: dict[str, Any] = {
    "enabled": False,
    "max_concurrent": 3,
    "auto_approve": False,
    "model": "inherit",
    "timeout_seconds": 120,
    "show_progress": True,
}

DEFAULTS: dict[str, dict[str, Any]] = {
    "hindsight": DEFAULT_HINDSIGHT_CONFIG,
    "tts": DEFAULT_TTS_CONFIG,
    "browser_tools": DEFAULT_BROWSER_TOOLS_CONFIG,
    "sub_agents": DEFAULT_SUB_AGENTS_CONFIG,
}


# ── 请求体模型 ──


class HindsightConfigBody(BaseModel):
    enabled: bool | None = None
    retention_days: int | None = Field(default=None, ge=7, le=365)
    importance_threshold: float | None = Field(default=None, ge=0.1, le=1.0)
    processing_mode: str | None = None
    prompt_template: str | None = None


class TtsConfigBody(BaseModel):
    enabled: bool | None = None
    provider: str | None = None
    voice: str | None = None
    speed: float | None = Field(default=None, ge=0.5, le=2.0)
    pitch: float | None = Field(default=None, ge=0.5, le=2.0)
    auto_read: bool | None = None


class BrowserToolsConfigBody(BaseModel):
    enabled: bool | None = None
    chrome_path: str | None = None
    headless: bool | None = None
    viewport_width: int | None = Field(default=None, ge=1, le=7680)
    viewport_height: int | None = Field(default=None, ge=1, le=4320)
    block_tracking: bool | None = None
    allowed_domains: list[str] | None = None


class SubAgentsConfigBody(BaseModel):
    enabled: bool | None = None
    max_concurrent: int | None = Field(default=None, ge=1, le=10)
    auto_approve: bool | None = None
    model: str | None = None
    timeout_seconds: int | None = Field(default=None, ge=30, le=600)
    show_progress: bool | None = None


# ── 持久化辅助 ──


def _load_all() -> dict[str, Any]:
    """读取整个 panel_configs.json，文件缺失或损坏时返回空 dict。"""
    if not CONFIG_PATH.exists():
        return {}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        logger.warning("[panel_configs] failed to read %s: %s", CONFIG_PATH, exc)
        return {}
    if not isinstance(data, dict):
        logger.warning("[panel_configs] invalid top-level document in %s", CONFIG_PATH)
        return {}
    return data


def _save_all(data: dict[str, Any]) -> None:
    """原子写入整个 panel_configs.json。"""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=".panel_configs.", suffix=".tmp", dir=str(CONFIG_PATH.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_name, CONFIG_PATH)
    except OSError:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _get_panel(panel: str) -> dict[str, Any]:
    """读取单个面板配置，与默认值合并以保证字段完整。"""
    with _fallback_lock(str(LOCK_PATH)):
        stored = _load_all().get(panel, {})
    if not isinstance(stored, dict):
        stored = {}
    merged = dict(DEFAULTS[panel])
    merged.update(stored)
    return merged


def _put_panel(panel: str, updates: dict[str, Any]) -> dict[str, Any]:
    """合并写入单个面板配置（仅覆盖提供的字段），返回合并后的完整配置。"""
    # 过滤掉 None（未提供的字段保持原值）
    patch = {k: v for k, v in updates.items() if v is not None}
    with _fallback_lock(str(LOCK_PATH)):
        all_data = _load_all()
        current = all_data.get(panel, {})
        if not isinstance(current, dict):
            current = {}
        merged = dict(DEFAULTS[panel])
        merged.update(current)
        merged.update(patch)
        all_data[panel] = merged
        try:
            _save_all(all_data)
        except OSError as exc:
            logger.error("[panel_configs] failed to save %s: %s", panel, exc)
            raise HTTPException(status_code=500, detail=f"Failed to persist config: {exc}")
    return merged


# ── Hindsight 配置 ──


@router.get("/memory/hindsight-config")
async def get_hindsight_config():
    return _get_panel("hindsight")


@router.put("/memory/hindsight-config")
async def update_hindsight_config(body: HindsightConfigBody):
    updates = body.model_dump(exclude_none=False)
    if updates.get("processing_mode") not in (None, "auto", "manual", "scheduled"):
        raise HTTPException(status_code=422, detail="processing_mode must be auto/manual/scheduled")
    return _put_panel("hindsight", updates)


# ── TTS / 语音配置 ──


@router.get("/settings/tts")
async def get_tts_config():
    return _get_panel("tts")


@router.put("/settings/tts")
async def update_tts_config(body: TtsConfigBody):
    updates = body.model_dump(exclude_none=False)
    if updates.get("provider") not in (None, "edge-tts", "openai-tts", "custom"):
        raise HTTPException(status_code=422, detail="provider must be edge-tts/openai-tts/custom")
    return _put_panel("tts", updates)


# ── 浏览器工具配置 ──


@router.get("/settings/browser-tools")
async def get_browser_tools_config():
    return _get_panel("browser_tools")


@router.put("/settings/browser-tools")
async def update_browser_tools_config(body: BrowserToolsConfigBody):
    updates = body.model_dump(exclude_none=False)
    domains = updates.get("allowed_domains")
    if domains is not None:
        # 去空白、去重（保持顺序）、忽略空项
        seen: set[str] = set()
        cleaned: list[str] = []
        for d in domains:
            if not isinstance(d, str):
                continue
            d = d.strip()
            if d and d not in seen:
                seen.add(d)
                cleaned.append(d)
        updates["allowed_domains"] = cleaned
    return _put_panel("browser_tools", updates)


# ── 子代理配置 ──


@router.get("/settings/sub-agents")
async def get_sub_agents_config():
    return _get_panel("sub_agents")


@router.put("/settings/sub-agents")
async def update_sub_agents_config(body: SubAgentsConfigBody):
    updates = body.model_dump(exclude_none=False)
    return _put_panel("sub_agents", updates)
