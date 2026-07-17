# MCP Status Field Bug Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix bug where `**result` dict spread overwrites explicit `"status"` field in `create_mcp_server`, `update_mcp_server`, and `delete_mcp_server`.

**Architecture:** TDD: write failing test → fix bug → verify test passes → verify no regression.

**Tech Stack:** Python 3.13, FastAPI, pytest

---

## Root Cause Analysis

`api/routes/mcp.py` 中 `_do_reload()` 返回：

```python
{"status": "ok", "servers": [], "tool_count": 0}
```

三个写操作端点（create / update / delete）的 return 语句把 `**result` 放在字典字面量**最后**：

```python
return {"status": "created", "server": server_dict, **result}
```

Python 字典字面量中，**后出现的键覆盖先出现的同名键**。因此 `**result` 展开时其 `"status": "ok"` 会覆盖前面显式写的 `"status": "created"`，导致 API 实际返回 `status: "ok"` 而非语义正确的 `created / updated / deleted`。

### 受影响位置（3 处，非任务描述的 2 处）

任务描述只点名 `create_mcp_server` 和 `delete_mcp_server`，但 Step 1.4 要求"检查是否还有其他类似的 `**result` 覆盖问题"。审查后发现 `update_mcp_server` 存在**完全相同**的 bug 模式，必须一并修复（否则留下一个已知且完全相同的 bug 是不负责任的）。

| 行号 | 函数 | 当前 return（buggy） |
|------|------|----------------------|
| 204 | `create_mcp_server` | `return {"status": "created", "server": server_dict, **result}` |
| 237 | `update_mcp_server` | `return {"status": "updated", "server": target, **result}` |
| 252 | `delete_mcp_server` | `return {"status": "deleted", "removed": removed["server_id"], **result}` |

`reload_mcp_servers`（line 270）直接 `return await _do_reload(request)`，无覆盖问题，不需修改。

---

## Fix Strategy

采用**最小改动**方案：将 `**result` 放在最前，显式字段放在后覆盖。保留原有的 `return {...}` 字面量风格，不引入临时变量，不改控制流。

```python
# Before (buggy)
return {"status": "created", "server": server_dict, **result}

# After (fixed)
return {**result, "status": "created", "server": server_dict}
```

这样语义为：先展开 reload 结果（status / servers / tool_count），再用显式字段覆盖 `status` 和 `server`。最终返回：`{"status": "created", "servers": [], "tool_count": 0, "server": server_dict}`。

选择该方案而非 `result["status"] = ...` 方案的理由：
1. 单行 return 保留原代码风格，diff 最小
2. 不改变 `result` 局部变量（避免下游若有其他引用产生副作用——虽然此处没有，但保持只读更安全）
3. 表达意图清晰："reload 结果 + 显式覆盖"

---

## Baseline

执行前先跑一次 mcp 测试，确认当前 24 个测试**全部通过**（因为现有测试断言 `status == "ok"`，恰好适配 bug 行为）：

```
.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_routes.py -v
# 期望: 24 passed
```

---

## File Structure

| File | 改动 |
|------|------|
| `tests/test_api/test_mcp_routes.py` | 修改 2 处断言（create/delete），新增 1 处断言（update），移除 2 处 NOTE 注释 |
| `api/routes/mcp.py` | 修改 3 处 return 语句（line 204 / 237 / 252） |

**只触碰这两个文件，3 个 commit（plan / red / green）或合并为 plan + fix 两个 commit。**

---

### Task 1: RED — 修改测试断言期望正确的 status 值

**Files:**
- Modify: `tests/test_api/test_mcp_routes.py`

**Context:** 当前测试为了适配 bug，把 `status` 断言成 `"ok"`。改为期望语义正确的值，让测试**失败**，从而证明 bug 存在且测试能捕获它。

- [ ] **Step 1.1: 修改 `TestCreateServer::test_create_stdio_success`**

`tests/test_api/test_mcp_routes.py:78-81`，删除 NOTE 注释并把断言改为 `"created"`：

```python
        # Before
        # NOTE: source bug — _do_reload() returns {"status": "ok", ...} which,
        # via `**result` spread, overwrites the intended "status": "created".
        # Asserting actual behavior; see plan report for the recorded bug.
        assert body["status"] == "ok"

        # After
        assert body["status"] == "created"
```

- [ ] **Step 1.2: 修改 `TestDeleteServer::test_delete_success`**

`tests/test_api/test_mcp_routes.py:233-234`，删除 NOTE 注释并把断言改为 `"deleted"`：

```python
        # Before
        # NOTE: same source bug as create — status overwritten to "ok" by **result.
        assert resp.json()["status"] == "ok"

        # After
        assert resp.json()["status"] == "deleted"
```

- [ ] **Step 1.3: 为 `update` 端点新增 status 断言**

`TestUpdateServer::test_update_partial_fields`（line 194-208）当前**没有**对 `status` 断言。为 `update_mcp_server` 的同类 bug 添加覆盖。在现有断言后追加：

```python
        assert srv["transport"] == "stdio"  # unchanged
        # 新增：update 端点同样存在 **result 覆盖 status 的 bug
        assert resp.json()["status"] == "updated"
```

- [ ] **Step 1.4: 运行测试，确认 RED（失败）**

```
.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_routes.py -v
```

期望 3 个测试失败：
- `TestCreateServer::test_create_stdio_success` — `AssertionError: assert 'ok' == 'created'`
- `TestUpdateServer::test_update_partial_fields` — `AssertionError: assert 'ok' == 'updated'`
- `TestDeleteServer::test_delete_success` — `AssertionError: assert 'ok' == 'deleted'`

其余 21 个测试仍通过。**必须看到失败**才进入 GREEN。

---

### Task 2: GREEN — 修复 mcp.py 三处 return 语句

**Files:**
- Modify: `api/routes/mcp.py`

- [ ] **Step 2.1: 修复 `create_mcp_server` (line 204)**

```python
# Before
    return {"status": "created", "server": server_dict, **result}

# After
    return {**result, "status": "created", "server": server_dict}
```

- [ ] **Step 2.2: 修复 `update_mcp_server` (line 237)**

```python
# Before
    return {"status": "updated", "server": target, **result}

# After
    return {**result, "status": "updated", "server": target}
```

- [ ] **Step 2.3: 修复 `delete_mcp_server` (line 252)**

```python
# Before
    return {"status": "deleted", "removed": removed["server_id"], **result}

# After
    return {**result, "status": "deleted", "removed": removed["server_id"]}
```

- [ ] **Step 2.4: 运行测试，确认 GREEN（通过）**

```
.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_routes.py -v
```

期望 24 passed，0 failed。**必须全部通过**才进入下一步。

---

### Task 3: 回归测试 + Lint

- [ ] **Step 3.1: 完整测试套件无回归**

```
.venv\Scripts\python.exe -m pytest tests/ -v
```

期望：除已知与 mcp 无关的既有失败外，不引入新的失败。重点关注 mcp 相关测试与任何依赖 `api/routes/mcp.py` 的测试。

- [ ] **Step 3.2: ruff 静态检查**

```
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 api/routes/mcp.py tests/test_api/test_mcp_routes.py
```

期望：`All checks passed!`（无 syntax error / undefined name / F821）。

---

### Task 4: 提交

按代码库 commit 风格（`<type>(<scope>): <subject>`，参考近期 `test(api): ...` / `test(db): ...`）。

- [ ] **Commit 1（plan）:** `docs(plan): add MCP status field bug fix TDD plan`
  - 仅 `docs/superpowers/plans/2026-07-17-mcp-status-bug-fix.md`
- [ ] **Commit 2（fix + tests）:** `fix(api): preserve MCP endpoint status over **result spread`
  - `api/routes/mcp.py` + `tests/test_api/test_mcp_routes.py`

或如需更细粒度，拆为 `test(api): expect correct MCP status (red)` + `fix(api): preserve MCP endpoint status (green)` 两个 commit。本计划默认合并为单一 fix commit（测试与修复同属一个 bug 的两面，单 commit 更清晰）。

---

## Verification Checklist

- [ ] 每个 RED 测试在修复前确实失败，且失败原因正确（断言不匹配，非 typo/错误）
- [ ] GREEN 后 24 个 mcp 测试全部通过
- [ ] 完整套件无新增失败
- [ ] ruff `E9,F63,F7,F821` 全部通过
- [ ] 仅修改 `api/routes/mcp.py` 和 `tests/test_api/test_mcp_routes.py`（外加 plan 文档）
- [ ] 未触碰其他 agent 的文件范围
