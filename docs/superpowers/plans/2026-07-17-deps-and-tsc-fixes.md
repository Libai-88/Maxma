# Dependencies Lock & TSC Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add missing pytest/pytest-cov to requirements-lock.txt and fix pre-existing tsc error in session-bridge.ts.

**Architecture:** Part A: add dev dependencies to pyproject.toml + regenerate lock. Part B: fix replace_messages type error.

**Tech Stack:** Python 3.13, uv, Bun, TypeScript

---

## Context & Findings (调研结论)

### Part A 现状
- `pyproject.toml` 只有 `[project] dependencies`，**没有** `[project.optional-dependencies]` 的 `dev` 组。
- `requirements-lock.txt` 头部注释：`uv pip compile pyproject.toml -o requirements-lock.txt -c constraints.txt`，但实际 `update-lock.bat` 用的是 `uv pip compile pyproject.toml --extra dev -o requirements-lock.txt`（**无** `-c constraints.txt`）。
- `requirements-lock.txt` / `requirements.txt` 中**均不含** `pytest`、`pytest-cov`、`pytest-asyncio`、`ruff`、`mypy`。
- `uv` 已安装（0.11.14），`.venv` 存在且已手动装了 pytest/ruff（但 lock 文件未声明，CI 无法复现）。
- `.github/workflows/pytest.yml` 第 29 行有 `python -m pip install pytest pytest-cov`（前一轮 Agent 4 的临时补丁）。
- `pyproject.toml` 已有 `[tool.pytest.ini_options]`（asyncio_mode=auto），但 `pytest-asyncio` 不在依赖中。

### Part B 现状（tsc baseline）
运行 `cd bun-sidecar && bunx tsc --noEmit` 后，本任务范围内的唯一错误：
```
src/session-bridge.ts(520,24): error TS2339: Property 'replace_messages' does not exist on type 'AgentSession'.
```
其余 tsc 错误均在 `node_modules/@oh-my-pi/*` 内部（上游包的类型声明问题，不在本任务范围），以及 `src/session-bridge.ts(94,10)` 的 Model 类型转换错误（前一轮 Agent 3 已知，不在本任务范围）。

### Part B 根因分析
- `session-bridge.ts` line 520：`record.session.replace_messages(remaining);`
- 调研 `@oh-my-pi/pi-coding-agent@16.5.2` 的 `src/session/agent-session.ts`：
  - line 1729：`export class AgentSession { readonly agent: Agent; ... }`
  - `AgentSession` 类**没有** `replace_messages` 或 `replaceMessages` 方法。
  - line 1730：`readonly agent: Agent;` — `AgentSession` 暴露 `agent` 属性。
  - `replaceMessages`（**camelCase**）是 `Agent` 类的方法，所有内部调用都是 `this.agent.replaceMessages(...)`（如 line 2377、5323）。
  - `replace_messages`（snake_case）在整个 `node_modules/@oh-my-pi` 中**完全不存在**（grep 0 命中）。
- **结论**：调用有两个 bug —— (1) 命名风格错误（snake_case 应为 camelCase），(2) 调用对象错误（应在 `session.agent` 上而非 `session` 上）。
- **正确写法**：`record.session.agent.replaceMessages(remaining);`
- 测试文件 `session-bridge.test.ts` 不覆盖 `undo` 分支，且 fake session 用 `as any`，修复不会破坏现有 12 个测试。

### Bun test baseline
`cd bun-sidecar && bun test` → 12 pass, 0 fail。

---

## Part A — 补全 requirements-lock.txt 的 pytest 依赖

### Task A1: 在 pyproject.toml 添加 dev optional-dependencies
**文件**: `d:\Maxma\MaxmaHere\pyproject.toml`

在 `[project.urls]` 之前（即 `dependencies` 列表之后）插入：
```toml
[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-cov>=5.0.0",
    "pytest-asyncio>=0.23.0",
    "ruff>=0.5.0",
    "mypy>=1.10.0",
]
```

### Task A2: 重新生成 requirements-lock.txt
**命令**（与 `update-lock.bat` 一致）:
```
cd d:\Maxma\MaxmaHere
uv pip compile pyproject.toml --extra dev -o requirements-lock.txt
```
- 验证：新 `requirements-lock.txt` 末尾应出现 `pytest`、`pytest-cov`、`pytest-asyncio`、`ruff`、`mypy` 及其传递依赖（`coverage`、`iniconfig`、`pluggy` 等）。
- 头部注释会自动更新为 `# uv pip compile pyproject.toml --extra dev -o requirements-lock.txt`。

### Task A3: 验证 .venv 可用
```
cd d:\Maxma\MaxmaHere
.venv\Scripts\python.exe -m pytest --version
.venv\Scripts\python.exe -m pytest_cov
```
- 若 `.venv` 已有 pytest 则直接通过；若 lock 重新解析后版本变化导致缺失，运行 `uv pip sync requirements-lock.txt` 同步。
- 注意：`update-lock.bat` 末尾也会 `uv pip sync requirements-lock.txt`，保持一致。

### Task A4: 修改 .github/workflows/pytest.yml
**文件**: `d:\Maxma\MaxmaHere\.github\workflows\pytest.yml`

移除第 29 行 `python -m pip install pytest pytest-cov`（因为 lock 文件现已包含）。保留 `python -m pip install -r requirements-lock.txt`。

### Task A5: 后端测试验证 + commit
```
cd d:\Maxma\MaxmaHere
.venv\Scripts\python.exe -m pytest tests/ --deselect "tests/test_api/test_files.py::TestSelectFile::test_allowed_in_development" -q
```
通过后提交：
- 文件：`pyproject.toml`, `requirements-lock.txt`, `.github/workflows/pytest.yml`
- commit message: `chore(deps): add pytest/pytest-cov/ruff/mypy to dev extras and regenerate lock`

---

## Part B — 修复 session-bridge.ts 的 tsc 类型错误

### Task B1: 修复 line 520 的 replace_messages 调用
**文件**: `d:\Maxma\MaxmaHere\bun-sidecar\src\session-bridge.ts`

**旧代码** (line 520):
```ts
record.session.replace_messages(remaining);
```

**新代码**:
```ts
record.session.agent.replaceMessages(remaining);
```

理由：
1. `replaceMessages`（camelCase）是 `Agent` 类的方法，不是 `AgentSession` 的方法。
2. `AgentSession` 通过 `readonly agent: Agent` 属性暴露 `Agent` 实例。
3. 与上游 `agent-session.ts` 内部用法一致（`this.agent.replaceMessages(...)`）。

### Task B2: 验证 tsc + bun test + commit
```
cd d:\Maxma\MaxmaHere\bun-sidecar
bunx tsc --noEmit
bun test
```
- 验证标准：`src/session-bridge.ts(520,24)` 的 TS2339 错误消失（其余 node_modules 内的错误不在本任务范围，保持原样）。
- `bun test` 应保持 12 pass, 0 fail。
- commit message: `fix(sidecar): correct replace_messages call to agent.replaceMessages in undo handler`

---

## Files In Scope (只允许修改的文件)
- `pyproject.toml`
- `requirements-lock.txt`
- `.github/workflows/pytest.yml`
- `bun-sidecar/src/session-bridge.ts`
- `bun-sidecar/tsconfig.json`（仅在必要时，预计不需要）

## Out of Scope
- `requirements.txt`（runtime lock，由 `uv pip compile pyproject.toml -o requirements.txt` 生成，不含 dev 依赖，本次不动）
- `node_modules/` 内的 tsc 错误（上游包问题）
- `src/session-bridge.ts(94,10)` 的 Model 类型转换错误（非本任务范围）
