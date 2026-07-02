"""表情偏好反馈入口。

把收藏、取消收藏、显式跳过、用户主动使用等事件集中到这里，避免各路由直接操作偏好内部结构。
"""

from typing import Callable

from tools.sticker_preferences import StickerPreferences, get_preferences


def _sticker_path(category: str, filename: str) -> str:
    return f"{category}/{filename}"


def _apply_feedback(update: Callable[[StickerPreferences], None]) -> None:
    """将一次反馈路径内的多个偏好变更合并为一次最终落盘。"""
    prefs = get_preferences()
    prefs.apply_feedback(update)


def on_sticker_used(category: str, filename: str) -> None:
    """用户主动选择发送某个表情。"""
    sticker_path = _sticker_path(category, filename)
    _apply_feedback(
        lambda prefs: (
            prefs.maybe_decay_scores(save=False),
            prefs.record_usage(sticker_path, save=False),
            prefs.boost_category(category, amount=0.03, save=False),
        )
    )


def on_favorite_added(category: str, filename: str) -> None:
    """用户收藏某个表情，视为强正反馈。"""
    sticker_path = _sticker_path(category, filename)
    _apply_feedback(
        lambda prefs: (
            prefs.maybe_decay_scores(save=False),
            prefs.record_usage(sticker_path, save=False),
            prefs.boost_category(category, amount=0.1, save=False),
        )
    )


def on_favorite_removed(category: str, filename: str) -> None:
    """用户取消收藏某个表情，降低对应分类权重。"""
    _apply_feedback(
        lambda prefs: (
            prefs.maybe_decay_scores(save=False),
            prefs.reduce_category(category, amount=0.05, save=False),
        )
    )


def on_sticker_skipped(category: str, filename: str) -> None:
    """用户明确表示减少推荐某个表情。"""
    sticker_path = _sticker_path(category, filename)
    _apply_feedback(
        lambda prefs: (
            prefs.maybe_decay_scores(save=False),
            prefs.record_skip(sticker_path, save=False),
            prefs.reduce_category(category, amount=0.03, save=False),
        )
    )


def decay_scores(force: bool = False) -> bool:
    """定期衰减单表情评分。"""
    prefs = get_preferences()
    if force:
        prefs.decay_scores()
        return True
    return prefs.maybe_decay_scores()
