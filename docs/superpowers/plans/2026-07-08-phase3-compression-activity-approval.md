# Phase 3：会话压缩增强 + Activity Hub + LLM 审批网关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强会话压缩可视化与手动控制、新建 Activity Hub 统一活动事件中心、新建 LLM 工具审批网关，让 Maxma 在长对话管理、可观测性、安全可控性上达到企业级水准。

**Architecture:** 会话压缩复用已有 `maybe_trim_checkpoint` + 新增 WS 事件推送与手动端点（最小侵入）。Activity Hub 完全复制 `ErrorCollector` 单例模式（`deque` + `threading.Lock`），新增 SSE 流式推送 + REST 查询 + 前端页面（纯新增不侵入）。LLM 审批网关包装 LangGraph `ToolNode` 为 `ApprovalToolNode`，复用 `interaction.py` register/resolve 机制与 `ask_user` WS 事件（最高风险，最后实现）。

**Tech Stack:** Python (FastAPI + asyncio + LangGraph) + Vue 3 (TypeScript + Pinia + SSE) + WebSocket

---

## Scope Check

本 plan 覆盖 3 个独立子系统，按风险从低到高排序：

| 模块 | Task | 侵入性 | 风险 | 依赖 |
|------|------|--------|------|------|
| 会话压缩增强 | Task 1-2 | 低 | 低 | 已有 `context_manager.py` |
| Activity Hub | Task 3-5 | 无（纯新增） | 低 | 无 |
| LLM 审批网关 | Task 6-9 | 高（替换 ToolNode） | 高 | Task 5（Activity Hub 记录审批事件） |

**建议执行顺序：** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9。前 5 个 Task 风险低可快速推进，Task 6-9 需充分测试。

---

## 文件结构

### 新建文件

| 文件路径 | 职责 |
|---------|------|
| `api/routes/session_compress.py` | 会话压缩手动触发 REST 端点 |
| `api/activity_hub.py` | Activity Hub 全局单例（`deque` + `threading.Lock`） |
| `api/routes/activity.py` | Activity Hub REST + SSE 路由 |
| `web/src/stores/activity.ts` | Activity Hub Pinia store |
| `web/src/views/ActivityView.vue` | Activity Hub 页面 |
| `agent/approval_gateway.py` | 审批策略 + 风险分级决策层 |
| `agent/approval_tool_node.py` | 包装 ToolNode 的审批拦截节点 |
| `web/src/components/ApprovalBubble.vue` | 审批请求 UI 组件 |

### 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `agent/context_manager.py` | `maybe_trim_checkpoint` 返回压缩详情 + WS 回调通知 |
| `api/routes/chat.py` | 传递 WS 回调给 `maybe_trim_checkpoint`；注册新路由 |
| `api/server.py` | 注册 session_compress + activity 路由 |
| `api/websocket_callback.py` | `on_tool_start/end` 记录到 Activity Hub |
| `agent/graph.py` | 替换 `ToolNode` 为 `ApprovalToolNode`（可配置开关） |
| `agent/executor.py` | 工具执行前后记录到 Activity Hub |
| `config/settings.py` | 新增审批相关配置项 |
| `web/src/composables/useChat.ts` | 新增 `context_compressed` + `approval_request` 事件处理 |
| `web/src/types/index.ts` | 新增 `ContextCompressedEvent` + `ApprovalRequestEvent` + `ActivityRecord` 类型 |
| `web/src/router/index.ts` | 新增 `/activity` 路由 |
| `web/src/App.vue` | 侧边栏新增 Activity 入口 |

---

## Task 1：会话压缩事件推送

**Files:**
- Modify: `agent/context_manager.py`
- Modify: `api/routes/chat.py`

- [ ] **Step 1：修改 `maybe_trim_checkpoint` 签名，新增 `ws_callback` 参数**

首先用 Read 工具读取 `d:\Maxma\MaxmaHere\agent\context_manager.py` 的 `maybe_trim_checkpoint` 函数（约 L339-422）。

在函数签名中新增 `ws_callback` 参数（可选）：

```python
async def maybe_trim_checkpoint(
    agent_maxma,
    config: dict,
    system_prompt_tokens: int,
    current_max_tokens: int,
    *,
    llm=None,
    ws_callback=None,  # 新增：WS 回调，用于推送压缩事件
) -> dict:
    """返回压缩详情 dict，而非 bool。ws_callback 为 None 时不推送事件。"""
```

- [ ] **Step 2：修改 `maybe_trim_checkpoint` 返回值**

将函数末尾的 `return True`/`return False` 改为返回详情 dict：

```python
    # 未触发压缩
    return {"compressed": False}

    # 触发压缩后，构建详情
    compress_detail = {
        "compressed": True,
        "removed_count": len(ids_to_remove),
        "summary_preview": summary_text[:200] if summary_text else "",
        "before_tokens": before_tokens,
        "after_tokens": after_tokens,
        "context_usage_before": usage_ratio_before,
        "context_usage_after": usage_ratio_after,
    }

    # 通过 WS 回调推送压缩事件
    if ws_callback and compress_detail["compressed"]:
        try:
            await ws_callback({
                "type": "context_compressed",
                "payload": compress_detail,
            })
        except Exception:
            pass  # WS 推送失败不影响压缩

    return compress_detail
```

注意：需在函数中计算 `before_tokens`/`after_tokens`/`usage_ratio_before`/`usage_ratio_after`。如果这些值已在函数中计算过（如 `usage_ratio`），复用即可。如果没有，在压缩前后各调用一次 `estimate_context_usage` 获取。

- [ ] **Step 3：修改 `chat.py` 调用点，传入 ws_callback**

用 Read 工具读取 `d:\Maxma\MaxmaHere\api\routes\chat.py` 的 `_run_agent_turn` 函数中调用 `maybe_trim_checkpoint` 的位置（约 L667-669）。

修改调用，传入 ws_callback：

```python
                    compress_result = await maybe_trim_checkpoint(
                        agent_maxma, config, system_prompt_tokens, current_max_tokens,
                        llm=llm,
                        ws_callback=ws_callback,
                    )
```

其中 `ws_callback` 是 `_run_agent_turn` 的参数或局部变量（WebSocket 发送函数）。检查函数签名，确保 `ws_callback` 在作用域内可用。

- [ ] **Step 4：后端验证**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from agent.context_manager import maybe_trim_checkpoint; import inspect; sig = inspect.signature(maybe_trim_checkpoint); print('ws_callback' in sig.parameters)"`

Expected: `True`

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from api.routes.chat import router; print('chat router ok')"`

Expected: `chat router ok`

- [ ] **Step 5：提交**

```bash
cd d:\Maxma\MaxmaHere
git add agent/context_manager.py api/routes/chat.py
git commit -m "feat: push context_compressed WS event when session is compressed"
```

---

## Task 2：手动压缩端点 + 前端事件处理

**Files:**
- Create: `api/routes/session_compress.py`
- Modify: `api/server.py`
- Modify: `web/src/composables/useChat.ts`
- Modify: `web/src/types/index.ts`

- [ ] **Step 1：创建手动压缩端点**

创建 `d:\Maxma\MaxmaHere\api\routes\session_compress.py`：

```python
"""会话手动压缩 REST 端点。"""
from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException, Request

from agent.context_manager import maybe_trim_checkpoint
from api.context_usage import estimate_context_usage
from api.llm_factory import build_llm

router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


@router.post("/{session_id}/compress")
async def compress_session(session_id: str, request: Request) -> dict:
    """手动触发会话上下文压缩。

    返回压缩详情 dict。若无需压缩，返回 {"compressed": False}。
    """
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    agent_maxma = request.app.state.agent
    config = {"configurable": {"thread_id": session_id}, "recursion_limit": 120}

    # 获取当前模型 LLM
    provider_id = getattr(session, "provider_id", None)
    model_name = getattr(session, "model_name", None)
    try:
        llm = build_llm(provider_id=provider_id, model_name=model_name)
    except Exception:
        llm = None

    # 估算当前 token
    usage = await estimate_context_usage(agent_maxma, config)
    system_prompt_tokens = usage.get("system_prompt_tokens", 0)
    current_max_tokens = usage.get("max_tokens", 128000)

    try:
        result = await maybe_trim_checkpoint(
            agent_maxma, config, system_prompt_tokens, current_max_tokens,
            llm=llm, ws_callback=None,
        )
        return result
    except Exception as e:
        logger.exception("Manual compress failed for session %s", session_id)
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 2：在 server.py 注册路由**

用 Read 工具读取 `d:\Maxma\MaxmaHere\api\server.py`，找到路由注册区域（约 L484-555）。

在 `app.include_router(...)` 序列中添加：

```python
    from api.routes import session_compress
    app.include_router(session_compress.router, prefix="/api")
```

- [ ] **Step 3：后端验证**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from api.routes.session_compress import router; print(len(router.routes))"`

Expected: `1`

- [ ] **Step 4：前端新增 `ContextCompressedEvent` 类型**

用 Read 工具读取 `d:\Maxma\MaxmaHere\web\src\types\index.ts`，在适当位置添加：

```typescript
/** 会话上下文压缩事件 */
export interface ContextCompressedEvent {
  type: 'context_compressed'
  payload: {
    compressed: boolean
    removed_count?: number
    summary_preview?: string
    before_tokens?: number
    after_tokens?: number
    context_usage_before?: number
    context_usage_after?: number
  }
}
```

- [ ] **Step 5：前端 useChat.ts 新增 `context_compressed` 事件处理**

用 Read 工具读取 `d:\Maxma\MaxmaHere\web\src\composables\useChat.ts` 的 `handleEventForChannel` 函数（约 L327-622）。

在 `case 'context_usage'` 之后（约 L335 后）添加：

```typescript
      case 'context_compressed': {
        // 更新上下文用量
        if (data.payload?.context_usage_after !== undefined) {
          ch.contextUsage = data.payload.context_usage_after
        }
        // 在当前 turn 事件流中追加压缩通知
        if (ch.currentTurn) {
          ch.currentTurn.events.push({
            type: 'system',
            kind: 'context_compressed',
            content: `上下文已压缩：移除 ${data.payload?.removed_count ?? 0} 条消息` +
              (data.payload?.summary_preview ? `，摘要：${data.payload.summary_preview}` : ''),
            timestamp: Date.now(),
          })
        }
        break
      }
```

- [ ] **Step 6：前端新增手动压缩 API 调用**

在 `d:\Maxma\MaxmaHere\web\src\api\index.ts` 中（用 Read 先查看现有 API 函数模式）添加：

```typescript
  /** 手动触发会话压缩 */
  async compressSession(sessionId: string): Promise<unknown> {
    return fetchJson(`/api/sessions/${sessionId}/compress`, { method: 'POST' })
  },
```

注意：需确认 `fetchJson` 函数的签名和用法，参考同文件中其他 API 函数的实现模式。

- [ ] **Step 7：前端验证**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`

Expected: 无新增错误

- [ ] **Step 8：提交**

```bash
cd d:\Maxma\MaxmaHere
git add api/routes/session_compress.py api/server.py
git add web/src/types/index.ts web/src/composables/useChat.ts web/src/api/index.ts
git commit -m "feat: add manual session compress endpoint and context_compressed event handling"
```

---

## Task 3：Activity Hub 后端核心

**Files:**
- Create: `api/activity_hub.py`
- Modify: `agent/executor.py`
- Modify: `api/callbacks/websocket_callback.py`

- [ ] **Step 1：创建 ActivityHub 单例**

创建 `d:\Maxma\MaxmaHere\api\activity_hub.py`：

```python
"""Activity Hub —— 全局活动事件中心。

采用与 ErrorCollector 相同的单例模式：deque 环形缓冲 + threading.Lock。
记录 turn/tool/plan/compression/approval/memory 级别事件，供前端实时展示和查询。
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class ActivityRecord:
    """单条活动记录。"""
    timestamp: float
    category: str  # turn / tool / plan / compression / approval / memory / system
    event_type: str  # 子类型，如 turn_start / tool_end / plan_proposed
    session_id: str = ""
    turn_id: str = ""
    tool_name: str = ""
    level: str = "info"  # info / warn / error
    message: str = ""
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ActivityHub:
    """活动事件中心，全局单例。"""

    _instance: Optional["ActivityHub"] = None
    _class_lock = threading.Lock()

    MAX_IN_MEMORY = 1000

    def __init__(self) -> None:
        self._buffer: deque[ActivityRecord] = deque(maxlen=self.MAX_IN_MEMORY)
        self._buffer_lock = threading.Lock()
        self._started_at = time.time()

    @classmethod
    def get(cls) -> "ActivityHub":
        """双重检查锁定获取单例。"""
        if cls._instance is None:
            with cls._class_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def add(
        self,
        category: str,
        event_type: str,
        *,
        session_id: str = "",
        turn_id: str = "",
        tool_name: str = "",
        level: str = "info",
        message: str = "",
        payload: Optional[dict[str, Any]] = None,
    ) -> ActivityRecord:
        """记录一条活动事件。线程安全。"""
        record = ActivityRecord(
            timestamp=time.time(),
            category=category,
            event_type=event_type,
            session_id=session_id,
            turn_id=turn_id,
            tool_name=tool_name,
            level=level,
            message=message,
            payload=payload or {},
        )
        with self._buffer_lock:
            self._buffer.append(record)
        return record

    def recent(self, limit: int = 100, category: Optional[str] = None) -> list[ActivityRecord]:
        """获取最近 N 条记录，可按 category 过滤。"""
        with self._buffer_lock:
            records = list(self._buffer)
        if category:
            records = [r for r in records if r.category == category]
        return records[-limit:]

    def clear(self) -> int:
        """清空缓冲区，返回清空的记录数。"""
        with self._buffer_lock:
            count = len(self._buffer)
            self._buffer.clear()
        return count

    def stats(self) -> dict[str, Any]:
        """返回统计信息。"""
        with self._buffer_lock:
            total = len(self._buffer)
            by_category: dict[str, int] = {}
            for r in self._buffer:
                by_category[r.category] = by_category.get(r.category, 0) + 1
        return {
            "total": total,
            "by_category": by_category,
            "started_at": self._started_at,
            "uptime_seconds": time.time() - self._started_at,
        }


# 模块级单例快捷引用
activity_hub = ActivityHub.get()
```

- [ ] **Step 2：在 websocket_callback.py 接入 Activity Hub**

用 Read 工具读取 `d:\Maxma\MaxmaHere\api\callbacks\websocket_callback.py` 的 `on_tool_start`（约 L91-110）和 `on_tool_end`（约 L112-161）方法。

在 `on_tool_start` 中添加活动记录（在现有逻辑之后）：

```python
    def on_tool_start(self, serialized: dict, input: dict, **kwargs) -> None:
        # ...现有逻辑保持不变...

        # 记录到 Activity Hub
        from api.activity_hub import activity_hub
        tool_name = serialized.get("name", "unknown")
        session_id = getattr(self, "session_id", "")
        turn_id = getattr(self, "turn_id", "")
        activity_hub.add(
            category="tool",
            event_type="tool_start",
            session_id=session_id,
            turn_id=turn_id,
            tool_name=tool_name,
            message=f"工具开始：{tool_name}",
            payload={"input": input},
        )
```

在 `on_tool_end` 中添加活动记录：

```python
    def on_tool_end(self, output: str, **kwargs) -> None:
        # ...现有逻辑保持不变...

        # 记录到 Activity Hub
        from api.activity_hub import activity_hub
        activity_hub.add(
            category="tool",
            event_type="tool_end",
            session_id=getattr(self, "session_id", ""),
            turn_id=getattr(self, "turn_id", ""),
            tool_name=getattr(self, "_current_tool_name", ""),
            message=f"工具结束",
            payload={"output_preview": str(output)[:200]},
        )
```

注意：需检查 `self.session_id`/`self.turn_id`/`self._current_tool_name` 是否在回调类中可用。如果属性名不同，调整为实际属性名。如果不存在，在 `on_tool_start` 中保存 `self._current_tool_name = tool_name`。

- [ ] **Step 3：在 executor.py 记录 turn 级别活动**

用 Read 工具读取 `d:\Maxma\MaxmaHere\agent\executor.py` 的 `make_executor_node` 函数。

在 turn 开始和结束处添加活动记录。找到 turn 开始的位置（约 L250 附近），添加：

```python
        from api.activity_hub import activity_hub
        activity_hub.add(
            category="turn",
            event_type="turn_start",
            session_id=config.get("configurable", {}).get("thread_id", ""),
            message="Agent turn 开始",
        )
```

找到 turn 结束的位置（return 之前），添加：

```python
        activity_hub.add(
            category="turn",
            event_type="turn_end",
            session_id=config.get("configurable", {}).get("thread_id", ""),
            message="Agent turn 结束",
        )
```

- [ ] **Step 4：后端验证**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from api.activity_hub import activity_hub; activity_hub.add('test', 'test_event', message='hello'); r = activity_hub.recent(10); print(len(r), r[-1].message)"`

Expected: `1 hello`

- [ ] **Step 5：提交**

```bash
cd d:\Maxma\MaxmaHere
git add api/activity_hub.py api/callbacks/websocket_callback.py agent/executor.py
git commit -m "feat: add ActivityHub singleton and record tool/turn events"
```

---

## Task 4：Activity Hub REST + SSE 路由

**Files:**
- Create: `api/routes/activity.py`
- Modify: `api/server.py`
- Modify: `agent/context_manager.py`

- [ ] **Step 1：创建 Activity Hub 路由**

创建 `d:\Maxma\MaxmaHere\api\routes\activity.py`：

```python
"""Activity Hub REST + SSE 路由。"""
from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from api.activity_hub import activity_hub

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("/recent")
async def get_recent(limit: int = 100, category: str | None = None) -> dict:
    """获取最近的活动记录。"""
    records = activity_hub.recent(limit=limit, category=category)
    return {
        "records": [r.to_dict() for r in records],
        "total": len(records),
    }


@router.get("/stats")
async def get_stats() -> dict:
    """获取活动统计信息。"""
    return activity_hub.stats()


@router.delete("")
async def clear_activity() -> dict:
    """清空活动缓冲区。"""
    count = activity_hub.clear()
    return {"cleared": count}


@router.get("/stream")
async def stream_activity(request: Request):
    """SSE 流式推送活动事件。

    客户端通过 EventSource 连接，实时接收新活动。
    使用轮询 deque 的方式（每 1s 检查一次），避免复杂的发布订阅机制。
    """
    async def event_generator():
        last_count = len(activity_hub.recent(limit=10000))
        while True:
            if await request.is_disconnected():
                break
            records = activity_hub.recent(limit=10000)
            new_records = records[last_count:]
            for record in new_records:
                yield {
                    "data": json.dumps(record.to_dict(), ensure_ascii=False),
                    "event": "activity",
                }
            last_count = len(records)
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

- [ ] **Step 2：在 server.py 注册路由**

用 Read 工具读取 `d:\Maxma\MaxmaHere\api\server.py`，在路由注册区域添加：

```python
    from api.routes import activity
    app.include_router(activity.router, prefix="/api")
```

- [ ] **Step 3：在 context_manager.py 压缩成功时记录到 Activity Hub**

用 Read 工具读取 `d:\Maxma\MaxmaHere\agent\context_manager.py` 的 `maybe_trim_checkpoint` 函数。

在压缩成功后（`aupdate_state` 之后）添加：

```python
                    # 记录到 Activity Hub
                    from api.activity_hub import activity_hub
                    activity_hub.add(
                        category="compression",
                        event_type="context_compressed",
                        session_id=config.get("configurable", {}).get("thread_id", ""),
                        message=f"上下文压缩：移除 {len(ids_to_remove)} 条消息",
                        payload={
                            "removed_count": len(ids_to_remove),
                            "summary_preview": summary_text[:200] if summary_text else "",
                        },
                    )
```

- [ ] **Step 4：后端验证**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from api.routes.activity import router; print(len(router.routes))"`

Expected: `4`

- [ ] **Step 5：提交**

```bash
cd d:\Maxma\MaxmaHere
git add api/routes/activity.py api/server.py agent/context_manager.py
git commit -m "feat: add Activity Hub REST+SSE routes and record compression events"
```

---

## Task 5：Activity Hub 前端页面

**Files:**
- Create: `web/src/stores/activity.ts`
- Create: `web/src/views/ActivityView.vue`
- Modify: `web/src/router/index.ts`
- Modify: `web/src/App.vue`

- [ ] **Step 1：创建 Activity Pinia store**

创建 `d:\Maxma\MaxmaHere\web\src\stores\activity.ts`：

```typescript
// web/src/stores/activity.ts
import { defineStore } from 'pinia'
import { ref, onUnmounted } from 'vue'
import { api } from '@/api'

export interface ActivityRecord {
  timestamp: number
  category: string
  event_type: string
  session_id: string
  turn_id: string
  tool_name: string
  level: string
  message: string
  payload: Record<string, unknown>
}

export const useActivityStore = defineStore('activity', () => {
  const records = ref<ActivityRecord[]>([])
  const stats = ref<Record<string, unknown>>({})
  const connected = ref(false)
  let eventSource: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function fetchRecent(limit = 100) {
    try {
      const data = await api.getActivityRecent(limit)
      records.value = data.records || []
    } catch (e) {
      console.error('Failed to fetch activity:', e)
    }
  }

  async function fetchStats() {
    try {
      stats.value = await api.getActivityStats()
    } catch (e) {
      console.error('Failed to fetch activity stats:', e)
    }
  }

  function startStream() {
    if (eventSource) eventSource.close()
    try {
      const base = import.meta.env.DEV ? 'http://127.0.0.1:8000' : ''
      eventSource = new EventSource(`${base}/api/activity/stream`)
      eventSource.addEventListener('activity', (ev: MessageEvent) => {
        try {
          const record = JSON.parse(ev.data) as ActivityRecord
          records.value.push(record)
          // 限制前端保留 500 条
          if (records.value.length > 500) {
            records.value = records.value.slice(-500)
          }
        } catch { /* noop */ }
      })
      eventSource.onopen = () => { connected.value = true }
      eventSource.onerror = () => {
        connected.value = false
        // SSE 断开后降级为轮询
        if (!pollTimer) {
          pollTimer = setInterval(() => fetchRecent(100), 5000)
        }
      }
    } catch {
      // EventSource 不支持时降级为轮询
      if (!pollTimer) {
        pollTimer = setInterval(() => fetchRecent(100), 5000)
      }
    }
  }

  function stopStream() {
    if (eventSource) { eventSource.close(); eventSource = null }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    connected.value = false
  }

  async function clear() {
    try {
      await api.clearActivity()
      records.value = []
    } catch (e) {
      console.error('Failed to clear activity:', e)
    }
  }

  return { records, stats, connected, fetchRecent, fetchStats, startStream, stopStream, clear }
})
```

- [ ] **Step 2：在 api/index.ts 添加 Activity API 函数**

用 Read 工具读取 `d:\Maxma\MaxmaHere\web\src\api\index.ts`，添加：

```typescript
  async getActivityRecent(limit = 100): Promise<{ records: ActivityRecord[]; total: number }> {
    return fetchJson(`/api/activity/recent?limit=${limit}`)
  },

  async getActivityStats(): Promise<Record<string, unknown>> {
    return fetchJson('/api/activity/stats')
  },

  async clearActivity(): Promise<{ cleared: number }> {
    return fetchJson('/api/activity', { method: 'DELETE' })
  },
```

注意：需确认 `fetchJson` 的用法。如果返回类型需要导入 `ActivityRecord`，添加 `import type { ActivityRecord } from '@/stores/activity'`。

- [ ] **Step 3：创建 ActivityView.vue**

创建 `d:\Maxma\MaxmaHere\web\src\views\ActivityView.vue`：

```vue
<!-- web/src/views/ActivityView.vue -->
<template>
  <div class="activity-view">
    <header class="activity-header">
      <h1>活动中心</h1>
      <div class="activity-controls">
        <span class="activity-status" :class="{ online: store.connected }">
          {{ store.connected ? '● 实时' : '○ 离线' }}
        </span>
        <button class="ds-btn ds-btn--sm" @click="store.fetchRecent(100)">刷新</button>
        <button class="ds-btn ds-btn--sm ds-btn--danger" @click="store.clear">清空</button>
      </div>
    </header>

    <!-- 统计概览 -->
    <div class="activity-stats" v-if="store.stats.total">
      <div class="stat-card">
        <span class="stat-value">{{ store.stats.total }}</span>
        <span class="stat-label">总事件</span>
      </div>
      <div class="stat-card" v-for="(count, cat) in store.stats.by_category" :key="cat">
        <span class="stat-value">{{ count }}</span>
        <span class="stat-label">{{ categoryLabel(cat as string) }}</span>
      </div>
    </div>

    <!-- 事件列表 -->
    <div class="activity-list">
      <div
        v-for="(record, idx) in displayRecords"
        :key="idx"
        class="activity-item"
        :class="`level-${record.level}`"
      >
        <div class="activity-item-time">{{ formatTime(record.timestamp) }}</div>
        <div class="activity-item-category" :class="`cat-${record.category}`">
          {{ categoryLabel(record.category) }}
        </div>
        <div class="activity-item-content">
          <span class="activity-item-message">{{ record.message }}</span>
          <span v-if="record.tool_name" class="activity-item-tool">{{ record.tool_name }}</span>
          <span v-if="record.session_id" class="activity-item-session">{{ record.session_id.slice(0, 8) }}</span>
        </div>
      </div>
      <div v-if="!store.records.length" class="activity-empty">
        暂无活动记录
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useActivityStore } from '@/stores/activity'

const store = useActivityStore()

const displayRecords = computed(() => [...store.records].reverse())

const categoryLabels: Record<string, string> = {
  turn: 'Turn',
  tool: '工具',
  plan: '计划',
  compression: '压缩',
  approval: '审批',
  memory: '记忆',
  system: '系统',
}

function categoryLabel(cat: string): string {
  return categoryLabels[cat] || cat
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

onMounted(() => {
  store.fetchRecent(100)
  store.fetchStats()
  store.startStream()
})

onUnmounted(() => {
  store.stopStream()
})
</script>

<style scoped>
.activity-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  overflow: hidden;
}

.activity-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.activity-header h1 {
  font-size: 1.4em;
  font-family: var(--font-display);
  color: var(--text-primary);
}

.activity-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.activity-status {
  font-size: 0.8em;
  color: var(--text-tertiary);
}
.activity-status.online {
  color: var(--status-ok, #16a34a);
}

.activity-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 80px;
}

.stat-value {
  font-size: 1.4em;
  font-weight: 600;
  color: var(--accent);
}

.stat-label {
  font-size: 0.75em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.activity-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
}

.activity-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 0.85em;
}
.activity-item:last-child {
  border-bottom: none;
}
.activity-item.level-warn {
  background: color-mix(in srgb, var(--status-warn, #d97706) 5%, transparent);
}
.activity-item.level-error {
  background: color-mix(in srgb, var(--status-error, #dc2626) 5%, transparent);
}

.activity-item-time {
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.activity-item-category {
  padding: 2px 8px;
  border-radius: 100px;
  font-size: 0.75em;
  font-weight: 500;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  white-space: nowrap;
}
.activity-item-category.cat-tool { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
.activity-item-category.cat-turn { background: color-mix(in srgb, var(--status-ok, #16a34a) 15%, transparent); color: var(--status-ok, #16a34a); }
.activity-item-category.cat-compression { background: color-mix(in srgb, var(--status-warn, #d97706) 15%, transparent); color: var(--status-warn, #d97706); }
.activity-item-category.cat-approval { background: color-mix(in srgb, var(--status-error, #dc2626) 15%, transparent); color: var(--status-error, #dc2626); }

.activity-item-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.activity-item-message {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-item-tool {
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  padding: 1px 6px;
  border-radius: 3px;
}

.activity-item-session {
  font-family: var(--font-mono, monospace);
  font-size: 0.75em;
  color: var(--text-tertiary);
}

.activity-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-tertiary);
}
</style>
```

- [ ] **Step 4：在 router 添加路由**

用 Read 工具读取 `d:\Maxma\MaxmaHere\web\src\router\index.ts`，在路由数组中添加：

```typescript
  {
    path: '/activity',
    name: 'activity',
    component: () => import('@/views/ActivityView.vue'),
  },
```

- [ ] **Step 5：在 App.vue 侧边栏添加入口**

用 Read 工具读取 `d:\Maxma\MaxmaHere\web\src\App.vue`，在 `<nav class="sidebar-nav">` 中（`router-link to="/kb"` 之后）添加：

```vue
        <router-link to="/activity" class="nav-item">
          <Icon name="memory" :size="18" /> <span class="nav-label">活动&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;ACTIVITY</span>
        </router-link>
```

- [ ] **Step 6：前端验证**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`

Expected: 无新增错误

Run: `cd d:\Maxma\MaxmaHere\web && npx vite build`

Expected: 构建成功

- [ ] **Step 7：提交**

```bash
cd d:\Maxma\MaxmaHere
git add web/src/stores/activity.ts web/src/views/ActivityView.vue web/src/router/index.ts web/src/App.vue web/src/api/index.ts
git commit -m "feat: add Activity Hub frontend page with SSE streaming"
```

---

## Task 6：审批网关配置与策略层

**Files:**
- Modify: `config/settings.py`
- Create: `agent/approval_gateway.py`

- [ ] **Step 1：在 settings.py 添加审批配置**

用 Read 工具读取 `d:\Maxma\MaxmaHere\config\settings.py`，添加配置项：

```python
    # ── LLM 审批网关 ──
    # 需要审批的工具列表（工具名匹配）
    approval_required_tools: list[str] = [
        "run_python",
        "file_edit",
        "file_write",
        "git_push",
        "git_commit",
        "shell_exec",
    ]
    # 审批超时时间（秒）
    approval_timeout: int = 300
    # 是否启用审批网关（False 时所有工具直接执行）
    approval_gateway_enabled: bool = True
```

- [ ] **Step 2：创建 approval_gateway.py**

创建 `d:\Maxma\MaxmaHere\agent\approval_gateway.py`：

```python
"""LLM 审批网关 —— 工具执行前的统一审批决策层。

根据工具名和参数风险分级，决定是否需要用户审批。
复用 interaction.py 的 register/resolve 机制进行异步等待。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)


class ApprovalDecision(str, Enum):
    """审批决策结果。"""
    APPROVED = "approved"          # 已批准
    REJECTED = "rejected"          # 已拒绝
    AUTO_APPROVED = "auto_approved"  # 自动批准（无需审批）
    TIMEOUT = "timeout"            # 超时


@dataclass
class ApprovalRequest:
    """审批请求。"""
    tool_name: str
    tool_input: dict[str, Any]
    session_id: str
    turn_id: str = ""
    reason: str = ""  # 为什么需要审批
    risk_level: str = "medium"  # low / medium / high


class ApprovalGateway:
    """审批网关，全局单例。"""

    _instance: Optional["ApprovalGateway"] = None

    def __init__(self) -> None:
        self._settings = get_settings()

    @classmethod
    def get(cls) -> "ApprovalGateway":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def needs_approval(self, tool_name: str, session_id: str, auto_approve: bool = False) -> bool:
        """判断工具是否需要审批。

        决策逻辑：
        1. 审批网关未启用 → False
        2. 会话级 auto_approve=True → False
        3. 工具在 approval_required_tools 列表中 → True
        4. 其他 → False
        """
        if not self._settings.approval_gateway_enabled:
            return False

        if auto_approve:
            return False

        return tool_name in self._settings.approval_required_tools

    def create_request(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        session_id: str,
        turn_id: str = "",
    ) -> ApprovalRequest:
        """创建审批请求对象。"""
        risk_level = self._assess_risk(tool_name, tool_input)
        reason = self._build_reason(tool_name, tool_input, risk_level)
        return ApprovalRequest(
            tool_name=tool_name,
            tool_input=tool_input,
            session_id=session_id,
            turn_id=turn_id,
            reason=reason,
            risk_level=risk_level,
        )

    def _assess_risk(self, tool_name: str, tool_input: dict[str, Any]) -> str:
        """评估风险等级。"""
        high_risk_tools = {"git_push", "shell_exec", "run_python"}
        medium_risk_tools = {"file_edit", "file_write", "git_commit"}

        if tool_name in high_risk_tools:
            return "high"
        if tool_name in medium_risk_tools:
            return "medium"
        return "low"

    def _build_reason(self, tool_name: str, tool_input: dict[str, Any], risk_level: str) -> str:
        """构建审批理由说明。"""
        risk_labels = {"high": "高风险", "medium": "中风险", "low": "低风险"}
        parts = [f"{risk_labels.get(risk_level, '未知风险')}工具：{tool_name}"]

        # 展示关键参数预览
        if "code" in tool_input:
            code_preview = str(tool_input["code"])[:100]
            parts.append(f"代码预览：{code_preview}")
        elif "path" in tool_input or "file_path" in tool_input:
            path = tool_input.get("path") or tool_input.get("file_path", "")
            parts.append(f"路径：{path}")
        elif "command" in tool_input:
            cmd_preview = str(tool_input["command"])[:100]
            parts.append(f"命令预览：{cmd_preview}")

        return "，".join(parts)


# 模块级单例
approval_gateway = ApprovalGateway.get()
```

- [ ] **Step 3：后端验证**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from agent.approval_gateway import approval_gateway; print(approval_gateway.needs_approval('run_python', 'test')); print(approval_gateway.needs_approval('read_file', 'test'))"`

Expected:
```
True
False
```

- [ ] **Step 4：提交**

```bash
cd d:\Maxma\MaxmaHere
git add config/settings.py agent/approval_gateway.py
git commit -m "feat: add approval gateway with risk-based policy"
```

---

## Task 7：ApprovalToolNode 审批拦截节点

**Files:**
- Create: `agent/approval_tool_node.py`
- Modify: `agent/graph.py`

- [ ] **Step 1：创建 ApprovalToolNode**

创建 `d:\Maxma\MaxmaHere\agent\approval_tool_node.py`：

```python
"""审批工具节点 —— 包装 LangGraph ToolNode，在执行前拦截需审批的工具。

复用 interaction.py 的 register/resolve 机制进行异步等待，
复用 ask_user WS 事件推送审批请求到前端。
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt import ToolNode

from agent.approval_gateway import approval_gateway, ApprovalDecision
from api import interaction
from api.activity_hub import activity_hub

logger = logging.getLogger(__name__)


class ApprovalToolNode:
    """包装 ToolNode，添加审批拦截层。

    工作流程：
    1. 从 state 提取 tool_calls
    2. 对每个 tool_call 检查是否需要审批
    3. 需要审批时：通过 interaction.register 注册 Future + WS 推送 approval_request
    4. 等待用户响应（approve/reject）
    5. approved → 执行工具；rejected → 返回拒绝 ToolMessage
    6. 无需审批 → 直接执行
    """

    def __init__(self, tools: list, ws_send_callback=None):
        """初始化。

        Args:
            tools: 工具列表
            ws_send_callback: 可选的 WS 发送回调，签名为 async (msg: dict) -> None
        """
        self._inner_node = ToolNode(tools)
        self._ws_send_callback = ws_send_callback

    async def __call__(self, state: dict) -> dict:
        """执行工具调用，带审批拦截。"""
        messages = state.get("messages", [])
        if not messages:
            return {"messages": []}

        last_message = messages[-1]
        if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
            # 无 tool_calls，直接透传给内部 ToolNode
            return await self._inner_node.ainvoke(state)

        # 获取会话 ID（用于 interaction 注册和 auto_approve 检查）
        # 注意：state 中可能没有 session_id，需从 config 获取
        session_id = state.get("_session_id", "")
        auto_approve = interaction.get_session_auto_approve(session_id)

        # 分离需审批和无需审批的 tool_calls
        tool_messages: list[ToolMessage] = []
        state_for_inner = {**state, "messages": messages}

        for tool_call in last_message.tool_calls:
            tool_name = tool_call["name"]
            tool_input = tool_call["args"]
            tool_call_id = tool_call["id"]

            if approval_gateway.needs_approval(tool_name, session_id, auto_approve):
                # 需要审批
                decision = await self._request_approval(
                    tool_name, tool_input, session_id, tool_call_id
                )

                if decision == ApprovalDecision.APPROVED:
                    # 批准 → 执行单个工具
                    single_state = {
                        **state,
                        "messages": [AIMessage(content="", tool_calls=[tool_call])],
                    }
                    result = await self._inner_node.ainvoke(single_state)
                    if result.get("messages"):
                        tool_messages.extend(result["messages"])

                elif decision == ApprovalDecision.REJECTED:
                    # 拒绝 → 返回拒绝消息
                    tool_messages.append(ToolMessage(
                        content=f"[用户拒绝执行] 工具 {tool_name} 被用户拒绝。请改用其他方式或询问用户。",
                        tool_call_id=tool_call_id,
                    ))
                    activity_hub.add(
                        category="approval",
                        event_type="approval_rejected",
                        session_id=session_id,
                        tool_name=tool_name,
                        level="warn",
                        message=f"用户拒绝执行工具：{tool_name}",
                    )

                else:
                    # 超时
                    tool_messages.append(ToolMessage(
                        content=f"[审批超时] 工具 {tool_name} 审批超时，已跳过。",
                        tool_call_id=tool_call_id,
                    ))
                    activity_hub.add(
                        category="approval",
                        event_type="approval_timeout",
                        session_id=session_id,
                        tool_name=tool_name,
                        level="warn",
                        message=f"工具审批超时：{tool_name}",
                    )

            else:
                # 无需审批 → 直接执行单个工具
                single_state = {
                    **state,
                    "messages": [AIMessage(content="", tool_calls=[tool_call])],
                }
                try:
                    result = await self._inner_node.ainvoke(single_state)
                    if result.get("messages"):
                        tool_messages.extend(result["messages"])
                except Exception as e:
                    tool_messages.append(ToolMessage(
                        content=f"[工具执行错误] {tool_name}: {e}",
                        tool_call_id=tool_call_id,
                    ))

        return {"messages": tool_messages}

    async def _request_approval(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        session_id: str,
        tool_call_id: str,
    ) -> ApprovalDecision:
        """发送审批请求并等待用户响应。"""
        from config.settings import get_settings
        settings = get_settings()

        # 创建审批请求
        request = approval_gateway.create_request(
            tool_name=tool_name,
            tool_input=tool_input,
            session_id=session_id,
        )

        # 生成 interaction_id
        interaction_id = str(uuid.uuid4())

        # 记录到 Activity Hub
        activity_hub.add(
            category="approval",
            event_type="approval_requested",
            session_id=session_id,
            tool_name=tool_name,
            message=f"请求审批工具：{tool_name}（{request.reason}）",
            payload={
                "interaction_id": interaction_id,
                "risk_level": request.risk_level,
                "tool_input_preview": {k: str(v)[:200] for k, v in tool_input.items()},
            },
        )

        # 通过 interaction 注册 Future
        future = interaction.register(session_id, interaction_id)

        # 通过 WS 推送审批请求
        if self._ws_send_callback:
            try:
                await self._ws_send_callback({
                    "type": "ask_user",
                    "payload": {
                        "tool_name": tool_name,
                        "interaction_id": interaction_id,
                        "mode": "approval",
                        "question": f"是否允许执行 {tool_name}？",
                        "detail": request.reason,
                        "risk_level": request.risk_level,
                        "tool_input": tool_input,
                        "options": [
                            {"label": "允许执行", "value": "yes"},
                            {"label": "拒绝", "value": "no"},
                        ],
                    },
                })
            except Exception as e:
                logger.error("Failed to send approval request via WS: %s", e)
                interaction.resolve(session_id, interaction_id, "no")
                return ApprovalDecision.REJECTED

        # 等待用户响应
        try:
            import asyncio
            response = await asyncio.wait_for(future, timeout=settings.approval_timeout)
        except TimeoutError:
            return ApprovalDecision.TIMEOUT
        except Exception as e:
            logger.error("Approval wait failed: %s", e)
            return ApprovalDecision.REJECTED

        # 判断响应
        if isinstance(response, str) and response.lower() in ("yes", "y", "approve", "approved", "允许", "确认"):
            return ApprovalDecision.APPROVED
        return ApprovalDecision.REJECTED
```

- [ ] **Step 2：修改 graph.py 替换 ToolNode**

用 Read 工具读取 `d:\Maxma\MaxmaHere\agent\graph.py`，找到 `ToolNode` 的导入和使用位置（约 L35 导入，L201 使用）。

修改导入：

```python
# 原始：from langgraph.prebuilt import ToolNode
from langgraph.prebuilt import ToolNode  # 保留用于回退
from agent.approval_tool_node import ApprovalToolNode
```

找到 `tool_node = ToolNode(tools)` 的位置，替换为：

```python
        # 使用审批工具节点（可配置开关）
        from config.settings import get_settings
        _settings = get_settings()
        if _settings.approval_gateway_enabled:
            tool_node = ApprovalToolNode(tools)
            logger.info("ApprovalToolNode enabled")
        else:
            tool_node = ToolNode(tools)
```

- [ ] **Step 3：后端验证**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from agent.approval_tool_node import ApprovalToolNode; print('ApprovalToolNode imported ok')"`

Expected: `ApprovalToolNode imported ok`

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from agent.graph import build_agent; print('graph build ok')"`

Expected: `graph build ok`

- [ ] **Step 4：提交**

```bash
cd d:\Maxma\MaxmaHere
git add agent/approval_tool_node.py agent/graph.py
git commit -m "feat: add ApprovalToolNode to intercept tool execution with user approval"
```

---

## Task 8：前端审批 UI 与事件处理

**Files:**
- Modify: `web/src/types/index.ts`
- Modify: `web/src/composables/useChat.ts`
- Create: `web/src/components/ApprovalBubble.vue`

- [ ] **Step 1：新增审批相关类型**

用 Read 工具读取 `d:\Maxma\MaxmaHere\web\src\types\index.ts`，添加：

```typescript
/** 审批请求事件（扩展 ask_user 事件，mode='approval'） */
export interface ApprovalRequestEvent {
  type: 'ask_user'
  payload: {
    tool_name: string
    interaction_id: string
    mode: 'approval'
    question: string
    detail: string
    risk_level: 'low' | 'medium' | 'high'
    tool_input: Record<string, unknown>
    options: { label: string; value: string }[]
  }
}
```

- [ ] **Step 2：修改 useChat.ts 处理审批事件**

用 Read 工具读取 `d:\Maxma\MaxmaHere\web\src\composables\useChat.ts` 的 `handleEventForChannel` 函数中 `case 'ask_user'` 的处理逻辑（约 L505-534）。

在现有 `ask_user` case 中，检查 `mode` 是否为 `approval`，如果是则附加到 `runningTool.interaction` 并标记为审批模式：

```typescript
      case 'ask_user': {
        // ...现有逻辑保持...
        const toolName = data.payload?.tool_name || ''
        const interactionId = data.payload?.interaction_id || ''
        const mode = data.payload?.mode || 'qa'

        // 查找正在运行的工具
        const runningTool = findRunningTool(ch.currentTurn?.events || [], toolName)
        if (runningTool) {
          runningTool.interaction = {
            interactionId,
            question: data.payload?.question || '',
            mode,
            options: data.payload?.options,
            detail: data.payload?.detail,
            // 审批模式特有字段
            risk_level: mode === 'approval' ? data.payload?.risk_level : undefined,
            tool_input: mode === 'approval' ? data.payload?.tool_input : undefined,
          }
        }
        break
      }
```

注意：需检查现有 `interaction` 对象的字段结构，确保新增 `risk_level` 和 `tool_input` 不破坏类型。如果 TS 类型严格，需在 types 中扩展。

- [ ] **Step 3：创建 ApprovalBubble.vue 组件**

创建 `d:\Maxma\MaxmaHere\web\src\components\ApprovalBubble.vue`：

```vue
<!-- web/src/components/ApprovalBubble.vue -->
<template>
  <div class="approval-bubble" :class="`risk-${riskLevel}`">
    <div class="approval-header">
      <span class="approval-icon" :title="`风险等级：${riskLabel}`">{{ riskIcon }}</span>
      <span class="approval-title">工具执行审批</span>
      <span class="approval-tool">{{ toolName }}</span>
    </div>

    <div class="approval-detail">{{ detail }}</div>

    <!-- 参数预览 -->
    <details v-if="toolInput && Object.keys(toolInput).length" class="approval-params">
      <summary>参数详情</summary>
      <pre class="approval-params-content">{{ JSON.stringify(toolInput, null, 2) }}</pre>
    </details>

    <!-- 操作按钮 -->
    <div class="approval-actions" v-if="!responded">
      <button class="ds-btn ds-btn--sm ds-btn--primary" @click="onApprove">
        允许执行
      </button>
      <button class="ds-btn ds-btn--sm ds-btn--danger" @click="onReject">
        拒绝
      </button>
    </div>
    <div class="approval-responded" v-else>
      <span :class="responded === 'yes' ? 'approval-approved' : 'approval-rejected'">
        {{ responded === 'yes' ? '✓ 已批准' : '✗ 已拒绝' }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  toolName: string
  detail: string
  riskLevel: string
  toolInput?: Record<string, unknown>
  interactionId: string
}>()

const emit = defineEmits<{
  respond: [interactionId: string, response: string]
}>()

const responded = ref<string | null>(null)

const riskLabels: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
}
const riskIcons: Record<string, string> = {
  high: '⚠️',
  medium: '⚡',
  low: 'ℹ️',
}

const riskLabel = riskLabels[props.riskLevel] || '未知'
const riskIcon = riskIcons[props.riskLevel] || 'ℹ️'

function onApprove() {
  if (responded.value) return
  responded.value = 'yes'
  emit('respond', props.interactionId, 'yes')
}

function onReject() {
  if (responded.value) return
  responded.value = 'no'
  emit('respond', props.interactionId, 'no')
}
</script>

<style scoped>
.approval-bubble {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  margin: 8px 0;
  background: var(--bg-card);
}

.approval-bubble.risk-high {
  border-left: 3px solid var(--status-error, #dc2626);
  background: color-mix(in srgb, var(--status-error, #dc2626) 5%, var(--bg-card));
}
.approval-bubble.risk-medium {
  border-left: 3px solid var(--status-warn, #d97706);
}
.approval-bubble.risk-low {
  border-left: 3px solid var(--status-ok, #16a34a);
}

.approval-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.approval-icon {
  font-size: 1.1em;
}

.approval-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.9em;
}

.approval-tool {
  font-family: var(--font-mono, monospace);
  font-size: 0.8em;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  padding: 1px 6px;
  border-radius: 3px;
}

.approval-detail {
  font-size: 0.85em;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}

.approval-params {
  margin-bottom: 8px;
  font-size: 0.8em;
}

.approval-params summary {
  cursor: pointer;
  color: var(--text-tertiary);
}

.approval-params-content {
  margin-top: 4px;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

.approval-actions {
  display: flex;
  gap: 8px;
}

.approval-responded {
  padding: 4px 0;
}

.approval-approved {
  color: var(--status-ok, #16a34a);
  font-weight: 500;
}

.approval-rejected {
  color: var(--status-error, #dc2626);
  font-weight: 500;
}
</style>
```

- [ ] **Step 4：在 ChatWindow.vue 或消息渲染处集成 ApprovalBubble**

用 Read 工具读取 `d:\Maxma\MaxmaHere\web\src\components\ChatWindow.vue`，找到工具事件渲染区域。

在工具事件的渲染中，检查 `event.interaction?.mode === 'approval'`，如果是则渲染 `<ApprovalBubble>`：

```vue
        <!-- 审批请求 -->
        <ApprovalBubble
          v-if="event.interaction?.mode === 'approval'"
          :tool-name="event.toolName"
          :detail="event.interaction.detail || ''"
          :risk-level="event.interaction.risk_level || 'medium'"
          :tool-input="event.interaction.tool_input"
          :interaction-id="event.interaction.interactionId"
          @respond="onApprovalRespond"
        />
```

在 `<script setup>` 中添加：

```typescript
import ApprovalBubble from '@/components/ApprovalBubble.vue'

function onApprovalRespond(interactionId: string, response: string) {
  // 复用现有的 sendUserResponse
  sendUserResponse(interactionId, response)
}
```

注意：`sendUserResponse` 需从 `useChat` 或 props 中获取。检查 ChatWindow 的 props/emits 确保正确传递。

- [ ] **Step 5：前端验证**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`

Expected: 无新增错误

Run: `cd d:\Maxma\MaxmaHere\web && npx vite build`

Expected: 构建成功

- [ ] **Step 6：提交**

```bash
cd d:\Maxma\MaxmaHere
git add web/src/types/index.ts web/src/composables/useChat.ts web/src/components/ApprovalBubble.vue web/src/components/ChatWindow.vue
git commit -m "feat: add approval request UI with risk display and approve/reject buttons"
```

---

## Task 9：端到端集成测试与 Activity Hub 记录

**Files:**
- Modify: `agent/approval_tool_node.py`
- Modify: `api/routes/chat.py`
- Modify: `agent/executor.py`

- [ ] **Step 1：确保 WS 回调传递到 ApprovalToolNode**

用 Read 工具读取 `d:\Maxma\MaxmaHere\agent\graph.py`，找到 `build_agent` 函数中创建 `ApprovalToolNode` 的位置。

WS 回调需要从运行时传入。由于 `build_agent` 在启动时构建图，而 WS 回调在请求时才有，需要通过 state 或 config 传递。

修改 `ApprovalToolNode.__call__`，从 config 获取 ws_send_callback：

```python
    async def __call__(self, state: dict, config: dict | None = None) -> dict:
        """执行工具调用，带审批拦截。"""
        # 从 config 获取 WS 回调
        ws_callback = None
        if config:
            ws_callback = config.get("configurable", {}).get("ws_callback")

        # 如果有新的 ws_callback，临时更新
        if ws_callback:
            self._ws_send_callback = ws_callback

        # ...其余逻辑不变...
```

在 `chat.py` 的 `_run_agent_turn` 中，将 ws_callback 加入 config：

```python
            config = {
                "configurable": {
                    "thread_id": session.session_id,
                    "ws_callback": ws_callback,  # 新增
                },
                "callbacks": [ws_callback_handler],
                "recursion_limit": 120,
            }
```

注意：检查 LangGraph 是否允许在 config 中传递自定义回调。如果 LangGraph 不支持，需通过其他机制（如 `interaction` 模块的全局 ContextVar）传递。

- [ ] **Step 2：在 executor.py 记录计划事件到 Activity Hub**

用 Read 工具读取 `d:\Maxma\MaxmaHere\agent\executor.py`，找到 `request_plan_confirmation` 调用处。

在计划确认请求时记录：

```python
        from api.activity_hub import activity_hub
        activity_hub.add(
            category="plan",
            event_type="plan_proposed",
            session_id=config.get("configurable", {}).get("thread_id", ""),
            message=f"计划待确认：{len(plan_steps)} 步",
            payload={"plan_steps": [s.get("description", "") for s in plan_steps[:5]]},
        )
```

在计划确认响应后记录：

```python
        if approved:
            activity_hub.add(
                category="plan",
                event_type="plan_approved",
                session_id=config.get("configurable", {}).get("thread_id", ""),
                message="计划已批准",
            )
        else:
            activity_hub.add(
                category="plan",
                event_type="plan_rejected",
                session_id=config.get("configurable", {}).get("thread_id", ""),
                level="warn",
                message="计划被拒绝",
            )
```

- [ ] **Step 3：后端验证**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from agent.graph import build_agent; from agent.approval_tool_node import ApprovalToolNode; from agent.approval_gateway import approval_gateway; print('all imports ok')"`

Expected: `all imports ok`

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -x -q 2>&1 | tail -20`

Expected: 现有测试不破坏（如果有测试的话）

- [ ] **Step 4：手动端到端验证**

启动后端：`cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m api.server`

启动前端：`cd d:\Maxma\MaxmaHere\web && npx vite`

验证步骤：
1. 打开 `http://localhost:5173`，发起对话
2. 触发需审批的工具（如让 AI 执行 Python 代码）
3. 确认审批请求气泡出现在对话中，显示工具名、风险等级、参数预览
4. 点击"允许执行"→ 工具执行，Activity Hub 记录 `approval_approved`
5. 点击"拒绝"→ 工具跳过，AI 收到拒绝消息
6. 打开 `/activity` 页面，确认审批事件已记录
7. 确认 auto_approve=True 时工具直接执行无需审批

- [ ] **Step 5：提交**

```bash
cd d:\Maxma\MaxmaHere
git add agent/approval_tool_node.py agent/graph.py api/routes/chat.py agent/executor.py
git commit -m "feat: wire WS callback to ApprovalToolNode and record plan events to ActivityHub"
```

---

## 完成后验证清单

- [ ] 所有 9 个 Task 的 git commit 已提交
- [ ] `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -c "from api.server import app; print('server ok')"` 无错误
- [ ] `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit` 无错误
- [ ] `cd d:\Maxma\MaxmaHere\web && npx vite build` 构建成功
- [ ] 会话压缩：长对话触发压缩时，前端显示压缩通知
- [ ] 会话压缩：POST `/api/sessions/{id}/compress` 可手动触发压缩
- [ ] Activity Hub：`/activity` 页面实时显示活动事件
- [ ] Activity Hub：SSE 流式推送正常，断线后降级轮询
- [ ] 审批网关：`run_python`/`file_edit` 等工具执行前弹出审批请求
- [ ] 审批网关：auto_approve=True 时跳过审批
- [ ] 审批网关：拒绝后 AI 收到拒绝消息并调整策略
- [ ] 所有三个功能在 Activity Hub 中都有事件记录
