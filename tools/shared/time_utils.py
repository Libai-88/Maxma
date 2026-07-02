"""共享时间工具模块。

统一时间段判定逻辑，消除 sticker_decision.py 和 sticker_selector.py 之间的不一致。
所有时间相关判定都应引用此模块。
"""

import hashlib
from datetime import datetime


# ── 时间段定义 ─────────────────────────────────────────────

TIME_PERIOD_DETAILS: tuple[tuple[str, int, int], ...] = (
    ("late_night", 23, 24),
    ("late_night", 0, 5),
    ("dawn", 5, 7),
    ("morning", 7, 11),
    ("noon", 11, 14),
    ("afternoon", 14, 18),
    ("evening", 18, 21),
    ("night", 21, 23),
)

_DETAIL_TO_COMPAT_PERIOD = {
    "late_night": "late_night",
    "dawn": "morning",
    "morning": "morning",
    "noon": "work",
    "afternoon": "work",
    "evening": "evening",
    "night": "evening",
}


def get_time_period_detail(hour: int | None = None) -> str:
    """返回贴纸系统内部使用的细粒度时间段。"""
    if hour is None:
        hour = datetime.now().hour

    for period, start, end in TIME_PERIOD_DETAILS:
        if start <= hour < end:
            return period
    return "late_night"


def get_time_period(hour: int | None = None) -> str:
    """获取兼容旧调用方的时间段。

    Args:
        hour: 小时数（0-23），默认为当前系统时间

    Returns:
        兼容时间段标识：'late_night' / 'morning' / 'work' / 'evening'
    """
    detail = get_time_period_detail(hour)
    return _DETAIL_TO_COMPAT_PERIOD.get(detail, "evening")


# ── 时间 → 情绪分类权重映射 ─────────────────────────────────

# 不同时间段对情绪分类的权重加成
# 格式：{时间段：{情绪分类：权重倍数}}
TIME_CATEGORY_BOOST = {
    "late_night": {
        # 深夜：温馨、想念类表情加成
        "爱心": 1.5,
        "悲伤": 1.3,
        "委屈": 1.2,
    },
    "dawn": {
        # 清晨：问候和轻度撒娇更自然
        "日常": 1.25,
        "撒娇": 1.1,
    },
    "morning": {
        # 早晨：活力、问候类表情加成
        "开心": 1.3,
        "日常": 1.2,
    },
    "noon": {
        # 中午：闲聊和轻吐槽更常见
        "日常": 1.15,
        "无语": 1.15,
    },
    "afternoon": {
        # 下午：轻松鼓劲，但不过度偏情绪化
        "开心": 1.1,
        "无语": 1.1,
    },
    "evening": {
        # 傍晚：放松、温馨类表情加成
        "开心": 1.2,
        "爱心": 1.1,
    },
    "night": {
        # 夜间：亲密度和软性表达升高
        "爱心": 1.3,
        "撒娇": 1.2,
        "日常": 1.05,
    },
}


# ── 便捷函数 ──────────────────────────────────────────────

def get_time_boost(category: str, hour: int | None = None) -> float:
    """获取指定情绪分类在当前时间段的权重加成。"""
    period = get_time_period_detail(hour)
    boost_map = TIME_CATEGORY_BOOST.get(period, {})
    return boost_map.get(category, 1.0)


def get_time_candidate_boost(
    category: str,
    sticker_key: str,
    hour: int | None = None,
) -> float:
    """把时间因素作用到单个候选贴纸上，而不是只对整类做无效乘法。"""
    base = get_time_boost(category, hour)
    if base == 1.0:
        return 1.0

    period = get_time_period_detail(hour)
    digest = hashlib.blake2b(
        f"{period}:{category}:{sticker_key}".encode("utf-8"),
        digest_size=2,
    ).digest()
    offset = int.from_bytes(digest, "big") / 65535.0
    return base * (0.85 + offset * 0.3)
