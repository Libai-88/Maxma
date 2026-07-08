# memory/deep_memory.py
"""Deep Memory：通过 snapshot diff 提取元事实。

比较新旧会话摘要，用 LLM 提取新出现的事实，存入 FactStore。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from memory.pii_guard import scrub_pii
from memory.rolling_summary import RollingSummary, parse_rolling_summary

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
MAX_CONCURRENT = 3

_EXTRACT_PROMPT = """分析以下会话摘要的变更，提取新出现的事实。

旧摘要：
{old_summary}

新摘要：
{new_summary}

请以 JSON 格式输出新事实，格式：
{{"facts": ["事实1", "事实2"], "timeline": ["事件1"]}}

只提取新摘要中有而旧摘要中没有的信息。如果没有新事实，返回空数组。
不要包含已有信息。"""


def extract_facts_from_diff(old_summary: str, new_summary: str) -> list[str]:
    """从摘要 diff 中提取新事实（简单文本差分，非 LLM）。"""
    old_lines = set(line.strip().lstrip('- ') for line in old_summary.split('\n') if line.strip())
    new_lines = [line.strip().lstrip('- ') for line in new_summary.split('\n') if line.strip()]

    new_facts: list[str] = []
    for line in new_lines:
        if line not in old_lines and line not in ['(暂无)', '## Facts', '## Timeline']:
            new_facts.append(line)
    return new_facts


class DeepMemoryProcessor:
    """Deep Memory 处理器：用 LLM 从 session diff 提取元事实。"""

    def __init__(self, *, llm: Any, fact_store: Any) -> None:
        self._llm = llm
        self._fact_store = fact_store
        self._fail_counts: dict[str, int] = {}
        self._fail_ttl = 3600  # 1 小时

    async def process_session_diff(
        self,
        *,
        session_id: str,
        old_summary: str,
        new_summary: str,
    ) -> int:
        """处理会话摘要 diff，提取事实存入 FactStore。

        Returns:
            提取的事实数量
        """
        # 检查失败计数
        if self._fail_counts.get(session_id, 0) >= MAX_RETRIES:
            logger.warning(f"Session {session_id} skipped due to consecutive failures")
            return 0

        try:
            prompt = _EXTRACT_PROMPT.format(
                old_summary=old_summary[:500],
                new_summary=new_summary[:500],
            )

            response = await self._llm.ainvoke(prompt)
            content = response.content if hasattr(response, 'content') else str(response)

            # 解析 JSON 输出
            facts_data = self._parse_json_response(content)
            if not facts_data:
                # 降级：用简单文本 diff
                new_facts = extract_facts_from_diff(old_summary, new_summary)
                facts_data = {"facts": new_facts, "timeline": []}

            facts = facts_data.get("facts", [])
            timeline = facts_data.get("timeline", [])

            # 脱敏后存入 FactStore
            count = 0
            for fact in facts:
                fact = scrub_pii(fact)
                if fact and len(fact) > 5:
                    self._fact_store.add(
                        content=fact,
                        tags=["deep_memory"],
                        source="session_diff",
                        session_id=session_id,
                    )
                    count += 1

            for event in timeline:
                event = scrub_pii(event)
                if event:
                    self._fact_store.add(
                        content=event,
                        tags=["timeline"],
                        source="session_diff",
                        session_id=session_id,
                    )

            # 成功，清零失败计数
            self._fail_counts[session_id] = 0
            logger.info(f"Deep memory: extracted {count} facts from session {session_id}")
            return count

        except Exception as e:
            self._fail_counts[session_id] = self._fail_counts.get(session_id, 0) + 1
            logger.error(f"Deep memory failed for session {session_id}: {e}")
            return 0

    def _parse_json_response(self, content: str) -> dict[str, Any] | None:
        """解析 LLM 的 JSON 输出（去掉 markdown fence）。"""
        # 去掉 markdown fence
        content = re.sub(r'^```json\s*', '', content.strip())
        content = re.sub(r'\s*```$', '', content)
        # 去掉前导思考块
        content = re.sub(r'^<thought>.*?</thought>\s*', '', content, flags=re.DOTALL)

        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # 尝试找到 JSON 数组
            match = re.search(r'\{[^{}]*"facts"[^{}]*\}', content, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    pass
            return None
