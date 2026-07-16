# tests/test_memory/test_pii_guard.py
import pytest
from memory.pii_guard import scrub_pii, PII_PATTERNS

def test_scrub_email():
    assert scrub_pii("联系我: test@example.com") == "联系我: [EMAIL]"

def test_scrub_phone():
    assert scrub_pii("电话: 13812345678") == "电话: [PHONE]"

def test_scrub_api_key():
    assert "sk-" not in scrub_pii("key: sk-1234567890abcdef")
    assert "[API_KEY]" in scrub_pii("key: sk-1234567890abcdef")

def test_scrub_id_card():
    assert "[ID_CARD]" in scrub_pii("身份证: 110101199001011234")

def test_no_false_positive():
    """正常文本不应被脱敏"""
    text = "用户喜欢古典音乐"
    assert scrub_pii(text) == text
