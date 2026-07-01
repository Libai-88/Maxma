"""事件钩子系统 — 监听特定事件并自动触发 Agent 动作。

支持的钩子类型：
- file_change: 监控目录的文件变更（基于 watchdog）
- schedule: 定时执行（基于 asyncio 定时循环）
- webhook: HTTP webhook 接收（通过 FastAPI 路由）

触发流程：
1. 事件发生
2. HookManager 匹配已注册的钩子
3. 创建临时 Agent 会话，注入触发上下文
4. Agent 执行预设动作
5. 结果记录到触发历史
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import yaml

from app_paths import EVENT_HOOKS_YAML_PATH

logger = logging.getLogger(__name__)

# 钩子状态常量
STATUS_ACTIVE = "active"
STATUS_PAUSED = "paused"
STATUS_ERROR = "error"

# 最大历史记录数
MAX_HISTORY = 100


@dataclass
class HookTriggerRecord:
    """单次触发记录。"""
    trigger_id: str
    hook_id: str
    timestamp: float
    trigger_type: str  # file_change / schedule / webhook
    trigger_detail: str  # 触发详情（如变更的文件路径）
    status: str  # success / error / timeout
    result: str = ""  # Agent 执行结果摘要


@dataclass
class HookConfig:
    """单个钩子配置。"""
    hook_id: str
    name: str
    hook_type: str  # file_change / schedule / webhook
    config: dict  # 类型相关配置
    action: str  # Agent 动作提示词
    status: str = STATUS_ACTIVE
    enabled: bool = True
    created_at: float = 0.0
    last_triggered: float = 0.0
    trigger_count: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "HookConfig":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


class HookManager:
    """事件钩子管理器。"""

    def __init__(self):
        self._hooks: dict[str, HookConfig] = {}
        self._history: list[HookTriggerRecord] = []
        self._watchers: dict[str, Any] = {}  # hook_id -> watchdog observer
        self._schedule_tasks: dict[str, asyncio.Task] = {}  # hook_id -> asyncio.Task
        self._loop: asyncio.AbstractEventLoop | None = None
        self._on_trigger: Any = None  # 触发回调（注入 Agent 会话）

    def set_trigger_callback(self, callback):
        """设置触发时的回调函数。

        callback 签名: async def callback(hook: HookConfig, trigger_detail: str) -> str
        返回 Agent 执行结果摘要。
        """
        self._on_trigger = callback

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        """设置事件循环（用于线程安全的异步调度）。"""
        self._loop = loop

    # ── 持久化 ──────────────────────────────────────────────

    def load(self):
        """从 YAML 文件加载钩子配置。"""
        if not EVENT_HOOKS_YAML_PATH.exists():
            return
        try:
            with open(EVENT_HOOKS_YAML_PATH, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            hooks_data = data.get("hooks", [])
            for h in hooks_data:
                hook = HookConfig.from_dict(h)
                self._hooks[hook.hook_id] = hook
            logger.info(f"Loaded {len(self._hooks)} event hooks")
        except Exception as e:
            logger.error(f"Failed to load event hooks: {e}")

    def save(self):
        """保存钩子配置到 YAML 文件。"""
        try:
            EVENT_HOOKS_YAML_PATH.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "hooks": [h.to_dict() for h in self._hooks.values()],
            }
            with open(EVENT_HOOKS_YAML_PATH, "w", encoding="utf-8") as f:
                yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        except Exception as e:
            logger.error(f"Failed to save event hooks: {e}")

    # ── CRUD ────────────────────────────────────────────────

    def create_hook(self, name: str, hook_type: str, config: dict, action: str) -> HookConfig:
        """创建新钩子。"""
        hook_id = uuid.uuid4().hex[:12]
        hook = HookConfig(
            hook_id=hook_id,
            name=name,
            hook_type=hook_type,
            config=config,
            action=action,
            created_at=time.time(),
        )
        self._hooks[hook_id] = hook
        self.save()
        # 如果是 active 状态，立即启动监听
        if hook.enabled and hook.status == STATUS_ACTIVE:
            self._start_hook(hook)
        return hook

    def update_hook(self, hook_id: str, **kwargs) -> HookConfig | None:
        """更新钩子配置。"""
        hook = self._hooks.get(hook_id)
        if not hook:
            return None
        # 先停止旧的监听
        self._stop_hook(hook)
        # 更新字段
        for key, value in kwargs.items():
            if value is not None and hasattr(hook, key):
                setattr(hook, key, value)
        self.save()
        # 重新启动
        if hook.enabled and hook.status == STATUS_ACTIVE:
            self._start_hook(hook)
        return hook

    def delete_hook(self, hook_id: str) -> bool:
        """删除钩子。"""
        hook = self._hooks.pop(hook_id, None)
        if not hook:
            return False
        self._stop_hook(hook)
        self.save()
        return True

    def get_hook(self, hook_id: str) -> HookConfig | None:
        return self._hooks.get(hook_id)

    def list_hooks(self) -> list[dict]:
        return [h.to_dict() for h in self._hooks.values()]

    def get_history(self, limit: int = 50) -> list[dict]:
        """获取最近的触发历史。"""
        return [asdict(r) for r in self._history[-limit:]]

    # ── 启停控制 ────────────────────────────────────────────

    def start_all(self):
        """启动所有已启用的钩子。"""
        for hook in self._hooks.values():
            if hook.enabled and hook.status == STATUS_ACTIVE:
                self._start_hook(hook)

    def stop_all(self):
        """停止所有钩子。"""
        for hook in self._hooks.values():
            self._stop_hook(hook)

    def _start_hook(self, hook: HookConfig):
        """启动单个钩子的监听。"""
        try:
            if hook.hook_type == "file_change":
                self._start_file_watcher(hook)
            elif hook.hook_type == "schedule":
                self._start_schedule(hook)
            elif hook.hook_type == "webhook":
                pass  # webhook 通过 HTTP 路由触发，无需后台任务
            logger.info(f"Started hook '{hook.name}' ({hook.hook_type})")
        except Exception as e:
            logger.error(f"Failed to start hook '{hook.name}': {e}")
            hook.status = STATUS_ERROR
            self.save()

    def _stop_hook(self, hook: HookConfig):
        """停止单个钩子的监听。"""
        # 停止文件监听
        if hook.hook_id in self._watchers:
            try:
                self._watchers[hook.hook_id].stop()
            except Exception:
                pass
            del self._watchers[hook.hook_id]

        # 停止定时任务
        if hook.hook_id in self._schedule_tasks:
            self._schedule_tasks[hook.hook_id].cancel()
            del self._schedule_tasks[hook.hook_id]

    # ── 文件变更监听 ────────────────────────────────────────

    def _start_file_watcher(self, hook: HookConfig):
        """启动文件变更监听。"""
        try:
            from watchdog.observers import Observer
            from watchdog.events import FileSystemEventHandler
        except ImportError:
            logger.warning("watchdog not installed, file_change hooks disabled. Run: pip install watchdog")
            hook.status = STATUS_ERROR
            self.save()
            return

        watch_path = hook.config.get("path", ".")
        patterns = hook.config.get("patterns", ["*"])
        ignore_patterns = hook.config.get("ignore_patterns", [])

        manager = self
        hook_id = hook.hook_id

        class _Handler(FileSystemEventHandler):
            def on_any_event(self, event):
                if event.is_directory:
                    return
                # 检查文件模式匹配
                import fnmatch
                src = str(event.src_path)
                filename = Path(src).name
                if not any(fnmatch.fnmatch(filename, p) for p in patterns):
                    return
                if any(fnmatch.fnmatch(filename, p) for p in ignore_patterns):
                    return

                event_type = event.event_type
                detail = f"{event_type}: {src}"

                # 异步触发
                h = manager.get_hook(hook_id)
                if h and h.enabled:
                    manager._fire_trigger(h, "file_change", detail)

        observer = Observer()
        observer.schedule(_Handler(), watch_path, recursive=True)
        observer.daemon = True
        observer.start()
        self._watchers[hook.hook_id] = observer

    # ── 定时执行 ────────────────────────────────────────────

    def _start_schedule(self, hook: HookConfig):
        """启动定时执行。"""
        interval = hook.config.get("interval", 3600)  # 默认 1 小时

        async def _schedule_loop():
            while True:
                await asyncio.sleep(interval)
                h = self.get_hook(hook.hook_id)
                if h and h.enabled:
                    self._fire_trigger(h, "schedule", f"定时触发 (间隔 {interval}s)")

        if self._loop:
            # 通过 call_soon_threadsafe 在正确的线程中创建 task
            def _create_task():
                task = self._loop.create_task(_schedule_loop())
                self._schedule_tasks[hook.hook_id] = task
            self._loop.call_soon_threadsafe(_create_task)
        else:
            # 直接在当前循环中创建
            task = asyncio.create_task(_schedule_loop())
            self._schedule_tasks[hook.hook_id] = task

    # ── 触发执行 ────────────────────────────────────────────

    def _fire_trigger(self, hook: HookConfig, trigger_type: str, detail: str):
        """触发钩子执行。"""
        record = HookTriggerRecord(
            trigger_id=uuid.uuid4().hex[:12],
            hook_id=hook.hook_id,
            timestamp=time.time(),
            trigger_type=trigger_type,
            trigger_detail=detail,
            status="pending",
        )

        # 更新钩子统计
        hook.last_triggered = time.time()
        hook.trigger_count += 1
        self.save()

        # 异步执行 Agent 动作
        if self._on_trigger and self._loop:
            asyncio.run_coroutine_threadsafe(
                self._execute_trigger(hook, record),
                self._loop,
            )
        elif self._on_trigger:
            asyncio.create_task(self._execute_trigger(hook, record))
        else:
            # 没有回调，只记录
            record.status = "skipped"
            record.result = "无触发回调"
            self._add_history(record)

    async def _execute_trigger(self, hook: HookConfig, record: HookTriggerRecord):
        """执行钩子动作（调用 Agent）。"""
        try:
            result = await self._on_trigger(hook, record.trigger_detail)
            record.status = "success"
            record.result = str(result)[:500]
        except asyncio.TimeoutError:
            record.status = "timeout"
            record.result = "Agent 执行超时"
        except Exception as e:
            record.status = "error"
            record.result = str(e)[:500]
            logger.error(f"Hook '{hook.name}' trigger failed: {e}")
        finally:
            self._add_history(record)

    def _add_history(self, record: HookTriggerRecord):
        """添加触发记录到历史。"""
        self._history.append(record)
        # 限制历史记录数
        if len(self._history) > MAX_HISTORY:
            self._history = self._history[-MAX_HISTORY:]

    # ── Webhook 触发入口 ────────────────────────────────────

    def trigger_webhook(self, hook_id: str, payload: str) -> bool:
        """通过 webhook 手动触发钩子。"""
        hook = self._hooks.get(hook_id)
        if not hook or hook.hook_type != "webhook":
            return False
        if not hook.enabled:
            return False
        self._fire_trigger(hook, "webhook", payload[:200])
        return True


# 全局单例
_hook_manager: HookManager | None = None


def get_hook_manager() -> HookManager:
    """获取全局 HookManager 实例。"""
    global _hook_manager
    if _hook_manager is None:
        _hook_manager = HookManager()
    return _hook_manager
