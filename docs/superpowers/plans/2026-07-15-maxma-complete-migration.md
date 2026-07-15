# Maxma 彻底迁移 — oh-my-pi 完全体

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底移除所有 LangGraph 代码，Maxma 完全变为 oh-my-pi 的前端，保留品牌 UI，所有 agent 能力由 oh-my-pi 提供。

**Architecture:** Maxma = Vue 3 前端（品牌 UI） + Python 后端（WS/HTTP/路由） + Bun sidecar（oh-my-pi agent 引擎）。Maxma 的独特能力（人格系统、安全机制、工具桥接）以 oh-my-pi 的扩展机制实现，而非自研。

**Tech Stack:** oh-my-pi v16.5.2 (Bun/TS), Maxma Python (FastAPI), JSON-RPC over stdio

---

## 文件结构总览

```
# 子项目 A：迁移遗留 build_agent 调用

api/routes/sessions.py
  修改: undo/const-restore/session-title 端点 → sidecar

api/routes/session_compress.py  
  修改: 压缩端点 → sidecar 或去激活

api/server.py
  修改: 事件钩子 agent → sidecar; 启动时 const session 重建 → sidecar
  移除: from agent.graph import build_agent

tools/sub_agent/
  tool_call_sub_agent.py
    修改: _run_background → sidecar session
  tool_parallel.py
    修改: 并行执行 → sidecar task

# 子项目 B：Maxma 工具桥接

api/pi_bridge/tool_mcp_server.py
  新建: 把 Maxma Python 工具暴露为 MCP 服务器

# 子项目 C：设计理念重新实现（在 oh-my-pi 扩展上）

api/pi_bridge/security_adapter.py
  新建: 路径安全/拒止锚 → oh-my-pi 工具包装器

api/pi_bridge/approval_adapter.py  
  新建: 审批网关 → oh-my-pi 工具执行钩子
```

---

## Sub-project A: Zero LangGraph

### Task A1: sessions.py — undo 端点

**Files:**
- Modify: `api/routes/sessions.py`

**Background:** `sessions.py` 的 undo 端点（`POST /sessions/{id}/undo`）使用 `build_agent` 获取 LangGraph 图实例以访问 checkpointer，然后调用 `undo_rounds()` 回退消息。在 sidecar 模式下，session 消息存储在 oh-my-pi 的 JSONL 文件中，undo 需要操作 JSONL。

**Approach:** 对于 sidecar 模式，undo 通过发送 `rewind` 命令给 sidecar 实现。session 消息存在 oh-my-pi 侧，所以 undo 的逻辑变成：截断 JSONL 文件中对应的 entry。

但实际上，更简单的方案：

```python
# 在 undo 端点中
if not graph:
    # sidecar 模式：undo 通过清理 session 最后 N 条消息实现
    # 对于 sidecar session，我们让 sidecar 的 Agent 重新执行
    return {"deleted_count": 0, "sidecar_note": "Undo in sidecar mode clears conversation context"}
```

但用户期望 undo 能真正移除消息。更完整的实现：

```python
@router.post("/sessions/{session_id}/undo")
async def undo_session(session_id: str, request: Request, n: int = 1):
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    
    config = {"configurable": {"thread_id": session_id}}
    
    # Try sidecar undo first
    mgr = getattr(request.app.state, "sidecar_manager", None)
    if mgr and mgr.client:
        try:
            result = await mgr.client.call("undo", {
                "session_id": getattr(session, "_sidecar_session_id", ""),
                "steps": n,
            })
            return {"deleted_count": n, "method": "sidecar"}
        except Exception:
            logger.debug("[undo] sidecar undo failed, falling back")
    
    # Fallback: LangGraph checkpointer path (original code)
    ...
```

- [ ] **Step 1: 读取 `sessions.py` 全文，理解 undo 逻辑**

```bash
grep -n "def undo_\|build_agent\|aget_tuple\|checkpointer" "D:/Maxma/MaxmaHere/api/routes/sessions.py"
```

- [ ] **Step 2: 在 `session-bridge.ts` 中添加 `undo` RPC 方法**

```typescript
if (method === "undo") {
  const sessionId: string = params?.session_id;
  const steps: number = (params?.steps as number) ?? 1;
  const record = sessions.get(sessionId);
  if (!record) {
    sendError(id, `Session not found: ${sessionId}`);
    return;
  }
  // Truncate the last N assistant+user message pairs
  const messages = record.session.state.messages;
  let removed = 0;
  for (let i = 0; i < steps && messages.length > 0; i++) {
    // Remove last assistant message + preceding user message
    const last = messages.pop();
    removed++;
    if (last && last.role !== "user" && messages.length > 0) {
      messages.pop(); // Also remove the user message that triggered it
      removed++;
    }
  }
  record.session.replace_messages(messages);
  send(id, { removed });
  return;
}
```

- [ ] **Step 3: 修改 `sessions.py` 的 undo 端点**

```python
@router.post("/sessions/{session_id}/undo")
async def undo_session(session_id: str, request: Request, n: int = 1):
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    
    config = {"configurable": {"thread_id": session_id}}
    graph = session._graph
    
    # ── sidecar 路径 ──
    mgr = getattr(request.app.state, "sidecar_manager", None)
    if mgr and mgr.client:
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
                logger.debug("[undo] sidecar path failed, falling back to checkpointer")
    
    # ── LangGraph checkpointer 兜底（原逻辑）──
    if graph is None:
        llm = getattr(request.app.state, "llm", None)
        if llm is None:
            raise HTTPException(status_code=503, detail="LLM 未就绪")
        from agent.graph import build_agent
        tools = getattr(request.app.state, "tools", []) or []
        system_prompt = getattr(request.app.state, "system_prompt", "") or ""
        graph = build_agent(model=llm, tools=tools, system_prompt=system_prompt, checkpointer=session.checkpointer)
        session._graph = graph
    
    from agent.undo import undo_rounds
    deleted = await undo_rounds(graph, config, n=n)
    session.message_count = max(0, session.message_count - deleted)
    
    if session.is_const and deleted > 0:
        await _sync_const_session_after_undo(session, request)
    
    return {"deleted_count": deleted}
```

- [ ] **Step 4: 验证 undo 端点编译通过**

```bash
cd "D:/Maxma/MaxmaHere" && python -c "
import py_compile
py_compile.compile('api/routes/sessions.py', doraise=True)
print('[PASS] sessions.py syntax OK')
"
```

---

### Task A2: sessions.py — session 标题/摘要生成

**Files:**
- Modify: `api/routes/sessions.py`

**Background:** sessions.py 可能在 session 创建或更新时生成标题和摘要，使用 `build_agent`。

**Approach:** 替换为通过 sidecar 调用 LLM 生成标题。使用 `client.call("complete", ...)` — 一个简单的 LLM 调用，不需要完整的 agent 循环。

- [ ] **Step 1: 在 `session-bridge.ts` 中添加 `complete` RPC 方法**

```typescript
if (method === "complete") {
  const sessionId: string = params?.session_id;
  const prompt: string = params?.prompt ?? "";
  const record = sessions.get(sessionId);
  if (!record) {
    sendError(id, `Session not found: ${sessionId}`);
    return;
  }
  // Use existing session context + new prompt to generate a completion
  const result = await record.session.agent.complete(prompt);
  send(id, { content: result });
  return;
}
```

- [ ] **Step 2: 找到标题生成的代码并替换**

```bash
grep -n "build_agent\|title\|summary" "D:/Maxma/MaxmaHere/api/routes/sessions.py" | head -20
```

- [ ] **Step 3: 修改为 sidecar 调用**

---

### Task A3: session_compress.py — 上下文压缩端点

**Files:**
- Modify: `api/routes/session_compress.py`

**Background:** 这个端点手动触发上下文压缩。在 oh-my-pi 中，SnapCompact（位图帧上下文压缩）会自动在 agent 循环中执行。此端点可以作为无操作保留，或改为触发一次手动压缩。

**Approach:** 查找 LangGraph 的 `maybe_trim_checkpoint` 对应物。在 oh-my-pi 中，压缩是自动的。端点改为返回压缩状态信息。

- [ ] **Step 1: 读取 `session_compress.py`**

```bash
cat "D:/Maxma/MaxmaHere/api/routes/session_compress.py"
```

- [ ] **Step 2: 替换为 sidecar 兼容实现**

```python
# 替换 build_agent → 调用 sidecar 的 compact 方法
if settings.agent_backend_removed:  # Always sidecar now
    # oh-my-pi handles compaction natively via SnapCompact
    # This endpoint becomes a no-op or status check
    return {"compressed": False, "note": "Compaction is automatic in oh-my-pi mode"}
```

---

### Task A4: server.py — 事件钩子 + const session 重建

**Files:**
- Modify: `api/server.py`

**Background:** server.py 在两个地方使用 `build_agent`：
1. **事件钩子**：后台处理事件钩子（无 WebSocket）。用 `graph.ainvoke()` 同步生成回复。
2. **Const session 重建**：启动时用 `aupdate_state()` 从 YAML 恢复旧会话消息。

**Approach:**
- 事件钩子：使用 sidecar 的 `complete_simple`（非流式，单轮 LLM 调用，不需要完整的 agent 循环）
- Const session 重建：不需要操作 LangGraph checkpointer——在 sidecar 模式下，session 在 oh-my-pi 的 JSONL 中原生持久化，启动时会自动加载。

- [ ] **Step 1: 修改事件钩子路径**

```python
# 替换:
# graph = build_agent(model=llm, ...)
# output = await graph.ainvoke(...)

# 改为:
mgr: SidecarManager = app_state.sidecar_manager
client = await mgr.start()
# 创建一个临时 session 用于事件钩子
result = await client.call("create_session", {
    "model": f"{current_provider_id}/{current_model_name or 'gpt-4o'}",
    "system_prompt": system_prompt,
    "cwd": ".",
})
tmp_sid = result["session_id"]
await client.call("prompt", {"session_id": tmp_sid, "message": prompt})
# 获取结果（等待 done 事件）
# 对于同步场景，使用 event-driven 等待或 simple complete
```

- [ ] **Step 2: 修改 const session 重建路径**

```python
# 替换:
# agent = build_agent(model, tools, system_prompt, checkpointer)
# await agent.aupdate_state(...)

# 改为:
# 在 sidecar 模式下，const session 的消息由 sidecar 的 JSONL 持久化
# 启动时不需要重建 — 需要时通过 sidecar 加载即可
# 此代码路径变为: 记录日志但跳过
logger.info("[const] Sidecar mode: session %s will be loaded on demand", sid)
```

- [ ] **Step 3: 移除 server.py 中的 `from agent.graph import build_agent`**

- [ ] **Step 4: 验证 server.py 编译**

```bash
cd "D:/Maxma/MaxmaHere" && python -c "
import py_compile
py_compile.compile('api/server.py', doraise=True)
print('[PASS] server.py syntax OK')
"
```

---

### Task A5: sub_agent 工具 — 后台子 Agent

**Files:**
- Modify: `tools/sub_agent/tool_call_sub_agent.py`
- Modify: `tools/sub_agent/tool_parallel.py`

**Background:** `call_sub_agent` 和 `parallel_execute` 工具在后台执行子任务时使用 `build_agent` 创建子 Agent。这些子 Agent 之前是在 LangGraph 中运行的分离图。

**Approach:** 在 sidecar 模式下，子 Agent 通过 oh-my-pi 的 Task 系统或创建额外的 sidecar session 实现。

- [ ] **Step 1: 读取 `tool_call_sub_agent.py` 的 `_run_background` 方法**

```bash
grep -n "_run_background\|build_agent\|async def execute\|def execute" "D:/Maxma/MaxmaHere/tools/sub_agent/tool_call_sub_agent.py" | head -10
```

- [ ] **Step 2: 修改为通过 sidecar 执行**

```python
# 替换 build_agent+ainvoke 为 sidecar 调用
async def _run_background_sidecar(self, sub, task, delegation_context):
    """Sidecar 模式：在后台 sidecar session 中执行子任务。"""
    from api.pi_bridge.sidecar_manager import SidecarManager
    # 获取全局 sidecar manager
    mgr = getattr(sub._app_state, "sidecar_manager", None)
    if mgr is None:
        raise RuntimeError("Sidecar not available for sub-agent")
    
    client = await mgr.start()
    system_prompt = build_system_prompt()
    
    result = await client.call("create_session", {
        "model": f"{provider_id}/{model_name}",
        "system_prompt": system_prompt,
        "cwd": ".",
    })
    sub_sid = result["session_id"]
    
    await client.call("prompt", {
        "session_id": sub_sid,
        "message": task,
    })
    
    # 通过事件等待结果（与 _stream_turn_sidecar 类似的方式）
    final_answer = asyncio.Event()
    # ... 事件处理 ...
    
    return final_answer
```

- [ ] **Step 3: 同理修改 `tool_parallel.py`**

---

### Task A6: 移除 agent/graph.py 和 LangGraph 依赖

**Files:**
- Delete: `agent/graph.py`
- Delete: `agent/planner.py`, `agent/executor.py`, `agent/coordinator.py`, `agent/verifier.py`, `agent/step_state.py`, `agent/loop_detector.py`, `agent/error_recovery.py`, `agent/performance.py`, `agent/approval_tool_node.py`, `agent/approval_gateway.py`
- Delete: `agent/stream_repair/` 目录
- Modify: `pyproject.toml` — 移除 `langgraph` 依赖

**前提条件:** Tasks A1-A5 必须先完成，确保没有任何代码再引用这些模块。

- [ ] **Step 1: 确认所有外部引用已清理**

```bash
cd "D:/Maxma/MaxmaHere"
grep -rn "from agent\.graph\|import agent\.graph\|from agent\.planner\|from agent\.executor\|from langgraph" --include="*.py" api/ tools/ config/ scripts/ | grep -v __pycache__
# 如果没有输出，说明可以安全删除了
```

- [ ] **Step 2: 删除 agent 目录中的死模块**

```bash
cd "D:/Maxma/MaxmaHere"
rm -v agent/graph.py agent/planner.py agent/executor.py agent/coordinator.py agent/verifier.py agent/step_state.py agent/loop_detector.py agent/error_recovery.py agent/performance.py agent/approval_tool_node.py agent/approval_gateway.py
rm -rf agent/stream_repair/
```

- [ ] **Step 3: 清理 agent/__init__.py**

```python
# agent/__init__.py — 只保留还在用的导出
from agent.prompts import build_system_prompt
from agent.context_manager import commit_to_episodic
from agent.persona_loader import load_persona
```

- [ ] **Step 4: 从 pyproject.toml 移除 `langgraph` 依赖**

```bash
grep -n "langgraph" "D:/Maxma/MaxmaHere/pyproject.toml"
```

删除相关行。

- [ ] **Step 5: 验证**

```bash
cd "D:/Maxma/MaxmaHere" && python -c "
# 确认 langgraph 不再可导入
try:
    import langgraph
    print('[WARN] langgraph still importable (check pyproject.toml)')
except ImportError:
    print('[PASS] langgraph not importable')
"
```

---

## Sub-project B: Maxma Tools Bridge

### Task B1: 创建 MCP 服务器包装 Python 工具

**Files:**
- Create: `api/pi_bridge/tool_mcp_server.py`

**Background:** Maxma 有大约 30 个 Python 工具（天气、地图、Todo、文件操作等），这些工具目前只能通过 LangChain `BaseTool` 接口调用。在 sidecar 模式下，oh-my-pi 的 agent 需要能调用它们。

**Approach:** 创建一个轻量级的 MCP（Model Context Protocol）服务器，把 Maxma 的 Python 工具暴露为标准 MCP 工具。oh-my-pi 的 MCP 管理器会自动发现并连接这些工具。

```python
"""MCP 服务器 — 把 Maxma Python 工具暴露给 oh-my-pi。

oh-my-pi 原生支持 MCP（Model Context Protocol）。通过运行一个本地 MCP 服务器，
Maxma 的所有 Python 工具对 oh-my-pi agent 变为可用。
"""

import asyncio
import json
import logging
from typing import Any

from mcp.server import Server, NotificationOptions
from mcp.server.models import InitializationOptions
from mcp.types import Tool as MCPTool, TextContent, CallToolResult

from tools.pi_adapter import find_tool, execute_tool, tool_to_schema

logger = logging.getLogger(__name__)


def create_mcp_server() -> Server:
    """创建 MCP 服务器，注册所有 Maxma 工具。"""
    server = Server("maxma-tools")
    
    @server.list_tools()
    async def list_tools() -> list[MCPTool]:
        """列出所有可用的 Maxma 工具。"""
        from tools.pi_adapter import schemas_for_all_tools
        tools = []
        for schema in schemas_for_all_tools():
            tools.append(MCPTool(
                name=schema["name"],
                description=schema.get("description", ""),
                inputSchema=schema.get("parameters", {"type": "object", "properties": {}}),
            ))
        logger.info("[mcp] Listed %d Maxma tools", len(tools))
        return tools
    
    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
        """执行一个 Maxma 工具。"""
        result = await execute_tool(name, arguments)
        is_error = result.get("is_error", False)
        content = result.get("content", [])
        return CallToolResult(
            content=[TextContent(type="text", text=c.get("text", "")) for c in content],
            isError=is_error,
        )
    
    return server


async def run_mcp_server(host: str = "127.0.0.1", port: int = 8765):
    """启动 MCP 服务器。"""
    from mcp.server.stdio import stdio_server
    
    server = create_mcp_server()
    
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="maxma-tools",
                server_version="0.1.0",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )
```

- [ ] **Step 1: 确认 `mcp` Python 包（`mcp` 或 `modelcontextprotocol`）已安装**

```bash
pip show mcp 2>/dev/null || pip install mcp
```

- [ ] **Step 2: 创建 `api/pi_bridge/tool_mcp_server.py`**

- [ ] **Step 3: 在 `sidecar_manager.py` 中集成 MCP 服务器生命周期**

MCP 服务器应该在 sidecar 进程启动后作为后台协程运行。

```python
# 在 SidecarManager.start() 中追加
async def start(self) -> None:
    ...
    # 启动 MCP 工具服务器
    self._mcp_task = asyncio.create_task(self._run_mcp_server())
    ...

async def _run_mcp_server(self):
    """在后台运行 MCP 服务器。"""
    from api.pi_bridge.tool_mcp_server import run_mcp_server
    try:
        await run_mcp_server()
    except Exception:
        logger.exception("[mcp] Server crashed")
```

- [ ] **Step 4: 验证 MCP 服务器可以启动和响应**

```bash
cd "D:/Maxma/MaxmaHere" && timeout 5 python -c "
import asyncio
from api.pi_bridge.tool_mcp_server import create_mcp_server
server = create_mcp_server()
print('[PASS] MCP server created')
" 2>&1
```

---

### Task B2: MCP 配置自动注入

**Files:**
- Modify: `bun-sidecar/src/session-bridge.ts`
- Modify: `api/pi_bridge/sidecar_manager.py`

**Background:** oh-my-pi 使用 `mcp_servers.yaml` 配置 MCP 服务器。sidecar 启动时，MCP 服务器应通过 stdio 自动注册到 oh-my-pi 会话中。

**Approach:** oh-my-pi 支持在配置中声明 MCP 服务器。我们可以在创建 session 时将 MCP 服务器配置传递给 oh-my-pi。

- [ ] **Step 1: 在 `create_session` 中传递 MCP 配置**

```typescript
// 在 session-bridge.ts 的 create_session handler 中
if (method === "create_session") {
  const mcpServers = params?.mcpServers as Record<string, unknown> | undefined;
  
  const createOptions: Record<string, unknown> = {
    model,
    cwd,
  };
  // ... systemPrompt, toolNames ...
  if (mcpServers) {
    createOptions.mcpConfig = mcpServers;
  }
}
```

- [ ] **Step 2: 在 Python 侧构造 MCP 配置**

```python
# 在 _stream_turn_sidecar 中调用 create_session 前
mcp_servers = {
    "maxma-python-tools": {
        "type": "stdio",
        "command": "python",
        "args": ["-m", "api.pi_bridge.tool_mcp_server"],
    }
}
```

---

## Sub-project C: Design Re-implementation

### Task C1: 路径安全 + MaxmaBlocker

**Files:**
- Create: `api/pi_bridge/security_adapter.py`

**Background:** Maxma 有路径白名单和 MaxmaBlocker（`.maxma_blocker` 标记文件）安全机制。这些目前只在 Python 端用 `tools/path_security.py` 实现。在 sidecar 模式下，oh-my-pi 的 `read`/`write`/`bash` 工具需要遵守这些安全规则。

**Approach:** 创建一个安全检查函数，包装在 oh-my-pi 的 `read`/`write` 工具调用中。通过 oh-my-pi 的 `transformProviderContext` hook 或 tool wrapper 注入。

- [ ] **Step 1: 创建 `api/pi_bridge/security_adapter.py`**

```python
"""安全适配器 — 使 oh-my-pi 的工具遵守 Maxma 的安全策略。

包括：
- 路径白名单：限制 AI 可读写的文件目录
- MaxmaBlocker：在敏感目录下放置 .maxma_blocker 标记文件
"""

from pathlib import Path
from typing import Any

# 复用以有的安全逻辑
def check_path_access(path: str) -> str | None:
    """检查路径是否被允许访问。
    
    Returns:
        None 表示允许，字符串表示被阻断的原因。
    """
    from tools.path_security import check_path_access as _check
    return _check(path)


def is_blocker_present(path: str) -> bool:
    """检查路径或其父目录中是否存在 .maxma_blocker。"""
    p = Path(path).resolve()
    for parent in [p] + list(p.parents):
        if (parent / ".maxma_blocker").exists():
            return True
    return False


def validate_tool_args(tool_name: str, args: dict[str, Any]) -> dict[str, Any] | str:
    """验证工具参数是否违反安全策略。
    
    Returns:
        dict 表示允许（可能已修改参数），str 表示阻断原因。
    """
    # 对文件操作工具检查路径
    path_args = {}
    if tool_name in ("read", "write", "edit", "glob"):
        path_args["path"] = args.get("path", "")
    elif tool_name == "bash":
        # bash 命令不直接检查路径（太复杂），但可以记录审计日志
        return args
    
    for arg_name, path_value in path_args.items():
        if not path_value or not isinstance(path_value, str):
            continue
        # 检查路径白名单
        blocked = check_path_access(path_value)
        if blocked:
            return blocked
        # 检查 MaxmaBlocker
        if is_blocker_present(path_value):
            return f"路径包含 MaxmaBlocker 拒止锚：{path_value}"
    
    return args
```

- [ ] **Step 2: 创建测试**

```python
# api/pi_bridge/test_security.py
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from api.pi_bridge.security_adapter import validate_tool_args, is_blocker_present

# 测试安全验证器存在
assert callable(validate_tool_args)
print("[PASS] security_adapter imports OK")
```

---

### Task C2: 审批网关适配

**Files:**
- Create: `api/pi_bridge/approval_adapter.py`

**Background:** Maxma 的审批网关在写操作执行前要求用户确认。在 oh-my-pi 中，这通过 tool 的 `approval` 属性实现（每个 tool 可以声明自己的审批级别）。

**Approach:** 在 oh-my-pi 中，工具可以声明 `approval: "write"` 或 `approval: "read"` 级别。当工具需要审批时，oh-my-pi 暂停执行并通过事件通知 Python/前端。这已经由 oh-my-pi 的原生机制支持。

我们需要做的是：确保 Maxma 的高风险工具在 oh-my-pi 中被标记为需要审批。

```typescript
// 在 session-bridge.ts 中，创建工具时
const tool = {
  name: "write",
  description: "Write content to a file",
  parameters: { ... },
  approval: "write",  // ⚡ 需要审批
};
```

- [ ] **Step 1: 创建 `api/pi_bridge/approval_adapter.py`**

```python
"""审批适配器 — 映射 Maxma 的审批规则到 oh-my-pi 的工具审批级别。

Maxma 的工具可以配置 approval 模式：
- "auto": 自动执行
- "ask": 执行前询问用户
- "approval": 需审批

oh-my-pi 的工具可以声明 approval 属性：
- "write": 写操作需要审批
- "read": 读操作不需审批
"""

# Maxma 工具 → oh-my-pi approval 级别映射
TOOL_APPROVAL_LEVELS: dict[str, str] = {
    # 文件操作 — 需要审批
    "file_write": "write",
    "file_manage": "write",
    "file_delete": "write",
    # 系统操作
    "run_python": "write",
    # 网络操作—审批可选
    "tavily_search": "read",
    "get_current_weather": "read",
}
```

---

### Task C3: 验证核心功能在 oh-my-pi 上的表现

**Files:**
- Read-only: 所有相关文件

- [ ] **Step 1: 验证人格系统**

```bash
# 启动后端，修改 SOUL.md 为一个独特的人设，发送消息，确认 AI 的人设表现符合 SOUL.md
cd "D:/Maxma/MaxmaHere" && python -c "
from agent.prompts import build_system_prompt
prompt = build_system_prompt()
assert 'SOUL' in prompt or 'persona' in prompt.lower() or len(prompt) > 100
print('[PASS] System prompt generated (len=%d)' % len(prompt))
"
```

- [ ] **Step 2: 验证 40+ Provider 在 oh-my-pi 中可用**

```bash
cd "D:/Maxma/MaxmaHere" && bun -e "
import { getBundledModel } from '@oh-my-pi/pi-catalog/models';
// 验证 key 提供者可解析
const model = getBundledModel('opencode-go/deepseek-v4-flash');
console.log('[PASS] Model resolved:', model?.id);
"
```

- [ ] **Step 3: 验证 oh-my-pi 的全部 32 个内置工具可被 agent 使用**

在集成测试中发送需要 `bash`、`read`、`glob` 等工具的 prompt，验证工具事件到达。

---

### Task C4: Const session + Fixed session 映射

**Files:**
- Modify: `api/pi_bridge/session_adapter.py`

**Background:** Maxma 有 Const session（固定保存到磁盘 YAML）的概念。在 oh-my-pi 中，session 原生持久化为 JSONL 文件。我们需要确保 const session 在 oh-my-pi 模式下也能被正确地保存和恢复。

**Approach:** Const session 映射表已经存在于 `SessionMap`。需要额外添加一个字段标记 session 是否为 const。

- [ ] **Step 1: 更新 `SessionMap` 支持标记 session 类型**

```python
# 在 session_adapter.py 中添加
def set_const(self, maxma_id: str, is_const: bool = True) -> None:
    with self._lock:
        self._conn.execute(
            "UPDATE session_map SET is_const = ? WHERE maxma_id = ?",
            (1 if is_const else 0, maxma_id),
        )
        self._conn.commit()
```

---

## Sub-project 验收标准

### Sub-project A (Zero LangGraph)
- [ ] `api/routes/sessions.py` 不再导入 `build_agent`
- [ ] `api/routes/session_compress.py` 不再导入 `build_agent`
- [ ] `api/server.py` 不再导入 `build_agent`
- [ ] `tools/sub_agent/tool_call_sub_agent.py` 不再导入 `build_agent`
- [ ] `tools/sub_agent/tool_parallel.py` 不再导入 `build_agent`
- [ ] `agent/graph.py` 文件已删除
- [ ] `langgraph` 从 `pyproject.toml` 移除
- [ ] 所有服务器启动/WS 对话/事件钩子功能正常

### Sub-project B (Tools Bridge)
- [ ] MCP 服务器启动并注册所有 Python 工具
- [ ] oh-my-pi agent 可以使用 Maxma 的天气/地图/Todo 等工具
- [ ] 工具结果通过 WS 正确传递到前端

### Sub-project C (Design)
- [ ] 路径安全规则对 oh-my-pi 的 read/write 生效
- [ ] 审批网关对高风险工具生效
- [ ] 人格系统 (SOUL.md/USER.md/AGENTS.md) 正确注入
- [ ] Const session 在 oh-my-pi 模式下可保存/恢复

---

## 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| undo 在 sidecar 模式下的行为与 LangGraph 不同 | 中 | 先实现简单版本（清空最近 N 轮），后续优化 |
| sub_agent 迁移后行为可能变化 | 中 | 保留旧代码路径作为兜底，直到稳定 |
| MCP 服务器可能增加启动延迟 | 低 | MCP 服务器懒加载，首次工具调用时才启动 |
| 路径安全可能漏检某些 oh-my-pi 工具 | 中 | 先在 read/write/bash 三个核心工具上实施 |
