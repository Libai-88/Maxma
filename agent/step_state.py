"""步骤状态机数据类 — Plan-and-Execute 执行计划的状态表示。

定义执行计划的结构化数据：
- StepStatus：单个步骤的执行状态枚举
- PlanStep：执行计划中的单个步骤
- ExecutionPlan：完整的执行计划

这些类型用于 AgentState 的扩展字段，驱动 executor 节点的步骤状态机。
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class StepStatus(str, Enum):
    """单个步骤的执行状态。"""
    PENDING = "pending"        # 待执行
    RUNNING = "running"        # 执行中
    DONE = "done"              # 已完成
    FAILED = "failed"          # 失败
    SKIPPED = "skipped"        # 已跳过（replan 时跳过已成功的步骤）


@dataclass
class PlanStep:
    """执行计划中的单个步骤。"""
    description: str                                     # 步骤描述
    tool_hint: str = ""                                  # 建议工具名
    parallel_group: int = 0                              # 并行组编号（0=非并行，>0=属于该组）
    depends_on: list[int] = field(default_factory=list)  # 依赖的步骤索引
    index: int = 0                                       # 步骤索引（0-based）

    @property
    def is_parallel(self) -> bool:
        """是否属于并行组。"""
        return self.parallel_group > 0

    def to_dict(self) -> dict:
        """序列化为 dict（用于 LangGraph state 持久化）。"""
        return {
            "description": self.description,
            "tool_hint": self.tool_hint,
            "parallel_group": self.parallel_group,
            "depends_on": list(self.depends_on),
            "index": self.index,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PlanStep":
        """从 dict 反序列化。"""
        return cls(
            description=d.get("description", ""),
            tool_hint=d.get("tool_hint", ""),
            parallel_group=d.get("parallel_group", 0),
            depends_on=d.get("depends_on", []),
            index=d.get("index", 0),
        )


@dataclass
class ExecutionPlan:
    """完整的执行计划。"""
    steps: list[PlanStep] = field(default_factory=list)
    raw_text: str = ""

    @property
    def step_count(self) -> int:
        return len(self.steps)

    @property
    def is_empty(self) -> bool:
        return not self.steps

    @property
    def has_parallel(self) -> bool:
        """是否包含并行步骤。"""
        return any(s.is_parallel for s in self.steps)

    def get_parallel_groups(self) -> list[list[PlanStep]]:
        """返回并行组列表，每个组是一组可并行的步骤。

        返回顺序按 parallel_group 编号升序。
        """
        groups: dict[int, list[PlanStep]] = {}
        for step in self.steps:
            if step.is_parallel:
                groups.setdefault(step.parallel_group, []).append(step)
        return [groups[k] for k in sorted(groups.keys())]

    def steps_in_order(self) -> list[PlanStep]:
        """返回按索引排序的步骤列表。"""
        return sorted(self.steps, key=lambda s: s.index)

    def to_dict_list(self) -> list[dict]:
        """序列化步骤列表为 dict 列表。"""
        return [s.to_dict() for s in self.steps]

    @classmethod
    def from_dict_list(cls, steps: list[dict], raw_text: str = "") -> "ExecutionPlan":
        """从 dict 列表反序列化。"""
        return cls(
            steps=[PlanStep.from_dict(d) for d in steps],
            raw_text=raw_text,
        )


def merge_dicts(left: dict | None, right: dict | None) -> dict:
    """LangGraph state reducer：合并两个 dict（right 覆盖 left 的同名 key）。

    用于 step_status 字段，使每次节点返回的部分更新能合并到已有状态而非覆盖。
    """
    if not left:
        return dict(right) if right else {}
    if not right:
        return dict(left)
    return {**left, **right}
