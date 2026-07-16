# Phase 1: Python 薄层化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Python 后端从"带完整 Agent 能力的后端"精简为"OMP 专属薄代理层"。删除 memory/、tools/、api/providers/ 等所有旧架构模块，简化存量文件。

**Architecture:** Python 后端只保留：WS↔JSON-RPC 桥接、认证、静态文件服务、YAML 配置持久化。所有 Agent 能力委托给 OMP sidecar。

**Tech Stack:** Python 3.11+ / FastAPI / uvicorn / OMP v16.5.2

**Prerequisite:** 设计文档 `docs/superpowers/specs/2026-07-16-maxma-omp-native-refactor-design.md` 已获批准。

---

## 文件结构总览

### 删除的目录
```
memory/                    ← 整个目录删除
tools/                     ← 整个目录删除
api/providers/             ← 整个目录删除
api/callbacks/             ← 整个目录删除
```

### 删除的文件
```
agent/autonomy/            ← 整个目录删除
agent/hooks.py             ← 删除
agent/audit_log.py         ← 删除
agent/circuit_breaker.py   ← 删除
agent/error_recovery.py    ← 删除
agent/delegation_scope.py  ← 删除
agent/runtime_context.py   ← 删除
agent/think_path.py        ← 删除
agent/performance.py       ← 删除
agent/session_health.py    ← 删除
agent/project_scanner.py   ← 删除（OMP 内置）
agent/lifecycle/           ← 整个目录删除
maxma_platform/            ← 整个目录删除
tools/mcp.py               ← 删除
tools/interaction/         ← 整个目录删除
tools/path_security.py     ← 删除
tools/crypto.py            ← 删除
tools/registry.py          ← 删除
```

### 修改的文件
```
api/server.py              ← 移除 provider/记忆/autonomy/hooks 生命周期
api/session_manager.py     ← 移除工具/checkpointer 字段
api/routes/chat.py         ← 移除 provider 选择逻辑
api/routes/sessions.py     ← 简化
api/routes/mcp.py          ← 简化
api/routes/persona.py      ← 保留
api/routes/skills.py       ← 保留
agent/__init__.py          ← 清空
agent/prompts.py           ← 保留（system prompt 构建）
agent/persona_loader.py    ← 保留
agent/context_manager.py   ← 已简化存根
agent/model_routing.py     ← 删除
agent/permission_policy.py ← 删除
pyproject.toml             ← 移除不需要的依赖
build/maxma-server.spec    ← 匹配新依赖
requirements.txt           ← 重新生成
config/settings.py         ← 简化
api/const_session_store.py ← 保留
api/time_traveler.py       ← 保留
app_paths.py               ← 简化（移除 memory/ 路径）
```

---

## Phase 1 — Task 1: 删除 tools/ 目录

**说明：** tools/ 目录包含所有 Python 工具实现。OMP 已内置 32 个工具覆盖相同功能。6 个 Maxma 特有配置管理工具将在 Phase 2 重写为 TypeScript AgentTool。

- [ ] **Step 1: 删除 tools/ 整个目录**

```bash
rm -rf "D:/Maxma/MaxmaHere/tools"
```

- [ ] **Step 2: 清理引用 tools/ 的导入**

检查所有剩余 Python 文件中 `from tools` 或 `import tools` 的引用：

```bash
cd "D:/Maxma/MaxmaHere" && grep -rn "from tools\|import tools\|tools\." --include="*.py" api/ agent/ config/ main.py app_paths.py | grep -v ".venv\|__pycache__\|\.git\|#"
```

对每个匹配的文件，要么删除该 import（如果只用了已删除的 tools），要么保留（如果引用了仍然存在的模块如 `tools/base.py` —— 但整个 tools/ 已删除，所以所有引用都要清理）。

需要清理的文件：
- `api/routes/chat.py` — 移除 `from tools import get_all_tools, merge_tool_lists` 和 `from tools.path_security import check_path_access`
- `api/server.py` — 移除 `from tools import merge_tool_lists` 和 `from tools.mcp import init_mcp_tools, close_mcp`
- `api/dependencies.py` — 可能引用 tools
- `api/__init__.py` — 可能引用 tools
- `api/interaction.py` — 可能引用 tools
- `agent/prompts.py` — 可能引用 tools
- `app_paths.py` — 可能引用 tools 路径
- `main.py` — 可能引用 tools

- [ ] **Step 3: 更新 pyproject.toml — 移除 tools 相关依赖**

```toml
# 移除:
# "tavily-python>=0.7.0",  ← OMP web_search 替代
# "playwright>=1.40.0",    ← OMP browser 替代
# "todoist-api-python",    ← TS AgentTool 版
# "uapi-sdk-python",       ← TS AgentTool 版
# "moviepy>=1.0.3",        ← 非核心
```

- [ ] **Step 4: 运行测试确认 tools/ 删除没有导致导入错误**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -m pytest tests/ --collect-only -q
```
Expected: 错误数不增加（仅删除 tools/ 不应该影响其他模块的导入）。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: remove tools/ — OMP 32 built-in tools replace all Python tools"
```

---

## Phase 1 — Task 2: 删除 memory/ 目录

**说明：** memory/ 包含 4 层记忆架构（ChromaDB + ONNX）。OMP 有 recall/reflect/retain/memory_edit 内置工具。记忆数据由 OMP 管理。

- [ ] **Step 1: 删除 memory/ 整个目录**

```bash
rm -rf "D:/Maxma/MaxmaHere/memory"
```

- [ ] **Step 2: 清理引用 memory/ 的导入**

```bash
cd "D:/Maxma/MaxmaHere" && grep -rn "from memory\|import memory\|memory\." --include="*.py" api/ agent/ config/ main.py app_paths.py | grep -v ".venv\|__pycache__\|\.git\|#"
```

需要清理的文件：
- `api/server.py` — 移除 `from memory.episodic import EpisodicMemoryManager`、`from memory.memory_manager import MemoryManager`、`from memory.semantic import SemanticMemoryManager`、`from memory.coordinator import MemoryCoordinator`、`from memory.narrative import LongTermMemoryInterface`、`from memory.ttl import schedule_purge`、`from memory.user_init import ensure_all`
- `api/routes/chat.py` — 移除 `from agent.context_manager import commit_to_episodic`、`from agent.context_manager import retrieve_from_episodic`
- `api/routes/memory.py` — 整个路由文件需要简化或删除
- `agent/prompts.py` — 移除 `from memory.narrative import get_narrative`、`from memory.user_init import ensure_user_md`、`from memory.semantic import SemanticMemoryManager`
- `agent/context_manager.py` — 移除 `commit_to_episodic`、`retrieve_from_episodic` 函数
- `main.py` — 移除 `from memory.user_init import ensure_all`
- `app_paths.py` — 移除 memory 相关路径常量

- [ ] **Step 3: 删除 ChromaDB 数据目录**

```bash
rm -rf "D:/Maxma/MaxmaHere/vector_db"
```

- [ ] **Step 4: 更新 pyproject.toml — 移除 memory 相关依赖**

```toml
# 移除:
# "chromadb>=0.5.0",       ← OMP 记忆系统替代，节省 ~600MB
# "onnxruntime>=1.16.0",   ← 不再需要本地嵌入
# "transformers>=4.40.0",   ← 不再需要
# "tiktoken>=0.7.0",       ← OMP 内置
```

- [ ] **Step 5: 运行测试确认 memory/ 删除没有导致导入错误**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -m pytest tests/ --collect-only -q
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: remove memory/ — OMP recall/reflect/retain replaces 4-layer memory system"
```

---

## Phase 1 — Task 3: 删除 api/providers/ 和 api/callbacks/

**说明：** api/providers/ 管理 LLM Provider 配置和实例创建。OMP ModelRegistry 管理 40+ provider。api/callbacks/ 是 LangChain 回调，不再需要。

- [ ] **Step 1: 删除目录**

```bash
rm -rf "D:/Maxma/MaxmaHere/api/providers"
rm -rf "D:/Maxma/MaxmaHere/api/callbacks"
```

- [ ] **Step 2: 删除 api/db/providers.py（provider 的 SQLite 存储）**

```bash
rm -f "D:/Maxma/MaxmaHere/api/db/providers.py"
```

- [ ] **Step 3: 清理引用**

```bash
cd "D:/Maxma/MaxmaHere" && grep -rn "from api.providers\|from api.callbacks\|from api.db.providers\|provider_manager\|ProviderManager" --include="*.py" api/ agent/ config/ | grep -v ".venv\|__pycache__"
```

需要清理的文件：
- `api/server.py` — 大量 provider 相关代码（lifespan 中创建 ProviderManager、健康监控、LLM 后台初始化）
- `api/routes/chat.py` — provider 选择逻辑、`resolve_model_role`、`_get_provider_context`
- `api/dependencies.py` — `get_llm()` 函数
- `api/health.py` — provider 健康检查
- `api/routes/providers.py` — provider CRUD 路由（可以保留但后端改为 OMP 代理）

- [ ] **Step 4: 更新 pyproject.toml**

```toml
# 移除:
# "langchain>=0.3.0",          ← 不再需要，OMP 管理 LLM
# "langchain-openai>=0.3.0",   ← 不再需要
# "langchain-mcp-adapters>=0.2.0", ← 不再需要
```

保留 `langchain-core` 用于 BaseMessage 类型？不——OMP 返回纯 JSON，不需要 LangChain 消息类型。完全移除 LangChain 生态。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: remove api/providers/ and api/callbacks/ — OMP ModelRegistry manages 40+ providers"
```

---

## Phase 1 — Task 4: 删除 agent/ 子模块（非 prompts 部分）

**说明：** agent/ 中除了 `prompts.py`（system prompt 构建）和 `persona_loader.py`（人设加载）外，其他都是旧架构模块（autonomy/hooks/audit/think_path 等），全部删除。

- [ ] **Step 1: 删除 agent/ 子目录和文件**

```bash
rm -rf "D:/Maxma/MaxmaHere/agent/autonomy"
rm -rf "D:/Maxma/MaxmaHere/agent/lifecycle"
rm -f "D:/Maxma/MaxmaHere/agent/hooks.py"
rm -f "D:/Maxma/MaxmaHere/agent/audit_log.py"
rm -f "D:/Maxma/MaxmaHere/agent/circuit_breaker.py"
rm -f "D:/Maxma/MaxmaHere/agent/error_recovery.py"
rm -f "D:/Maxma/MaxmaHere/agent/runtime_context.py"
rm -f "D:/Maxma/MaxmaHere/agent/think_path.py"
rm -f "D:/Maxma/MaxmaHere/agent/delegation_scope.py"
rm -f "D:/Maxma/MaxmaHere/agent/performance.py"
rm -f "D:/Maxma/MaxmaHere/agent/session_health.py"
rm -f "D:/Maxma/MaxmaHere/agent/model_routing.py"
rm -f "D:/Maxma/MaxmaHere/agent/permission_policy.py"
rm -f "D:/Maxma/MaxmaHere/agent/project_scanner.py"
```

保留：
- `agent/prompts.py` — system prompt 构建（调用方是 api/routes/chat.py）
- `agent/persona_loader.py` — 人设加载（调用方是 prompts.py）
- `agent/context_manager.py` — 已简化存根
- `agent/__init__.py` — 清空或保留 imports

- [ ] **Step 2: 清理引用**

```bash
cd "D:/Maxma/MaxmaHere" && grep -rn "from agent\.\|import agent" --include="*.py" api/ main.py app_paths.py | grep -v ".venv\|__pycache__\|\.git\|#"
```

主要清理 `api/server.py` 和 `api/routes/chat.py` 中的引用。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: remove agent/ submodules — OMP replaces autonomy/hooks/think_path/error_recovery"
```

---

## Phase 1 — Task 5: 简化 api/server.py

**说明：** server.py 现在需要移除以下生命周期逻辑：
- Provider 初始化 (ProviderManager, 健康监控, LLM 后台初始化)
- 记忆系统初始化 (EpisodicMemoryManager, SemanticMemoryManager, MemoryCoordinator, LTM)
- 事件钩子 (HookManager)
- 自治调度器 (autonomy)
- 工具加载 (merge_tool_lists, MCP init, MCP 重载回调)
- TTL 清理
- Workflow
- Idle queue

保留：
- 认证 Token
- SessionManager
- Static file serving
- CORS
- Router registration
- SidecarManager 初始化

- [ ] **Step 1: 读取当前 server.py**

```bash
cd "D:/Maxma/MaxmaHere" && wc -l api/server.py
```

当前约 769 行。目标缩减到 ~200 行。

- [ ] **Step 2: 重写 server.py**

核心结构：

```python
"""FastAPI 应用工厂 — OMP 薄代理层。"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.auth import load_or_create_token
from api.cors_config import build_cors_origins
from api.routes import chat, sessions, persona, skills
from api.session_manager import SessionManager
from api.ws_registry import WebSocketRegistry
from api.pi_bridge.sidecar_manager import SidecarManager
from config.settings import get_settings
from version import __version__

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期 — OMP 薄代理模式。"""
    # 1. 初始化认证 Token
    from api.db.auth import load_or_create_token as load_token
    app.state.auth_token = load_token()
    logger.info("[auth] token: %s...%s", app.state.auth_token[:4], app.state.auth_token[-4:])

    # 2. Session 管理
    app.state.session_manager = SessionManager()
    app.state.ws_registry = WebSocketRegistry()
    app.state.system_prompt = ""
    
    # 3. Sidecar 管理器（懒启动）
    app.state.sidecar_manager = SidecarManager()
    logger.info("[sidecar] SidecarManager created")

    yield

    # 关闭 sidecar
    if getattr(app.state, "sidecar_manager", None):
        await app.state.sidecar_manager.stop()
        logger.info("[sidecar] stopped")


def create_app() -> FastAPI:
    app = FastAPI(
        title="MaxmaHere API",
        version=__version__,
        lifespan=lifespan,
    )

    # CORS
    cors_origins = build_cors_origins()
    app.add_middleware(CORSMiddleware, allow_origins=cors_origins,
                       allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

    # REST 路由
    app.include_router(sessions.router, prefix="/api")
    app.include_router(chat.router)
    app.include_router(persona.router, prefix="/api")
    app.include_router(skills.router, prefix="/api")

    # Auth token endpoint
    @app.get("/api/auth/token")
    async def get_auth_token():
        return {"token": app.state.auth_token}

    # 健康检查
    @app.get("/api/health")
    async def health():
        sidecar_ok = getattr(app.state, "sidecar_manager", None) is not None
        return {"status": "ok", "version": __version__, "sidecar": sidecar_ok}

    # 生产模式：挂载前端静态文件
    if os.environ.get("MAXMA_ENV") == "production":
        from app_paths import WEB_DIST_DIR
        if WEB_DIST_DIR.exists():
            from fastapi.responses import FileResponse
            app.mount("/assets", StaticFiles(directory=WEB_DIST_DIR / "assets"), name="assets")
            @app.get("/{path:path}")
            async def spa_fallback(path: str):
                index_path = WEB_DIST_DIR / "index.html"
                if index_path.exists():
                    return FileResponse(index_path)
                return {"detail": "Not Found"}
            @app.get("/")
            async def root_fallback():
                index_path = WEB_DIST_DIR / "index.html"
                if index_path.exists():
                    return FileResponse(index_path)
                return {"detail": "Not Found"}
            logger.info("[static] mounted frontend: %s", WEB_DIST_DIR)

    return app
```

- [ ] **Step 3: 验证无导入错误**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -c "from api.server import create_app; app = create_app(); print(f'OK: {len(app.routes)} routes')"
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: simplify server.py — remove provider/memory/autonomy/hooks lifecycle"
```

---

## Phase 1 — Task 6: 简化 api/routes/chat.py

**说明：** chat.py 需要移除 provider 选择逻辑、模型路由、ThinkPath、memory 投影、LTM、sticker 处理等，变成纯 WS ↔ JSON-RPC 代理。

当前 chat.py 约 1450 行。目标缩减到 ~400 行。

保留：
- WebSocket 连接管理
- Session 创建/恢复
- Sidecar 事件转发（token/tool_start/tool_end/tool_error/answer/done/error）
- System prompt 构建（build_system_prompt）
- 上下文用量估算（简化版）
- 取消处理
- Const 会话保存

移除：
- `_resolve_think_path_execution` 整个函数
- `_think_path_runtime_context` 整个函数
- `_get_provider_context` 整个函数
- `_build_runtime_context_for_agent` 整个函数
- `_process_image_refs` 整个函数（OMP 支持多模态）
- `_describe_image` 整个函数
- `_get_project_context` 整个函数
- `_detect_project_path` 整个函数
- `_project_completed_turn_to_episodic` 整个函数
- `_get_recent_ai_messages` 整个函数
- 所有 provider/model 选择逻辑（约 200 行）
- 所有 delegation context 逻辑
- 所有 memory 投影逻辑
- `process_stickers` 调用

- [ ] **Step 1: 重写 _stream_turn_sidecar 为 chat.py 的唯一执行路径**

```python
async def _stream_turn_sidecar(
    ws: WebSocket,
    session: SessionState,
    user_message: str,
    system_prompt: str,
    model_str: str | None = None,
) -> str:
    """Execute a turn using oh-my-pi sidecar (Bun subprocess).
    
    Pure proxy: forwards WS events 1:1 from sidecar to frontend.
    """
    app_state = ws.app.state
    mgr = app_state.sidecar_manager
    await mgr.start()
    client = mgr.client
    if client is None:
        raise RuntimeError("Sidecar not available")

    session._sidecar_mgr = mgr

    # Look up or create sidecar session
    from api.pi_bridge.session_adapter import SessionMap
    with SessionMap() as sm:
        sidecar_sid = sm.get_sidecar_id(session.session_id)
    if not sidecar_sid:
        sidecar_sid = getattr(session, "_sidecar_session_id", None)

    # Validate stale session
    if sidecar_sid:
        try:
            await client.call("get_messages", {"session_id": sidecar_sid, "limit": 0})
        except Exception:
            sidecar_sid = None
            with SessionMap() as sm:
                sm.remove(session.session_id)

    if not sidecar_sid:
        result = await client.call("create_session", {
            "model": model_str or "",
            "system_prompt": system_prompt,
            "cwd": ".",
        })
        sidecar_sid = result["session_id"]
        session._sidecar_session_id = sidecar_sid
        with SessionMap() as sm:
            sm.set_mapping(session.session_id, sidecar_sid)

    # Register event handlers
    final_answer = ""
    turn_done = asyncio.Event()

    async def _on_token(sid: str, event: dict):
        if sid != sidecar_sid: return
        try: await ws.send_json({"type": "token", "payload": event.get("payload", {})})
        except Exception: pass

    async def _on_tool_start(sid: str, event: dict):
        if sid != sidecar_sid: return
        try: await ws.send_json({"type": "tool_start", "payload": event.get("payload", {})})
        except Exception: pass

    async def _on_tool_end(sid: str, event: dict):
        if sid != sidecar_sid: return
        try: await ws.send_json({"type": "tool_end", "payload": event.get("payload", {})})
        except Exception: pass

    async def _on_tool_error(sid: str, event: dict):
        if sid != sidecar_sid: return
        try: await ws.send_json({"type": "tool_error", "payload": event.get("payload", {})})
        except Exception: pass

    async def _on_answer(sid: str, event: dict):
        nonlocal final_answer
        if sid != sidecar_sid: return
        final_answer = event.get("payload", {}).get("content", "")

    async def _on_done(sid: str, event: dict):
        if sid != sidecar_sid: return
        turn_done.set()

    async def _on_error(sid: str, event: dict):
        if sid != sidecar_sid: return
        try:
            await ws.send_json({"type": "error", "payload": event.get("payload", {})})
        except Exception: pass

    unsubs = [
        client.on("token", _on_token),
        client.on("tool_start", _on_tool_start),
        client.on("tool_end", _on_tool_end),
        client.on("tool_error", _on_tool_error),
        client.on("answer", _on_answer),
        client.on("done", _on_done),
        client.on("error", _on_error),
    ]

    try:
        await client.call("prompt", {"session_id": sidecar_sid, "message": user_message})
        await asyncio.wait_for(turn_done.wait(), timeout=600)
    except asyncio.TimeoutError:
        try: await client.call("cancel", {"session_id": sidecar_sid})
        except Exception: pass
        if not final_answer:
            final_answer = "（处理超时）"
    except Exception as e:
        try: await client.call("cancel", {"session_id": sidecar_sid})
        except Exception: pass
        if not final_answer:
            final_answer = f"（处理出错：{e}）"
    finally:
        for u in unsubs:
            try: u()
            except Exception: pass

    return final_answer
```

- [ ] **Step 2: 简化 websocket_chat 端点**

主循环只需：接收消息 → _stream_turn_sidecar → 发送 answer/done → 保存 const session。

```python
@router.websocket("/ws/chat/{session_id}")
async def websocket_chat(ws: WebSocket, session_id: str):
    await ws.accept()
    app_state = ws.app.state
    session = await app_state.session_manager.get_or_create(session_id)
    app_state.ws_registry.register(session_id, ws)

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
                continue
            if msg.get("type") != "chat":
                continue
            
            payload = msg.get("payload", {})
            user_message = str(payload.get("message", "")).strip()
            if not user_message:
                continue

            system_prompt = build_system_prompt()
            model_str = payload.get("model")  # optional model override
            
            final_answer = await _stream_turn_sidecar(
                ws, session, user_message, system_prompt, model_str,
            )
            
            if final_answer:
                await ws.send_json({"type": "answer", "payload": {"content": final_answer}})
                session.message_count += 2
            
            await ws.send_json({"type": "done", "payload": {"turn_id": uuid.uuid4().hex}})
    except WebSocketDisconnect:
        pass
    finally:
        app_state.ws_registry.unregister(session_id)
```

- [ ] **Step 3: 验证无导入错误**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -c "from api.routes.chat import router; print(f'OK: {len(router.routes)} routes')"
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: simplify chat.py — pure WS↔JSON-RPC proxy, remove provider/memory logic"
```

---

## Phase 1 — Task 7: 更新 pyproject.toml 和依赖

- [ ] **Step 1: 重写 pyproject.toml dependencies**

```toml
[project]
name = "maxmahere"
dynamic = ["version"]
description = "MaxmaHere — oh-my-pi AI Agent Desktop Frontend"
requires-python = ">=3.11"

dependencies = [
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.27.0",
    "pydantic-settings>=2.0.0",
    "python-dotenv>=1.0.0",
    "pyyaml>=6.0",
    "cryptography>=41.0.0",
    "httpx>=0.27.0",
    "requests>=2.31.0",
    "aiosqlite>=0.20.0",   # SessionMap SQLite
    "beautifulsoup4>=4.12.0",
    "PyPDF2>=3.0.0",
    "python-docx>=1.1.0",
    "filelock>=3.13.0",
    "watchdog>=3.0.0",
]
```

- [ ] **Step 2: 重新生成 requirements.txt**

```bash
cd "D:/Maxma/MaxmaHere" && uv pip compile pyproject.toml -o requirements.txt
```

- [ ] **Step 3: 重新生成 requirements-lock.txt**

```bash
cd "D:/Maxma/MaxmaHere" && uv pip compile pyproject.toml -o requirements-lock.txt
```

- [ ] **Step 4: 卸载不再需要的包**

```bash
cd "D:/Maxma/MaxmaHere" && pip uninstall -y chromadb onnxruntime transformers langchain langchain-openai langchain-mcp-adapters tavily-python playwright moviepy
```

- [ ] **Step 5: 运行测试确认**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -m pytest tests/ --collect-only -q
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "build: update pyproject.toml — remove langchain/chromadb/transformers/playwright deps"
```

---

## Phase 1 — Task 8: 更新 build/maxma-server.spec

- [ ] **Step 1: 重写 spec 文件 hiddenimports**

移除所有已删除模块的引用（langchain, memory, tools, agent submodules）。

保留：
```python
hiddenimports = [
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "fastapi",
    "pydantic",
    "pydantic_settings",
    "yaml",
    "cryptography",
    "aiosqlite",
    "api.pi_bridge.rpc_client",
    "api.pi_bridge.sidecar_manager",
    "api.pi_bridge.session_adapter",
    "api.pi_bridge.ws_event_mapper",
    "api.auth",
    "api.const_session_store",
    "api.time_traveler",
    "api.db.core",
    "api.db.auth",
]
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "build: update maxma-server.spec — match new thin dependencies"
```

---

## Phase 1 — Task 9: 删除 maxma_platform/ 和其他杂项

- [ ] **Step 1: 删除 maxma_platform/**

```bash
rm -rf "D:/Maxma/MaxmaHere/maxma_platform"
```

- [ ] **Step 2: 删除旧文档**

```bash
rm -f "D:/Maxma/MaxmaHere/FIND.md"
rm -f "D:/Maxma/MaxmaHere/SECURITY.md"
```

- [ ] **Step 3: 清理 app_paths.py**

移除 memory/tools/autonomy 相关路径常量。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove maxma_platform/, old docs, stale paths"
```

---

## Phase 1 — Task 10: 最终验证

- [ ] **Step 1: 验证所有模块导入**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -c "
import sys; sys.path.insert(0, '.')
modules = [
    'api.server', 'api.session_manager', 'api.checkpointer_factory',
    'api.time_traveler', 'api.const_session_store',
    'api.pi_bridge.rpc_client', 'api.pi_bridge.sidecar_manager',
    'api.pi_bridge.session_adapter', 'api.pi_bridge.ws_event_mapper',
    'api.routes.chat', 'api.routes.sessions',
    'agent.prompts', 'agent.persona_loader',
]
for m in modules:
    try: __import__(m); print(f'OK: {m}')
    except Exception as e: print(f'FAIL: {m}: {e}')
"
```

- [ ] **Step 2: 验证服务启动**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && timeout 10 uvicorn api.server:create_app --host 127.0.0.1 --port 18099 2>&1 | head -10
```

Expected: "Starting server... Waiting for application startup."

- [ ] **Step 3: 验证测试收集**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -m pytest tests/ --collect-only -q 2>&1 | tail -3
```

Expected: No errors, some tests collected (remaining tests that don't import deleted modules).

- [ ] **Step 4: 最终 commit**

```bash
git add -A && git commit -m "chore: Phase 1 final validation — Python pure thin layer ready"
```
