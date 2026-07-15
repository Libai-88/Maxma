# MaxmaHere 迁移修复总计划 — 单一事实源收敛

> **核心原则：** 所有问题的根源是同一个——对话状态存在两个竞争的事实源（LangGraph checkpointer 和 oh-my-pi sidecar），迁移只完成了写端的切换，读端仍指向旧源。本计划围绕"收敛到单一事实源"展开，一次解决全部问题。

**Goal:** 使 MaxmaHere 在 sidecar 模式下功能完整可用（dev 模式正常 + 生产构建成功），消除所有 LangGraph 遗留依赖，统一状态管理。

**Architecture:** 迁移后的正确架构中，**oh-my-pi sidecar 是对话状态的唯一事实源**，`SessionMap`（SQLite）是 session 映射和历史摘要的持久缓存。所有需要"读取对话历史"的场景必须从这两个源之一获取数据，而非已废弃的 checkpointer。

**Tech Stack:** oh-my-pi v16.5.2 (Bun/TS), Python 3.12+ (FastAPI), SQLite (SessionMap), JSON-RPC 2.0 over stdio

---

## 问题根因分析

```
                        ┌─────────────────────┐
                        │   oh-my-pi sidecar   │  ← 对话状态的实际拥有者
                        │  (JSONL 持久化消息)   │
                        └─────────┬───────────┘
                                  │ JSON-RPC
                        ┌─────────▼───────────┐
                        │   Python Backend     │
                        │  (FastAPI + WS)      │
                        └─────────┬───────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
     ┌────────▼────────┐ ┌───────▼───────┐ ┌────────▼────────┐
     │   SessionMap     │ │ Checkpointer  │ │  YAML const     │
     │   (SQLite)       │ │ (LangGraph)   │ │  files          │
     │ ✅ 仍在写入       │ │ ❌ 已无数据    │ │ ❌ 从空数据序列化 │
     └─────────────────┘ └───────────────┘ └─────────────────┘
```

**当前状态：** 6 处代码读 checkpointer（无数据），2 处读 session._graph（永远 None），1 处调 None 对象方法（必崩），构建配置引用已删除模块，旧工具目录未清理。

**目标状态：** 所有读操作指向 SessionMap 或 sidecar RPC；checkpointer 引用全部移除；构建配置与实际文件结构一致。

---

## 修复总览

| 阶段 | 目标 | 涉及文件数 | 预估时间 |
|------|------|-----------|---------|
| Phase 1 | 状态读取收敛 — 修复所有 checkpointer/graph 依赖 | 5 | 3-4h |
| Phase 2 | sidecar 加固 — 并发安全、资源泄漏、错误处理 | 3 | 1-2h |
| Phase 3 | 构建管线修复 — PyInstaller + requirements + Bun 打包 | 3 | 2h |
| Phase 4 | 遗留代码清理 — tools/ 决策、autonomy、死测试 | 15+ | 3-4h |
| Phase 5 | 防御性加固 — 安全适配器、类型同步、代码质量 | 5 | 1-2h |

---

## Phase 1: 状态读取收敛

> **目标：** 所有需要"对话历史"的代码路径从 SessionMap 或 sidecar 获取，彻底消除对 LangGraph checkpointer 的运行时依赖。

### Task 1.1: 新增 sidecar RPC — `get_messages`

**Files:**
- Modify: `bun-sidecar/src/session-bridge.ts`
- Modify: `bun-sidecar/src/rpc-types.ts`

**Background:** 当前 sidecar 没有暴露"读取 session 消息历史"的 RPC 方法。Python 端需要获取消息历史来替代 checkpointer 读取。

**Approach:** 在 session-bridge.ts 中新增 `get_messages` RPC 方法，返回指定 session 的消息列表。

```typescript
// session-bridge.ts — 新增 RPC 方法
if (method === "get_messages") {
  const sessionId: string = params?.session_id;
  const limit: number = (params?.limit as number) ?? 50;
  const record = sessions.get(sessionId);
  if (!record) {
    sendError(id, `Session not found: ${sessionId}`);
    return;
  }
  const messages = record.session.state.messages;
  const sliced = messages.slice(-limit);
  const result = sliced.map((m: any) => ({
    role: m.role,
    content: typeof m.content === "string"
      ? m.content
      : m.content?.map((b: any) => b.type === "text" ? b.text : "").join("") ?? "",
  }));
  send(id, { messages: result, total: messages.length });
  return;
}
```

```typescript
// rpc-types.ts — 补充类型
export type RpcMethodName =
  | "create_session" | "prompt" | "cancel"
  | "destroy_session" | "undo" | "get_messages";  // 新增

export interface GetMessagesParams {
  session_id: string;
  limit?: number;
}

export interface GetMessagesResult {
  messages: Array<{ role: string; content: string }>;
  total: number;
}
```

- [ ] 在 session-bridge.ts 的 dispatch 中添加 `get_messages` handler
- [ ] 在 rpc-types.ts 中补充类型定义
- [ ] 验证：`cd bun-sidecar && bun run src/session-bridge.ts` 无语法错误

---

### Task 1.2: 新增 Python 辅助函数 — 从 sidecar 获取消息

**Files:**
- Modify: `api/routes/chat.py`

**Background:** chat.py 中有多个函数通过 checkpointer 读取消息历史。需要统一替换为从 sidecar 获取。

**Approach:** 在 chat.py 顶部新增一个辅助函数 `_get_messages_from_sidecar()`，封装 sidecar RPC 调用。所有需要消息历史的函数统一调用它。

```python
# chat.py — 新增辅助函数
async def _get_messages_from_sidecar(
    session: "SessionState",
    limit: int = 50,
) -> list[dict]:
    """从 sidecar 获取消息历史。sidecar 不可用时返回空列表。"""
    mgr = getattr(session, "_app_state", None)
    if mgr is None:
        return []
    sidecar_mgr = getattr(mgr, "sidecar_manager", None)
    if sidecar_mgr is None or sidecar_mgr.client is None:
        return []
    # 从 SessionMap 获取 sidecar session ID
    from api.pi_bridge.session_adapter import SessionMap
    with SessionMap() as sm:
        sidecar_sid = sm.get_sidecar_id(session.session_id)
    if not sidecar_sid:
        sidecar_sid = getattr(session, "_sidecar_session_id", None)
    if not sidecar_sid:
        return []
    try:
        result = await sidecar_mgr.client.call("get_messages", {
            "session_id": sidecar_sid,
            "limit": limit,
        })
        return result.get("messages", [])
    except Exception:
        logger.debug("[sidecar] get_messages failed", exc_info=True)
        return []
```

- [ ] 在 chat.py 中合适位置添加 `_get_messages_from_sidecar()`
- [ ] 验证语法：`python -c "import py_compile; py_compile.compile('api/routes/chat.py', doraise=True)"`

---

### Task 1.3: 修复 `_get_recent_ai_messages` — 贴纸上下文

**Files:**
- Modify: `api/routes/chat.py` (line 294-312)

**Background:** 当前实现通过 `session.checkpointer.aget_tuple(config)` 读取 AI 消息，sidecar 模式下 config 为 None 且 checkpointer 无数据。

**Approach:** 改为调用 `_get_messages_from_sidecar()`，从返回结果中过滤 role=assistant 的消息。

```python
# 替换 line 294-312 的 _get_recent_ai_messages
async def _get_recent_ai_messages(
    session: "SessionState",
    _config: dict | None,   # 保留参数签名兼容（标记废弃）
    limit: int = 5,
) -> list[dict]:
    """从 sidecar 获取最近的 AI 消息（用于贴纸情感分析）。"""
    messages = await _get_messages_from_sidecar(session, limit=limit * 3)
    ai_msgs = [m for m in messages if m.get("role") == "assistant"]
    return ai_msgs[-limit:]
```

**调用方修改（line 1100）：**
```python
# 替换:
# recent = await _get_recent_ai_messages(session, config, limit=5)
# 改为:
recent = await _get_recent_ai_messages(session, None, limit=5)
```

- [ ] 替换 `_get_recent_ai_messages` 实现
- [ ] 确认调用方传入参数兼容

---

### Task 1.4: 修复 `_calculate_context_usage` — 上下文用量统计

**Files:**
- Modify: `api/routes/chat.py` (line 522-554)

**Background:** 当前从 checkpointer 读取消息来估算 token 用量。sidecar 模式下 checkpointer 无数据。

**Approach:** 改为从 sidecar 获取消息，用简单的字符数估算 token（或直接从 `done` 事件的 `context_usage` 字段获取，如果 sidecar 未来支持）。当前阶段用消息总字符数的粗略估算。

```python
async def _calculate_context_usage(
    session: "SessionState",
    system_prompt: str,
    max_tokens: int = 0,
    model_name: str = "",
) -> dict:
    """估算上下文用量。sidecar 模式下从消息历史估算。"""
    messages = await _get_messages_from_sidecar(session, limit=100)
    total_chars = sum(len(m.get("content", "")) for m in messages)
    total_chars += len(system_prompt)
    # 粗略估算：中文约 1.5 字/token，英文约 4 字符/token
    estimated_tokens = int(total_chars / 2)
    return {
        "estimated_tokens": estimated_tokens,
        "max_tokens": max_tokens or 128000,
        "percentage": min(100, int(estimated_tokens / max(max_tokens, 1) * 100)),
        "message_count": len(messages),
    }
```

- [ ] 替换 `_calculate_context_usage` 实现
- [ ] 确认 sessions.py 的 `get_context_usage` 端点也能正常工作（Task 1.7）

---

### Task 1.5: 修复 CancelledError 处理器和取消清理

**Files:**
- Modify: `api/routes/chat.py` (lines 575-645, 1037-1040, 1115-1135)

**Background:**
1. `_inject_cancel_tool_messages()` (line 575) 读 `session._graph`（永远 None），直接 return，孤立的 tool_calls 不被清理。
2. CancelledError handler (line 1130) 调 `agent_maxma.aupdate_state()`，agent_maxma 永远 None，必崩。

**Approach:** 在 sidecar 模式下，取消清理应该通过 sidecar 的 `cancel` RPC 完成，不需要操作 checkpointer。移除所有 LangGraph 相关的取消清理代码。

```python
# 1. 修改 _inject_cancel_tool_messages (line 575)
#    在函数开头添加 sidecar 模式的早期返回
async def _inject_cancel_tool_messages(session, config, ws):
    """sidecar 模式下无需手动清理 — cancel RPC 已中止生成。"""
    # sidecar 模式：cancel 由 sidecar 处理，不需要注入 tool error messages
    if getattr(session, "_graph", None) is None:
        return
    # ... 保留原 LangGraph 路径（理论上不会被到达）

# 2. 修改 CancelledError handler (line 1115-1135)
#    移除对 agent_maxma 的调用
except asyncio.CancelledError:
    if not turn_completed:
        # sidecar 模式下通过 cancel RPC 中止
        try:
            mgr = app_state.sidecar_manager
            if mgr and mgr.client:
                from api.pi_bridge.session_adapter import SessionMap
                with SessionMap() as sm:
                    sidecar_sid = sm.get_sidecar_id(session.session_id)
                if sidecar_sid:
                    await mgr.client.call("cancel", {"session_id": sidecar_sid})
        except Exception:
            logger.debug("[cancel] sidecar cancel failed", exc_info=True)
        # 移除: await agent_maxma.aupdate_state(...)  ← 必崩代码
        await ws.send_json({"type": "error", "payload": {"error": "已取消"}})
    raise
```

- [ ] 修改 `_inject_cancel_tool_messages` 添加 sidecar 早期返回
- [ ] 修改 CancelledError handler，移除 `agent_maxma.aupdate_state()` 调用
- [ ] 将 line 1039-1040 的 `agent_maxma = None; session._graph = None` 改为注释说明

---

### Task 1.6: 修复情景记忆投影

**Files:**
- Modify: `api/routes/chat.py` (lines 1196-1203)

**Background:** `_project_completed_turn_to_episodic()` 被传入 `graph=None, config=None`，内部使用 graph 时静默失败。

**Approach:** 修改函数签名，不再需要 graph/config 参数。情景记忆投影只需要 user_message 和 final_answer，这两个在 sidecar 模式下已经可用。

```python
# 修改 _project_completed_turn_to_episodic 签名
async def _project_completed_turn_to_episodic(
    user_message: str,
    assistant_message: str,
    session_id: str,
    episodic_mm=None,
):
    """将完成的对话轮投影到情景记忆。不再需要 graph/config。"""
    if episodic_mm is None:
        return
    try:
        from agent.context_manager import commit_to_episodic
        await commit_to_episodic(
            user_message=user_message,
            assistant_message=assistant_message,
            episodic_mm=episodic_mm,
            session_id=session_id,
        )
    except Exception:
        logger.warning("[episodic] projection failed", exc_info=True)
```

**调用方修改（line 1196-1203）：**
```python
# 替换:
# await _project_completed_turn_to_episodic(
#     graph=agent_maxma, config=config, ...)
# 改为:
await _project_completed_turn_to_episodic(
    user_message=user_message,
    assistant_message=final_answer,
    session_id=session.session_id,
    episodic_mm=getattr(app_state, "episodic_mm", None),
)
```

- [ ] 修改 `_project_completed_turn_to_episodic` 签名和实现
- [ ] 修改调用方传参
- [ ] 检查 `commit_to_episodic` 函数签名是否兼容

---

### Task 1.7: 修复 sessions.py — 历史消息、标题、上下文用量

**Files:**
- Modify: `api/routes/sessions.py` (lines 131-170, 262-296, 359-421)

**Background:** 三个端点通过 checkpointer 读取消息：
- `get_messages` (line 157)：前端加载历史
- `get_context_usage` (line 278)：上下文用量
- `generate_session_title` (line 368)：标题生成

**Approach:** 每个端点改为从 sidecar 获取消息。

```python
# get_messages 端点 — 替换 checkpointer 读取
@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str, request: Request, limit: int = 50):
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found")

    # 从 sidecar 获取消息
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr and sidecar_mgr.client:
        from api.pi_bridge.session_adapter import SessionMap
        with SessionMap() as smap:
            sidecar_sid = smap.get_sidecar_id(session_id)
        if not sidecar_sid:
            sidecar_sid = getattr(session, "_sidecar_session_id", None)
        if sidecar_sid:
            try:
                result = await sidecar_mgr.client.call("get_messages", {
                    "session_id": sidecar_sid,
                    "limit": limit,
                })
                return {"messages": result.get("messages", []), "total": result.get("total", 0)}
            except Exception:
                logger.debug("[messages] sidecar fetch failed", exc_info=True)

    # fallback: 从 SessionMap 的 recent turns 获取
    from api.pi_bridge.session_adapter import SessionMap
    with SessionMap() as smap:
        turns = smap.get_recent_turns(session_id, count=limit)
    messages = []
    for t in turns:
        messages.append({"role": "user", "content": t.get("user", "")})
        messages.append({"role": "assistant", "content": t.get("assistant", "")})
    return {"messages": messages, "total": len(messages)}
```

```python
# generate_session_title — 替换 checkpointer 读取
# 改为从 sidecar 获取前几条消息，用 LLM 生成标题
# （具体实现类似现有逻辑，只是消息来源从 checkpointer 改为 sidecar RPC）
```

```python
# get_context_usage — 替换为调用 _calculate_context_usage（已修复为从 sidecar 读取）
```

- [ ] 修改 `get_messages` 端点
- [ ] 修改 `generate_session_title` 端点
- [ ] 修改 `get_context_usage` 端点
- [ ] 修改 `_sync_const_session_after_undo` (line 173-200) — 从 sidecar 读取
- [ ] 修改 `constify_session` (line 318-356) — 从 sidecar 读取

---

### Task 1.8: 修复 undo 端点 — 持久化 session ID 查找

**Files:**
- Modify: `api/routes/sessions.py` (lines 203-259)

**Background:** undo 端点的 sidecar 路径只查内存属性 `_sidecar_session_id`，重启后丢失。

**Approach:** 改为先查 `SessionMap`（SQLite 持久化），再 fallback 到内存属性。同时移除 LangGraph fallback（`from agent.graph import build_agent` 必然 ImportError）。

```python
@router.post("/sessions/{session_id}/undo")
async def undo_session(session_id: str, request: Request, n: int = 1):
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(404, "Session not found")

    mgr = getattr(request.app.state, "sidecar_manager", None)
    if mgr and mgr.client:
        # 优先从 SessionMap（持久化）查找 sidecar session ID
        from api.pi_bridge.session_adapter import SessionMap
        with SessionMap() as smap:
            sidecar_sid = smap.get_sidecar_id(session_id)
        if not sidecar_sid:
            sidecar_sid = getattr(session, "_sidecar_session_id", None)
        if sidecar_sid:
            try:
                result = await mgr.client.call("undo", {
                    "session_id": sidecar_sid,
                    "steps": n,
                })
                removed = result.get("removed", n)
                if session.message_count >= removed:
                    session.message_count -= removed
                await _sync_const_session_after_undo(session, request)
                return {"deleted_count": removed}
            except Exception:
                logger.debug("[undo] sidecar undo failed", exc_info=True)

    # sidecar 不可用时的降级响应
    raise HTTPException(503, "Undo 需要 sidecar 连接")
```

- [ ] 修改 undo 端点，从 SessionMap 查找 sidecar ID
- [ ] 移除 `from agent.graph import build_agent` 的 LangGraph fallback
- [ ] 验证语法

---

### Task 1.9: 修复 const session 自动保存

**Files:**
- Modify: `api/routes/chat.py` (lines 1224-1247)

**Background:** const session 保存逻辑从 checkpointer 读取消息，序列化后写入 YAML。sidecar 模式下 checkpointer 无数据，导致写入空列表，擦除历史。

**Approach:** 改为从 sidecar 获取消息，序列化后写入 YAML。

```python
# 替换 const session 保存逻辑
if session.is_const:
    try:
        messages = await _get_messages_from_sidecar(session, limit=200)
        if messages:
            # 转换为可序列化格式
            serializable = [
                {"role": m["role"], "content": m["content"]}
                for m in messages
            ]
            await _save_const_session_yaml(session, serializable)
    except Exception:
        logger.warning("[const] save failed", exc_info=True)
```

- [ ] 修改 const session 保存逻辑
- [ ] 确认 `_save_const_session_yaml` 函数签名兼容

---

### Task 1.10: 修复 server.py — checkpointer 初始化

**Files:**
- Modify: `api/server.py`

**Background:** server.py lifespan 中 `init_persistent_checkpointer()` 初始化 LangGraph checkpointer。如果 langgraph 已卸载，此处会 ImportError。

**Approach:** 将 checkpointer 初始化包裹在 try/except 中，sidecar 模式下跳过。同时修复 `_load_const_sessions` 不再依赖 checkpointer。

```python
# lifespan 中
try:
    from api.checkpointer_factory import init_persistent_checkpointer
    await init_persistent_checkpointer()
except ImportError:
    logger.info("[checkpointer] langgraph not available, using sidecar-only mode")
except Exception:
    logger.warning("[checkpointer] init failed", exc_info=True)
```

```python
# _load_const_sessions — 不再注入 checkpointer
# const session 的消息由 sidecar 管理，启动时只恢复元数据（message_count 等）
```

- [ ] 包裹 checkpointer 初始化为 try/except
- [ ] 修改 `_load_const_sessions` 不再依赖 checkpointer
- [ ] 验证 server.py 语法

---

### Phase 1 验收标准

- [ ] `grep -rn "checkpointer\.\|session\._graph\|agent_maxma\." api/routes/chat.py` 无活跃的 LangGraph 操作（仅保留注释和早期返回的 guard）
- [ ] `grep -rn "from agent\.graph" api/` 无输出
- [ ] dev 模式启动后：发送消息 → 刷新页面 → 历史消息仍在
- [ ] dev 模式启动后：会话标题能自动生成
- [ ] dev 模式启动后：context_usage 显示非零值
- [ ] dev 模式启动后：undo 在服务器重启后仍可用
- [ ] const session 重启后内容不丢失

---

## Phase 2: Sidecar 加固

> **目标：** 修复 session-bridge.ts 和 sidecar_manager.py 中的并发安全、资源泄漏和错误处理问题。

### Task 2.1: prompt 并发锁

**Files:**
- Modify: `bun-sidecar/src/session-bridge.ts`

**Background:** `prompt` handler 是 fire-and-forget，多个 prompt 可在同一 session 上并发。

**Approach:** 为每个 session 维护一个 Promise chain，确保 prompt 串行执行。

```typescript
// 在 SessionRecord 中添加 pending prompt tracker
interface SessionRecord {
  session: AgentSession;
  promptQueue: Promise<void>;  // 新增
}

// prompt handler 中
if (method === "prompt") {
  const sessionId = params?.session_id;
  const message = params?.message;
  const record = sessions.get(sessionId);
  if (!record) { sendError(id, `Session not found`); return; }

  // 串行化：将新 prompt 链接到上一个的 then
  record.promptQueue = record.promptQueue
    .catch(() => {})  // 上一个失败的 prompt 不阻塞下一个
    .then(() => record.session.prompt(message).catch(e => {
      console.error(`[prompt] error: ${e}`);
    }));

  send(id, { ok: true });
  return;
}
```

- [ ] 在 SessionRecord 接口中添加 `promptQueue: Promise<void>`
- [ ] 修改 prompt handler 使用 Promise chain 串行化
- [ ] 初始化时设置 `promptQueue: Promise.resolve()`

---

### Task 2.2: sidecar_manager.py 锁修复

**Files:**
- Modify: `api/pi_bridge/sidecar_manager.py`

**Background:** `stop()` 在 lock 外操作 `self._client`，`restart()` 不设 lock 就置 None。

**Approach:** 所有对 `self._client` 和 `self._process` 的读写都放入 `self._lock` 内。

```python
async def stop(self) -> None:
    async with self._lock:
        if self._client is not None:
            await self._client.stop()
            self._client = None
        if self._process is not None:
            # ... process termination logic ...
            self._process = None

async def restart(self) -> None:
    async with self._lock:
        self._client = None
    await self.stop()
    await self.start()
```

- [ ] 修改 `stop()` 将 client 操作移入 lock
- [ ] 修改 `restart()` 将 client 置 None 移入 lock
- [ ] 审查所有 `self._client` 和 `self._process` 的访问点，确保都在 lock 内

---

### Task 2.3: SessionMap 资源管理

**Files:**
- Modify: `api/routes/chat.py`

**Background:** `_stream_turn_sidecar` 中创建的 `SessionMap()` 实例没有 close。

**Approach:** 统一使用 `with SessionMap() as sm:` 上下文管理器。

```python
# 替换所有裸 SessionMap() 调用
# line 342: _session_map = SessionMap() → with SessionMap() as _session_map:
# line 1089: SessionMap() → with SessionMap() as sm:
```

- [ ] 搜索 chat.py 中所有 `SessionMap()` 调用
- [ ] 改为 `with SessionMap() as ...:` 模式

---

### Task 2.4: 优雅关闭

**Files:**
- Modify: `bun-sidecar/src/session-bridge.ts`

**Background:** 无 SIGTERM/SIGINT handler，进程被杀时所有 session 丢失。

**Approach:** 添加信号处理器，在退出前销毁所有 session。

```typescript
async function shutdown() {
  for (const [sid, record] of sessions) {
    try {
      await record.session.dispose();
    } catch {}
  }
  sessions.clear();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

- [ ] 添加 SIGTERM/SIGINT handler
- [ ] handler 中 dispose 所有 session

---

### Phase 2 验收标准

- [ ] 快速连续发送 3 条消息，sidecar 不崩溃、不产生乱序响应
- [ ] `stop()` 和 `start()` 并发调用不产生孤儿进程
- [ ] SessionMap 连接在每轮对话后正确关闭
- [ ] Ctrl+C 终止 sidecar 时无残留 Bun 进程

---

## Phase 3: 构建管线修复

> **目标：** 使 PyInstaller 打包和 Tauri 构建能成功产出可分发的安装包。

### Task 3.1: 清理 PyInstaller spec

**Files:**
- Modify: `build/maxma-server.spec`

**Background:** hiddenimports 中引用 15+ 个已删除的 agent 模块。

**Approach:** 逐一移除已删除模块的引用，添加 sidecar 相关的新模块。

**需要移除的 hiddenimports：**
```
agent.graph, agent.planner, agent.executor, agent.step_state,
agent.loop_detector, agent.coordinator, agent.verifier,
agent.delegation_scope, agent.approval_gateway, agent.approval_tool_node,
agent.llm_reviewer, agent.execution_lease, agent.capability_policy,
agent.session_health, agent.execution_boundary
```

**需要添加的 hiddenimports：**
```
api.pi_bridge.sidecar_manager, api.pi_bridge.rpc_client,
api.pi_bridge.session_adapter, api.pi_bridge.security_adapter,
api.pi_bridge.approval_adapter, api.pi_bridge.ws_event_mapper
```

- [ ] 移除所有已删除模块的 hiddenimport 条目
- [ ] 添加 pi_bridge 模块的 hiddenimport 条目
- [ ] 移除 `api.time_traveler`（依赖 LangGraph）
- [ ] 验证：`python -c "import py_compile; py_compile.compile('build/maxma-server.spec', doraise=True)"` 或手动检查语法

---

### Task 3.2: 重新锁定 requirements.txt

**Files:**
- Modify: `requirements.txt`, `requirements-lock.txt`

**Approach:** 从 pyproject.toml 重新生成 requirements.txt。

```bash
cd D:\Maxma\MaxmaHere
.venv\Scripts\python.exe -m pip install --isolated pip-tools
.venv\Scripts\python.exe -m piptools compile pyproject.toml -o requirements.txt
```

如果 pip-tools 不可用，手动编辑 requirements.txt 移除：
- `langgraph*` 所有条目
- `todoist-api-python`
- `uapi-sdk-python`

- [ ] 重新生成或手动更新 requirements.txt
- [ ] 确认与 pyproject.toml 一致

---

### Task 3.3: Bun sidecar 生产分发方案

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`
- Create: `bun-sidecar/build.ps1` (或加入现有 build 脚本)

**Background:** 当前 sidecar 通过 `bun run src/session-bridge.ts` 启动，生产环境用户机器没有 Bun。

**Approach:** 使用 `bun build --compile` 将 session-bridge.ts 编译为独立 exe。

```powershell
# bun-sidecar/build.ps1
cd bun-sidecar
bun build src/session-bridge.ts --compile --outfile ../desktop/src-tauri/binaries/pi-sidecar-x86_64-pc-windows-msvc.exe
```

然后在 tauri.conf.json 的 `externalBin` 中添加：
```json
{
  "externalBin": [
    "binaries/maxma-server",
    "binaries/pi-sidecar"
  ]
}
```

同时修改 `sidecar_manager.py` 的启动命令：
```python
# 从 "bun", "run", "src/session-bridge.ts"
# 改为直接执行编译后的二进制
cmd = [str(sidecar_exe)]
```

- [ ] 创建 bun-sidecar/build.ps1
- [ ] 测试 `bun build --compile` 能否成功编译 session-bridge.ts
- [ ] 修改 tauri.conf.json externalBin
- [ ] 修改 sidecar_manager.py 启动命令
- [ ] 修改 build/maxma-server.spec 或 Tauri build script 自动编译 sidecar

---

### Phase 3 验收标准

- [ ] `PyInstaller build/maxma-server.spec` 成功产出 dist/maxma-server/
- [ ] `bun build --compile` 成功产出 sidecar exe
- [ ] `cargo tauri build` 成功产出安装包（注意：按开发规则，只允许 `cargo tauri dev` 测试，此处仅验证配置正确性）
- [ ] requirements.txt 与 pyproject.toml 依赖一致

---

## Phase 4: 遗留代码清理

> **目标：** 消除所有 LangGraph 残留引用，清理死代码，使代码库状态与架构一致。

### Task 4.1: tools/ 目录决策与执行

**Files:**
- Modify/Delete: `tools/` 目录（决策后执行）

**Background:** tools/ 目录有 180+ 文件，50+ 生产代码仍在 import。Plan 2 要求全部删除，但实际上 MCP 桥接（替代方案）已被删除且未重建。高德地图工具没有 TS 版本。

**Approach:** 分三步走：

**Step 1 — 审计实际活跃工具：** 确认哪些 tools/ 下的模块仍被生产代码 import，列出依赖图。

**Step 2 — 分类处理：**
- **仍被需要的基础设施模块**（`tools/base.py`, `tools/path_security.py`, `tools/crypto.py`, `tools/mcp.py`, `tools/sticker_*.py` 等）：保留，但移到 `api/` 或新建 `infra/` 目录下
- **已被 TS 工具替代的功能模块**（`tools/todo/`, `tools/entertainment/tool_tarot.py`, `tools/network/tool_get_current_weather.py` 等）：删除
- **高德地图工具**（`tools/map/`）：需要决定——要么写 TS 版本，要么保留 Python 版并通过某种方式让 sidecar 调用

**Step 3 — 更新 tools/__init__.py：** 移除已删除工具的注册信息。

- [ ] 审计 tools/ 下每个模块的活跃引用
- [ ] 分类并执行移动/删除
- [ ] 更新 tools/__init__.py 注册表
- [ ] 更新所有 import 路径

---

### Task 4.2: autonomy 模块修复

**Files:**
- Modify: `agent/autonomy/runner.py` (line 25)
- Modify: `agent/autonomy/scout.py` (line 19)

**Background:** 两个文件顶层 `from agent.graph import build_agent`，autonomy 启用时服务器启动崩溃。

**Approach:** 改为通过 sidecar 执行自治任务（与 Task A5 的 sub_agent 迁移思路一致）。

```python
# runner.py / scout.py — 替换顶层 import
# 删除: from agent.graph import build_agent
# 改为延迟导入 sidecar 调用
async def _run_autonomous_turn(app, prompt: str, model: str) -> str:
    mgr: SidecarManager = app.state.sidecar_manager
    client = await mgr.start()
    result = await client.call("create_session", {
        "model": model,
        "system_prompt": "You are an autonomous improvement agent.",
        "cwd": ".",
    })
    sid = result["session_id"]
    # ... 等待结果 ...
```

- [ ] 移除 runner.py 和 scout.py 的顶层 `from agent.graph import build_agent`
- [ ] 替换为 sidecar 调用
- [ ] 测试 autonomy 启用时服务器能正常启动

---

### Task 4.3: 死测试文件清理

**Files:**
- Delete: `tests/test_agent/test_graph.py`
- Delete: `tests/test_agent/test_graph_coordinator.py`
- Delete: `tests/test_agent/test_graph_verifier.py`
- Delete: `tests/test_agent/test_coordinator.py`
- Delete: `tests/test_agent/test_verifier.py`
- Delete: `tests/test_agent/test_planner.py`
- Delete: `tests/test_agent/test_loop_detector.py`
- Delete: `tests/test_agent/test_orchestration_e2e.py`
- Delete: `tests/test_agent/test_provider_failover_graph.py`
- Modify: `tests/test_agent/test_autonomy_runner.py` — 移除 build_agent mock
- Modify: `tests/test_api/test_session_manager.py` — 移除 langgraph mock

**Approach:** 删除所有引用已删除模块的测试文件。保留并更新仍可运行的测试。

- [ ] 删除 9 个死测试文件
- [ ] 更新 2 个需要修改的测试文件
- [ ] 运行 `pytest --collect-only` 确认无 ImportError

---

### Task 4.4: 杂项清理

**Files:**
- Modify: `main.py` — 文档字符串 "LangGraph ReAct AI Agent" → "oh-my-pi Agent"
- Modify: `api/checkpointer_factory.py` — 包裹 LangGraph import 为 try/except
- Modify: `api/session_manager.py` (line 55) — 同上
- Modify: `memory/narrative.py` — 确认 `_HAS_LANGGRAPH` guard 正常工作
- Delete: `api/time_traveler.py` — 依赖 LangGraph RemoveMessage，且 undo 已改为 sidecar RPC
- Modify: `agent/context_manager.py` — 清理 LangGraph 相关注释/文档

- [ ] 逐一处理上述文件
- [ ] 最终验证：`grep -rn "from agent\.graph\|from langgraph\|import langgraph" --include="*.py" api/ agent/ tools/ main.py` 无输出（或仅有 try/except guard）

---

### Phase 4 验收标准

- [ ] `grep -rn "from agent\.graph" --include="*.py"` 无输出
- [ ] `grep -rn "from langgraph" --include="*.py"` 仅有 try/except guard
- [ ] `pytest --collect-only` 无 ImportError
- [ ] tools/ 目录结构清晰，无死代码
- [ ] autonomy 启用时服务器正常启动

---

## Phase 5: 防御性加固

> **目标：** 修复安全适配器、类型定义、代码质量问题。

### Task 5.1: security_adapter.py 改为 fail-closed

**Files:**
- Modify: `api/pi_bridge/security_adapter.py`

```python
def check_path_access(path: str) -> str | None:
    try:
        from tools.path_security import check_path_access as _check
        return _check(path)
    except Exception as e:
        # fail-closed: 安全检查失败时拒绝访问
        logger.error("[security] check_path_access failed: %s", e)
        return f"安全检查失败，拒绝访问: {path}"
```

- [ ] 修改异常处理为 fail-closed

---

### Task 5.2: approval_adapter.py 默认改为 ask

**Files:**
- Modify: `api/pi_bridge/approval_adapter.py`

```python
# 默认从 "auto" 改为 "ask"（未映射的工具需要用户确认）
TOOL_APPROVAL_MAP.get(tool_name, "ask")
```

- [ ] 修改默认审批级别

---

### Task 5.3: rpc-types.ts 与实现对齐

**Files:**
- Modify: `bun-sidecar/src/rpc-types.ts`

- [ ] `RpcMethodName` 添加 `"get_messages"`
- [ ] 添加 `GetMessagesParams` / `GetMessagesResult` 接口
- [ ] `tool_error` payload 添加 `elapsed` 字段
- [ ] 确认 `thinking_start`/`thinking_end` 是否需要从 EVENT_TYPES 中移除（如果 sidecar 不打算发送这些事件）

---

### Task 5.4: tarot shuffle 修复

**Files:**
- Modify: `bun-sidecar/src/tools/index.ts`

```typescript
// Fisher-Yates shuffle 替换 sort
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

- [ ] 替换 tarot 的 shuffle 算法

---

### Task 5.5: package.json 依赖补全

**Files:**
- Modify: `bun-sidecar/package.json`

```json
{
  "dependencies": {
    "zod": "^3.25.0",
    "@oh-my-pi/pi-coding-agent": "16.5.2",
    "@oh-my-pi/pi-agent-core": "16.5.2",
    "@oh-my-pi/pi-ai": "16.5.2",
    "@oh-my-pi/pi-catalog": "16.5.2"
  }
}
```

- [ ] 添加 `zod` 和 `@oh-my-pi/pi-catalog` 为显式依赖
- [ ] 运行 `bun install` 验证

---

### Phase 5 验收标准

- [ ] security_adapter 异常时拒绝访问
- [ ] 未映射工具需要用户确认
- [ ] rpc-types.ts 与 session-bridge.ts 完全对齐
- [ ] tarot 使用均匀洗牌
- [ ] `bun install` 无 warning

---

## 执行顺序与依赖关系

```
Phase 1 (状态收敛)  ──→  Phase 2 (sidecar 加固)
       │                         │
       │                         ↓
       │               Phase 3 (构建修复)
       │
       ↓
Phase 4 (遗留清理)  ──→  Phase 5 (防御加固)
```

Phase 1 是所有后续工作的前提——不修复状态读取，dev 模式就无法正常工作。Phase 2-3 可以并行。Phase 4 依赖 Phase 1 完成（确认哪些代码路径已不再需要 checkpointer）。Phase 5 独立于其他阶段，可随时插入。

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| `replace_messages` 不是 oh-my-pi 公开 API | 高 | Phase 1 完成后立即验证 undo 功能；如不可用则改为销毁重建 session |
| `bun build --compile` 可能不支持所有 TS 特性 | 中 | 提前做 spike 验证；备选方案：捆绑 Bun 运行时 |
| tools/ 目录清理可能遗漏引用 | 中 | 用 grep 全量扫描 + pytest --collect-only 验证 |
| SessionMap 的 turn 历史只有摘要，不够详细 | 低 | 后续可增加 sidecar JSONL 导入能力 |
| oh-my-pi 版本升级可能改变 API | 低 | 锁定版本号，升级前做回归测试 |
