"""SubAgent 委托范围 — 单调收窄的权限交集计算。

核心安全不变量：子 Agent 的有效权限永远是父 Agent 权限的子集。
来源：multi_agent_trust_layer 的 DelegationScope.narrow() 思想，
适配 Maxma 的本地单用户桌面场景（去掉加密签名/多租户身份）。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DelegationScope:
    """SubAgent 的有效权限范围（不可变）。

    Attributes:
        allowed_tools: 允许的工具名集合（空集 = 无工具）
        allowed_paths: 允许的文件路径前缀集合（空集 = 无路径访问）
        max_tokens: 子 Agent 最大 token 预算（0 = 无预算）
        time_limit_seconds: 子 Agent 最大执行时长（0 = 无限制）
    """
    allowed_tools: frozenset[str] = field(default_factory=frozenset)
    allowed_paths: frozenset[str] = field(default_factory=frozenset)
    max_tokens: int = 0
    time_limit_seconds: int = 0

    def is_empty(self) -> bool:
        """范围是否为空（无工具且无路径且无预算）。"""
        return (
            not self.allowed_tools
            and not self.allowed_paths
            and self.max_tokens == 0
            and self.time_limit_seconds == 0
        )


def intersect(parent: DelegationScope, child_request: DelegationScope) -> DelegationScope:
    """计算父子范围的交集（单调收窄）。

    核心安全不变量：结果永远是 parent 的子集，无论 child_request 请求多大。
    - 工具/路径：取交集
    - token/time 上限：取 min（子不能超过父）
    - 空集拒绝：任一关键维度（工具/路径）交集为空时整体收窄为空（fail-closed）

    Args:
        parent: 父 Agent 的当前有效范围
        child_request: 子 Agent 请求的范围

    Returns:
        收窄后的有效范围（可能是空集）
    """
    tools = parent.allowed_tools & child_request.allowed_tools
    paths = parent.allowed_paths & child_request.allowed_paths
    # 空集拒绝：工具或路径交集为空则整体收窄为空（fail-closed）
    if not tools or not paths:
        return DelegationScope()
    return DelegationScope(
        allowed_tools=frozenset(tools),
        allowed_paths=frozenset(paths),
        max_tokens=min(parent.max_tokens, child_request.max_tokens) if parent.max_tokens and child_request.max_tokens else 0,
        time_limit_seconds=min(parent.time_limit_seconds, child_request.time_limit_seconds) if parent.time_limit_seconds and child_request.time_limit_seconds else 0,
    )


def from_parent_context(
    allowed_tools: list[str],
    allowed_paths: list[str],
    max_tokens: int = 8000,
    time_limit_seconds: int = 180,
) -> DelegationScope:
    """从父 Agent 上下文构造父范围。

    Args:
        allowed_tools: 父 Agent 当前可用的工具名列表
        allowed_paths: 父 Agent 路径白名单
        max_tokens: 父 Agent token 预算上限
        time_limit_seconds: 父 Agent 执行时长上限

    Returns:
        父 Agent 的 DelegationScope
    """
    return DelegationScope(
        allowed_tools=frozenset(allowed_tools),
        allowed_paths=frozenset(allowed_paths),
        max_tokens=max_tokens,
        time_limit_seconds=time_limit_seconds,
    )
