# memory/rolling_summary.py
"""滚动摘要格式契约。

输出格式固定为 facts + timeline 两节，保证 LLM 输出可解析。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class RollingSummary:
    """滚动摘要数据结构。"""
    facts: list[str] = field(default_factory=list)
    timeline: list[str] = field(default_factory=list)


def format_rolling_summary(summary: RollingSummary) -> str:
    """格式化滚动摘要为文本。"""
    lines: list[str] = []

    lines.append("## Facts")
    if summary.facts:
        for fact in summary.facts:
            lines.append(f"- {fact}")
    else:
        lines.append("(暂无)")

    lines.append("")
    lines.append("## Timeline")
    if summary.timeline:
        for event in summary.timeline:
            lines.append(f"- {event}")
    else:
        lines.append("(暂无)")

    return "\n".join(lines)


_FACTS_PATTERN = re.compile(r'##\s*Facts?\s*\n(.*?)(?=\n##\s|$)', re.DOTALL)
_TIMELINE_PATTERN = re.compile(r'##\s*Timeline\s*\n(.*?)(?=\n##\s|$)', re.DOTALL)


def parse_rolling_summary(text: str) -> RollingSummary:
    """解析滚动摘要文本。"""
    facts: list[str] = []
    timeline: list[str] = []

    facts_match = _FACTS_PATTERN.search(text)
    if facts_match:
        for line in facts_match.group(1).strip().split('\n'):
            line = line.strip()
            if line.startswith('- '):
                facts.append(line[2:].strip())
            elif line and line != "(暂无)":
                facts.append(line)

    timeline_match = _TIMELINE_PATTERN.search(text)
    if timeline_match:
        for line in timeline_match.group(1).strip().split('\n'):
            line = line.strip()
            if line.startswith('- '):
                timeline.append(line[2:].strip())
            elif line and line != "(暂无)":
                timeline.append(line)

    return RollingSummary(facts=facts, timeline=timeline)
