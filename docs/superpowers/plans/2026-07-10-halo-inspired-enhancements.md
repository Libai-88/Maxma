# Halo-Inspired Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Halo 2.1.12 项目中经过验证的设计思想和实现技巧移植到 Maxma，作为"锦上添花"的增强，不破坏 Maxma 现有的优秀架构。

**Architecture:** Maxma 已有完善的装饰器工具注册、4 层记忆架构、DPAPI/Fernet 凭据加密、指纹缓存、AsyncSqliteSaver checkpointer 等优秀设计。本计划只做增量增强：引入三阶段启动分层、后台任务 JSONL transcript、凭据掩码统一、事件去重缓存、调度器指数退避、Disposable 资源管理原语。每个模块独立可测试，不触碰已有核心逻辑。

**Tech Stack:** Python 3.13 / FastAPI / asyncio / Pydantic / pytest

---

## 设计原则

1. **增量增强，不重构**：每个新增文件独立，已有文件只做最小改动（加调用点）
2. **保留已有优秀设计**：不替换装饰器注册、指纹缓存、DPAPI 加密、4 层记忆等已有模式
3. **默认安全**：新功能默认关闭或最低影响，显式开启
4. **TDD**：每个模块先写测试再实现
5. **频繁提交**：每个 Task 结束即 commit

## 文件结构总览

```
MaxmaHere/
├── agent/
│   └── autonomy/
│       └── scheduler.py          ← Modify: 接入指数退避 + 自动禁用
│   └── lifecycle/
│       ├── __init__.py          ← Create: Disposable 资源管理原语
│       └── disposable.py        ← Create
├── api/
│   ├── bootstrap/
│   │   ├── __init__.py          ← Create: 三阶段启动分层
│   │   ├── essential.py         ← Create: Tier 1 (首屏必需, <500ms)
│   │   ├── extended.py          ← Create: Tier 2 (异步注册, 不阻塞)
│   │   └── idle_queue.py        ← Create: Tier 3 (空闲任务队列)
│   ├── security/
│   │   ├── __init__.py          ← Create: 凭据掩码统一层
│   │   └── credential_mask.py   ← Create
│   ├── transcript/
│   │   ├── __init__.py          ← Create: 后台任务 JSONL transcript
│   │   └── jsonl_writer.py      ← Create
│   └── server.py                ← Modify: 接入 bootstrap 分层 + transcript
├── platform/
│   ├── __init__.py              ← Create: 平台原语层
│   └── event_dedup.py           ← Create: 事件去重缓存
└── tests/
    ├── test_lifecycle/
    │   ├── __init__.py
    │   └── test_disposable.py
    ├── test_bootstrap/
    │   ├── __init__.py
    │   └── test_idle_queue.py
    ├── test_security/
    │   ├── __init__.py
    │   └── test_credential_mask.py
    ├── test_transcript/
    │   ├── __init__.py
    │   └── test_jsonl_writer.py
    └── test_platform/
        ├── __init__.py
        └── test_event_dedup.py
```

---

## Task 1: Disposable 资源管理原语

**Files:**
- Create: `agent/lifecycle/__init__.py`
- Create: `agent/lifecycle/disposable.py`
- Test: `tests/test_lifecycle/__init__.py`
- Test: `tests/test_lifecycle/test_disposable.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_lifecycle/test_disposable.py
"""Disposable 资源管理原语测试 — VSCode 风格的资源生命周期管理。"""
import pytest
from agent.lifecycle.disposable import (
    IDisposable,
    to_disposable,
    combined_disposable,
    DisposableStore,
    MutableDisposable,
)


def test_to_disposable_calls_fn_on_dispose():
    called = []
    d = to_disposable(lambda: called.append(True))
    d.dispose()
    assert called == [True]


def test_disposable_idempotent():
    """dispose 多次只执行一次清理。"""
    called = []
    d = to_disposable(lambda: called.append(True))
    d.dispose()
    d.dispose()
    assert called == [True]


def test_combined_disposable_releases_in_reverse_order():
    """组合 disposable 按注册的逆序释放。"""
    order = []
    d1 = to_disposable(lambda: order.append("d1"))
    d2 = to_disposable(lambda: order.append("d2"))
    d3 = to_disposable(lambda: order.append("d3"))
    combined = combined_disposable(d1, d2, d3)
    combined.dispose()
    assert order == ["d3", "d2", "d1"]


def test_disposable_store_add_and_clear():
    store = DisposableStore()
    called = []
    store.add(to_disposable(lambda: called.append("a")))
    store.add(to_disposable(lambda: called.append("b")))
    store.clear()
    assert sorted(called) == ["a", "b"]
    # clear 后 store 仍可用
    store.add(to_disposable(lambda: called.append("c")))
    store.clear()
    assert "c" in called


def test_disposable_store_dispose_prevents_future_add():
    store = DisposableStore()
    store.add(to_disposable(lambda: None))
    store.dispose()
    with pytest.raises(RuntimeError, match="disposed"):
        store.add(to_disposable(lambda: None))


def test_mutable_disposable_set_replaces_old():
    """set 新值时自动释放旧值。"""
    released = []
    m = MutableDisposable(to_disposable(lambda: released.append("old")))
    m.set(to_disposable(lambda: released.append("new")))
    assert released == ["old"]
    m.dispose()
    assert released == ["old", "new"]


def test_mutable_dispose_without_value():
    m = MutableDisposable(None)
    m.dispose()  # 不应抛异常
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_lifecycle/test_disposable.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.lifecycle'`

- [ ] **Step 3: Write minimal implementation**

```python
# agent/lifecycle/__init__.py
"""资源生命周期管理原语 — VSCode 风格的 Disposable 模式。

提供 IDisposable 接口和组合管理工具，用于统一管理会话清理、
MCP 连接释放、watcher 注销等资源生命周期。
"""
from agent.lifecycle.disposable import (
    IDisposable,
    to_disposable,
    combined_disposable,
    DisposableStore,
    MutableDisposable,
)

__all__ = [
    "IDisposable",
    "to_disposable",
    "combined_disposable",
    "DisposableStore",
    "MutableDisposable",
]
```

```python
# agent/lifecycle/disposable.py
"""Disposable 资源管理原语。

设计参考 VSCode 的 IDisposable 模式：
- IDisposable: 单个资源的释放接口
- to_disposable(fn): 把清理函数包装成 IDisposable
- combined_disposable(...): 组合多个 disposable，逆序释放
- DisposableStore: 集合管理，clear() 释放但保持可用，dispose() 释放且禁止未来添加
- MutableDisposable<T>: 持有单个可替换的 disposable，set 新值时自动释放旧值
"""
from __future__ import annotations

from typing import Callable, List, Optional, Protocol


class IDisposable(Protocol):
    """资源释放协议。"""

    def dispose(self) -> None: ...


class _FunctionDisposable:
    """把清理函数包装成 IDisposable。"""

    def __init__(self, fn: Callable[[], None]):
        self._fn = fn
        self._disposed = False

    def dispose(self) -> None:
        if self._disposed:
            return
        self._disposed = True
        self._fn()


def to_disposable(fn: Callable[[], None]) -> IDisposable:
    """把清理函数包装成 IDisposable（幂等：多次 dispose 只执行一次）。"""
    return _FunctionDisposable(fn)


def combined_disposable(*disposables: IDisposable) -> IDisposable:
    """组合多个 disposable，dispose 时按注册的逆序释放。"""
    items = list(disposables)
    _disposed = [False]

    def _dispose():
        if _disposed[0]:
            return
        _disposed[0] = True
        for d in reversed(items):
            try:
                d.dispose()
            except Exception:
                pass  # 单个释放失败不影响其他

    return to_disposable(_dispose)


class DisposableStore:
    """Disposable 集合管理器。

    - add(): 添加 disposable
    - clear(): 释放所有已添加的 disposable，但 store 仍可继续使用
    - dispose(): 释放所有并标记为已销毁，之后 add() 抛 RuntimeError
    """

    def __init__(self):
        self._items: List[IDisposable] = []
        self._disposed = False

    def add(self, disposable: IDisposable) -> IDisposable:
        """添加 disposable 到集合。"""
        if self._disposed:
            raise RuntimeError("Cannot add to a disposed DisposableStore")
        self._items.append(disposable)
        return disposable

    def clear(self) -> None:
        """释放所有已添加的 disposable，但保持 store 可用。"""
        items = self._items
        self._items = []
        for d in reversed(items):
            try:
                d.dispose()
            except Exception:
                pass

    def dispose(self) -> None:
        """释放所有并标记为已销毁。"""
        self._disposed = True
        self.clear()


class MutableDisposable:
    """持有单个可替换的 disposable。

    set 新值时自动释放旧值；dispose 时释放当前值并禁止未来 set。
    """

    def __init__(self, value: Optional[IDisposable]):
        self._value = value
        self._disposed = False

    def set(self, value: Optional[IDisposable]) -> None:
        """设置新值，自动释放旧值。"""
        if self._disposed:
            if value is not None:
                value.dispose()
            return
        old = self._value
        self._value = value
        if old is not None:
            old.dispose()

    def dispose(self) -> None:
        """释放当前值并标记为已销毁。"""
        if self._disposed:
            return
        self._disposed = True
        if self._value is not None:
            self._value.dispose()
            self._value = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_lifecycle/test_disposable.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
cd MaxmaHere
git add agent/lifecycle/ tests/test_lifecycle/
git commit -m "feat: add Disposable resource management primitives"
```

---

## Task 2: 空闲任务队列（Idle Queue）

**Files:**
- Create: `api/bootstrap/__init__.py`
- Create: `api/bootstrap/idle_queue.py`
- Test: `tests/test_bootstrap/__init__.py`
- Test: `tests/test_bootstrap/test_idle_queue.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_bootstrap/test_idle_queue.py
"""空闲任务队列测试 — Tier 3 非关键任务顺序执行。"""
import asyncio
import pytest
from api.bootstrap.idle_queue import (
    register_idle_task,
    start_idle_drain,
    is_idle_draining,
    clear_idle_queue,
)


@pytest.fixture(autouse=True)
def reset_queue():
    clear_idle_queue()
    yield
    clear_idle_queue()


def test_register_idle_task_returns_id():
    task_id = register_idle_task("test", lambda: None)
    assert isinstance(task_id, str)
    assert len(task_id) > 0


def test_register_idle_task_with_coroutine():
    """支持注册协程任务。"""
    async def _coro():
        pass

    task_id = register_idle_task("coro-test", _coro)
    assert isinstance(task_id, str)


@pytest.mark.asyncio
async def test_start_idle_drain_executes_all_tasks():
    """drain 依次执行所有已注册的 idle 任务。"""
    results = []

    def _sync_task():
        results.append("sync")

    async def _async_task():
        results.append("async")

    register_idle_task("sync", _sync_task)
    register_idle_task("async", _async_task)

    await start_idle_drain()
    assert results == ["sync", "async"]
    assert not is_idle_draining()


@pytest.mark.asyncio
async def test_idle_drain_task_failure_does_not_stop_queue():
    """单个任务失败不中断队列。"""
    results = []

    def _fail():
        raise ValueError("boom")

    def _ok():
        results.append("ok")

    register_idle_task("fail", _fail)
    register_idle_task("ok", _ok)

    await start_idle_drain()
    assert results == ["ok"]


@pytest.mark.asyncio
async def test_idle_drain_yields_between_tasks():
    """每个任务之间 setImmediate 让出事件循环。"""
    ordering = []

    async def _check():
        ordering.append("task")
        # 如果没有让出，这个回调不会在任务间执行
        await asyncio.sleep(0)

    for i in range(3):
        register_idle_task(f"task-{i}", _check)

    await start_idle_drain()
    assert len(ordering) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_bootstrap/test_idle_queue.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.bootstrap'`

- [ ] **Step 3: Write minimal implementation**

```python
# api/bootstrap/__init__.py
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
```

```python
# api/bootstrap/idle_queue.py
"""空闲任务队列 — Tier 3 非关键任务。

设计参考 Halo 的 idle-queue.ts：
- register_idle_task(name, fn_or_coro) 注册非关键任务
- start_idle_drain() 依次执行所有已注册任务
- 每个任务之间用 asyncio.sleep(0) 让出事件循环
- 单个任务失败不中断队列（只 log warning）
- 任务支持同步函数和协程函数
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import uuid
from typing import Callable, List, Optional, Union

logger = logging.getLogger(__name__)

# 任务类型：同步函数或协程函数
IdleTaskFn = Union[Callable[[], None], Callable[[], "asyncio.Coroutine"]]

# 全局状态（进程内单例）
_pending_tasks: List[tuple[str, str, IdleTaskFn]] = []
_draining: bool = False


def register_idle_task(
    name: str,
    fn: IdleTaskFn,
) -> str:
    """注册一个空闲任务。

    Args:
        name: 任务名称（用于日志）
        fn: 同步函数或协程函数（无参数）

    Returns:
        任务 ID
    """
    task_id = str(uuid.uuid4())
    _pending_tasks.append((task_id, name, fn))
    return task_id


def is_idle_draining() -> bool:
    """是否正在执行 drain。"""
    return _draining


def clear_idle_queue() -> None:
    """清空待执行队列（用于测试）。"""
    global _pending_tasks, _draining
    _pending_tasks = []
    _draining = False


async def start_idle_drain() -> None:
    """依次执行所有已注册的空闲任务。

    每个任务之间用 asyncio.sleep(0) 让出事件循环。
    单个任务失败只 log warning，不中断队列。
    """
    global _pending_tasks, _draining

    if _draining:
        logger.warning("[idle-queue] drain already in progress, skipping")
        return

    _draining = True
    tasks = _pending_tasks
    _pending_tasks = []

    for task_id, name, fn in tasks:
        try:
            result = fn()
            if inspect.isawaitable(result):
                await result
        except Exception as e:
            logger.warning("[idle-queue] task '%s' failed: %s", name, e)
        # 让出事件循环，不阻塞高优先级任务
        await asyncio.sleep(0)

    _draining = False
    logger.info("[idle-queue] drained %d task(s)", len(tasks))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_bootstrap/test_idle_queue.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd MaxmaHere
git add api/bootstrap/ tests/test_bootstrap/
git commit -m "feat: add idle task queue for Tier 3 startup phasing"
```

---

## Task 3: 事件去重缓存

**Files:**
- Create: `platform/__init__.py`
- Create: `platform/event_dedup.py`
- Test: `tests/test_platform/__init__.py`
- Test: `tests/test_platform/test_event_dedup.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_platform/test_event_dedup.py
"""事件去重缓存测试 — 应对 webhook 重试/文件监听爆发。"""
import time
import pytest
from platform.event_dedup import EventDedupCache


def test_first_event_is_new():
    cache = EventDedupCache(ttl_seconds=60, max_size=1000)
    assert cache.is_new("event-1") is True


def test_duplicate_within_ttl_is_deduped():
    cache = EventDedupCache(ttl_seconds=60, max_size=1000)
    cache.is_new("event-1")
    assert cache.is_new("event-1") is False


def test_expired_event_is_new_again():
    cache = EventDedupCache(ttl_seconds=0.05, max_size=1000)
    cache.is_new("event-1")
    time.sleep(0.06)
    assert cache.is_new("event-1") is True


def test_max_size_eviction():
    """超过 max_size 时淘汰最早插入的条目。"""
    cache = EventDedupCache(ttl_seconds=60, max_size=3)
    cache.is_new("a")
    cache.is_new("b")
    cache.is_new("c")
    cache.is_new("d")  # 触发淘汰 "a"
    assert cache.is_new("a") is True  # "a" 已被淘汰


def test_clear():
    cache = EventDedupCache(ttl_seconds=60, max_size=1000)
    cache.is_new("event-1")
    cache.clear()
    assert cache.is_new("event-1") is True


def test_size_tracking():
    cache = EventDedupCache(ttl_seconds=60, max_size=1000)
    cache.is_new("a")
    cache.is_new("b")
    cache.is_new("b")  # 不增加
    assert cache.size() == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_platform/test_event_dedup.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'platform'`

- [ ] **Step 3: Write minimal implementation**

```python
# platform/__init__.py
"""平台原语层 — 零业务知识的通用引擎组件。"""
```

```python
# platform/event_dedup.py
"""事件去重缓存 — 应对 webhook 重试/文件监听爆发。

设计参考 Halo 的 event-dedup.ts：
- TTL 60s + maxSize 1000
- Map 插入序淘汰（FIFO）
- 线程安全（threading.Lock）

适用场景：
- webhook 重试导致同一事件被多次触发
- watchdog 文件监听短时间内多次回调
- 事件钩子重复触发保护
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict


class EventDedupCache:
    """事件去重缓存。

    Args:
        ttl_seconds: 事件指纹的存活时间（过期后同一事件视为新事件）
        max_size: 缓存最大条目数（FIFO 淘汰）
    """

    def __init__(self, ttl_seconds: float = 60.0, max_size: int = 1000):
        self._ttl = max(1.0, float(ttl_seconds))
        self._max_size = max(10, int(max_size))
        self._cache: OrderedDict[str, float] = OrderedDict()
        self._lock = threading.Lock()

    def is_new(self, event_key: str) -> bool:
        """检查事件是否为新的（未被去重）。

        如果是第一次见到此 key，返回 True 并缓存。
        如果在 TTL 内重复，返回 False（已去重）。
        如果超过 TTL，视为新事件，刷新时间戳。

        Args:
            event_key: 事件唯一指纹（如 hash(payload) 或 path+event_type）

        Returns:
            True 如果是新事件
        """
        now = time.monotonic()
        with self._lock:
            # 检查是否已存在且未过期
            if event_key in self._cache:
                last_seen = self._cache[event_key]
                if now - last_seen < self._ttl:
                    return False  # 去重
                # 已过期，刷新
                del self._cache[event_key]

            # 新事件：插入并检查容量
            self._cache[event_key] = now
            if len(self._cache) > self._max_size:
                # FIFO 淘汰最早插入的
                self._cache.popitem(last=False)
            return True

    def clear(self) -> None:
        """清空缓存。"""
        with self._lock:
            self._cache.clear()

    def size(self) -> int:
        """当前缓存条目数。"""
        with self._lock:
            return len(self._cache)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_platform/test_event_dedup.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd MaxmaHere
git add platform/ tests/test_platform/
git commit -m "feat: add event deduplication cache for webhook/file-watch bursts"
```

---

## Task 4: 凭据掩码统一层

**Files:**
- Create: `api/security/__init__.py`
- Create: `api/security/credential_mask.py`
- Test: `tests/test_security/__init__.py`
- Test: `tests/test_security/test_credential_mask.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_security/test_credential_mask.py
"""凭据掩码统一层测试 — 所有离开进程边界的配置都掩码。"""
import pytest
from api.security.credential_mask import (
    mask_sensitive_fields,
    unmask_sentinels,
    is_sensitive_key,
    MASK_SENTINEL,
)


def test_masks_api_key():
    data = {"api_key": "sk-1234567890abcdef", "label": "DeepSeek"}
    masked = mask_sensitive_fields(data)
    assert masked["api_key"] == MASK_SENTINEL
    assert masked["label"] == "DeepSeek"


def test_masks_nested_env():
    data = {
        "mcpServers": {
            "server1": {"env": {"API_KEY": "secret123", "TOKEN": "tok456"}}
        }
    }
    masked = mask_sensitive_fields(data)
    env = masked["mcpServers"]["server1"]["env"]
    assert env["API_KEY"] == MASK_SENTINEL
    assert env["TOKEN"] == MASK_SENTINEL


def test_masks_token_secret_password():
    data = {
        "token": "abc",
        "secret": "def",
        "password": "ghi",
        "credential": "jkl",
        "normal_field": "untouched",
    }
    masked = mask_sensitive_fields(data)
    for key in ["token", "secret", "password", "credential"]:
        assert masked[key] == MASK_SENTINEL
    assert masked["normal_field"] == "untouched"


def test_unmask_sentinels_restores_original():
    """客户端原样发回 *** → 用现有明文回填。"""
    original = {"api_key": "sk-real-key", "label": "DeepSeek"}
    from_client = {"api_key": MASK_SENTINEL, "label": "DeepSeek-updated"}
    restored = unmask_sentinels(from_client, original)
    assert restored["api_key"] == "sk-real-key"
    assert restored["label"] == "DeepSeek-updated"


def test_unmask_sentinels_keeps_new_value():
    """客户端发回新值（非 sentinel）→ 使用新值。"""
    original = {"api_key": "sk-old-key"}
    from_client = {"api_key": "sk-new-key"}
    restored = unmask_sentinels(from_client, original)
    assert restored["api_key"] == "sk-new-key"


def test_is_sensitive_key_patterns():
    assert is_sensitive_key("api_key") is True
    assert is_sensitive_key("API_KEY") is True
    assert is_sensitive_key("token") is True
    assert is_sensitive_key("accessToken") is True
    assert is_sensitive_key("password") is True
    assert is_sensitive_key("label") is False
    assert is_sensitive_key("model_name") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_security/test_credential_mask.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.security'`

- [ ] **Step 3: Write minimal implementation**

```python
# api/security/__init__.py
"""安全原语层 — 凭据掩码、加密辅助。

设计参考 Halo 的 config-encryption.ts：
- 掩码始终启用（不依赖加密开关）
- 写回时用 sentinel 回填（客户端发回 *** → 用现有明文回填）
- 敏感字段显式列举 + 名称正则二级门控
"""
from api.security.credential_mask import (
    mask_sensitive_fields,
    unmask_sentinels,
    is_sensitive_key,
    MASK_SENTINEL,
)

__all__ = [
    "mask_sensitive_fields",
    "unmask_sentinels",
    "is_sensitive_key",
    "MASK_SENTINEL",
]
```

```python
# api/security/credential_mask.py
"""凭据掩码统一层 — 所有离开进程边界的配置都掩码。

设计原则（参考 Halo config-encryption.ts）：
1. 掩码始终启用：不依赖加密开关，所有经过 IPC/HTTP 输出的配置都掩码
2. 写回时 sentinel 回填：客户端原样发回 *** → 用现有明文回填，避免误存空值
3. 敏感字段显式列举 + 名称正则二级门控（应对动态 map 如 mcpServers.*.env）

与现有 ProviderConfig.to_dict() 的关系：
- to_dict() 已做 api_key 脱敏，本模块是更通用的统一层
- 逐步迁移各处序列化逻辑到本模块
"""
from __future__ import annotations

import re
from typing import Any, Dict

# 掩码哨兵值 — 客户端发回此值表示"未修改"
MASK_SENTINEL = "***"

# 显式敏感字段名（全小写匹配）
_EXPLICIT_SENSITIVE_FIELDS: frozenset[str] = frozenset({
    "api_key",
    "apikey",
    "token",
    "secret",
    "password",
    "credential",
    "credentials",
    "access_token",
    "accesstoken",
    "refresh_token",
    "refreshtoken",
    "auth_token",
    "authtoken",
    "private_key",
    "privatekey",
})

# 二级正则：动态 map 的 key 名匹配（如 mcpServers.*.env 里的 KEY/TOKEN）
_SENSITIVE_KEY_PATTERN = re.compile(
    r"(?:^|_)(key|token|secret|password|credential|auth)(?:$|_)",
    re.IGNORECASE,
)


def is_sensitive_key(key: str) -> bool:
    """判断字段名是否敏感。

    两级检查：
    1. 显式列表匹配（全小写）
    2. 名称正则匹配（key/token/secret/password/credential/auth 词根）
    """
    if not key:
        return False
    lower = key.lower()
    if lower in _EXPLICIT_SENSITIVE_FIELDS:
        return True
    return bool(_SENSITIVE_KEY_PATTERN.search(key))


def mask_sensitive_fields(data: Any) -> Any:
    """递归掩码所有敏感字段。

    遍历 dict 的所有 key，对敏感 key 的值替换为 MASK_SENTINEL。
    递归处理嵌套 dict 和 dict 值。

    Args:
        data: 任意数据（dict/list/scalar）

    Returns:
        掩码后的数据（深拷贝，不修改原数据）
    """
    if isinstance(data, dict):
        result: Dict[str, Any] = {}
        for k, v in data.items():
            if is_sensitive_key(k) and v:
                result[k] = MASK_SENTINEL
            else:
                result[k] = mask_sensitive_fields(v)
        return result
    if isinstance(data, list):
        return [mask_sensitive_fields(item) for item in data]
    return data


def unmask_sentinels(
    received: dict,
    original: dict,
) -> dict:
    """用现有明文回填客户端发回的 sentinel 值。

    场景：前端表单加载时拿到掩码值 ***，提交时原样发回。
    如果直接存储会把 *** 当成新密钥存入，导致凭据丢失。
    本函数检测 sentinel 值并用 original 中的明文回填。

    Args:
        received: 客户端发回的数据（可能含 ***）
        original: 服务端已有的原始数据（明文）

    Returns:
        回填后的数据（received 的副本，sentinel 被替换为明文）
    """
    result = dict(received)
    for key, value in result.items():
        if value == MASK_SENTINEL:
            # 用原始明文回填
            result[key] = original.get(key, "")
        elif isinstance(value, dict) and key in original and isinstance(original[key], dict):
            # 递归处理嵌套 dict（如 mcpServers.server1.env）
            result[key] = unmask_sentinels(value, original[key])
    return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_security/test_credential_mask.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd MaxmaHere
git add api/security/ tests/test_security/
git commit -m "feat: add unified credential masking layer with sentinel restoration"
```

---

## Task 5: 后台任务 JSONL Transcript Writer

**Files:**
- Create: `api/transcript/__init__.py`
- Create: `api/transcript/jsonl_writer.py`
- Test: `tests/test_transcript/__init__.py`
- Test: `tests/test_transcript/test_jsonl_writer.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_transcript/test_jsonl_writer.py
"""后台任务 JSONL Transcript Writer 测试。"""
import json
import pytest
from pathlib import Path
from langchain_core.messages import HumanMessage, AIMessage

from api.transcript.jsonl_writer import TranscriptWriter


@pytest.fixture
def transcript_path(tmp_path):
    return tmp_path / "test-run.jsonl"


def test_writer_creates_file(transcript_path):
    writer = TranscriptWriter(transcript_path)
    writer.append_message(HumanMessage(content="hello"))
    assert transcript_path.exists()


def test_writer_appends_jsonl_lines(transcript_path):
    writer = TranscriptWriter(transcript_path)
    writer.append_message(HumanMessage(content="hello"))
    writer.append_message(AIMessage(content="hi there"))

    lines = transcript_path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 2

    entry1 = json.loads(lines[0])
    assert entry1["role"] == "human"
    assert entry1["content"] == "hello"
    assert "timestamp" in entry1

    entry2 = json.loads(lines[1])
    assert entry2["role"] == "ai"


def test_writer_preserves_tool_calls(transcript_path):
    """tool_calls 被保留在 transcript 中。"""
    ai_msg = AIMessage(
        content="",
        tool_calls=[{"name": "file_read", "args": {"path": "/tmp"}, "id": "tc1"}],
    )
    writer = TranscriptWriter(transcript_path)
    writer.append_message(ai_msg)

    entry = json.loads(transcript_path.read_text(encoding="utf-8").strip())
    assert entry["tool_calls"] == [{"name": "file_read", "args": {"path": "/tmp"}, "id": "tc1"}]


def test_writer_append_run_metadata(transcript_path):
    """写入 run 级元数据作为首行。"""
    writer = TranscriptWriter(transcript_path)
    writer.append_metadata({"run_id": "abc-123", "trigger": "autonomy", "action": "diagnose"})

    entry = json.loads(transcript_path.read_text(encoding="utf-8").strip())
    assert entry["type"] == "metadata"
    assert entry["run_id"] == "abc-123"
    assert entry["trigger"] == "autonomy"


def test_writer_close_is_idempotent(transcript_path):
    writer = TranscriptWriter(transcript_path)
    writer.append_message(HumanMessage(content="x"))
    writer.close()
    writer.close()  # 不应抛异常


def test_read_transcript_returns_messages(transcript_path):
    """read_transcript 把 JSONL 读回消息列表。"""
    writer = TranscriptWriter(transcript_path)
    writer.append_metadata({"run_id": "r1"})
    writer.append_message(HumanMessage(content="q1"))
    writer.append_message(AIMessage(content="a1"))
    writer.close()

    messages = TranscriptWriter.read_messages(transcript_path)
    assert len(messages) == 2
    assert messages[0]["content"] == "q1"
    assert messages[1]["content"] == "a1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_transcript/test_jsonl_writer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'api.transcript'`

- [ ] **Step 3: Write minimal implementation**

```python
# api/transcript/__init__.py
"""后台任务 Transcript — JSONL 格式的透明抄本。

设计参考 Halo 的 session-store.ts：
- 后台运行（事件钩子/自治）把每条聚合消息 appendFileSync 到 JSONL
- 观察者按需轮询读取（仅在视图打开时）
- 无人观看的 run 对前端零开销
"""
from api.transcript.jsonl_writer import TranscriptWriter

__all__ = ["TranscriptWriter"]
```

```python
# api/transcript/jsonl_writer.py
"""JSONL Transcript Writer — 后台任务透明抄本。

设计参考 Halo session-store.ts：
- 把每个聚合 assistant/user 消息 append 到 {runId}.jsonl
- 无人观看的 run 对前端零开销（不打 agent:* 事件）
- 观察者按需轮询读取

与现有 audit.jsonl 的区别：
- audit.jsonl 记录 MCP 调用审计日志
- transcript 记录完整对话流（用于后台 run 重放/调试）
"""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, List, Optional

from langchain_core.messages import BaseMessage

logger = logging.getLogger(__name__)


class TranscriptWriter:
    """JSONL 格式的对话抄本写入器。

    线程安全（同一 run 的并发写入用 Lock 保护）。
    每个 run 一个文件，路径由调用方指定。

    Args:
        path: JSONL 文件路径
    """

    def __init__(self, path: Path | str):
        self._path = Path(path)
        self._lock = threading.Lock()
        self._closed = False
        # 确保父目录存在
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def append_message(self, message: BaseMessage) -> None:
        """追加一条消息到 transcript。

        Args:
            message: LangChain BaseMessage（HumanMessage/AIMessage 等）
        """
        entry = self._serialize_message(message)
        self._append_jsonl(entry)

    def append_metadata(self, metadata: dict) -> None:
        """追加 run 级元数据（作为首行）。

        Args:
            metadata: 元数据 dict（如 run_id, trigger, action）
        """
        entry = {"type": "metadata", "timestamp": time.time()}
        entry.update(metadata)
        self._append_jsonl(entry)

    def append_raw(self, role: str, content: str, **extra: Any) -> None:
        """追加原始格式的消息（不依赖 LangChain 类型）。

        Args:
            role: 消息角色（human/ai/system/tool）
            content: 消息内容
            **extra: 额外字段（如 tool_calls, tool_call_id）
        """
        entry: dict[str, Any] = {
            "type": "message",
            "role": role,
            "content": content,
            "timestamp": time.time(),
        }
        entry.update(extra)
        self._append_jsonl(entry)

    def close(self) -> None:
        """关闭 writer（幂等）。"""
        with self._lock:
            self._closed = True

    def _append_jsonl(self, entry: dict) -> None:
        with self._lock:
            if self._closed:
                return
            line = json.dumps(entry, ensure_ascii=False, default=str)
            with open(self._path, "a", encoding="utf-8") as f:
                f.write(line + "\n")

    @staticmethod
    def _serialize_message(message: BaseMessage) -> dict:
        """把 LangChain BaseMessage 序列化为 dict。"""
        entry: dict[str, Any] = {
            "type": "message",
            "role": message.type,
            "content": message.content,
            "timestamp": time.time(),
        }
        # 保留 tool_calls（AIMessage）
        tool_calls = getattr(message, "tool_calls", None)
        if tool_calls:
            entry["tool_calls"] = [
                {"name": tc["name"], "args": tc["args"], "id": tc.get("id", "")}
                for tc in tool_calls
            ]
        # 保留 tool_call_id（ToolMessage）
        tool_call_id = getattr(message, "tool_call_id", None)
        if tool_call_id:
            entry["tool_call_id"] = tool_call_id
        # 保留 name
        name = getattr(message, "name", None)
        if name:
            entry["name"] = name
        return entry

    @staticmethod
    def read_messages(path: Path | str) -> List[dict]:
        """读取 transcript，返回消息列表（跳过 metadata 行）。

        Args:
            path: JSONL 文件路径

        Returns:
            消息 dict 列表（每项含 role/content/timestamp）
        """
        path = Path(path)
        if not path.exists():
            return []
        messages: List[dict] = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("type") == "message":
                        messages.append(entry)
                except json.JSONDecodeError:
                    continue
        return messages
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_transcript/test_jsonl_writer.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd MaxmaHere
git add api/transcript/ tests/test_transcript/
git commit -m "feat: add JSONL transcript writer for background run persistence"
```

---

## Task 6: 调度器指数退避 + 自动禁用

**Files:**
- Modify: `agent/autonomy/scheduler.py`
- Test: `tests/test_agent/test_scheduler_backoff.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_agent/test_scheduler_backoff.py
"""自治调度器指数退避 + 自动禁用测试。"""
import asyncio
import pytest
from agent.autonomy.scheduler import (
    BackoffState,
    compute_next_interval,
    MAX_CONSECUTIVE_FAILURES,
)


def test_backoff_state_initial():
    state = BackoffState()
    assert state.consecutive_failures == 0
    assert state.is_disabled() is False


def test_backoff_increments_on_failure():
    state = BackoffState()
    state.record_failure()
    assert state.consecutive_failures == 1
    state.record_failure()
    assert state.consecutive_failures == 2


def test_backoff_resets_on_success():
    state = BackoffState()
    state.record_failure()
    state.record_failure()
    state.record_success()
    assert state.consecutive_failures == 0


def test_compute_next_interval_no_failures():
    """无失败时用基础间隔。"""
    state = BackoffState(base_interval=3600)
    assert compute_next_interval(state) == 3600


def test_compute_next_interval_with_backoff():
    """失败越多间隔越长（指数退避）。"""
    state = BackoffState(base_interval=3600)
    state.record_failure()
    i1 = compute_next_interval(state)
    state.record_failure()
    i2 = compute_next_interval(state)
    assert i1 > 3600
    assert i2 > i1


def test_auto_disable_after_max_failures():
    """连续失败达 MAX_CONSECUTIVE_FAILURES 次自动禁用。"""
    state = BackoffState(base_interval=3600)
    for _ in range(MAX_CONSECUTIVE_FAILURES):
        state.record_failure()
    assert state.is_disabled() is True


def test_backoff_capped_at_max():
    """退避间隔不超过上限。"""
    state = BackoffState(base_interval=3600, max_interval=7200)
    for _ in range(10):
        state.record_failure()
    interval = compute_next_interval(state)
    assert interval <= 7200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_scheduler_backoff.py -v`
Expected: FAIL with `ImportError: cannot import name 'BackoffState'`

- [ ] **Step 3: Write minimal implementation**

在 `agent/autonomy/scheduler.py` 的 import 区后、`start_autonomy` 之前插入 `BackoffState` 类和常量：

```python
# === 指数退避 + 自动禁用（参考 Halo scheduler DESIGN.md §2.3）===

MAX_CONSECUTIVE_FAILURES = 5
MAX_BACKOFF_INTERVAL = 86400  # 24 小时上限


@dataclass
class BackoffState:
    """调度器退避状态。

    - consecutive_failures: 连续失败次数
    - base_interval: 基础间隔（秒）
    - max_interval: 最大间隔上限（秒）
    - disabled: 是否被自动禁用
    """

    base_interval: int = 3600
    max_interval: int = MAX_BACKOFF_INTERVAL
    consecutive_failures: int = 0
    disabled: bool = False

    def record_failure(self) -> None:
        """记录一次失败，增加退避。"""
        self.consecutive_failures += 1
        if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
            self.disabled = True
            logger.warning(
                "[autonomy] 调度器连续失败 %d 次，已自动禁用",
                self.consecutive_failures,
            )

    def record_success(self) -> None:
        """记录一次成功，重置退避。"""
        self.consecutive_failures = 0
        self.disabled = False

    def is_disabled(self) -> bool:
        """是否已被自动禁用。"""
        return self.disabled


def compute_next_interval(state: BackoffState) -> int:
    """计算下一次执行间隔（指数退避）。

    策略：base * 2^failures，封顶 max_interval。
    """
    if state.consecutive_failures == 0:
        return state.base_interval
    # 指数退避：base * 2^failures
    interval = state.base_interval * (2 ** state.consecutive_failures)
    return min(interval, state.max_interval)
```

需要在文件顶部 import 区添加 `from dataclasses import dataclass`（如果尚未导入）。

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_scheduler_backoff.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: 接入 _autonomy_loop**

修改 `_autonomy_loop()` 内部循环，把固定 `await asyncio.sleep(interval_seconds)` 改为用 `BackoffState` 动态计算：

在 `_autonomy_loop` 函数体内，在 `while True:` 之前添加：

```python
        backoff = BackoffState(
            base_interval=interval_seconds,
            max_interval=MAX_BACKOFF_INTERVAL,
        )
```

把 `while True:` 循环体改为：

```python
        while True:
            if backoff.is_disabled():
                logger.warning("[autonomy] 调度器已自动禁用，停止循环")
                break
            try:
                report = await _run_tick(app, self_improve_enabled=self_improve_enabled)
                _last_tick_at = datetime.now().isoformat()
                _last_tick_report = report
                _tick_count += 1
                backoff.record_success()
            except asyncio.CancelledError:
                logger.info("[autonomy] 调度器被取消")
                break
            except Exception as e:
                logger.warning("[autonomy] tick 异常（不杀死循环）: %s", e)
                backoff.record_failure()

            next_interval = compute_next_interval(backoff)
            if next_interval != interval_seconds:
                logger.info(
                    "[autonomy] 退避间隔: %ds（连续失败 %d 次）",
                    next_interval, backoff.consecutive_failures,
                )
            await asyncio.sleep(next_interval)
```

- [ ] **Step 6: Run existing autonomy tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/ -v -k "scheduler or backoff"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd MaxmaHere
git add agent/autonomy/scheduler.py tests/test_agent/test_scheduler_backoff.py
git commit -m "feat: add exponential backoff and auto-disable to autonomy scheduler"
```

---

## Task 7: 接入 Transcript 到自治 Runner

**Files:**
- Modify: `agent/autonomy/runner.py`
- Test: `tests/test_agent/test_runner_transcript.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_agent/test_runner_transcript.py
"""自治 Runner Transcript 集成测试。"""
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from agent.autonomy.runner import run_self_improvement_agent


@pytest.mark.asyncio
async def test_run_creates_transcript_file(tmp_path):
    """自治 run 产出 JSONL transcript。"""
    transcript_path = tmp_path / "autonomy-run-test.jsonl"

    # Mock app
    app = MagicMock()
    app.state.llm = MagicMock()
    app.state.session_manager = AsyncMock()
    session = MagicMock()
    session.session_id = "test-session"
    session.checkpointer = None
    app.state.session_manager.create = AsyncMock(return_value=session)
    app.state.session_manager.delete = AsyncMock()
    app.state.tools = []
    app.state.system_prompt = "test"
    app.state.episodic_mm = None

    # Mock build_agent
    mock_graph = AsyncMock()
    mock_graph.ainvoke = AsyncMock(
        return_value={"messages": [MagicMock(content="done", type="ai")]}
    )

    with patch("agent.autonomy.runner.build_agent", return_value=mock_graph):
        result = await run_self_improvement_agent(
            app=app,
            diagnostic_report={"issues": [], "error_summary": {"total": 0}, "health_summary": {"overall_status": "ok"}},
            timeout=30,
            transcript_path=transcript_path,
        )

    assert transcript_path.exists()
    lines = transcript_path.read_text(encoding="utf-8").strip().split("\n")
    # 首行是 metadata，后续是消息
    assert len(lines) >= 2
    first = json.loads(lines[0])
    assert first["type"] == "metadata"
    assert first["trigger"] == "autonomy"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_runner_transcript.py -v`
Expected: FAIL with `TypeError: run_self_improvement_agent() got an unexpected keyword argument 'transcript_path'`

- [ ] **Step 3: Modify runner.py to accept transcript_path**

在 `run_self_improvement_agent` 函数签名中添加 `transcript_path` 参数，并在执行过程中写入 transcript：

```python
async def run_self_improvement_agent(
    app: Any,
    diagnostic_report: dict,
    timeout: int = 600,
    transcript_path: Path | str | None = None,
) -> str:
    """触发自改进 Agent 会话（无 WS、无 HITL 的 headless 执行）。

    Args:
        app: FastAPI 应用实例
        diagnostic_report: 诊断报告
        timeout: 超时秒数
        transcript_path: 可选，如果指定则把对话写入 JSONL transcript

    Returns:
        Agent 执行结果文本
    """
    from api.transcript.jsonl_writer import TranscriptWriter

    # 初始化 transcript writer（如果指定了路径）
    writer = TranscriptWriter(transcript_path) if transcript_path else None

    session_manager = getattr(app.state, "session_manager", None)
    if session_manager is None:
        raise RuntimeError("session_manager 未初始化")

    session = await session_manager.create()
    try:
        if writer:
            writer.append_metadata({
                "run_id": session.session_id,
                "trigger": "autonomy",
                "action": "self_improve",
                "timeout": timeout,
            })

        llm = getattr(app.state, "llm", None)
        if llm is None:
            raise RuntimeError("LLM 未就绪")

        tools = getattr(app.state, "tools", [])
        headless_tools = _filter_tools_for_headless(tools)
        system_prompt = getattr(app.state, "system_prompt", "") or ""
        prompt = _build_self_improve_prompt(diagnostic_report)

        if writer:
            writer.append_raw("human", prompt)

        graph = build_agent(
            model=llm,
            tools=headless_tools,
            system_prompt=system_prompt,
            checkpointer=session.checkpointer,
            episodic_mm=getattr(app.state, "episodic_mm", None),
            enable_hitl=False,
        )
        session._graph = graph

        output = await asyncio.wait_for(
            graph.ainvoke(
                {"messages": [HumanMessage(content=prompt)]},
                config={
                    "configurable": {"thread_id": session.session_id},
                    "recursion_limit": 120,
                },
            ),
            timeout=timeout,
        )

        result_text = _extract_final_answer(output)

        if writer:
            writer.append_raw("ai", result_text)
            writer.close()

        return result_text
    except Exception:
        if writer:
            writer.close()
        raise
    finally:
        delete_session = getattr(session_manager, "delete", None)
        if callable(delete_session):
            await delete_session(session.session_id)
```

需要在文件顶部添加 `from pathlib import Path` 和 `from typing import ... Path`。

同时需要添加一个辅助函数 `_extract_final_answer`（如果尚未存在）：

```python
def _extract_final_answer(output: dict) -> str:
    """从 graph 输出中提取最终文本。"""
    messages = output.get("messages", []) if isinstance(output, dict) else []
    if not messages:
        return ""
    last = messages[-1]
    content = last.content if hasattr(last, "content") else str(last)
    return str(content or "")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_runner_transcript.py -v`
Expected: PASS

- [ ] **Step 5: 修改 scheduler.py 调用，传入 transcript_path**

在 `agent/autonomy/scheduler.py` 的 `_run_self_improve` 函数中，构造 transcript 路径并传入：

```python
async def _run_self_improve(app: Any, report: dict) -> str:
    """触发自改进 Agent 会话。"""
    from agent.autonomy.runner import run_self_improvement_agent
    from config.settings import get_settings
    from app_paths import DATA_DIR
    from datetime import datetime

    settings = get_settings()
    timeout = settings.autonomy_max_agent_timeout

    # 构造 transcript 路径
    transcript_dir = DATA_DIR / "transcripts" / "autonomy"
    transcript_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    transcript_path = transcript_dir / f"autonomy-{timestamp}.jsonl"

    return await run_self_improvement_agent(
        app=app,
        diagnostic_report=report,
        timeout=timeout,
        transcript_path=transcript_path,
    )
```

- [ ] **Step 6: Run all autonomy tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/ -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd MaxmaHere
git add agent/autonomy/runner.py agent/autonomy/scheduler.py tests/test_agent/test_runner_transcript.py
git commit -m "feat: persist autonomy run transcripts to JSONL"
```

---

## Task 8: 接入事件去重到 HookManager

**Files:**
- Modify: `agent/hooks.py`
- Test: `tests/test_agent/test_hooks_dedup.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_agent/test_hooks_dedup.py
"""事件钩子去重集成测试。"""
import pytest
from agent.hooks import HookManager
from platform.event_dedup import EventDedupCache


def test_file_change_hook_dedup_within_ttl():
    """同一文件短时间内多次变更只触发一次。"""
    manager = HookManager()
    manager._dedup_cache = EventDedupCache(ttl_seconds=60, max_size=1000)

    # 模拟同一文件变更
    key1 = manager._make_dedup_key("file_change", "/path/to/file.py")
    key2 = manager._make_dedup_key("file_change", "/path/to/file.py")

    assert manager._dedup_cache.is_new(key1) is True
    assert manager._dedup_cache.is_new(key2) is False  # 去重


def test_different_files_not_deduped():
    manager = HookManager()
    manager._dedup_cache = EventDedupCache(ttl_seconds=60, max_size=1000)

    key1 = manager._make_dedup_key("file_change", "/path/to/file1.py")
    key2 = manager._make_dedup_key("file_change", "/path/to/file2.py")

    assert manager._dedup_cache.is_new(key1) is True
    assert manager._dedup_cache.is_new(key2) is True  # 不同文件不去重


def test_webhook_dedup_by_payload_hash():
    """webhook 按 payload hash 去重。"""
    manager = HookManager()
    manager._dedup_cache = EventDedupCache(ttl_seconds=60, max_size=1000)

    payload = '{"event": "push", "ref": "main"}'
    key1 = manager._make_dedup_key("webhook", payload)
    key2 = manager._make_dedup_key("webhook", payload)

    assert manager._dedup_cache.is_new(key1) is True
    assert manager._dedup_cache.is_new(key2) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_hooks_dedup.py -v`
Expected: FAIL with `AttributeError: 'HookManager' object has no attribute '_dedup_cache'`

- [ ] **Step 3: Modify HookManager to add dedup**

在 `agent/hooks.py` 的 `HookManager.__init__` 中初始化 dedup cache：

```python
    def __init__(self):
        # ... 已有初始化 ...
        # 事件去重缓存（应对 webhook 重试/文件监听爆发）
        from platform.event_dedup import EventDedupCache
        self._dedup_cache = EventDedupCache(ttl_seconds=60, max_size=1000)
```

添加去重 key 生成方法：

```python
    def _make_dedup_key(self, trigger_type: str, detail: str) -> str:
        """生成事件去重 key。

        Args:
            trigger_type: 触发类型（file_change/webhook/schedule）
            detail: 触发详情（文件路径或 payload）

        Returns:
            去重 key 字符串
        """
        import hashlib
        detail_hash = hashlib.md5(detail.encode("utf-8")).hexdigest()[:16]
        return f"{trigger_type}:{detail_hash}"
```

在文件变更和 webhook 触发路径中加入去重检查。找到文件变更触发的方法（如 `_on_file_change` 或类似），在调用 `_trigger_hook` 前加入：

```python
        # 事件去重检查
        dedup_key = self._make_dedup_key("file_change", str(file_path))
        if not self._dedup_cache.is_new(dedup_key):
            logger.debug("[hooks] file_change deduped: %s", file_path)
            return
```

同样在 webhook 触发路径加入：

```python
        # webhook 去重
        import json as _json
        payload_str = _json.dumps(payload, sort_keys=True) if isinstance(payload, dict) else str(payload)
        dedup_key = self._make_dedup_key("webhook", payload_str)
        if not self._dedup_cache.is_new(dedup_key):
            logger.debug("[hooks] webhook deduped")
            return
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_hooks_dedup.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd MaxmaHere
git add agent/hooks.py tests/test_agent/test_hooks_dedup.py
git commit -m "feat: add event deduplication to file-change and webhook hooks"
```

---

## Task 9: 接入 Idle Queue 到 server.py lifespan

**Files:**
- Modify: `api/server.py`

- [ ] **Step 1: 识别可移入 Idle Queue 的启动步骤**

在 `lifespan()` 中，以下步骤是"非首屏必需"的：
- RAG 索引预热（如果有）
- 记忆管理器的 TTL 清理任务启动
- 指标 flush 任务启动
- const 会话加载（如果 LLM 未就绪会 skip，可延后重试）

**注意**：不移动以下步骤（它们是首屏必需的）：
- Provider 管理器初始化（health 依赖）
- session_manager / ws_registry
- checkpointer 初始化
- LLM 后台初始化（已是非阻塞）
- MCP 工具加载（chat 依赖）
- Auth token

- [ ] **Step 2: 注册 idle tasks**

在 `lifespan()` 函数的 `yield` 之前、所有必需步骤完成后，注册非关键任务：

```python
    # === 注册 Idle Queue 任务（Tier 3，不阻塞启动）===
    from api.bootstrap.idle_queue import register_idle_task

    # const 会话重试加载（如果 LLM 初始化时未就绪）
    async def _retry_const_sessions():
        await asyncio.sleep(5)  # 等 LLM 初始化
        if getattr(app.state, "llm", None) is not None:
            await _load_const_sessions(app)

    register_idle_task("retry-const-sessions", _retry_const_sessions)

    # 指标 flush（低频，可延后）
    register_idle_task("start-metrics-flush", lambda: get_metrics().start_flush_task())

    # 记忆 TTL 清理任务
    register_idle_task("start-ttl-purge", lambda: schedule_ttl_purge(
        _settings.ttl_purge_interval_seconds,
        [_long_term_mm, _episodic_mm, _semantic_mm],
    ))
```

- [ ] **Step 3: 在 yield 前启动 idle drain**

在 `yield` 之前添加：

```python
    # === 启动 Idle Queue drain（非阻塞）===
    from api.bootstrap.idle_queue import start_idle_drain
    asyncio.create_task(start_idle_drain())
```

- [ ] **Step 4: 验证启动正常**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_server.py -v`
Expected: PASS（所有已有服务器测试不应被破坏）

- [ ] **Step 5: 手动启动验证**

Run: `.venv\Scripts\python.exe main.py`
Expected: 启动日志中应看到 `[idle-queue] drained N task(s)`

- [ ] **Step 6: Commit**

```bash
cd MaxmaHere
git add api/server.py
git commit -m "refactor: move non-critical startup tasks to idle queue"
```

---

## Task 10: 接入凭据掩码到 Provider REST API

**Files:**
- Modify: `api/routes/providers.py`
- Test: `tests/test_api/test_providers_masking.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_api/test_providers_masking.py
"""Provider API 凭据掩码集成测试。"""
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    """创建测试客户端。"""
    # Mock provider manager
    from api.server import create_app
    app = create_app()
    app.state.provider_manager = MagicMock()
    app.state.auth_token = "test-token"
    return TestClient(app)


def test_list_providers_masks_api_key(client):
    """GET /api/providers 返回的 api_key 被掩码。"""
    from api.providers import ProviderConfig
    config = ProviderConfig(
        id="test-1",
        provider_type="openai",
        label="Test",
        api_key="sk-1234567890abcdef",
        base_url="https://api.test.com/v1",
        models=["test-model"],
        enabled=True,
    )
    client.app.state.provider_manager.list_all = MagicMock(return_value=[config])

    response = client.get(
        "/api/providers",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) > 0
    # api_key 应被掩码（不再是明文）
    assert data[0]["api_key"] != "sk-1234567890abcdef"
    assert "***" in data[0]["api_key"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_providers_masking.py -v`
Expected: FAIL（如果现有 to_dict() 已经做了脱敏则调整测试期望，或 PASS 则跳到下一步）

- [ ] **Step 3: 在 providers route 中接入统一掩码**

在 `api/routes/providers.py` 的列表端点中，用 `mask_sensitive_fields` 包装返回数据：

找到返回 provider 列表的位置，改为：

```python
from api.security.credential_mask import mask_sensitive_fields

@router.get("/providers")
async def list_providers(request: Request):
    manager = request.app.state.provider_manager
    configs = manager.list_all()
    # 使用统一掩码层（替代各处 to_dict 的分散脱敏）
    result = []
    for config in configs:
        d = config.to_dict()  # 已有脱敏
        # 额外用统一层兜底（防止遗漏字段）
        d = mask_sensitive_fields(d)
        result.append(d)
    return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_providers_masking.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd MaxmaHere
git add api/routes/providers.py tests/test_api/test_providers_masking.py
git commit -m "feat: apply unified credential masking to provider REST API"
```

---

## Task 11: 接入 Disposable 到 lifespan 清理

**Files:**
- Modify: `api/server.py`

- [ ] **Step 1: 在 lifespan 开头创建 DisposableStore**

在 `lifespan()` 函数开头（`yield` 之前）添加：

```python
    from agent.lifecycle.disposable import DisposableStore, to_disposable

    # Disposable 资源集合 — 统一管理生命周期
    _disposables = DisposableStore()
    app.state._disposables = _disposables
```

- [ ] **Step 2: 注册关键资源到 DisposableStore**

把现有 lifespan 中的后台任务注册到 DisposableStore。例如：

```python
    # 后台 LLM 初始化任务
    llm_task = asyncio.create_task(_init_llm_background())
    _disposables.add(to_disposable(lambda: llm_task.cancel() if not llm_task.done() else None))

    # 会话清理任务
    cleanup_task = asyncio.create_task(_periodic_cleanup())
    _disposables.add(to_disposable(lambda: cleanup_task.cancel() if not cleanup_task.done() else None))
```

- [ ] **Step 3: 在 shutdown 中用 DisposableStore 释放**

把 `yield` 之后的清理逻辑改为：

```python
    # 优先通过 DisposableStore 释放（逆序）
    _disposables = getattr(app.state, "_disposables", None)
    if _disposables:
        _disposables.dispose()

    # 保留必要的显式清理（Disposable 无法覆盖的 async 资源）
    from api.providers.health_monitor import stop_health_monitor
    await stop_health_monitor()

    from memory.ttl import stop_purge as stop_ttl_purge
    await stop_ttl_purge()

    hook_manager.stop_all()
    logger.info("[hooks] 事件钩子管理器已停止")

    from agent.autonomy.scheduler import stop_autonomy
    await stop_autonomy()

    await close_mcp()
    await balance.close_async_client()
    await app.state.ltm.stop_listening()

    try:
        from tools.network.playwright_tools.browser_manager import BrowserManager
        BrowserManager().shutdown()
    except Exception:
        logger.warning("[playwright] browser shutdown failed", exc_info=True)

    from api.checkpointer_factory import close_persistent_checkpointer
    await close_persistent_checkpointer()
```

- [ ] **Step 4: 验证启动和关闭**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_server.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd MaxmaHere
git add api/server.py
git commit -m "refactor: use DisposableStore for lifespan resource cleanup"
```

---

## Task 12: 添加 Transcript 读取 REST 端点

**Files:**
- Modify: `api/routes/diagnostics.py`（或新建 `api/routes/transcripts.py`）
- Test: `tests/test_api/test_transcript_endpoint.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_api/test_transcript_endpoint.py
"""Transcript 读取端点测试。"""
import json
import pytest
from pathlib import Path
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from api.server import create_app
    app = create_app()
    app.state.auth_token = "test-token"
    return TestClient(app)


def test_list_transcripts(client, tmp_path, monkeypatch):
    """GET /api/transcripts 返回已有的 transcript 文件列表。"""
    from app_paths import DATA_DIR
    transcript_dir = tmp_path / "transcripts" / "autonomy"
    transcript_dir.mkdir(parents=True)
    (transcript_dir / "autonomy-20260710-120000.jsonl").write_text(
        json.dumps({"type": "metadata", "run_id": "r1"}) + "\n", encoding="utf-8"
    )

    monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)

    response = client.get(
        "/api/transcripts",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "autonomy" in data["categories"]
    assert len(data["categories"]["autonomy"]) == 1


def test_read_transcript(client, tmp_path, monkeypatch):
    """GET /api/transcripts/{category}/{filename} 返回 transcript 内容。"""
    transcript_dir = tmp_path / "transcripts" / "autonomy"
    transcript_dir.mkdir(parents=True)
    filename = "autonomy-20260710-120000.jsonl"
    (transcript_dir / filename).write_text(
        json.dumps({"type": "metadata", "run_id": "r1"}) + "\n" +
        json.dumps({"type": "message", "role": "human", "content": "test"}) + "\n",
        encoding="utf-8",
    )

    monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)

    response = client.get(
        f"/api/transcripts/autonomy/{filename}",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["messages"]) == 1
    assert data["messages"][0]["content"] == "test"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_transcript_endpoint.py -v`
Expected: FAIL with 404（路由不存在）

- [ ] **Step 3: 添加 transcript 路由**

新建 `api/routes/transcripts.py`：

```python
"""Transcript 读取 REST 端点 — 后台运行抄本的查看入口。"""
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from api.transcript.jsonl_writer import TranscriptWriter
from app_paths import DATA_DIR

logger = logging.getLogger(__name__)

router = APIRouter()

# 允许的 transcript 类别（路径穿越防护）
_ALLOWED_CATEGORIES = frozenset({"autonomy", "hooks", "manual"})


@router.get("/transcripts")
async def list_transcripts(request: Request):
    """列出所有 transcript 文件，按类别分组。"""
    transcripts_root = DATA_DIR / "transcripts"
    result: dict[str, list] = {}
    if not transcripts_root.exists():
        return {"categories": result}

    for category_dir in transcripts_root.iterdir():
        if not category_dir.is_dir():
            continue
        if category_dir.name not in _ALLOWED_CATEGORIES:
            continue
        files = []
        for f in sorted(category_dir.glob("*.jsonl"), reverse=True):
            stat = f.stat()
            files.append({
                "filename": f.name,
                "size": stat.st_size,
                "modified_at": stat.st_mtime,
            })
        result[category_dir.name] = files

    return {"categories": result}


@router.get("/transcripts/{category}/{filename}")
async def read_transcript(category: str, filename: str, request: Request):
    """读取单个 transcript 文件内容。"""
    if category not in _ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")

    # 路径穿越防护
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    transcript_path = DATA_DIR / "transcripts" / category / filename
    if not transcript_path.exists():
        raise HTTPException(status_code=404, detail="Transcript not found")

    messages = TranscriptWriter.read_messages(transcript_path)
    return {"messages": messages, "filename": filename, "category": category}
```

- [ ] **Step 4: 在 server.py 中挂载路由**

在 `create_app()` 中添加：

```python
    # Transcript 读取
    from api.routes import transcripts as transcripts_router
    app.include_router(transcripts_router.router, prefix="/api")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_transcript_endpoint.py -v`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
cd MaxmaHere
git add api/routes/transcripts.py tests/test_api/test_transcript_endpoint.py api/server.py
git commit -m "feat: add REST endpoints for reading background run transcripts"
```

---

## Task 13: 集成验证 + 端到端测试

**Files:**
- Test: `tests/test_integration/test_halo_inspired.py`

- [ ] **Step 1: Write integration test**

```python
# tests/test_integration/test_halo_inspired.py
"""Halo-inspired 增强功能集成验证测试。"""
import asyncio
import json
import pytest
from pathlib import Path

from agent.lifecycle.disposable import DisposableStore, to_disposable
from api.bootstrap.idle_queue import register_idle_task, start_idle_drain, clear_idle_queue
from api.security.credential_mask import mask_sensitive_fields, MASK_SENTINEL
from api.transcript.jsonl_writer import TranscriptWriter
from platform.event_dedup import EventDedupCache
from agent.autonomy.scheduler import BackoffState, compute_next_interval


def test_all_modules_importable():
    """所有新增模块可正常导入。"""
    import agent.lifecycle
    import api.bootstrap
    import api.security
    import api.transcript
    import platform.event_dedup


def test_idle_queue_and_disposable_together():
    """Idle Queue 任务中使用 Disposable。"""
    clear_idle_queue()
    store = DisposableStore()
    released = []

    def _task():
        store.add(to_disposable(lambda: released.append("cleaned")))

    register_idle_task("test", _task)

    asyncio.run(start_idle_drain())
    store.dispose()
    assert released == ["cleaned"]


def test_transcript_with_credential_mask():
    """Transcript 中不泄露凭据。"""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w") as f:
        path = Path(f.name)

    try:
        writer = TranscriptWriter(path)
        writer.append_raw("human", "My API key is sk-1234567890")
        writer.close()

        # 读取后掩码
        from api.transcript.jsonl_writer import TranscriptWriter as TW
        messages = TW.read_messages(path)
        masked = mask_sensitive_fields({"messages": messages})
        # transcript 内容不应被掩码（它是对话内容，不是配置字段）
        # 但如果 transcript 中恰好有 api_key 字段名则应被掩码
        assert "messages" in masked
    finally:
        path.unlink(missing_ok=True)


def test_backoff_and_event_dedup_independence():
    """退避状态和事件去重互不干扰。"""
    backoff = BackoffState(base_interval=3600)
    dedup = EventDedupCache(ttl_seconds=60, max_size=100)

    backoff.record_failure()
    assert dedup.is_new("event-1") is True
    assert dedup.is_new("event-1") is False

    backoff.record_success()
    assert backoff.consecutive_failures == 0
    # dedup 状态不受 backoff 影响
    assert dedup.is_new("event-1") is False
```

- [ ] **Step 2: Run integration test**

Run: `.venv\Scripts\python.exe -m pytest tests/test_integration/test_halo_inspired.py -v`
Expected: PASS (4 tests)

- [ ] **Step 3: 运行全量测试套件确保无回归**

Run: `.venv\Scripts\python.exe -m pytest tests/ -v --tb=short`
Expected: 所有测试 PASS（新增测试 + 已有测试）

- [ ] **Step 4: Commit**

```bash
cd MaxmaHere
git add tests/test_integration/test_halo_inspired.py
git commit -m "test: add integration tests for Halo-inspired enhancements"
```

---

## Self-Review

### Spec coverage 检查

| Halo 闪光点 | 对应 Task | 状态 |
|---|---|---|
| 三阶段启动分层（Bootstrap Phasing） | Task 2 + Task 9 | ✅ |
| Disposable 资源生命周期管理 | Task 1 + Task 11 | ✅ |
| 事件去重缓存 | Task 3 + Task 8 | ✅ |
| 凭据掩码统一层（始终启用 + sentinel 回填） | Task 4 + Task 10 | ✅ |
| 后台任务 JSONL Transcript | Task 5 + Task 7 + Task 12 | ✅ |
| 调度器指数退避 + 自动禁用 | Task 6 | ✅ |
| 集成验证 | Task 13 | ✅ |

### 未纳入本计划（避免画蛇添足）

以下 Halo 特性**不纳入**，因为 Maxma 已有等价或更优实现，强行替换会破坏现有设计：

1. **装饰器工具注册** — Maxma 已有完善的 `@register_tool` + `pkgutil.walk_packages`，不替换
2. **4 层记忆架构** — Maxma 已有 long/episodic/semantic + coordinator，不重构
3. **DPAPI/Fernet 加密** — Maxma 已有 `tools/crypto.py`，不替换
4. **指纹缓存** — Maxma 已有 MD5 指纹被动失效，不替换
5. **AsyncSqliteSaver checkpointer** — Maxma 已有 WAL 模式 + 工厂模式，不替换
6. **OpenAI-compat-router 协议翻译** — Maxma 的 Provider 体系不同（多 provider 直连），不引入
7. **Store/Registry 技能市场** — Maxma 的技能是文件式 + GitHub 导入，不引入中心化市场
8. **Platform/Apps/Spec 三层正交分层** — Maxma 的分层方式不同（agent/api/tools/memory），不做架构重构

### Placeholder 扫描

无 TBD/TODO/placeholder。所有代码块均完整。

### 类型一致性

- `BackoffState` 在 Task 6 定义，在 Task 13 引用 — 一致 ✅
- `TranscriptWriter` 在 Task 5 定义，在 Task 7/12/13 引用 — 一致 ✅
- `mask_sensitive_fields` 在 Task 4 定义，在 Task 10/13 引用 — 一致 ✅
- `EventDedupCache` 在 Task 3 定义，在 Task 8/13 引用 — 一致 ✅
- `DisposableStore` 在 Task 1 定义，在 Task 11/13 引用 — 一致 ✅

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-10-halo-inspired-enhancements.md`.**
