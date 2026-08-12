"""API 路由 — 首次引导（onboarding）状态。

ONBOARDING-PORTABLE-001：引导状态此前仅存于前端 localStorage
（maxma.onboarding.v1），便携版与标准安装版共享同一 WebView2 profile 时
互相污染——任一版本点过"跳过/完成"，另一版本首启便直接跳过引导。
现改为后端存储（随数据目录走，见 app_paths.ONBOARDING_STATE_PATH）：
- 全新数据目录（未迁移）无记录 → 前端按新用户显示引导；
- 标准版 → 便携版数据迁移会自然携带状态（同一用户的数据延续）；
- 浏览器 profile 中的旧 localStorage 不再被信任为判定依据。
"""

import json
import logging

from fastapi import APIRouter

from app_paths import ONBOARDING_STATE_PATH

logger = logging.getLogger(__name__)

router = APIRouter()

_DEFAULT_PREFERENCES = {"displayName": "", "language": "zh-CN", "workspace": "personal"}


def _load_state() -> dict:
    """读取引导状态；文件缺失/损坏时按新用户处理。"""
    try:
        if ONBOARDING_STATE_PATH.exists():
            data = json.loads(ONBOARDING_STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except (OSError, ValueError):
        logger.warning("[onboarding] 读取引导状态失败，按新用户处理")
    return {"completed": False, "preferences": dict(_DEFAULT_PREFERENCES)}


def _save_state(state: dict) -> None:
    """原子写入引导状态（先写临时文件再 rename，避免半写文件）。"""
    ONBOARDING_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ONBOARDING_STATE_PATH.with_name(ONBOARDING_STATE_PATH.name + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(ONBOARDING_STATE_PATH)


@router.get("/onboarding/state")
async def get_onboarding_state():
    """返回当前引导状态；无记录时返回 completed=false（新用户）。"""
    return _load_state()


@router.put("/onboarding/state")
async def put_onboarding_state(payload: dict):
    """保存引导状态（完成/跳过标记 + 偏好）。字段白名单过滤，防前端传任意键。"""
    prefs = payload.get("preferences") or {}
    preferences = {
        "displayName": str(prefs.get("displayName") or "")[:80],
        "language": "en" if prefs.get("language") == "en" else "zh-CN",
        "workspace": "project" if prefs.get("workspace") == "project" else "personal",
    }
    state = {"completed": bool(payload.get("completed")), "preferences": preferences}
    _save_state(state)
    return state
