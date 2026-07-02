"""用户偏好学习器 — 基于交互反馈调整表情选择权重。

记录用户对表情的反馈：
- 收藏 = 强正反馈
- 跳过（未选择）= 弱负反馈
- 重复使用 = 正反馈

构建用户偏好向量，用于调整表情选择权重。
"""

import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from api.yaml_store import dump_yaml_atomic, load_yaml, yaml_file_lock
from app_paths import DATA_DIR

PREFERENCES_PATH = DATA_DIR / "api" / "data" / "sticker_preferences.yaml"
logger = logging.getLogger(__name__)

DEFAULT_CATEGORY_WEIGHTS = {
    "开心": 1.0,
    "无语": 1.0,
    "委屈": 1.0,
    "悲伤": 1.0,
    "害羞": 1.0,
    "生气": 1.0,
    "惊讶": 1.0,
    "尴尬": 1.0,
    "撒娇": 1.0,
    "得意": 1.0,
    "爱心": 1.0,
    "日常": 1.0,
}


def _default_preferences_data() -> dict:
    now = datetime.now().isoformat()
    return {
        "category_weights": dict(DEFAULT_CATEGORY_WEIGHTS),
        "sticker_scores": {},
        "usage_count": {},
        "last_updated": now,
        "last_decay_at": now,
    }


def _coerce_float_map(value: object, *, minimum: float | None = None, maximum: float | None = None) -> dict[str, float]:
    result: dict[str, float] = {}
    if not isinstance(value, dict):
        return result

    for key, item in value.items():
        if not isinstance(key, str):
            continue
        try:
            number = float(item)
        except (TypeError, ValueError):
            continue
        if minimum is not None:
            number = max(minimum, number)
        if maximum is not None:
            number = min(maximum, number)
        result[key] = number
    return result


def _coerce_int_map(value: object, *, minimum: int | None = None) -> dict[str, int]:
    result: dict[str, int] = {}
    if not isinstance(value, dict):
        return result

    for key, item in value.items():
        if not isinstance(key, str):
            continue
        try:
            number = int(item)
        except (TypeError, ValueError):
            continue
        if minimum is not None:
            number = max(minimum, number)
        result[key] = number
    return result


def _normalize_preferences_data(data: object) -> dict:
    default_data = _default_preferences_data()
    if not isinstance(data, dict):
        return default_data

    category_weights = dict(DEFAULT_CATEGORY_WEIGHTS)
    category_weights.update(_coerce_float_map(data.get("category_weights"), minimum=0.0))

    sticker_scores = _coerce_float_map(data.get("sticker_scores"))
    usage_count = _coerce_int_map(data.get("usage_count"), minimum=0)

    last_updated = data.get("last_updated")
    if not isinstance(last_updated, str) or not last_updated:
        last_updated = default_data["last_updated"]

    last_decay_at = data.get("last_decay_at")
    if not isinstance(last_decay_at, str) or not last_decay_at:
        last_decay_at = last_updated

    return {
        "category_weights": category_weights,
        "sticker_scores": sticker_scores,
        "usage_count": usage_count,
        "last_updated": last_updated,
        "last_decay_at": last_decay_at,
    }


def _load_yaml_safe(path: Path) -> dict:
    """安全加载 YAML 文件，文件不存在时返回默认结构。"""
    default_data = _default_preferences_data()
    try:
        with yaml_file_lock(path):
            if not path.exists():
                return default_data
            return _normalize_preferences_data(load_yaml(path, default={}))
    except Exception:
        logger.warning("Failed to load sticker preferences from %s", path, exc_info=True)
        return default_data


# ── 偏好数据模型 ──────────────────────────────────────────────

class StickerPreferences:
    """用户表情偏好管理器。"""
    
    def __init__(self):
        self._lock = threading.RLock()
        self._data = _load_yaml_safe(PREFERENCES_PATH)
        self._category_weights: dict[str, float] = dict(
            self._data.get("category_weights", DEFAULT_CATEGORY_WEIGHTS)
        )
        self._sticker_scores: dict[str, float] = dict(self._data.get("sticker_scores", {}))
        self._usage_count: dict[str, int] = dict(self._data.get("usage_count", {}))
        self._last_updated: str = self._data.get("last_updated", "")
        self._last_decay_at: str = self._data.get("last_decay_at", self._last_updated)

    def _snapshot(self) -> dict:
        self._last_updated = datetime.now().isoformat()
        self._data = {
            "category_weights": dict(self._category_weights),
            "sticker_scores": dict(self._sticker_scores),
            "usage_count": dict(self._usage_count),
            "last_updated": self._last_updated,
            "last_decay_at": self._last_decay_at,
        }
        return self._data

    def _save_locked(self) -> None:
        data = self._snapshot()
        with yaml_file_lock(PREFERENCES_PATH):
            dump_yaml_atomic(PREFERENCES_PATH, data)
    
    def save(self):
        """保存偏好数据。"""
        with self._lock:
            self._save_locked()

    def apply_feedback(self, updater: Callable[["StickerPreferences"], None]) -> None:
        """批量应用一次反馈并只执行一次最终落盘。"""
        with self._lock:
            updater(self)
            self._save_locked()
    
    # ─ 分类权重 ──────────────────────────────────────────────
    
    def get_category_weight(self, category: str) -> float:
        """获取某个情绪分类的权重。"""
        with self._lock:
            return self._category_weights.get(category, 1.0)
    
    def boost_category(self, category: str, amount: float = 0.1, save: bool = True):
        """提升某个分类的权重（用户选择了该分类的表情）。"""
        with self._lock:
            current = self._category_weights.get(category, 1.0)
            self._category_weights[category] = min(current + amount, 3.0)  # 上限 3.0
            if save:
                self._save_locked()
    
    def reduce_category(self, category: str, amount: float = 0.05, save: bool = True):
        """降低某个分类的权重（用户跳过了该分类的表情）。"""
        with self._lock:
            current = self._category_weights.get(category, 1.0)
            self._category_weights[category] = max(current - amount, 0.3)  # 下限 0.3
            if save:
                self._save_locked()
    
    # ── 单表情评分 ─────────────────────────────────────────────
    
    def get_sticker_score(self, path: str) -> float:
        """获取某个表情的评分。"""
        with self._lock:
            return self._sticker_scores.get(path, 0.0)

    def get_usage_count(self, path: str) -> int:
        """获取某个表情的使用次数。"""
        with self._lock:
            return self._usage_count.get(path, 0)
    
    def record_usage(self, path: str, save: bool = True):
        """记录表情被使用（正反馈）。"""
        with self._lock:
            current_score = self._sticker_scores.get(path, 0.0)
            # M2: 分数衰减 — 每次使用 +1.0，但上限 10.0 防止膨胀
            self._sticker_scores[path] = min(current_score + 1.0, 10.0)
            
            current_count = self._usage_count.get(path, 0)
            self._usage_count[path] = current_count + 1

            if save:
                self._save_locked()
    
    def record_skip(self, path: str, save: bool = True):
        """记录表情被跳过（弱负反馈）。"""
        with self._lock:
            current_score = self._sticker_scores.get(path, 0.0)
            self._sticker_scores[path] = max(current_score - 0.1, -5.0)  # 下限 -5.0
            if save:
                self._save_locked()

    def decay_scores(self, factor: float = 0.95, save: bool = True):
        """衰减单表情评分，避免早期反馈永久支配选择结果。"""
        with self._lock:
            factor = max(0.0, min(factor, 1.0))
            self._sticker_scores = {
                path: round(score * factor, 4)
                for path, score in self._sticker_scores.items()
                if abs(score * factor) >= 0.01
            }
            self._last_decay_at = datetime.now().isoformat()
            if save:
                self._save_locked()

    def maybe_decay_scores(self, interval_days: int = 7, factor: float = 0.95, save: bool = True) -> bool:
        """到达衰减周期时自动衰减一次，返回是否执行了衰减。"""
        with self._lock:
            try:
                last_decay = datetime.fromisoformat(self._last_decay_at)
            except (TypeError, ValueError):
                last_decay = datetime.min

            if (datetime.now() - last_decay).days < interval_days:
                return False

            self.decay_scores(factor=factor, save=save)
            return True
    
    # ── 偏好查询 ──────────────────────────────────────────────
    
    def get_favorite_categories(self) -> list[str]:
        """获取用户偏好的分类（权重 > 1.5）。"""
        with self._lock:
            return [cat for cat, weight in self._category_weights.items() if weight > 1.5]
    
    def get_avoided_categories(self) -> list[str]:
        """获取用户避免的分类（权重 < 0.7）。"""
        with self._lock:
            return [cat for cat, weight in self._category_weights.items() if weight < 0.7]
    
    def get_top_stickers(self, limit: int = 20) -> list[tuple[str, float]]:
        """获取评分最高的表情。"""
        with self._lock:
            sorted_stickers = sorted(
                self._sticker_scores.items(),
                key=lambda x: x[1],
                reverse=True
            )
            return sorted_stickers[:limit]
    
    def reset(self):
        """重置所有偏好数据。"""
        with self._lock:
            self._category_weights = dict(DEFAULT_CATEGORY_WEIGHTS)
            self._sticker_scores = {}
            self._usage_count = {}
            self._last_decay_at = datetime.now().isoformat()
            self._save_locked()


# ── 全局单例 ──────────────────────────────────────────────────

_preferences_instance: Optional[StickerPreferences] = None
_preferences_lock = threading.Lock()  # L7: 线程安全


def get_preferences() -> StickerPreferences:
    """获取全局偏好管理器实例。"""
    global _preferences_instance
    if _preferences_instance is None:
        with _preferences_lock:
            if _preferences_instance is None:  # 双重检查
                _preferences_instance = StickerPreferences()
    return _preferences_instance
