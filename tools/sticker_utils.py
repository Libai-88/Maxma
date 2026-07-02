"""Tool: sticker_utils — 表情包解析工具。

解析 LLM 输出中的 [表情包] 或 [表情包:情绪] 占位符，
从本地表情库智能选取对应情绪的表情（避免重复、考虑偏好），
替换为 <sticker:category/filename> 标记。
"""

import logging
import re
import time
from pathlib import Path

from app_paths import BUNDLE_DIR
from tools.emotion_detector import EMOTION_CATEGORIES, normalize_emotion_category

logger = logging.getLogger(__name__)

# 正则匹配 [表情包] 或 [表情包:情绪分类]
STICKER_RE = re.compile(r'\[表情包(?::([^\]]+))?\]', re.IGNORECASE)

# 表情库根目录（打包后在 _MEIPASS/config/stickers/）
STICKERS_DIR = BUNDLE_DIR / "config" / "stickers"

def _resolve_emotion(raw: str) -> str:
    """将 LLM 输出的情绪名解析为标准分类名。"""
    return normalize_emotion_category(raw)


def _get_smart_sticker(category: str) -> str | None:
    """智能选择表情（避免重复、考虑偏好）。"""
    from tools.sticker_selector import select_sticker
    return select_sticker(category)


def process_stickers(
    text: str,
    user_message: str = "",
    ai_recent_messages: list[str] | None = None,
) -> tuple[str, list[str]]:
    """解析文本中的表情包占位符，支持分层决策架构。

    分层决策逻辑：
    1. LLM 主动模式：LLM 输出含 [表情包:情绪] → 直接解析替换
    2. 决策器补发模式：LLM 未输出表情 → 决策器判断是否补发

    Args:
        text: LLM 原始输出文本
        user_message: 用户最新消息（用于决策器判断）
        ai_recent_messages: AI 最近 N 条消息（用于决策器判断频率）

    Returns:
        (处理后的文本, 贴纸文件相对路径列表)
    """
    if not text:
        return text, []

    stickers: list[str] = []

    # ─ 模式 1：LLM 主动输出表情 ──────────────────────────────
    if STICKER_RE.search(text):
        def replace_sticker(match: re.Match) -> str:
            raw_emotion = match.group(1)  # 可能为 None（即 [表情包] 无分类）
            category = _resolve_emotion(raw_emotion or "")
            sticker_path = _get_smart_sticker(category)
            if sticker_path:
                stickers.append(sticker_path)
                return f"<sticker:{sticker_path}>"
            # 找不到表情，删除占位符
            return ""

        processed = STICKER_RE.sub(replace_sticker, text)
        return processed, stickers

    # ── 模式 2：决策器补发模式 ────────────────────────────────
    # LLM 未输出表情，决策器判断是否需要补发
    if user_message:
        try:
            from tools.sticker_decision import (
                should_send_sticker,
                get_sticker_emotion,
                build_context,
            )

            # 统计 AI 最近消息中的表情数量
            recent_sticker_count = 0
            if ai_recent_messages:
                recent_sticker_count = sum(
                    1 for msg in ai_recent_messages[-5:]
                    if '[表情包' in msg or '<sticker:' in msg
                )

            ctx = build_context(
                user_message,
                ai_recent_messages=ai_recent_messages or [],
                recent_sticker_count=recent_sticker_count,
            )

            if should_send_sticker(ctx):
                # 决策器决定补发表情
                emotion = get_sticker_emotion(ctx)
                sticker_path = _get_smart_sticker(emotion)
                if sticker_path:
                    stickers.append(sticker_path)
                    # 将表情追加到文本末尾
                    processed = text + f"\n<sticker:{sticker_path}>"
                    return processed, stickers
        except Exception:
            pass  # 决策器异常时不补发

    # 无表情需要处理
    return text, []


_cat_cache: tuple[dict[str, int], float] | None = None

def get_sticker_categories() -> dict[str, int]:
    """返回各分类的表情数量统计（用于调试/管理界面）。"""
    global _cat_cache
    now = time.time()
    if _cat_cache is not None and (now - _cat_cache[1]) < 30.0:
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
