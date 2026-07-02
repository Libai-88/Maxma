"""Smart sticker selector — 智能表情选择器。

基于上下文、用户偏好、时间场景等因素，从表情库中选择最合适的表情。
替代原有的纯随机选择策略。
"""

import random
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from app_paths import DATA_DIR, BUNDLE_DIR
from tools.emotion_detector import normalize_emotion_category
from tools.shared.time_utils import get_time_candidate_boost
import logging
logger = logging.getLogger(__name__)


# 表情库根目录
STICKERS_DIR = BUNDLE_DIR / "config" / "stickers"

# 用户偏好数据路径
PREFERENCES_PATH = DATA_DIR / "api" / "data" / "sticker_preferences.yaml"
RECENT_PATH = DATA_DIR / "api" / "data" / "sticker_recent.yaml"
FAVORITES_PATH = DATA_DIR / "api" / "data" / "sticker_favorites.yaml"

# 缓存：分类 → 文件列表
_sticker_cache: dict[str, tuple[list[Path], float]] = {}
_CACHE_TTL = 30.0


def _get_stickers_in_category(category: str) -> list[Path]:
    """获取指定分类下的所有表情文件（带缓存）。"""
    now = time.time()
    cached = _sticker_cache.get(category)
    if cached and (now - cached[1]) < _CACHE_TTL:
        return cached[0]
    
    cat_dir = STICKERS_DIR / category
    if not cat_dir.is_dir():
        return []
    
    files = list(cat_dir.glob("*.webp"))
    _sticker_cache[category] = (files, now)
    return files


def _load_yaml_safe(path: Path) -> dict:
    """安全加载 YAML 文件，文件不存在时返回空字典。"""
    import yaml
    if not path.exists():
        return {}
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


def get_recent_stickers(limit: int = 10) -> set[str]:
    """获取最近使用的表情（避免重复）。"""
    data = _load_yaml_safe(RECENT_PATH)
    recent = data.get('recent', [])
    # 返回最近 N 个表情的 category/filename 集合，避免跨分类同名误判
    return {
        f"{item.get('category', '')}/{item.get('filename', '')}"
        for item in recent[-limit:]
    }


def add_recent_sticker(category: str, filename: str) -> None:
    """记录表情为最近使用。"""
    data = _load_yaml_safe(RECENT_PATH)
    recent = data.get('recent', [])
    
    # 移除已存在的相同记录（同分类同文件）
    recent = [
        r for r in recent
        if not (r.get('filename') == filename and r.get('category') == category)
    ]
    
    # 添加到末尾
    recent.append({
        'category': category,
        'filename': filename,
        'used_at': datetime.now().isoformat()
    })
    
    # 保留最近 50 条
    recent = recent[-50:]
    
    data['recent'] = recent
    _save_yaml_safe(RECENT_PATH, data)


def get_favorite_stickers() -> set[str]:
    """获取用户收藏的表情。"""
    data = _load_yaml_safe(FAVORITES_PATH)
    favorites = data.get('favorites', [])
    return {
        f"{item.get('category', '')}/{item.get('filename', '')}"
        for item in favorites
    }


def get_user_preferences() -> dict:
    """获取用户偏好数据。"""
    return _load_yaml_safe(PREFERENCES_PATH)


def select_sticker(
    category: str,
    context: Optional[dict] = None
) -> Optional[str]:
    """智能选择表情。
    
    Args:
        category: 情绪分类名
        context: 上下文信息（可选）
            - recent_limit: 避免重复的最近数量（默认 10）
            - use_time_boost: 是否启用时间场景加成（默认 True）
            - use_favorites_boost: 是否启用收藏加成（默认 True）
            - record_recent: 是否写入最近使用（默认 True）
    
    Returns:
        相对路径字符串（category/filename.webp）或 None
    """
    raw_category = (category or "").strip()
    category = normalize_emotion_category(raw_category, default=raw_category or "日常")

    if context is None:
        context = {}
    
    recent_limit = context.get('recent_limit', 10)
    use_time_boost = context.get('use_time_boost', True)
    use_favorites_boost = context.get('use_favorites_boost', True)
    record_recent = context.get('record_recent', True)
    hour = context.get('hour')
    
    # 获取候选表情
    candidates = _get_stickers_in_category(category)
    if not candidates:
        return None
    
    # 构建权重表
    weights = []
    recent = get_recent_stickers(recent_limit)
    favorites = get_favorite_stickers()
    
    for sticker_path in candidates:
        filename = sticker_path.name
        sticker_key = f"{category}/{filename}"
        weight = 1.0
        
        # 1. 避免重复：最近用过的降低权重
        if sticker_key in recent:
            weight *= 0.1
        
        # 2. 收藏加成：用户收藏的提高权重
        if use_favorites_boost and sticker_key in favorites:
            weight *= 3.0
        
        # 2.5 用户偏好加成（Phase 3）
        try:
            from tools.sticker_preferences import get_preferences
            prefs = get_preferences()
            sticker_full_path = f"{category}/{filename}"
            # 单表情评分加成
            sticker_score = prefs.get_sticker_score(sticker_full_path)
            if sticker_score > 0:
                weight *= (1.0 + sticker_score * 0.1)  # 每分 +10%
            # 分类权重加成
            category_weight = prefs.get_category_weight(category)
            weight *= category_weight
        except Exception:
            pass  # 偏好系统未就绪时忽略

        # 3. 时间场景加成：按候选贴纸粒度做稳定偏置，避免整类统一乘数无效
        if use_time_boost:
            weight *= get_time_candidate_boost(category, sticker_key, hour)
        
        weights.append(weight)

    # 加权随机选择
    if sum(weights) == 0:
        # 所有权重都为 0，回退到均匀随机
        chosen = random.choice(candidates)
    else:
        chosen = random.choices(candidates, weights=weights, k=1)[0]
    
    # 推荐预览不应污染最近使用记录
    if record_recent:
        add_recent_sticker(category, chosen.name)
    
    return f"{category}/{chosen.name}"


def get_sticker_stats() -> dict:
    """获取表情库统计信息（用于调试）。"""
    stats = {}
    for cat_dir in sorted(STICKERS_DIR.iterdir()):
        if cat_dir.is_dir():
            count = len(list(cat_dir.glob("*.webp")))
            stats[cat_dir.name] = count
    return stats
