# tests/test_memory/test_rolling_summary.py
import pytest
from memory.rolling_summary import format_rolling_summary, parse_rolling_summary, RollingSummary

def test_format_rolling_summary():
    summary = RollingSummary(
        facts=["用户喜欢Python", "用户是开发者"],
        timeline=["讨论了编程语言", "提到了项目架构"],
    )
    text = format_rolling_summary(summary)
    assert "## Facts" in text or "## 事实" in text
    assert "用户喜欢Python" in text
    assert "## Timeline" in text or "## 时间线" in text

def test_parse_rolling_summary():
    text = """## Facts
- 用户喜欢Python
- 用户是开发者

## Timeline
- 讨论了编程语言
- 提到了项目架构"""
    summary = parse_rolling_summary(text)
    assert len(summary.facts) == 2
    assert "用户喜欢Python" in summary.facts[0]
    assert len(summary.timeline) == 2

def test_empty_summary():
    summary = RollingSummary(facts=[], timeline=[])
    text = format_rolling_summary(summary)
    parsed = parse_rolling_summary(text)
    assert parsed.facts == []
    assert parsed.timeline == []
