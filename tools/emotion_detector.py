"""情绪检测器 — 细粒度情绪识别 + 上下文感知。

将 12 个大类扩展为 30+ 种子情绪，支持：
1. 从文本中检测情绪（用于 AI 自动决定发表情）
2. 细粒度情绪 → 大类映射（用于表情选择）
3. 上下文感知（对话阶段、用户情绪响应）
"""

import re
from dataclasses import dataclass
from typing import Optional


# ── 细粒度情绪体系 ─────────────────────────────────────────────

@dataclass(frozen=True)
class FineEmotion:
    """子情绪定义。"""
    name: str          # 子情绪名（LLM 可使用）
    category: str      # 所属大类
    intensity: float   # 强度 0.0-1.0
    keywords: tuple[str, ...]  # 触发关键词


EMOTION_CATEGORIES: tuple[str, ...] = (
    "开心", "无语", "委屈", "悲伤", "害羞", "生气",
    "惊讶", "尴尬", "撒娇", "得意", "爱心", "日常",
)


# 30+ 种子情绪定义
FINE_EMOTIONS: list[FineEmotion] = [
    # ── 开心系 ──
    FineEmotion("大笑", "开心", 0.9, ("哈哈哈", "哈哈哈哈", "笑死", "lol", "xswl")),
    FineEmotion("兴奋", "开心", 0.8, ("好耶", "太棒了", "太好了", "耶", "哇塞")),
    FineEmotion("满足", "开心", 0.6, ("真好", "幸福", "开心", "满足", "舒服")),
    FineEmotion("欣慰", "开心", 0.5, ("放心了", "还好", "没事就好", "那就好")),
    FineEmotion("惊喜", "开心", 0.7, ("哇", "天哪", "真的吗", "不敢相信")),
    
    # ── 甜蜜系 ──
    FineEmotion("幸福", "爱心", 0.8, ("幸福", "甜蜜", "好甜", "心动")),
    FineEmotion("温馨", "爱心", 0.6, ("温暖", "温馨", "暖心", "感动")),
    FineEmotion("浪漫", "爱心", 0.7, ("浪漫", "约会", "烛光", "玫瑰")),
    FineEmotion("心动", "爱心", 0.9, ("心动", "小鹿乱撞", "心跳", "脸红心跳")),
    
    # ── 想念系 ──
    FineEmotion("思念", "爱心", 0.7, ("想你", "想念", "想你啦", "miss u")),
    FineEmotion("表白", "爱心", 0.9, ("爱你", "喜欢你", "爱你哦", "love u")),
    FineEmotion("感激", "爱心", 0.6, ("谢谢", "感谢", "谢谢你", "感恩")),
    
    # ── 难过系 ──
    FineEmotion("哭泣", "悲伤", 0.9, ("呜呜", "哭了", "流泪", "😭")),
    FineEmotion("伤心", "悲伤", 0.7, ("伤心", "难过", "心痛", "心碎")),
    FineEmotion("失落", "悲伤", 0.5, ("失落", "失望", "沮丧", "郁闷")),
    FineEmotion("绝望", "悲伤", 1.0, ("绝望", "完了", "没救了", "崩溃")),
    
    # ── 委屈系 ──
    FineEmotion("可怜", "委屈", 0.7, ("可怜", "好惨", "太惨了", "心疼")),
    FineEmotion("求安慰", "委屈", 0.6, ("安慰我", "抱抱", "求抱抱", "摸摸头")),
    FineEmotion("被误解", "委屈", 0.8, ("冤枉", "误解", "不是这样的", "你听我解释")),
    
    # ── 愤怒系 ──
    FineEmotion("愤怒", "生气", 0.9, ("生气", "愤怒", "气死了", "混蛋")),
    FineEmotion("不满", "生气", 0.6, ("不满", "不满意", "不喜欢", "讨厌")),
    FineEmotion("炸毛", "生气", 0.8, ("炸毛", "炸了", "暴躁", "抓狂")),
    FineEmotion("吃醋", "生气", 0.7, ("吃醋", "嫉妒", "酸了", "柠檬")),
    
    # ── 无语系 ──
    FineEmotion("无奈", "无语", 0.6, ("无奈", "没办法", "好吧", "行吧")),
    FineEmotion("翻白眼", "无语", 0.7, ("翻白眼", "呵呵", "哦", "行")),
    FineEmotion("冷漠", "无语", 0.5, ("冷漠", "随便", "无所谓", "哦")),
    FineEmotion("心累", "无语", 0.8, ("心累", "累了", "疲惫", "好累")),
    
    # ── 害羞系 ──
    FineEmotion("脸红", "害羞", 0.7, ("脸红", "害羞", "不好意思", "尴尬")),
    FineEmotion("腼腆", "害羞", 0.5, ("腼腆", "内向", "不敢", "怯")),
    FineEmotion("紧张", "害羞", 0.6, ("紧张", "忐忑", "不安", "慌")),
    
    # ── 惊讶系 ──
    FineEmotion("震惊", "惊讶", 0.9, ("震惊", "震惊了", "天哪", "我的天")),
    FineEmotion("意外", "惊讶", 0.7, ("意外", "没想到", "居然", "竟然")),
    FineEmotion("吃惊", "惊讶", 0.8, ("吃惊", "吓到", "哇", "啊")),
    
    # ── 尴尬系 ──
    FineEmotion("局促", "尴尬", 0.6, ("局促", "手足无措", "不知道咋办")),
    FineEmotion("社死", "尴尬", 0.9, ("社死", "社会性死亡", "丢人", "丢脸")),
    FineEmotion("无语凝噎", "尴尬", 0.7, ("无语凝噎", "不知道该说什么", "沉默")),
    
    # ── 撒娇系 ──
    FineEmotion("卖萌", "撒娇", 0.7, ("卖萌", "萌", "可爱", "萌萌哒")),
    FineEmotion("求关注", "撒娇", 0.6, ("求关注", "理我嘛", "看看我", "在吗")),
    FineEmotion("依赖", "撒娇", 0.8, ("依赖", "离不开", "要你陪", "别走")),
    
    # ── 得意系 ──
    FineEmotion("骄傲", "得意", 0.7, ("骄傲", "自豪", "厉害吧", "我棒不棒")),
    FineEmotion("瑟", "得意", 0.8, ("嘚瑟", "炫耀", "显摆", "得意")),
    FineEmotion("小确幸", "得意", 0.5, ("小确幸", "小开心", "满足", "知足")),
    
    # ── 日常系 ──
    FineEmotion("问候", "日常", 0.3, ("你好", "在吗", "早", "晚上好")),
    FineEmotion("晚安", "日常", 0.4, ("晚安", "好梦", "睡啦", "休息")),
    FineEmotion("打招呼", "日常", 0.3, ("嗨", "hello", "hi", "哟")),
    FineEmotion("敷衍", "日常", 0.2, ("嗯", "哦", "好", "行", "知道了")),
]

EMOTION_ALIASES: dict[str, str] = {
    "高兴": "开心",
    "快乐": "开心",
    "兴奋": "开心",
    "哈哈": "开心",
    "笑": "开心",
    "无奈": "无语",
    "冷漠": "无语",
    "翻白眼": "无语",
    "心累": "无语",
    "难过": "悲伤",
    "哭泣": "悲伤",
    "伤心": "悲伤",
    "失落": "悲伤",
    "脸红": "害羞",
    "腼腆": "害羞",
    "不好意思": "害羞",
    "愤怒": "生气",
    "不满": "生气",
    "炸毛": "生气",
    "震惊": "惊讶",
    "意外": "惊讶",
    "吃惊": "惊讶",
    "局促": "尴尬",
    "无语凝噎": "尴尬",
    "卖萌": "撒娇",
    "哼哼": "撒娇",
    "求关注": "撒娇",
    "骄傲": "得意",
    "嘚瑟": "得意",
    "自信": "得意",
    "幸福": "爱心",
    "甜蜜": "爱心",
    "温馨": "爱心",
    "浪漫": "爱心",
    "心动": "爱心",
    "喜欢": "爱心",
    "想念": "爱心",
    "思念": "爱心",
    "表白": "爱心",
    "感激": "爱心",
    "爱": "爱心",
    "问候": "日常",
    "晚安": "日常",
    "打招呼": "日常",
    "早安": "日常",
}

FINE_EMOTION_CATEGORY_MAP: dict[str, str] = {
    emotion.name: emotion.category for emotion in FINE_EMOTIONS
}

# 构建快速查找表（dict→list 形式，共享关键词保留所有情绪，匹配时选强度最高的）
_KEYWORD_TO_EMOTIONS: dict[str, list[FineEmotion]] = {}
for _emotion in FINE_EMOTIONS:
    for _kw in _emotion.keywords:
        _KEYWORD_TO_EMOTIONS.setdefault(_kw.lower(), []).append(_emotion)


# ── 公开 API ──────────────────────────────────────────────────

def detect_emotion_from_text(text: str) -> Optional[FineEmotion]:
    """从文本中检测最匹配的细粒度情绪。
    
    Args:
        text: 用户或 AI 的文本
        
    Returns:
        匹配的 FineEmotion，或 None
    """
    if not text:
        return None
    
    text_lower = text.lower()
    
    # 1. 精确关键词匹配（最高优先级，共享关键词选强度最高的）
    matched_emotions: list[FineEmotion] = []
    for keyword, emotions in _KEYWORD_TO_EMOTIONS.items():
        if keyword in text_lower:
            matched_emotions.extend(emotions)
    
    if matched_emotions:
        # 选强度最高的
        return max(matched_emotions, key=lambda e: e.intensity)
    
    # 2. 模糊匹配（关键词包含在文本中，或文本包含在关键词中）
    best_match: Optional[FineEmotion] = None
    best_score = 0.0
    
    for emotion in FINE_EMOTIONS:
        for keyword in emotion.keywords:
            kw_lower = keyword.lower()
            if kw_lower in text_lower or text_lower in kw_lower:
                # 计算匹配分数：关键词越长、强度越高，分数越高
                score = len(kw_lower) * emotion.intensity
                if score > best_score:
                    best_score = score
                    best_match = emotion
    
    return best_match


def detect_emotion_category(text: str) -> str:
    """从文本中检测情绪大类（12 分类）。
    
    Args:
        text: 用户或 AI 的文本
        
    Returns:
        情绪大类名（如 "开心"、"悲伤" 等）
    """
    emotion = detect_emotion_from_text(text)
    if emotion:
        return emotion.category
    return "日常"


def normalize_emotion_category(raw: str | None, default: str = "日常") -> str:
    """将细粒度情绪、别名或模糊表达统一成 12 类标准分类。"""
    if not raw:
        return default

    value = raw.strip()
    if not value:
        return default

    if value in EMOTION_CATEGORIES:
        return value

    if value in EMOTION_ALIASES:
        return EMOTION_ALIASES[value]

    if value in FINE_EMOTION_CATEGORY_MAP:
        return FINE_EMOTION_CATEGORY_MAP[value]

    for category in EMOTION_CATEGORIES:
        if category in value or value in category:
            return category

    for alias, category in EMOTION_ALIASES.items():
        if alias in value or value in alias:
            return category

    return default


def get_emotions_by_category(category: str) -> list[FineEmotion]:
    """获取某个大类下的所有子情绪。
    
    Args:
        category: 大类名（如 "开心"）
        
    Returns:
        该大类下的所有 FineEmotion 列表
    """
    return [e for e in FINE_EMOTIONS if e.category == category]


def get_all_categories() -> list[str]:
    """获取所有大类列表。"""
    return list(EMOTION_CATEGORIES)
