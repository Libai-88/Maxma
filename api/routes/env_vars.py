"""REST API — 工具环境变量管理（读取/更新 .env 文件）。"""

import os

from dotenv import dotenv_values, set_key
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app_paths import ENV_FILE_PATH
from config.settings import get_settings, reload_settings

router = APIRouter()

ENV_PATH = ENV_FILE_PATH

# ── 已知环境变量元信息 ──

ENV_VAR_META: dict[str, dict[str, str]] = {
    "ZHIPUAI_API_KEY": {
        "label": "智谱 AI",
        "description": "GLM-5V-Turbo 图片理解工具",
        "apply_url": "https://open.bigmodel.cn/usercenter/apikeys",
    },
    "TODOIST_API_TOKEN": {
        "label": "Todoist",
        "description": "Todoist 任务管理",
        "apply_url": "https://todoist.com/app/settings/integrations/developer",
    },
    "UAPIS_API_KEY": {
        "label": "UAPI",
        "description": "天气/娱乐等 API 服务",
        "apply_url": "https://uapis.cn/console",
    },
    "AMAP_API_KEY": {
        "label": "高德地图",
        "description": "地图 POI 搜索、地理编码、路线规划",
        "apply_url": "https://lbs.amap.com/dev/key/app",
    },
    "TAVILY_API_KEY": {
        "label": "Tavily",
        "description": "网络搜索与内容提取",
        "apply_url": "https://app.tavily.com/api-key",
    },
}


def _refresh_runtime_settings() -> None:
    """同步当前进程环境并重建 Settings 单例。"""
    file_values = dotenv_values(ENV_PATH)
    for key in ENV_VAR_META:
        value = file_values.get(key, "")
        if value:
            os.environ[key] = value
        else:
            os.environ.pop(key, None)
    reload_settings()


def _mask_value(value: str) -> str:
    """脱敏展示：保留前 4 位 + '****' + 后 4 位。"""
    if len(value) <= 8:
        return value[:2] + "****"
    return value[:4] + "****" + value[-4:]


class EnvVarItem(BaseModel):
    key: str
    label: str
    description: str
    apply_url: str = ""  # 申请入口外链（空字符串表示无预设申请入口）
    value: str  # 已脱敏
    is_set: bool


class ListEnvVarsResponse(BaseModel):
    env_vars: list[EnvVarItem]


class UpdateEnvVarRequest(BaseModel):
    key: str
    value: str


class BatchUpdateEnvVarItem(BaseModel):
    key: str
    value: str


class BatchUpdateEnvVarRequest(BaseModel):
    env_vars: list[BatchUpdateEnvVarItem]


@router.get("/env-vars", response_model=ListEnvVarsResponse)
async def list_env_vars():
    """列出所有已知环境变量（值脱敏）。"""
    settings = get_settings()
    file_values = dotenv_values(ENV_PATH)

    items: list[EnvVarItem] = []
    for key, meta in ENV_VAR_META.items():
        raw = getattr(settings, key.lower(), None) or file_values.get(key, "")
        items.append(
            EnvVarItem(
                key=key,
                label=meta["label"],
                description=meta["description"],
                apply_url=meta.get("apply_url", ""),
                value=_mask_value(raw) if raw else "",
                is_set=bool(raw),
            )
        )
    return ListEnvVarsResponse(env_vars=items)


@router.put("/env-vars")
async def update_env_var(req: UpdateEnvVarRequest):
    """更新单个环境变量并持久化到 .env 文件。"""
    if req.key not in ENV_VAR_META:
        raise HTTPException(status_code=400, detail=f"未知环境变量: {req.key}")
    if not req.value:
        raise HTTPException(status_code=400, detail="值不能为空")

    try:
        set_key(str(ENV_PATH), req.key, req.value)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"写入 .env 失败: {e}")

    _refresh_runtime_settings()

    return {
        "status": "ok",
        "key": req.key,
        "masked_value": _mask_value(req.value),
    }


@router.put("/env-vars/batch")
async def batch_update_env_vars(req: BatchUpdateEnvVarRequest):
    """批量更新多个环境变量。"""
    updated: list[dict[str, str]] = []
    for item in req.env_vars:
        if item.key not in ENV_VAR_META:
            continue
        if not item.value:
            continue
        try:
            set_key(str(ENV_PATH), item.key, item.value)
            updated.append({"key": item.key, "masked_value": _mask_value(item.value)})
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"写入 {item.key} 失败: {e}",
            )

    if updated:
        _refresh_runtime_settings()

    return {"status": "ok", "updated": updated}
