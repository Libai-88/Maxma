"""API 路由 — 表情收藏管理。"""

import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app_paths import DATA_DIR

router = APIRouter()

FAVORITES_PATH = DATA_DIR / "api" / "data" / "sticker_favorites.yaml"
RECENT_PATH = DATA_DIR / "api" / "data" / "sticker_recent.yaml"

# 表情库根目录
from app_paths import BUNDLE_DIR
STICKERS_DIR = BUNDLE_DIR / "config" / "stickers"

_CATEGORY_RE = re.compile(r'^[\w\u4e00-\u9fff\-]+$')
_FILENAME_RE = re.compile(r'^[\w\-]+\.webp$')


def _validate_sticker_ref(category: str, filename: str) -> None:
    """与图片服务保持一致的表情路径校验。"""
    if not _CATEGORY_RE.match(category):
        raise HTTPException(status_code=400, detail="非法分类名")
    if not _FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="非法文件名")


def _load_yaml_safe(path: Path) -> dict:
    """安全加载 YAML 文件，文件不存在时创建默认文件。"""
    import yaml
    if not path.exists():
        # H1: 文件不存在时创建默认文件
        path.parent.mkdir(parents=True, exist_ok=True)
        default_data = {'favorites': []} if 'favorite' in str(path) else {'recent': []}
        with open(path, 'w', encoding='utf-8') as f:
            yaml.dump(default_data, f, allow_unicode=True, default_flow_style=False)
        return default_data
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


def _save_yaml_safe(path: Path, data: dict) -> None:
    """安全保存 YAML 文件。"""
    import yaml
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False)


class FavoriteRequest(BaseModel):
    """收藏请求。"""
    category: str
    filename: str


class FavoriteResponse(BaseModel):
    """收藏响应。"""
    success: bool
    message: str


class StickerItem(BaseModel):
    """前端表情项。"""
    category: str
    filename: str
    path: str


def _sticker_exists(category: str, filename: str) -> bool:
    """检查内置或自定义表情是否存在。"""
    _validate_sticker_ref(category, filename)
    if category == 'custom':
        custom_path = DATA_DIR / "config" / "stickers" / "custom" / filename
        return custom_path.is_file()
    return (STICKERS_DIR / category / filename).is_file()


@router.get("/stickers/favorites")
async def get_favorites():
    """获取收藏列表。"""
    data = _load_yaml_safe(FAVORITES_PATH)
    favorites = data.get('favorites', [])
    try:
        from tools.sticker_preferences import get_preferences
        prefs = get_preferences()
    except Exception:
        prefs = None

    # 补充 path 字段
    result = []
    for item in favorites:
        item_copy = dict(item)
        sticker_path = f"{item.get('category', '')}/{item.get('filename', '')}"
        item_copy['path'] = sticker_path
        item_copy['usage_count'] = prefs.get_usage_count(sticker_path) if prefs else 0
        result.append(item_copy)
    return {"favorites": result}


@router.post("/stickers/favorites", response_model=FavoriteResponse)
async def add_favorite(req: FavoriteRequest):
    """添加收藏。"""
    # 验证文件存在
    if not _sticker_exists(req.category, req.filename):
        raise HTTPException(status_code=404, detail="表情不存在")
    
    data = _load_yaml_safe(FAVORITES_PATH)
    favorites = data.get('favorites', [])
    
    # 检查是否已收藏（同时比较 filename 和 category）
    for fav in favorites:
        if fav.get('filename') == req.filename and fav.get('category') == req.category:
            return FavoriteResponse(success=False, message="已在收藏中")
    
    # 添加收藏
    favorites.append({
        'category': req.category,
        'filename': req.filename,
        'added_at': datetime.now().isoformat()
    })
    
    data['favorites'] = favorites
    _save_yaml_safe(FAVORITES_PATH, data)

    from tools.sticker_preference_hooks import on_favorite_added
    on_favorite_added(req.category, req.filename)
    
    return FavoriteResponse(success=True, message="已收藏")


@router.delete("/stickers/favorites", response_model=FavoriteResponse)
async def remove_favorite(filename: str, category: str):
    """取消收藏。"""
    data = _load_yaml_safe(FAVORITES_PATH)
    favorites = data.get('favorites', [])
    
    # 移除收藏（同时匹配 filename 和 category）
    new_favorites = [f for f in favorites 
                     if not (f.get('filename') == filename and f.get('category') == category)]
    
    if len(new_favorites) == len(favorites):
        return FavoriteResponse(success=False, message="未找到收藏")
    
    data['favorites'] = new_favorites
    _save_yaml_safe(FAVORITES_PATH, data)

    from tools.sticker_preference_hooks import on_favorite_removed
    on_favorite_removed(category, filename)
    
    return FavoriteResponse(success=True, message="已取消收藏")


@router.post("/stickers/usage", response_model=FavoriteResponse)
async def record_sticker_usage(req: FavoriteRequest):
    """记录用户主动发送表情。"""
    if not _sticker_exists(req.category, req.filename):
        raise HTTPException(status_code=404, detail="表情不存在")

    from tools.sticker_preference_hooks import on_sticker_used
    from tools.sticker_selector import add_recent_sticker

    on_sticker_used(req.category, req.filename)
    add_recent_sticker(req.category, req.filename)

    return FavoriteResponse(success=True, message="已记录使用")


@router.post("/stickers/skip", response_model=FavoriteResponse)
async def record_sticker_skip(req: FavoriteRequest):
    """记录用户明确减少推荐某个表情。"""
    if not _sticker_exists(req.category, req.filename):
        raise HTTPException(status_code=404, detail="表情不存在")

    from tools.sticker_preference_hooks import on_sticker_skipped
    on_sticker_skipped(req.category, req.filename)

    return FavoriteResponse(success=True, message="已减少推荐")


@router.get("/stickers/recent")
async def get_recent(limit: int = 50):
    """获取最近使用列表。"""
    data = _load_yaml_safe(RECENT_PATH)
    recent = data.get('recent', [])
    # 先反转（最新在前），再取前 N 条，并补充 path 字段
    result = []
    seen: set[str] = set()
    for item in reversed(recent):
        item_copy = dict(item)
        item_copy['path'] = f"{item.get('category', '')}/{item.get('filename', '')}"
        if item_copy['path'] in seen:
            continue
        seen.add(item_copy['path'])
        result.append(item_copy)
    return {"recent": result[:limit]}


@router.get("/stickers/recommendations")
async def get_recommendations(
    text: str = "",
    limit: int = Query(default=4, ge=1, le=12),
):
    """基于当前输入文本推荐少量表情，不写入最近使用。"""
    from tools.emotion_detector import detect_emotion_from_text
    from tools.shared.time_utils import get_time_period
    from tools.sticker_selector import select_sticker

    categories: list[str] = []
    emotion = detect_emotion_from_text(text)
    if emotion:
        categories.append(emotion.category)

    time_period = get_time_period()
    if time_period == "late_night":
        categories.extend(["爱心", "委屈", "日常"])
    elif time_period == "morning":
        categories.extend(["日常", "开心"])
    elif time_period == "work":
        categories.extend(["无语", "开心", "日常"])
    else:
        categories.extend(["开心", "爱心", "日常"])

    categories.extend(["开心", "爱心", "日常", "无语"])

    deduped_categories: list[str] = []
    for category in categories:
        if category not in deduped_categories:
            deduped_categories.append(category)

    seen: set[str] = set()
    recommendations: list[StickerItem] = []
    for category in deduped_categories:
        for _ in range(4):
            path = select_sticker(category, {"record_recent": False, "recent_limit": 10})
            if not path or path in seen:
                continue
            seen.add(path)
            filename = path.split("/", 1)[1]
            recommendations.append(StickerItem(category=category, filename=filename, path=path))
            break
        if len(recommendations) >= limit:
            break

    return {"recommendations": [item.model_dump() for item in recommendations[:limit]]}


@router.get("/stickers/index")
async def get_sticker_index():
    """获取表情索引（用于前端搜索），包含内置+自定义表情。"""
    index = {}
    # 内置表情
    for cat_dir in STICKERS_DIR.iterdir():
        if cat_dir.is_dir():
            category = cat_dir.name
            for sticker_file in cat_dir.glob("*.webp"):
                index[f"{category}/{sticker_file.name}"] = {
                    'category': category,
                    'filename': sticker_file.name,
                    'path': f"{category}/{sticker_file.name}"
                }
    # 自定义表情
    from app_paths import DATA_DIR
    custom_dir = DATA_DIR / "config" / "stickers" / "custom"
    if custom_dir.exists():
        for sticker_file in custom_dir.glob("*.webp"):
            index[f"custom/{sticker_file.name}"] = {
                'category': 'custom',
                'filename': sticker_file.name,
                'path': f"custom/{sticker_file.name}"
            }
    return {"index": index}
