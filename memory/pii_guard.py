# memory/pii_guard.py
"""PII（个人身份信息）脱敏工具。在存储到记忆系统前清理敏感信息。"""
from __future__ import annotations

import re

# PII 正则模式
PII_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # 邮箱
    ("[EMAIL]", re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')),
    # 手机号（11位）
    ("[PHONE]", re.compile(r'\b1[3-9]\d{9}\b')),
    # 身份证号（18位）
    ("[ID_CARD]", re.compile(r'\b\d{17}[\dXx]\b')),
    # API Key（sk- 开头）
    ("[API_KEY]", re.compile(r'sk-[a-zA-Z0-9]{16,}')),
    # 银行卡号（16-19位连续数字）
    ("[BANK_CARD]", re.compile(r'\b\d{16,19}\b')),
]

# 合并的正则
PII_PATTERN = re.compile('|'.join(
    f'(?P<pattern_{i}>{p.pattern})' for i, (_, p) in enumerate(PII_PATTERNS)
))


def scrub_pii(text: str, *, max_length: int = 500) -> str:
    """脱敏文本中的 PII 信息。

    Args:
        text: 原始文本
        max_length: 最大字符长度（超长截断）

    Returns:
        脱敏后的文本
    """
    if not text:
        return text

    result = text
    for replacement, pattern in PII_PATTERNS:
        result = pattern.sub(replacement, result)

    # 长度限制
    if len(result) > max_length:
        result = result[:max_length] + "...(truncated)"

    return result
