"""三阶段启动分层 — 参考 Halo 的 Bootstrap Phasing 模式。

Tier 1 Essential  (同步, <500ms, 首屏必需)
Tier 2 Extended   (异步注册, 不阻塞 UI, 懒初始化)
Tier 3 Idle        (非关键任务顺序执行, 失败只 warn)
"""
from api.bootstrap.idle_queue import (
    register_idle_task,
    start_idle_drain,
    is_idle_draining,
    clear_idle_queue,
)

__all__ = [
    "register_idle_task",
    "start_idle_drain",
    "is_idle_draining",
    "clear_idle_queue",
]
