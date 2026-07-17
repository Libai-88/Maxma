# Test Scaffold Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Evaluate and properly handle 3 test scaffold files in `api/pi_bridge/` (`test_integration.py`, `test_session_map.py`, `test_tools_e2e.py`), which all have 0% coverage and violate project structure by living under `api/` source directory.

**Architecture:** Read each file → classify nature (test/script/dead code) → choose handling (move/delete/cover) → execute → verify coverage & ruff.

**Tech Stack:** Python 3.13, pytest

---

## Step 1: File Nature Assessment (已通过 Read + Grep 完成)

### 1.1 `api/pi_bridge/test_integration.py` (40 语句)

- **是 pytest 测试？** 否。仅有一个 `async def main()`，无 `def test_*` 函数。
- **是集成脚本？** 是。`if __name__ == "__main__": asyncio.run(main())`，启动真实 `SidecarManager` + `JsonRpcClient`，调用 `create_session` / `prompt` / 订阅 `token` 事件。
- **被谁引用？** 仅 `README.md:172` 和历史快照文档 `docs/了解_Maxma_大迭代_2026-07-16_11-52.md`（作为手动运行命令出现）。无任何 Python `import`。
- **功能是否已被覆盖？** 是。`tests/test_pi_bridge/test_sidecar_manager_extra.py` 通过 mock 覆盖了 `start` / `stop` / `restart` / `_forward_stderr` 的所有分支；`tests/test_pi_bridge/test_sidecar_manager.py` 覆盖了 stderr 任务取消场景。`tests/test_pi_bridge/test_rpc_client.py` 覆盖了 RPC 客户端。
- **性质判定：** 手动 E2E 集成脚本（非 pytest），需要真实 bun-sidecar 才能运行。0% 覆盖率意味着从未被 pytest 收集也从未手动执行。

### 1.2 `api/pi_bridge/test_session_map.py` (42 语句)

- **是 pytest 测试？** 否。虽有一个 `def test_session_map()` 函数，但函数体用 `print("[PASS]...")` 而非 `assert` 报告（仅有少量 assert），且通过 `if __name__ == "__main__": test_session_map()` 手动运行。位于 `api/` 目录下，pytest 默认不收集。
- **是集成脚本？** 否。只测试纯 Python `SessionMap` 类与 SQLite，不依赖 sidecar。
- **被谁引用？** 仅 `README.md:174` 和历史快照文档。无任何 Python `import`。
- **功能是否已被覆盖？** 是，且覆盖更全面。`tests/test_pi_bridge/test_session_adapter.py` 包含 `TestSessionMapInit` / `TestSessionMapCRUD` / `TestSessionMapConst` / `TestSessionMapAppendTurn` / `TestSessionMapGetRecentTurns` / `TestSessionMapListAll` / `TestSessionMapCount` / `TestSessionMapClose` / `TestSessionMapPersistenceRoundTrip` 共 9 个测试类，覆盖了所有 CRUD + 持久化 + 边界场景。
- **性质判定：** 死代码。简单 CRUD 测试脚本，功能已被等价 pytest 测试 100% 覆盖，无任何额外价值。

### 1.3 `api/pi_bridge/test_tools_e2e.py` (80 语句)

- **是 pytest 测试？** 否。仅有 `async def main()`，无 `def test_*` 函数。
- **是集成脚本？** 是。`if __name__ == "__main__": asyncio.run(main())`，启动真实 sidecar，注册 `tool_start` / `tool_end` / `token` / `done` 事件处理器，发送触发 `read` 工具的 prompt，验证事件流。
- **被谁引用？** 仅 `README.md:173` 和历史快照文档。无任何 Python `import`。
- **功能是否已被覆盖？** 是。`tests/test_pi_bridge/test_sidecar_manager_extra.py` 覆盖了 sidecar 生命周期；`tests/test_pi_bridge/test_ws_event_mapper.py` 覆盖了事件映射；`tests/test_pi_bridge/test_rpc_client*.py` 覆盖了 RPC 客户端事件订阅。
- **性质判定：** 手动 E2E 集成脚本（非 pytest），需要真实 bun-sidecar 才能运行。0% 覆盖率。

---

## Step 2: Handling Decision

| 文件 | 性质 | 方案 | 理由 |
|---|---|---|---|
| `test_session_map.py` | 死代码（简单 CRUD 脚本，已被等价 pytest 完全覆盖） | **C：删除** | 无任何额外价值，纯死代码 |
| `test_integration.py` | 手动 E2E 脚本（需真实 sidecar） | **B：移到 `scripts/manual_tests/`** | 保留作为调试工具，但移出 `api/` 源码目录 |
| `test_tools_e2e.py` | 手动 E2E 脚本（需真实 sidecar） | **B：移到 `scripts/manual_tests/`** | 保留作为调试工具，但移出 `api/` 源码目录 |

**统一处理：**
- 删除 `test_session_map.py`（功能已 100% 被 `tests/test_pi_bridge/test_session_adapter.py` 覆盖）
- 移动 `test_integration.py` 和 `test_tools_e2e.py` 到 `scripts/manual_tests/` 子目录
- 更新 `README.md` 中的 "Sidecar 测试" 命令路径
- 不修改 `docs/了解_Maxma_大迭代_2026-07-16_11-52.md`（历史快照文档，不修改）

---

## Step 3: Execution Plan

### Task 1: 创建 `scripts/manual_tests/` 目录并移动两个 E2E 脚本

- [ ] 创建 `scripts/manual_tests/` 目录
- [ ] `git mv api/pi_bridge/test_integration.py scripts/manual_tests/test_integration.py`
- [ ] `git mv api/pi_bridge/test_tools_e2e.py scripts/manual_tests/test_tools_e2e.py`
- [ ] 验证移动后文件可正常 import（`from api.pi_bridge.sidecar_manager import SidecarManager` 等仍可用，因为脚本本身用 `sys.path.insert` 处理了路径）

### Task 2: 删除 `test_session_map.py`

- [ ] `git rm api/pi_bridge/test_session_map.py`
- [ ] 用 Grep 二次确认无任何 Python import 引用（已确认仅 README + 历史文档引用）

### Task 3: 更新 `README.md`

- [ ] 修改 `README.md:171-174` 的 "Sidecar 测试" 部分，更新为新路径：
  ```bash
  # Sidecar 测试（手动 E2E，需先启动 bun-sidecar）
  python scripts/manual_tests/test_integration.py
  python scripts/manual_tests/test_tools_e2e.py
  ```
  - 移除 `python api/pi_bridge/test_session_map.py` 行（功能已由 pytest 覆盖，运行 `pytest tests/test_pi_bridge/test_session_adapter.py` 即可）

### Task 4: 验证无回归

- [ ] 运行 ruff 检查：`.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 api tests`
- [ ] 运行完整测试套件：`.venv\Scripts\python.exe -m pytest tests/ -v`
- [ ] 验证 `api/pi_bridge/` 目录下不再有 `test_*.py` 文件

### Task 5: 覆盖率验证

- [ ] 运行覆盖率检查：`.venv\Scripts\python.exe -m pytest tests/ --cov=api --cov=agent --cov-report=term -q`
- [ ] 确认整体覆盖率提升（分母减少 162 语句：40 + 42 + 80）

### Task 6: 提交

- [ ] 单次 commit 包含：移动 2 个文件 + 删除 1 个文件 + 更新 README.md
- [ ] commit message: `chore: relocate pi_bridge test scaffolds out of api/ source directory`

---

## Constraints Checklist

- ✅ 不修改 `api/pi_bridge/security_adapter.py`、`approval_adapter.py`（Agent 18）
- ✅ 不修改 `api/bootstrap/`、`api/checkpointer_factory.py`、`api/time_traveler.py`、`api/logging_config.py`（Agent 19）
- ✅ 不修改 `api/routes/mcp.py`（Agent 20）
- ✅ 不修改 `bun-sidecar/`、`web/`、`pyproject.toml`、`requirements-lock.txt`
- ✅ 不修改已有的测试文件（仅移动目标文件到 scripts/）
- ✅ 不修改历史快照文档 `docs/了解_Maxma_大迭代_2026-07-16_11-52.md`
