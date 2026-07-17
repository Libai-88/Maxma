# Dead Code Cleanup & Minor Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Remove dead code (checkpointer_factory, time_traveler), fix approval_adapter docstring, evaluate httpx2 migration.

**Architecture:** Part A: verify and remove dead code. Part B: fix docstring. Part C: evaluate httpx2.

**Tech Stack:** Python 3.13, pytest

---

## 调研结论（已完成）

### Part A 调研

#### `api/checkpointer_factory.py`（11 语句，100% 覆盖）

- **性质**：LangGraph 时代遗留的 no-op 存根，docstring 自述"保留为兼容导入的零操作存根"。
- **Grep 结果**（排除 `.venv/`、`node_modules/`、`docs/`）：
  - 唯一 Python 引用者：`tests/test_api/test_checkpointer_factory.py`（测试本模块的 no-op 契约）。
  - `build/maxma-server.spec`：**未引用**。
  - `pyproject.toml`、`requirements.txt`、`requirements-lock.txt`、`setup.py`、CI 配置：**未引用**。
  - `HANDOFF.md:83`：仅在表格中提到"已用 try/except 保护"，是历史记录，不影响代码。
- **决策**：删除 `api/checkpointer_factory.py` + 删除其测试 `tests/test_api/test_checkpointer_factory.py`（被测对象不存在则测试无意义）。

#### `api/time_traveler.py`（21 语句，100% 覆盖）

- **性质**：sidecar 版本的撤回工具，提供 `undo_rounds/undo_last_round/undo_all`。
- **Grep 结果**：
  - `build/maxma-server.spec:80`：在 `hiddenimports` 中被引用（`"api.time_traveler"`）。
  - 唯一 Python 引用者：`tests/test_api/test_time_traveler.py`（测试本模块）。
  - `api/routes/sessions.py:257-295` 的 `/sessions/{session_id}/undo` 路由**内联实现** `client.call("undo", {...})`，**未调用** `time_traveler.undo_rounds`。
- **决策**：从 `build/maxma-server.spec` 的 `hiddenimports` 移除 `"api.time_traveler"` + 删除 `api/time_traveler.py` + 删除 `tests/test_api/test_time_traveler.py`。

### Part B 调研

#### `api/pi_bridge/approval_adapter.py`

- **第 47 行 docstring**：`"read" / "write" / "interactive" / "auto"（默认自动）`
- **第 49 行代码**：`return TOOL_APPROVAL_MAP.get(tool_name, "ask")`
- **不一致**：docstring 说默认 `"auto"`，实际返回 `"ask"`。
- **决策**：修改 docstring 第 47 行，将 `"auto"（默认自动）` 改为 `"ask"（默认询问）`，与代码一致。

### Part C 调研

#### `tests/conftest.py:9` StarletteDeprecationWarning

- **现状**：`from starlette.testclient import TestClient` 触发：
  `StarletteDeprecationWarning: Using 'httpx' with 'starlette.testclient' is deprecated; install 'httpx2' instead.`
- **Starlette 1.3.1 行为**（`starlette/testclient.py:32-51`）：
  - 优先 `import httpx2 as httpx`；失败则回退 `import httpx` 并发 warning。
- **httpx2 可用性**：PyPI 有 `httpx2==2.7.0`（最新），API 与 httpx 0.28 兼容（starlette 1.3.1 已适配）。
- **项目内直接 `import httpx` 的位置**：仅 `api/routes/balance.py:5` 和 `tests/test_api/test_balance_routes.py:10`。这些是业务代码，与 starlette testclient 无关，仍使用 httpx 包，不受影响。
- **迁移方案**：
  1. 在 `pyproject.toml` 的 `[project.optional-dependencies].dev` 添加 `"httpx2>=2.7.0"`。
  2. `.venv\Scripts\python.exe -m pip install httpx2`。
  3. **不修改任何 .py 文件**（starlette 自动检测 httpx2）。
  4. 运行测试验证 warning 消失。
- **决策**：迁移 httpx2（简单、零代码改动、消除 warning）。

---

## 任务列表

### Task A1: 删除 `api/checkpointer_factory.py` 及其测试

**Files to delete:**
- `api/checkpointer_factory.py`
- `tests/test_api/test_checkpointer_factory.py`

**Steps:**
1. Grep 已确认无生产代码引用（仅测试引用）。
2. 删除上述两个文件。
3. 运行 `pytest tests/ -v` 确认无回归。

### Task A2: 删除 `api/time_traveler.py`、其测试及 spec 条目

**Files to delete:**
- `api/time_traveler.py`
- `tests/test_api/test_time_traveler.py`

**Files to modify:**
- `build/maxma-server.spec`：从 `hiddenimports` 列表中移除 `"api.time_traveler",` 行。

**Steps:**
1. 删除上述两个文件。
2. 编辑 `build/maxma-server.spec`，删除第 80 行 `"api.time_traveler",`。
3. 运行 `pytest tests/ -v` 确认无回归。
4. 运行 ruff `F821` 检查确认无未定义名称引用。

### Task A3: 提交 Part A

**Commit message:**
```
refactor(api): remove dead code (checkpointer_factory, time_traveler)

- Remove api/checkpointer_factory.py (LangGraph-era no-op stub,
  no production imports)
- Remove api/time_traveler.py (semi-live code; /sessions/{id}/undo
  route inlines client.call("undo") instead of using this module)
- Remove their test files (tests/test_api/test_checkpointer_factory.py,
  tests/test_api/test_time_traveler.py)
- Drop "api.time_traveler" from build/maxma-server.spec hiddenimports
```

### Task B1: 修复 `approval_adapter.py` docstring

**File:** `api/pi_bridge/approval_adapter.py`

**Change (line 47):**
- Before: `        "read" / "write" / "interactive" / "auto"（默认自动）`
- After:  `        "read" / "write" / "interactive" / "ask"（默认询问）`

**Steps:**
1. Edit docstring 第 47 行。
2. 运行 `pytest tests/ -v` 确认无回归。

### Task B2: 提交 Part B

**Commit message:**
```
docs(api): fix approval_adapter docstring default mismatch

get_approval_level() returns "ask" as default (per
TOOL_APPROVAL_MAP.get(tool_name, "ask")), but docstring claimed
"auto（默认自动）". Align docstring with actual behavior.
```

### Task C1: 迁移 httpx2

**Files to modify:**
- `pyproject.toml`：在 `dev` 列表添加 `"httpx2>=2.7.0"`。

**Commands:**
- `.venv\Scripts\python.exe -m pip install "httpx2>=2.7.0"`

**Steps:**
1. 编辑 `pyproject.toml` 添加 dev 依赖。
2. 安装 httpx2 到 .venv。
3. 运行 `pytest tests/ -v` 确认 warning 消失且无回归。

### Task C2: 提交 Part C

**Commit message:**
```
build(tests): add httpx2 to dev deps to fix Starlette deprecation

Starlette 1.3.1's testclient prefers httpx2 over httpx; without it,
importing TestClient emits StarletteDeprecationWarning. Add httpx2 to
dev extras and install into .venv. No source changes needed —
starlette auto-detects httpx2 at import time.
```

### Task D1: 最终验证

1. 运行完整测试套件：`.venv\Scripts\python.exe -m pytest tests/ -v`
2. 运行 ruff：`.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 api tests`
3. 确认所有测试通过、无 warning、ruff 无错误。

---

## 约束与边界

- **不修改**：`api/db/metrics.py`、`api/metrics.py`（Agent 22）；`api/diagnostics.py`、`api/session_manager.py`、`api/db/core.py`（Agent 23）；`api/routes/chat.py`、`api/pi_bridge/sidecar_manager.py`（Agent 25）；`bun-sidecar/`、`web/`。
- **不修改已有测试文件**：除 conftest.py（Part C 不需要改 conftest）。
- **删除前用 Grep 确认无引用**：已完成。
- **频繁提交**：Part A、B、C 分别提交。

## 风险与回滚

- **Part A 风险**：删除 `time_traveler.py` 后，如果未来需要复用 undo 逻辑，需重新实现。当前路由已内联，无功能损失。
- **Part C 风险**：httpx2 与 httpx 的 API 兼容性。starlette 1.3.1 已适配，且项目业务代码仍用 httpx，互不干扰。
- **回滚**：每个 Part 独立提交，可单独 revert。
