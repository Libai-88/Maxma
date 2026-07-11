"""User-confirmed thinking paths for requests that merit more deliberation.

The paths describe *how deeply* Maxma should work, never what sensitive topic a
user is discussing.  They are deterministic local suggestions so opening the
chooser never performs a hidden model call or classifies the request remotely.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class ThinkPath:
    """A safe, display-ready execution-depth option."""

    id: str
    label: str
    description: str
    estimated_cost: str
    depth: str
    role: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


_COMPLEXITY_MARKERS = (
    "分析", "比较", "对比", "研究", "调查", "排查", "定位", "修复", "重构",
    "实现", "设计", "规划", "计划", "步骤", "总结", "审查", "迁移", "优化",
    "review", "debug", "research", "compare", "implement", "design", "plan",
)

_PATHS: tuple[ThinkPath, ...] = (
    ThinkPath("light", "轻量", "直接作答，适合已有明确方向的问题。", "低", "浅", "fast"),
    ThinkPath("standard", "标准", "先梳理要点，再给出可执行的答案。", "中", "中", "general"),
    ThinkPath("deep", "深入", "拆分假设、权衡方案并检查关键风险。", "较高", "深", "analysis"),
)


def should_offer_think_paths(text: str) -> bool:
    """Return whether a request is complex enough to offer an optional chooser.

    This intentionally uses only transparent shape/keyword checks.  It never
    infers sensitive subject matter, user attributes, or an execution policy.
    """
    raw = str(text or "")
    # Keep the structural check separate from whitespace normalization.  Checking
    # after ``split()`` would make this branch unreachable for multi-line tasks.
    has_multiple_lines = "\n" in raw or "\r" in raw
    normalized = " ".join(raw.split())
    if len(normalized) >= 60 or has_multiple_lines:
        return True
    lowered = normalized.lower()
    return any(marker in lowered for marker in _COMPLEXITY_MARKERS)


def get_think_paths(text: str) -> list[ThinkPath]:
    """Return the fixed choices for complex requests, otherwise no interruption."""
    return list(_PATHS) if should_offer_think_paths(text) else []


def get_think_path(path_id: str | None) -> ThinkPath | None:
    """Resolve a client supplied id without accepting arbitrary role names."""
    if not isinstance(path_id, str):
        return None
    normalized = path_id.strip().lower()
    return next((path for path in _PATHS if path.id == normalized), None)
