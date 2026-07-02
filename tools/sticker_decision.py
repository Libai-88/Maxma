"""表情发送决策器 — 上下文感知。

根据对话上下文智能决定：
1. 是否应该发送表情
2. 发送什么情绪的表情
3. 发送频率控制

替代原有的固定频率规则（每 3-4 条消息一个表情）。
"""

from dataclasses import dataclass
from datetime import datetime
import re
from typing import Optional

from tools.emotion_detector import FineEmotion, detect_emotion_from_text
from tools.shared.time_utils import get_time_period


@dataclass
class ConversationContext:
    """对话上下文信息。"""
    user_message: str           # 用户最新消息
    ai_recent_messages: list[str]  # AI 最近 N 条消息
    recent_sticker_count: int   # 最近消息中表情数量
    is_greeting: bool           # 是否开场对话
    is_farewell: bool           # 是否告别对话
    time_of_day: str            # 时间段：morning/afternoon/evening/night
    detected_emotion: Optional[FineEmotion] = None  # 用户消息情绪缓存


# ── 决策规则 ──────────────────────────────────────────────────

# 问候关键词
_GREETING_KEYWORDS = ("你好", "在吗", "早", "晚上好", "嗨", "hello", "hi", "哟", "回来了")
_FAREWELL_KEYWORDS = ("晚安", "拜拜", "再见", "睡了", "休息", "好梦", "明天见")


def _is_greeting(text: str) -> bool:
    """判断是否为问候消息。"""
    stripped = text.strip().lower()
    for kw in _GREETING_KEYWORDS:
        if kw == "早":
            if re.match(r"^早(安|上好|啊|呀|哇|喔|哦|～|~|！|!|，|,)?$", stripped):
                return True
            continue
        if kw.isascii():
            if re.search(rf"(?<![a-z0-9]){re.escape(kw)}(?![a-z0-9])", stripped):
                return True
            continue
        if kw in stripped:
            return True
    return False


def _is_farewell(text: str) -> bool:
    """判断是否为告别消息。"""
    text_lower = text.lower()
    return any(kw in text_lower for kw in _FAREWELL_KEYWORDS)


# ── 公开 API ──────────────────────────────────────────────────

def should_send_sticker(context: ConversationContext) -> bool:
    """决定是否应该发送表情。
    
    决策逻辑：
    1. 问候/告别 → 高概率发送
    2. 用户情绪强烈 → 发送回应表情
    3. 最近表情过多 → 降低概率
    4. 日常对话 → 按概率发送
    
    Args:
        context: 对话上下文
        
    Returns:
        True 表示应该发送表情
    """
    # 1. 最近表情过多 → 暂停发送，问候也不能绕过频控
    if context.recent_sticker_count >= 3:
        return False

    if context.ai_recent_messages:
        recent_ai_sticker_count = sum(
            1 for msg in context.ai_recent_messages[-5:]
            if '[表情包' in msg or '<sticker:' in msg
        )
        if recent_ai_sticker_count >= 2:
            return False

    # 2. 问候/告别场景 → 高概率发送
    if context.is_greeting or context.is_farewell:
        return True

    # 3. 检测用户情绪强度
    user_emotion = context.detected_emotion
    if user_emotion and user_emotion.intensity >= 0.7:
        # 用户情绪强烈（如大笑、哭泣、愤怒）→ 发送回应表情
        return True

    # 4. 深夜场景 → 提高发送概率（情感高峰时段）
    if context.time_of_day == "late_night":
        # 深夜 23:00-06:00 是情感高峰，提高概率
        return True

    # 5. 日常对话 → 按概率发送（约 30% 概率）
    # 使用用户消息长度的哈希来决定，确保同一消息结果一致
    msg_hash = sum(ord(c) for c in context.user_message) % 100
    return msg_hash < 30  # 30% 概率


def get_sticker_emotion(context: ConversationContext) -> str:
    """获取应该发送的表情情绪分类。
    
    决策逻辑：
    1. 用户情绪 → 发送对应或互补情绪
    2. 问候 → 开心/日常
    3. 告别 → 爱心/日常
    4. 深夜 → 温馨/爱心
    
    Args:
        context: 对话上下文
        
    Returns:
        情绪分类名（12 大类之一）
    """
    # 1. 用户情绪 → 发送对应情绪
    user_emotion = context.detected_emotion
    if user_emotion:
        # 对于负面情绪，发送安慰类表情（爱心/委屈）
        if user_emotion.category in ("悲伤", "委屈"):
            return "爱心"  # 安慰
        elif user_emotion.category == "生气":
            return "委屈"  # 示弱
        elif user_emotion.category == "尴尬":
            return "无语"  # 共情
        else:
            return user_emotion.category  # 同频
    
    # 2. 问候 → 开心
    if context.is_greeting:
        return "开心"
    
    # 3. 告别 → 爱心
    if context.is_farewell:
        return "爱心"
    
    # 4. 深夜 → 爱心（温馨）
    if context.time_of_day == "late_night":
        return "爱心"
    
    # 5. 默认 → 日常
    return "日常"


def build_context(
    user_message: str,
    ai_recent_messages: list[str],
    recent_sticker_count: int = 0,
) -> ConversationContext:
    """构建对话上下文对象。
    
    Args:
        user_message: 用户最新消息
        ai_recent_messages: AI 最近 N 条消息
        recent_sticker_count: 最近消息中表情数量
        
    Returns:
        ConversationContext 对象
    """
    return ConversationContext(
        user_message=user_message,
        ai_recent_messages=ai_recent_messages,
        recent_sticker_count=recent_sticker_count,
        is_greeting=_is_greeting(user_message),
        is_farewell=_is_farewell(user_message),
        time_of_day=get_time_period(),
        detected_emotion=detect_emotion_from_text(user_message),
    )
