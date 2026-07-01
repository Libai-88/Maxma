"""Tool: sticker_utils — 表情包解析工具。

解析 LLM 输出中的 [表情包] 或 [表情包:情绪] 占位符，
从本地表情库随机选取对应情绪的表情，替换为 <sticker:category/filename> 标记。
"""

import logging
import random
import re
import time
from pathlib import Path

from app_paths import BUNDLE_DIR

logger = logging.getLogger(__name__)

# 正则匹配 [表情包] 或 [表情包:情绪分类]
STICKER_RE = re.compile(r'\[表情包(?::([^\]]+))?\]', re.IGNORECASE)

# 表情库根目录（打包后在 _MEIPASS/config/stickers/）
STICKERS_DIR = BUNDLE_DIR / "config" / "stickers"

# 12 情绪分类
EMOTION_CATEGORIES = [
    "开心", "无语", "委屈", "悲伤", "害羞", "生气",
    "惊讶", "尴尬", "撒娇", "得意", "爱心", "日常",
]

# 模糊匹配：LLM 可能输出近义分类名
EMOTION_ALIASES = {
    "高兴": "开心", "快乐": "开心", "兴奋": "开心", "哈哈": "开心", "笑": "开心",
    "无奈": "无语", "冷漠": "无语", "翻白眼": "无语",
    "难过": "悲伤", "哭泣": "悲伤", "伤心": "悲伤", "失落": "悲伤",
    "脸红": "害羞", "腼腆": "害羞", "不好意思": "害羞",
    "愤怒": "生气", "不满": "生气", "炸毛": "生气",
    "震惊": "惊讶", "意外": "惊讶", "吃惊": "惊讶",
    "局促": "尴尬", "无语凝噎": "尴尬",
    "卖萌": "撒娇", "哼哼": "撒娇", "求关注": "撒娇",
    "骄傲": "得意", "嘚瑟": "得意", "自信": "得意",
    "喜欢": "爱心", "想念": "爱心", "表白": "爱心", "爱": "爱心",
    "问候": "日常", "晚安": "日常", "打招呼": "日常", "早安": "日常",
}


def _resolve_emotion(raw: str) -> str:
    """将 LLM 输出的情绪名解析为标准分类名。"""
    if not raw:
        return "日常"
    raw = raw.strip()
    # 直接匹配
    if raw in EMOTION_CATEGORIES:
        return raw
    # 别名匹配
    if raw in EMOTION_ALIASES:
        return EMOTION_ALIASES[raw]
    # 模糊匹配（包含关系）
    for alias, standard in EMOTION_ALIASES.items():
        if alias in raw or raw in alias:
            return standard
    # 兜底：日常
    return "日常"


_sticker_cache: dict[str, tuple[list[Path], float]] = {}
_STICKER_CACHE_TTL = 30.0

def _get_random_sticker(category: str) -> str | None:
    """从指定分类目录随机选一张 WebP 表情，返回相对路径（category/filename.webp）。"""
    cat_dir = STICKERS_DIR / category
    if not cat_dir.is_dir():
        return None
    now = time.time()
    cached = _sticker_cache.get(category)
    if cached and (now - cached[1]) < _STICKER_CACHE_TTL:
        files = cached[0]
    else:
        files = list(cat_dir.glob("*.webp"))
        _sticker_cache[category] = (files, now)
    if not files:
        return None
    chosen = random.choice(files)
    return f"{category}/{chosen.name}"


def process_stickers(text: str) -> tuple[str, list[str]]:
    """解析文本中的表情包占位符。

    Args:
        text: LLM 原始输出文本

    Returns:
        (处理后的文本, 贴纸文件相对路径列表)
    """
    if not text or not STICKER_RE.search(text):
        return text, []

    stickers = []

    def replace_sticker(match: re.Match) -> str:
        raw_emotion = match.group(1)  # 可能为 None（即 [表情包] 无分类）
        category = _resolve_emotion(raw_emotion or "")
        sticker_path = _get_random_sticker(category)
        if sticker_path:
            stickers.append(sticker_path)
            return f"<sticker:{sticker_path}>"
        # 找不到表情，删除占位符
        return ""

    processed = STICKER_RE.sub(replace_sticker, text)
    return processed, stickers


_cat_cache: tuple[dict[str, int], float] | None = None

def get_sticker_categories() -> dict[str, int]:
    """返回各分类的表情数量统计（用于调试/管理界面）。"""
    global _cat_cache
    now = time.time()
    if _cat_cache is not None and (now - _cat_cache[1]) < _STICKER_CACHE_TTL:
        return _cat_cache[0]
    result = {}
    for cat in EMOTION_CATEGORIES:
        cat_dir = STICKERS_DIR / cat
        if cat_dir.is_dir():
            result[cat] = len(list(cat_dir.glob("*.webp")))
        else:
            result[cat] = 0
    _cat_cache = (result, now)
    return result
