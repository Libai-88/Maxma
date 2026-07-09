# Production Quality Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all security vulnerabilities, bugs, dead code, and test quality issues identified in the four-layer architecture upgrade audit, bringing Maxma to production-grade quality.

**Architecture:** Three-phase approach — Phase 1 fixes security and correctness bugs (fail-closed), Phase 2 removes dead code and deduplicates near-identical modules, Phase 3 adds missing test coverage, migrates frontend state management to Pinia, and adds operational observability.

**Tech Stack:** Python 3.13 (LangGraph + FastAPI + Pydantic), Vue 3 + TypeScript + Pinia, pytest, vitest

---

## File Structure

**Modified files:**
- `agent/autonomy/runner.py` — Task 1 (whitelist), Task 3 (chr(10) fix)
- `agent/autonomy/diagnostics.py` — Task 2 (dedup bug), Task 3 (unused import)
- `web/src/components/workbench/cards/TableCard.vue` — Task 4 (XSS fix)
- `api/health.py` — Task 5 (status vocabulary)
- `tests/test_agent/test_autonomy_scheduler.py` — Task 6 (mock API fix)
- `tests/test_agent/test_autonomy_runner.py` — Task 6 (tautological patch fix)
- `config/settings.py` — Task 7 (remove dead flag)
- `agent/prompts.py` — Task 7 (remove dead prompt function)
- `tools/system/tool_rag_diagnose.py` — Task 7 (remove text ref), Task 9 (shared base)
- `tools/system/tool_system_diagnose.py` — Task 9 (shared base)
- `web/src/composables/useWorkbench.ts` — Task 8 (remove clearCards)
- `web/src/types/workbench.ts` — Task 8 (remove WorkbenchState)
- `web/src/components/ToolBubbleRouter.vue` — Task 10 (remove console.log)
- `agent/autonomy/scheduler.py` — Task 14 (get_running_loop + initial delay + status)
- `api/server.py` — Task 15 (autonomy status route registration)
- `.env.example` — Task 15 (autonomy env vars)

**Created files:**
- `tools/base_diagnose.py` — Task 9 (shared diagnose base class)
- `tests/test_agent/test_autonomy_runner_pure.py` — Task 11 (pure function tests)
- `tests/test_tools/test_system_diagnose_edge.py` — Task 12 (edge case tests)
- `web/src/stores/workbench.ts` — Task 13 (Pinia store)
- `tests/test_api/test_autonomy_status.py` — Task 15 (status endpoint test)

**Deleted files:**
- `memory/kb/query_rewriter.py` — Task 7 (dead code)
- `tests/test_memory/test_kb_query_rewriter.py` — Task 7 (dead test)

---

## Phase 1: Security + Bug Fixes (Tasks 1-6)

### Task 1: Runner Tool Whitelist (Fail-Closed Security)

**Problem:** `runner.py:28` uses a blacklist `_INTERACTIVE_TOOL_PATTERNS = {"ask_user", "approval"}` — any tool not matching these patterns is allowed, including dangerous tools like `run_python`, `file_write`, `git_commit`, `manage_mcp`. A headless self-improvement agent with no user interaction must be fail-closed: only explicitly whitelisted tools are available.

**Files:**
- Modify: `agent/autonomy/runner.py:27-39`
- Test: `tests/test_agent/test_autonomy_runner.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_agent/test_autonomy_runner.py`:

```python
class TestFilterInteractiveTools:
    def test_whitelisted_tools_retained(self):
        """白名单内工具被保留。"""
        from agent.autonomy.runner import _filter_tools_for_headless

        mock_tools = []
        for name in ["manage_skills", "system_diagnose", "rag_diagnose", "kb_search"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        result = _filter_tools_for_headless(mock_tools)
        assert len(result) == 4

    def test_dangerous_tools_filtered_out(self):
        """危险工具（run_python/file_write/git_commit）被过滤。"""
        from agent.autonomy.runner import _filter_tools_for_headless

        mock_tools = []
        for name in ["run_python", "file_write", "git_commit", "manage_mcp", "manage_skills"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        result = _filter_tools_for_headless(mock_tools)
        result_names = [getattr(t, "name", "") for t in result]
        assert "manage_skills" in result_names
        assert "run_python" not in result_names
        assert "file_write" not in result_names
        assert "git_commit" not in result_names
        assert "manage_mcp" not in result_names

    def test_interactive_tools_filtered_out(self):
        """交互工具（ask_user_*）被过滤。"""
        from agent.autonomy.runner import _filter_tools_for_headless

        mock_tools = []
        for name in ["ask_user_question", "ask_user_approval", "manage_skills"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        result = _filter_tools_for_headless(mock_tools)
        result_names = [getattr(t, "name", "") for t in result]
        assert "manage_skills" in result_names
        assert "ask_user_question" not in result_names
        assert "ask_user_approval" not in result_names

    def test_empty_input_returns_empty(self):
        """空输入返回空列表。"""
        from agent.autonomy.runner import _filter_tools_for_headless
        assert _filter_tools_for_headless([]) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_runner.py::TestFilterInteractiveTools -v`
Expected: FAIL with `ImportError: cannot import name '_filter_tools_for_headless'`

- [ ] **Step 3: Implement the whitelist**

Replace lines 27-39 in `agent/autonomy/runner.py`:

```python
# Headless 自改进 Agent 允许的工具白名单（fail-closed：仅这些工具可用）
# 安全原则：无用户交互的后台 Agent 只能诊断 + 管理 Skills，不能执行代码/写文件/改配置
_ALLOWED_HEADLESS_TOOLS: frozenset[str] = frozenset({
    "manage_skills",    # 创建/更新 Skills（核心自改进能力）
    "system_diagnose",  # 系统级故障诊断
    "rag_diagnose",     # RAG 故障诊断
    "kb_search",        # 知识库检索（查找已有文档）
})


def _filter_tools_for_headless(tools: list) -> list:
    """按白名单过滤工具（fail-closed：仅白名单内工具可用）。

    Headless 自改进 Agent 无用户交互，不能执行代码/写文件/改配置。
    只允许诊断工具和 Skills 管理工具。
    """
    return [t for t in tools if getattr(t, "name", "") in _ALLOWED_HEADLESS_TOOLS]
```

Also update the call site at line 134:
```python
# 获取工具列表并过滤交互工具
all_tools = getattr(app.state, "tools", []) or []
tools = _filter_tools_for_headless(all_tools)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_runner.py::TestFilterInteractiveTools -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run full runner test suite**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_runner.py -v`
Expected: PASS (all tests — existing tests use `app.state.tools = []` so filtering is a no-op)

- [ ] **Step 6: Commit**

```bash
git add agent/autonomy/runner.py tests/test_agent/test_autonomy_runner.py
git commit -m "fix(autonomy): replace tool blacklist with fail-closed whitelist

Headless self-improvement agent now only allows manage_skills,
system_diagnose, rag_diagnose, kb_search. Dangerous tools like
run_python, file_write, git_commit are blocked by default."
```

---

### Task 2: Fix prioritize_issues Dedup Bug

**Problem:** `diagnostics.py:143` — `not any(i["component"] == "tools" for i in issues)` checks already-added issues, not processed categories. Once the first low-priority category (count < 3) is added with `component="tools"`, ALL subsequent low-priority categories are silently dropped.

**Example:** `by_category = {"tool_error": 5, "file_error": 2, "network_error": 1}` → only `tool_error` (medium) is added; `file_error` and `network_error` are silently dropped because `any(i["component"] == "tools" ...)` is True after the first.

**Files:**
- Modify: `agent/autonomy/diagnostics.py:134-149`
- Test: `tests/test_agent/test_autonomy_diagnostics.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_agent/test_autonomy_diagnostics.py` in `TestPrioritizeIssues`:

```python
    def test_multiple_low_priority_categories_all_included(self):
        """多个低优先级类别（<3次）都被包含，不被静默丢弃。"""
        error_summary = ErrorSummary(
            total=4,
            by_category={"file_error": 2, "network_error": 1, "config_error": 1},
            recent_messages=["err1", "err2", "err3", "err4"],
        )
        health_summary = HealthSummary(overall_status="ok", degraded_components=[])
        issues = prioritize_issues(error_summary, health_summary)
        # 三个低优先级类别都应出现
        categories = [i["category"] for i in issues]
        assert "file_error" in categories
        assert "network_error" in categories
        assert "config_error" in categories
        assert len(issues) == 3
        for issue in issues:
            assert issue["priority"] == "low"

    def test_mixed_medium_and_low_priority_all_included(self):
        """中优先级（>=3次）和低优先级（<3次）混合时全部包含。"""
        error_summary = ErrorSummary(
            total=8,
            by_category={"tool_error": 5, "file_error": 2, "network_error": 1},
            recent_messages=["err"] * 8,
        )
        health_summary = HealthSummary(overall_status="ok", degraded_components=[])
        issues = prioritize_issues(error_summary, health_summary)
        categories = [i["category"] for i in issues]
        assert "tool_error" in categories
        assert "file_error" in categories
        assert "network_error" in categories
        # tool_error 是 medium，其余是 low
        for issue in issues:
            if issue["category"] == "tool_error":
                assert issue["priority"] == "medium"
            else:
                assert issue["priority"] == "low"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_diagnostics.py::TestPrioritizeIssues::test_multiple_low_priority_categories_all_included -v`
Expected: FAIL — only 1 issue returned instead of 3 (current bug silently drops subsequent categories)

- [ ] **Step 3: Fix the dedup logic**

Replace lines 134-149 in `agent/autonomy/diagnostics.py`:

```python
    # 中/低优先级：重复错误
    for category, count in error_summary.by_category.items():
        if count >= 3:
            issues.append({
                "priority": "medium",
                "component": "tools",
                "category": category,
                "description": f"类别 {category} 出现 {count} 次错误",
            })
        elif count > 0:
            issues.append({
                "priority": "low",
                "component": "tools",
                "category": category,
                "description": f"类别 {category} 出现 {count} 次错误",
            })
```

(删除 `not any(i["component"] == "tools" for i in issues)` 条件)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_diagnostics.py::TestPrioritizeIssues -v`
Expected: PASS (all tests including new ones)

- [ ] **Step 5: Commit**

```bash
git add agent/autonomy/diagnostics.py tests/test_agent/test_autonomy_diagnostics.py
git commit -m "fix(autonomy): prioritize_issues no longer silently drops low-priority categories

Removed faulty dedup condition that checked already-added issues instead
of processed categories. Each error category now gets its own issue
entry regardless of how many tools-component issues already exist."
```

---

### Task 3: Delete Unused Import + Fix chr(10) Literal

**Problem 1:** `diagnostics.py:13` — `from dataclasses import dataclass, field` imports `field` but neither `ErrorSummary` nor `HealthSummary` uses `field()`.

**Problem 2:** `runner.py:70` — `{chr(10).join(...)}` in f-string. While functionally correct (`chr(10)` evaluates to `"\n"`), it's an anti-pattern. Python 3.13 (PEP 701) allows `"\n"` directly in f-string expressions.

**Files:**
- Modify: `agent/autonomy/diagnostics.py:13`
- Modify: `agent/autonomy/runner.py:70`
- Test: `tests/test_agent/test_autonomy_runner_pure.py` (created in Task 11, but add one test here)

- [ ] **Step 1: Write the failing test for chr(10) fix**

Create `tests/test_agent/test_autonomy_runner_pure.py`:

```python
"""Runner 纯函数单元测试 — agent/autonomy/runner.py。"""
from agent.autonomy.runner import _build_self_improve_prompt


class TestBuildSelfImprovePrompt:
    def test_recent_messages_joined_by_newline(self):
        """最近错误消息由真实换行符连接，不是字面量 chr(10)。"""
        report = {
            "issues": [],
            "error_summary": {
                "total": 3,
                "by_category": {"tool_error": 3},
                "recent_messages": ["error one", "error two", "error three"],
            },
            "health_summary": {"overall_status": "ok", "degraded_components": []},
        }
        prompt = _build_self_improve_prompt(report)
        # 真实换行符应存在于消息之间
        assert "error one\nerror two" in prompt
        # 不应包含字面量 "chr(10)"
        assert "chr(10)" not in prompt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_runner_pure.py::TestBuildSelfImprovePrompt::test_recent_messages_joined_by_newline -v`
Expected: FAIL — `"chr(10)"` appears in the output (the f-string inserts `chr(10).join(...)` result which is newline-joined, BUT the test asserts `"chr(10)" not in prompt` which should PASS since `chr(10)` evaluates to newline... Wait — actually `chr(10).join(...)` produces newline-joined text, so `"chr(10)" not in prompt` would PASS. The test needs to verify the output is newline-joined, which it already is.

Actually, `chr(10)` evaluates to `"\n"` at runtime, so the current code already produces newlines. The test `assert "error one\nerror two" in prompt` would PASS with the current code. So this test doesn't fail — it's a style fix, not a behavior fix.

Let me adjust: the test verifies correct behavior (which already works), and the fix is purely stylistic. Run the test to confirm it passes with current code:

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_runner_pure.py::TestBuildSelfImprovePrompt::test_recent_messages_joined_by_newline -v`
Expected: PASS (behavior is already correct; fix is stylistic)

- [ ] **Step 3: Fix the unused import in diagnostics.py**

Change line 13 in `agent/autonomy/diagnostics.py`:

```python
from dataclasses import dataclass
```

(Remove `, field`)

- [ ] **Step 4: Fix the chr(10) literal in runner.py**

Change line 70 in `agent/autonomy/runner.py`:

```python
### 最近错误消息
{"\n".join(report.get('error_summary', {}).get('recent_messages', [])[:5])}
```

(Replace `chr(10)` with `"\n"`)

- [ ] **Step 5: Run all diagnostics + runner tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_diagnostics.py tests/test_agent/test_autonomy_runner.py tests/test_agent/test_autonomy_runner_pure.py -v`
Expected: PASS

- [ ] **Step 6: Verify no lint errors**

Run: `.venv\Scripts\python.exe -m pyflakes agent/autonomy/diagnostics.py agent/autonomy/runner.py`
Expected: No output (no warnings)

- [ ] **Step 7: Commit**

```bash
git add agent/autonomy/diagnostics.py agent/autonomy/runner.py tests/test_agent/test_autonomy_runner_pure.py
git commit -m "fix(autonomy): remove unused field import, replace chr(10) with newline

- diagnostics.py: remove unused 'field' from dataclasses import
- runner.py: replace chr(10).join() with \"\\n\".join() in f-string
  (PEP 701 allows backslashes in f-string expressions on Python 3.12+)"
```

---

### Task 4: Fix TableCard.vue XSS Vulnerability

**Problem:** `TableCard.vue:7` — `<div v-html="renderedTable">` renders unescaped HTML. Cell values from tool JSON output are injected directly via template literals (`<td>${c}</td>`). If a tool returns JSON containing `<script>`, it gets injected as live HTML.

**Files:**
- Modify: `web/src/components/workbench/cards/TableCard.vue`

- [ ] **Step 1: Rewrite the template to use Vue's text interpolation**

Replace the entire `<template>` and `<script>` sections of `web/src/components/workbench/cards/TableCard.vue`:

```vue
<template>
  <div class="canvas-card table-card">
    <div class="card-header">
      <span class="card-title">{{ card.title }}</span>
      <button class="card-remove" @click="$emit('remove')">&times;</button>
    </div>
    <div class="card-body">
      <table v-if="tableData">
        <thead>
          <tr>
            <th v-for="header in tableData.headers" :key="header">{{ header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in tableData.rows" :key="rowIndex">
            <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
      <pre v-else>{{ card.content }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CanvasCard } from '@/types/workbench'
import { computed } from 'vue'

const props = defineProps<{ card: CanvasCard }>()
defineEmits<{ remove: [] }>()

interface TableData {
  headers: string[]
  rows: string[][]
}

const tableData = computed<TableData | null>(() => {
  try {
    const data = JSON.parse(props.card.content)
    if (Array.isArray(data) && data.length > 0) {
      const headers = Object.keys(data[0])
      const rows = data.map((row: Record<string, unknown>) =>
        headers.map(h => String(row[h] ?? ''))
      )
      return { headers, rows }
    }
  } catch {
    /* not JSON — fall through to <pre> */
  }
  return null
})
</script>
```

Keep the existing `<style scoped>` section unchanged.

- [ ] **Step 2: Verify the build**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No type errors for TableCard.vue

- [ ] **Step 3: Run frontend lint**

Run: `cd web && npx eslint src/components/workbench/cards/TableCard.vue`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/components/workbench/cards/TableCard.vue
git commit -m "fix(workbench): replace v-html with Vue template rendering in TableCard

Eliminates XSS vulnerability where tool JSON containing <script> tags
would be injected as live HTML. Vue's text interpolation {{ }}
automatically escapes content."
```

---

### Task 5: Unify Health Status Vocabulary

**Problem:** `ComponentHealth.status` uses `Literal["ok", "error"]` but `check_health_sync` returns `"degraded"` for component statuses. `collect_health_summary` checks for `"degraded"` but not `"error"`. This means:
1. `check_health_sync` output doesn't conform to `ComponentHealth` schema
2. Async health checks returning `"error"` are not detected as degraded by `collect_health_summary`

**Files:**
- Modify: `api/health.py:19-20`
- Modify: `agent/autonomy/diagnostics.py:97-100`
- Test: `tests/test_agent/test_autonomy_diagnostics.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_agent/test_autonomy_diagnostics.py` in `TestHealthSummary`:

```python
    def test_error_status_treated_as_degraded(self):
        """组件 status='error' 也应被视为降级。"""
        health_data = {
            "status": "degraded",
            "llm": {"status": "error"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "degraded"},
        }
        summary = collect_health_summary(health_data)
        assert "llm" in summary.degraded_components
        assert "mcp_tools" in summary.degraded_components
        assert "memory" not in summary.degraded_components
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_diagnostics.py::TestHealthSummary::test_error_status_treated_as_degraded -v`
Expected: FAIL — `"llm"` not in `degraded_components` (current code only checks for `"degraded"`, not `"error"`)

- [ ] **Step 3: Fix collect_health_summary**

Change lines 97-100 in `agent/autonomy/diagnostics.py`:

```python
    for component in ("llm", "memory", "native_tools", "mcp_tools"):
        comp_data = health_data.get(component, {})
        if isinstance(comp_data, dict) and comp_data.get("status") != "ok":
            degraded.append(component)
```

(Replace `comp_data.get("status") == "degraded"` with `comp_data.get("status") != "ok"` — any non-ok status is degraded)

- [ ] **Step 4: Add "degraded" to ComponentHealth Literal**

Change line 20 in `api/health.py`:

```python
class ComponentHealth(BaseModel):
    status: Literal["ok", "degraded", "error"]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_diagnostics.py -v`
Expected: PASS

- [ ] **Step 6: Run health-related tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_health.py -v` (if exists)
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add api/health.py agent/autonomy/diagnostics.py tests/test_agent/test_autonomy_diagnostics.py
git commit -m "fix(health): unify status vocabulary to ok/degraded/error

- ComponentHealth.status now includes 'degraded' in Literal type
- collect_health_summary treats any non-'ok' status as degraded
- Fixes: async checks returning 'error' were not detected as degraded
  by the autonomy diagnostic layer"
```

---

### Task 6: Fix Test Mock APIs + Tautological Patches

**Problem 1:** `test_autonomy_scheduler.py` — 3 occurrences of `mock_collector.get_errors.return_value` should be `get_all`. Tests pass only because MagicMock auto-creates `get_all()` returning an empty iterable, silently dropping error data.

**Problem 2:** `test_autonomy_runner.py:58` — `test_creates_and_deletes_session` patches `_extract_final_answer` and then asserts the patch's return value. Real extraction logic has zero coverage.

**Files:**
- Modify: `tests/test_agent/test_autonomy_scheduler.py:103,126,151`
- Modify: `tests/test_agent/test_autonomy_runner.py:45-67`

- [ ] **Step 1: Fix scheduler test mock APIs**

In `tests/test_agent/test_autonomy_scheduler.py`, replace all 3 occurrences of:

```python
mock_collector.get_errors.return_value = [...]
```

with:

```python
mock_collector.get_all.return_value = [...]
```

The 3 occurrences are at:
- Line 103: `mock_collector.get_errors.return_value = []`
- Line 126: `mock_collector.get_errors.return_value = [{"category": "llm_error", ...}]`
- Line 151: `mock_collector.get_errors.return_value = [{"category": "llm_error", ...}]`

- [ ] **Step 2: Fix runner tautological patch**

In `tests/test_agent/test_autonomy_runner.py`, update `test_creates_and_deletes_session`:

```python
    @pytest.mark.asyncio
    async def test_creates_and_deletes_session(self, mock_app, sample_report):
        """runner 创建临时会话并在完成后删除。"""
        mock_session = MagicMock()
        mock_session.session_id = "test-session-123"
        mock_session.checkpointer = MagicMock()
        mock_app.state.session_manager.create.return_value = mock_session

        # 构建真实 AI 消息（type='ai'），让 _extract_final_answer 走主路径
        mock_msg = MagicMock()
        mock_msg.content = "Self-improvement complete"
        mock_msg.type = "ai"

        mock_graph = MagicMock()
        mock_graph.ainvoke = AsyncMock(return_value={
            "messages": [mock_msg]
        })

        with patch("agent.autonomy.runner.build_agent", return_value=mock_graph):
            result = await run_self_improvement_agent(
                app=mock_app,
                diagnostic_report=sample_report,
                timeout=30,
            )

            mock_app.state.session_manager.create.assert_called_once()
            mock_app.state.session_manager.delete.assert_called_once_with("test-session-123")
            assert "Self-improvement" in result
```

Key change: removed `patch("agent.autonomy.runner._extract_final_answer", ...)`, added `mock_msg.type = "ai"` so the real `_extract_final_answer` runs through its main path.

- [ ] **Step 3: Run scheduler tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_scheduler.py -v`
Expected: PASS — now `get_all()` returns the mock data, error_summary correctly populates

- [ ] **Step 4: Run runner tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_runner.py -v`
Expected: PASS — real `_extract_final_answer` extracts "Self-improvement complete" via main path

- [ ] **Step 5: Commit**

```bash
git add tests/test_agent/test_autonomy_scheduler.py tests/test_agent/test_autonomy_runner.py
git commit -m "test(autonomy): fix mock APIs and remove tautological patches

- scheduler tests: get_errors → get_all (matches real ErrorCollector API)
- runner test: remove _extract_final_answer patch, set msg.type='ai'
  so real extraction logic is exercised instead of asserting a mock's
  return value"
```

---

## Phase 2: Dead Code + Redundancy (Tasks 7-10)

### Task 7: Delete Dead query_rewriter Module + Dead Flag

**Problem:** `memory/kb/query_rewriter.py` is never imported by the retrieval pipeline. The `query_rewrite_enabled` flag in `config/settings.py` is defined and tested but never read by any business logic. `build_query_rewriter_prompt()` in `agent/prompts.py` is only imported by the dead `query_rewriter.py`.

**Files:**
- Delete: `memory/kb/query_rewriter.py`
- Delete: `tests/test_memory/test_kb_query_rewriter.py`
- Modify: `config/settings.py:119-120` (remove flag)
- Modify: `agent/prompts.py:606-629` (remove function)
- Modify: `tools/system/tool_rag_diagnose.py:28` (update text reference)
- Modify: `tests/test_config_settings.py:69-73` (remove test)

- [ ] **Step 1: Delete the dead module and its test**

```bash
git rm memory/kb/query_rewriter.py
git rm tests/test_memory/test_kb_query_rewriter.py
```

- [ ] **Step 2: Remove the dead flag from settings.py**

In `config/settings.py`, remove these 2 lines (around line 119-120):

```python
    # 查询重写：对话式查询在 embed 前重写为自包含查询
    query_rewrite_enabled: bool = False
```

- [ ] **Step 3: Remove build_query_rewriter_prompt from prompts.py**

In `agent/prompts.py`, delete the entire `build_query_rewriter_prompt()` function (lines 606-629).

- [ ] **Step 4: Update rag_diagnose text reference**

In `tools/system/tool_rag_diagnose.py` line 28, change:

```python
        "fix": "启用查询重写（query_rewrite_enabled），将对话式查询重写为自包含查询后再 embed。",
```

to:

```python
        "fix": "将对话式查询重写为自包含查询后再 embed（补全指代词、添加上下文）。",
```

- [ ] **Step 5: Remove the dead flag test**

In `tests/test_config_settings.py`, remove the test method `test_query_rewrite_enabled_defaults_off` (around lines 69-73).

- [ ] **Step 6: Run config tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_config_settings.py -v`
Expected: PASS

- [ ] **Step 7: Verify no broken imports**

Run: `.venv\Scripts\python.exe -c "from memory.kb import retriever; print('OK')"`
Expected: `OK`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: delete dead query_rewriter module and query_rewrite_enabled flag

query_rewriter.py was never wired into the retrieval pipeline.
query_rewrite_enabled was defined but never read by any business logic.
build_query_rewriter_prompt in prompts.py was only used by the dead module."
```

---

### Task 8: Delete Dead WorkbenchState Type + clearCards Function

**Problem:** `WorkbenchState` interface in `web/src/types/workbench.ts:46-53` is never imported. `clearCards()` in `useWorkbench.ts:65-67` is defined and exported but never called from any component.

**Files:**
- Modify: `web/src/types/workbench.ts:45-53`
- Modify: `web/src/composables/useWorkbench.ts:65-67,120`

- [ ] **Step 1: Remove WorkbenchState interface**

In `web/src/types/workbench.ts`, delete lines 45-53:

```typescript
/** 工作台状态 */
export interface WorkbenchState {
  /** 面板是否展开 */
  isOpen: boolean
  /** 当前标签页 */
  activeTab: WorkbenchTab
  /** Canvas 卡片列表 */
  cards: CanvasCard[]
}
```

- [ ] **Step 2: Remove clearCards function**

In `web/src/composables/useWorkbench.ts`:

Delete lines 65-67:
```typescript
  function clearCards() {
    cards.value = []
  }
```

Delete line 120 (the export):
```typescript
    clearCards,
```

- [ ] **Step 3: Verify no broken imports**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No errors (nothing imports WorkbenchState or calls clearCards)

- [ ] **Step 4: Commit**

```bash
git add web/src/types/workbench.ts web/src/composables/useWorkbench.ts
git commit -m "refactor(workbench): delete dead WorkbenchState type and clearCards function

WorkbenchState was never imported anywhere. clearCards was exported but
never called from any component."
```

---

### Task 9: Extract Diagnose Tool Shared Base Class

**Problem:** `tool_system_diagnose.py` and `tool_rag_diagnose.py` have near-identical structure: a patterns dict, a `diagnose_*` function with identical scoring logic, an Input model, and a Tool class with identical `_run` method. This is copy-paste duplication.

**Files:**
- Create: `tools/base_diagnose.py`
- Modify: `tools/system/tool_system_diagnose.py`
- Modify: `tools/system/tool_rag_diagnose.py`
- Test: `tests/test_tools/test_base_diagnose.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_tools/test_base_diagnose.py`:

```python
"""共享诊断基类测试 — tools/base_diagnose.py。"""
import pytest
from tools.base_diagnose import diagnose_by_patterns, DiagnoseToolBase


class TestDiagnoseByPatterns:
    def test_best_match_returned(self):
        """返回得分最高的模式。"""
        patterns = {
            "A01": {"name": "Pattern A", "symptoms": ["alpha", "beta"], "fix": "Fix A"},
            "A02": {"name": "Pattern B", "symptoms": ["gamma"], "fix": "Fix B"},
            "A99": {"name": "Uncategorized", "symptoms": [], "fix": "Generic fix"},
        }
        result = diagnose_by_patterns("alpha beta problem", patterns, "A99")
        assert result["primary_pattern"] == "A01"
        assert result["pattern_name"] == "Pattern A"
        assert result["minimal_fix"] == "Fix A"
        assert result["confidence"] == 1.0

    def test_fallback_when_no_match(self):
        """无匹配时返回 fallback 模式。"""
        patterns = {
            "A01": {"name": "Pattern A", "symptoms": ["alpha"], "fix": "Fix A"},
            "A99": {"name": "Uncategorized", "symptoms": [], "fix": "Generic fix"},
        }
        result = diagnose_by_patterns("completely unrelated text", patterns, "A99")
        assert result["primary_pattern"] == "A99"
        assert result["confidence"] == 0.0

    def test_case_insensitive(self):
        """匹配不区分大小写。"""
        patterns = {
            "A01": {"name": "Pattern A", "symptoms": ["timeout"], "fix": "Fix A"},
            "A99": {"name": "Uncategorized", "symptoms": [], "fix": "Generic fix"},
        }
        result = diagnose_by_patterns("TIMEOUT occurred", patterns, "A99")
        assert result["primary_pattern"] == "A01"

    def test_partial_match(self):
        """部分匹配返回归一化置信度。"""
        patterns = {
            "A01": {"name": "Pattern A", "symptoms": ["alpha", "beta", "gamma"], "fix": "Fix A"},
            "A99": {"name": "Uncategorized", "symptoms": [], "fix": "Generic fix"},
        }
        result = diagnose_by_patterns("alpha problem", patterns, "A99")
        assert result["primary_pattern"] == "A01"
        assert result["confidence"] == round(1 / 3, 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_base_diagnose.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tools.base_diagnose'`

- [ ] **Step 3: Create the shared base module**

Create `tools/base_diagnose.py`:

```python
"""共享诊断工具基类 — 提取 tool_system_diagnose 和 tool_rag_diagnose 的公共逻辑。

职责：
- diagnose_by_patterns: 纯函数，按症状关键词匹配诊断模式
- DiagnoseToolBase: ToolBase 子类，封装统一的 _run 逻辑

用法：
    from tools.base_diagnose import diagnose_by_patterns, DiagnoseToolBase

    PATTERNS = {"S01": {"name": "...", "symptoms": [...], "fix": "..."}, ...}

    def diagnose(text: str) -> dict:
        return diagnose_by_patterns(text, PATTERNS, "S99")

    class MyDiagnoseTool(DiagnoseToolBase):
        name = "my_diagnose"
        description = "..."
        args_schema = MyInput
        _patterns = PATTERNS
        _fallback_key = "S99"
"""
from __future__ import annotations

from pydantic import BaseModel

from tools.base import ToolBase, format_error, format_success


def diagnose_by_patterns(
    failure_description: str,
    patterns: dict[str, dict],
    fallback_key: str,
) -> dict:
    """按症状关键词匹配诊断模式。

    Args:
        failure_description: 故障描述文本
        patterns: 诊断模式数据库，格式 {"key": {"name": str, "symptoms": list[str], "fix": str}}
        fallback_key: 无匹配时的回退模式 key

    Returns:
        {"primary_pattern": str, "pattern_name": str, "minimal_fix": str, "confidence": float}
    """
    text = failure_description.lower()

    best_match = fallback_key
    best_score = 0.0

    for key, pattern in patterns.items():
        score = 0
        for symptom in pattern["symptoms"]:
            if symptom.lower() in text:
                score += 1
        max_possible = max(len(pattern["symptoms"]), 1)
        normalized = score / max_possible
        if normalized > best_score:
            best_score = normalized
            best_match = key

    pattern = patterns[best_match]
    return {
        "primary_pattern": best_match,
        "pattern_name": pattern["name"],
        "minimal_fix": pattern["fix"],
        "confidence": round(best_score, 2),
    }


class DiagnoseToolBase(ToolBase):
    """诊断工具共享基类。

    子类需设置：
    - name: 工具名
    - description: 工具描述
    - args_schema: 输入参数模型（需有 failure_description: str 字段）
    - _patterns: 诊断模式数据库 dict
    - _fallback_key: 无匹配时的回退 key
    """
    _patterns: dict[str, dict] = {}
    _fallback_key: str = ""

    def _run(self, failure_description: str = "") -> str:
        if not failure_description.strip():
            return format_error("failure_description 不能为空")

        result = diagnose_by_patterns(
            failure_description, self._patterns, self._fallback_key
        )

        formatted = (
            f"诊断模式: {result['primary_pattern']} - {result['pattern_name']}\n"
            f"置信度: {result['confidence']}\n"
            f"修复建议: {result['minimal_fix']}"
        )

        return format_success({
            "primary_pattern": result["primary_pattern"],
            "pattern_name": result["pattern_name"],
            "minimal_fix": result["minimal_fix"],
            "confidence": result["confidence"],
            "formatted": formatted,
        })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_base_diagnose.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Refactor tool_system_diagnose.py to use the base**

Replace the entire content of `tools/system/tool_system_diagnose.py`:

```python
"""系统级故障诊断工具 — 将系统故障描述映射到 S01-S08 诊断模式。

来源：autonomy layer 的 self-diagnosis 能力，扩展自 rag_diagnose 的 P01-P12 模式。
职责：输入故障描述，返回最匹配的诊断模式 + 最小修复建议。
纯规则匹配，不调用 LLM、不依赖外部服务。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from tools.base import register_tool
from tools.base_diagnose import DiagnoseToolBase, diagnose_by_patterns


# ── S01-S08 系统诊断模式数据库 ──
SYSTEM_FAILURE_PATTERNS: dict[str, dict] = {
    "S01": {
        "name": "LLM Provider 不可用",
        "symptoms": ["llm 不可用", "未配置", "provider 不可用", "llm is none", "模型未加载", "runtime 未初始化"],
        "fix": "检查 providers.yaml 配置；确认 API key 有效；通过 Web UI 添加至少一个 provider；重启后端等待 LLM 后台初始化完成。",
    },
    "S02": {
        "name": "LLM API 超时/限流",
        "symptoms": ["超时", "timeout", "限流", "rate limit", "429", "503", "api 请求失败", "连接重置"],
        "fix": "检查网络连接；降低请求频率；确认 API 额度未耗尽；尝试切换到其他 provider 或模型。",
    },
    "S03": {
        "name": "工具执行错误",
        "symptoms": ["工具", "tool", "执行失败", "run_python", "报错", "工具调用", "tool error"],
        "fix": "检查工具输入参数；确认依赖环境（Python 包、文件路径）正确；查看 tool_error 详细日志；使用 system_diagnose 进一步定位。",
    },
    "S04": {
        "name": "Provider 认证/配置错误",
        "symptoms": ["api key", "认证失败", "401", "403", "unauthorized", "无效", "key 无效", "配置错误"],
        "fix": "通过 Web UI 重新配置 provider API key；确认 key 未过期；检查 base_url 是否正确；确认模型名称拼写正确。",
    },
    "S05": {
        "name": "记忆/向量库错误",
        "symptoms": ["记忆", "memory", "chromadb", "向量库", "embedding", "upsert", "collection"],
        "fix": "检查 ChromaDB 进程状态；确认 embedding 模型已加载；使用 rag_diagnose 工具进一步诊断 RAG 问题；检查磁盘空间。",
    },
    "S06": {
        "name": "Agent 死循环",
        "symptoms": ["死循环", "loop", "反复调用", "重复", "recursion", "循环检测", "同一工具"],
        "fix": "调整 loop_detection_threshold（默认 3）；检查工具输出是否导致 Agent 误判；优化系统提示词减少循环倾向；降低 recursion_limit。",
    },
    "S07": {
        "name": "会话/连接错误",
        "symptoms": ["websocket", "ws", "连接断开", "session", "会话", "断开", "disconnect", "4001"],
        "fix": "检查网络稳定性；确认 Token 未过期；查看 ws_registry 日志；重启后端恢复连接。",
    },
    "S08": {
        "name": "未分类系统故障",
        "symptoms": [],
        "fix": "查看 /api/diagnostics/error-log 获取详细错误信息；检查 maxma.log 日志文件；确认 Python 版本和依赖包版本；重启后端。",
    },
}


def diagnose_system_failure(failure_description: str) -> dict:
    """诊断系统故障，返回最匹配的模式。"""
    return diagnose_by_patterns(failure_description, SYSTEM_FAILURE_PATTERNS, "S08")


class SystemDiagnoseInput(BaseModel):
    """system_diagnose 输入参数"""
    failure_description: str = Field(
        description="系统故障的描述（错误信息、症状、复现步骤等）",
    )


@register_tool
class SystemDiagnoseTool(DiagnoseToolBase):
    """系统级故障诊断工具：将系统故障描述映射到 S01-S08 诊断模式 + 最小修复建议。"""

    name: str = "system_diagnose"
    description: str = (
        "诊断系统级故障。输入故障描述，返回最匹配的 S01-S08 诊断模式、"
        "模式名称、最小修复建议和置信度。"
        "当用户报告系统错误、LLM 不可用、工具失败、provider 问题时使用。"
        "[调用积极性: 用户报告系统级问题时主动调用] [get_doc: 无]"
    )
    args_schema: type[BaseModel] = SystemDiagnoseInput
    _patterns = SYSTEM_FAILURE_PATTERNS
    _fallback_key = "S08"
```

- [ ] **Step 6: Refactor tool_rag_diagnose.py similarly**

Replace the entire content of `tools/system/tool_rag_diagnose.py` (keep `RAG_FAILURE_PATTERNS` dict, replace function + class):

```python
"""RAG 失败诊断工具 — 将故障描述映射到 P01-P12 诊断模式。

来源：rag_failure_diagnostics_clinic 的 12 模式分类法。
职责：输入故障描述，返回最匹配的诊断模式 + 最小修复建议。
纯规则匹配，不调用 LLM、不依赖向量库。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from tools.base import register_tool
from tools.base_diagnose import DiagnoseToolBase, diagnose_by_patterns


# ── P01-P12 诊断模式数据库 ──
RAG_FAILURE_PATTERNS: dict[str, dict] = {
    "P01": {
        "name": "检索零结果",
        "symptoms": ["空结果", "没有匹配", "零结果", "无返回", "count=0", "找不到"],
        "fix": "检查知识库是否为空；确认 embedding 引擎已加载；验证查询文本非空；检查 collection 是否正确创建。",
    },
    "P02": {
        "name": "对话式查询 embed 效果差",
        "symptoms": ["那个东西", "它支持", "之前聊的", "上下文", "指代", "代词"],
        "fix": "将对话式查询重写为自包含查询后再 embed（补全指代词、添加上下文）。",
    },
    "P03": {
        "name": "低相关度结果",
        "symptoms": ["不相关", "相似度低", "阈值过滤", "相关性差", "答非所问"],
        "fix": "启用 CRAG grading（crag_enabled）过滤不相关结果；或调高 threshold；考虑引入重排器。",
    },
    "P04": {
        "name": "切块过大",
        "symptoms": ["切块太大", "chunk size", "上下文过长", "截断", "overflow"],
        "fix": "减小 chunk_size（建议 500-800 tokens）；调整 chunk_overlap（建议 50-100 tokens）。",
    },
    "P05": {
        "name": "embedding 模型不匹配",
        "symptoms": ["embedding 模型", "维度不匹配", "model mismatch", "ONNX"],
        "fix": "确认查询和索引使用相同的 embedding 模型；检查 ONNX 模型版本一致性。",
    },
    "P06": {
        "name": "索引未更新",
        "symptoms": ["索引过期", "未更新", "stale", "新文档没搜到", "添加后搜不到"],
        "fix": "确认文档添加后 index 已刷新；检查 upsert 是否成功；验证 collection.count() 增加。",
    },
    "P07": {
        "name": "查询过短或过长",
        "symptoms": ["查询太短", "查询太长", "单字查询", "超长查询"],
        "fix": "对过短查询添加上下文；对过长查询提取关键词；设置查询长度上下限。",
    },
    "P08": {
        "name": "阈值设置不当",
        "symptoms": ["阈值", "threshold", "过滤太严", "过滤太松"],
        "fix": "调整 threshold：0.2-0.4 适合宽松检索，0.5-0.7 适合精确匹配；或启用 CRAG grading 替代硬阈值。",
    },
    "P09": {
        "name": "top_k 过小或过大",
        "symptoms": ["top_k", "结果太少", "结果太多"],
        "fix": "调整 top_k：3-5 适合精确问答，10-20 适合研究型查询；CRAG 场景建议 top_k=20 召回 + grading 筛选。",
    },
    "P10": {
        "name": "ChromaDB 元数据类型错误",
        "symptoms": ["元数据", "metadata", "嵌套字典", "upsert 失败", "scalar", "标量"],
        "fix": "ChromaDB metadata 值必须是标量类型（str/int/float/bool/None）；嵌套字典会导致 upsert 失败，需扁平化或 JSON 序列化。",
    },
    "P11": {
        "name": "代理拦截本地请求",
        "symptoms": ["代理", "proxy", "localhost", "127.0.0.1", "连接失败", "timeout", "Clash", "V2Ray"],
        "fix": "设置 NO_PROXY=127.0.0.1,localhost,::1；或在 HTTP 客户端配置 .no_proxy()；关闭 Clash/V2Ray 测试。",
    },
    "P12": {
        "name": "未分类故障",
        "symptoms": [],
        "fix": "检查日志获取详细错误信息；确认 chromadb/onnxruntime 版本；验证 .venv 隔离环境；参考 rag_failure_diagnostics_clinic 文档。",
    },
}


def diagnose_failure(failure_description: str) -> dict:
    """诊断 RAG 故障，返回最匹配的模式。"""
    return diagnose_by_patterns(failure_description, RAG_FAILURE_PATTERNS, "P12")


class RagDiagnoseInput(BaseModel):
    """rag_diagnose 输入参数"""
    failure_description: str = Field(
        description="RAG 故障的描述（症状、错误信息、复现步骤等）",
    )


@register_tool
class RagDiagnoseTool(DiagnoseToolBase):
    """RAG 失败诊断工具：将故障描述映射到 P01-P12 诊断模式 + 最小修复建议。"""

    name: str = "rag_diagnose"
    description: str = (
        "诊断 RAG 检索故障。输入故障描述，返回最匹配的 P01-P12 诊断模式、"
        "模式名称、最小修复建议和置信度。"
        "当用户报告知识库检索问题、RAG 质量差、向量库错误时使用。"
        "[调用积极性: 用户报告检索/向量库问题时主动调用] [get_doc: 无]"
    )
    args_schema: type[BaseModel] = RagDiagnoseInput
    _patterns = RAG_FAILURE_PATTERNS
    _fallback_key = "P12"
```

- [ ] **Step 7: Run existing diagnose tool tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_system_diagnose.py tests/test_tools/test_rag_diagnose.py tests/test_tools/test_base_diagnose.py -v`
Expected: PASS (if existing tests exist and pass)

- [ ] **Step 8: Run full test suite to verify no regressions**

Run: `.venv\Scripts\python.exe -m pytest tests/ -x -q`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add tools/base_diagnose.py tools/system/tool_system_diagnose.py tools/system/tool_rag_diagnose.py tests/test_tools/test_base_diagnose.py
git commit -m "refactor(tools): extract shared DiagnoseToolBase from system/rag diagnose tools

DRY: tool_system_diagnose and tool_rag_diagnose had identical scoring
logic and _run methods. Extracted diagnose_by_patterns() pure function
and DiagnoseToolBase class to tools/base_diagnose.py."
```

---

### Task 10: Delete ToolBubbleRouter console.log

**Problem:** `ToolBubbleRouter.vue:26` — `console.log('[ToolBubbleRouter] toolCall:', ...)` fires on every tool call in production, cluttering the browser console. This is debug leftover.

**Files:**
- Modify: `web/src/components/ToolBubbleRouter.vue:24-32`

- [ ] **Step 1: Remove the console.log**

In `web/src/components/ToolBubbleRouter.vue`, change the `bubbleComponent` computed:

```typescript
const bubbleComponent = computed(() => {
  return getBubbleComponent(props.toolCall.name)
})
```

(Remove the `console.log` and the `const comp =` intermediate variable)

- [ ] **Step 2: Verify build**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ToolBubbleRouter.vue
git commit -m "fix(frontend): remove debug console.log from ToolBubbleRouter

The console.log fired on every tool call in production, cluttering the
browser console with per-render noise."
```

---

## Phase 3: Tests + Frontend + Ops (Tasks 11-15)

### Task 11: Runner Pure Function Unit Tests

**Problem:** `_build_self_improve_prompt` and `_extract_final_answer` have no direct unit tests. The existing runner tests only cover `run_self_improvement_agent` (the async orchestrator), not the pure helper functions.

**Files:**
- Modify: `tests/test_agent/test_autonomy_runner_pure.py` (created in Task 3, extend it)

- [ ] **Step 1: Write the tests**

Add to `tests/test_agent/test_autonomy_runner_pure.py`:

```python
"""Runner 纯函数单元测试 — agent/autonomy/runner.py。"""
import pytest
from unittest.mock import MagicMock

from agent.autonomy.runner import (
    _build_self_improve_prompt,
    _extract_final_answer,
    _filter_tools_for_headless,
)


class TestBuildSelfImprovePrompt:
    def test_prompt_contains_diagnostic_sections(self):
        """提示词包含诊断报告各部分。"""
        report = {
            "issues": [
                {"priority": "high", "component": "llm", "description": "LLM down"},
            ],
            "error_summary": {
                "total": 3,
                "by_category": {"tool_error": 3},
                "recent_messages": ["err1", "err2", "err3"],
            },
            "health_summary": {"overall_status": "degraded", "degraded_components": ["llm"]},
        }
        prompt = _build_self_improve_prompt(report)
        assert "自治自改进任务" in prompt
        assert "LLM down" in prompt
        assert "tool_error" in prompt
        assert "degraded" in prompt
        assert "llm" in prompt

    def test_prompt_with_empty_report(self):
        """空报告也能生成提示词。"""
        report = {}
        prompt = _build_self_improve_prompt(report)
        assert "自治自改进任务" in prompt
        assert "无错误" in prompt
        assert "无问题" in prompt

    def test_recent_messages_joined_by_newline(self):
        """最近错误消息由真实换行符连接，不是字面量 chr(10)。"""
        report = {
            "issues": [],
            "error_summary": {
                "total": 3,
                "by_category": {"tool_error": 3},
                "recent_messages": ["error one", "error two", "error three"],
            },
            "health_summary": {"overall_status": "ok", "degraded_components": []},
        }
        prompt = _build_self_improve_prompt(report)
        assert "error one\nerror two" in prompt
        assert "chr(10)" not in prompt

    def test_prompt_includes_task_instructions(self):
        """提示词包含任务指令。"""
        report = {}
        prompt = _build_self_improve_prompt(report)
        assert "manage_skills" in prompt
        assert "自治自改进模式" in prompt


class TestExtractFinalAnswer:
    def test_returns_ai_message_content(self):
        """返回 type='ai' 的消息内容。"""
        msg1 = MagicMock()
        msg1.content = "tool output"
        msg1.type = "tool"

        msg2 = MagicMock()
        msg2.content = "Final answer here"
        msg2.type = "ai"

        output = {"messages": [msg1, msg2]}
        result = _extract_final_answer(output)
        assert result == "Final answer here"

    def test_fallback_to_last_message_if_no_ai(self):
        """无 ai 消息时回退到最后一条。"""
        msg1 = MagicMock()
        msg1.content = "tool output 1"
        msg1.type = "tool"

        msg2 = MagicMock()
        msg2.content = "tool output 2"
        msg2.type = "tool"

        output = {"messages": [msg1, msg2]}
        result = _extract_final_answer(output)
        assert result == "tool output 2"

    def test_skips_empty_content(self):
        """跳过空内容消息。"""
        msg1 = MagicMock()
        msg1.content = ""
        msg1.type = "ai"

        msg2 = MagicMock()
        msg2.content = "Real answer"
        msg2.type = "ai"

        output = {"messages": [msg1, msg2]}
        result = _extract_final_answer(output)
        assert result == "Real answer"

    def test_empty_output_returns_empty_string(self):
        """空输出返回空字符串。"""
        assert _extract_final_answer({}) == ""
        assert _extract_final_answer({"messages": []}) == ""

    def test_non_string_content_skipped(self):
        """非字符串 content 被跳过。"""
        msg1 = MagicMock()
        msg1.content = {"key": "value"}  # dict, not str
        msg1.type = "ai"

        msg2 = MagicMock()
        msg2.content = "String answer"
        msg2.type = "ai"

        output = {"messages": [msg1, msg2]}
        result = _extract_final_answer(output)
        assert result == "String answer"

    def test_exception_returns_empty_string(self):
        """异常时返回空字符串。"""
        result = _extract_final_answer(None)
        assert result == ""


class TestFilterToolsForHeadless:
    def test_whitelisted_tools_retained(self):
        """白名单内工具被保留。"""
        mock_tools = []
        for name in ["manage_skills", "system_diagnose", "rag_diagnose", "kb_search"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        result = _filter_tools_for_headless(mock_tools)
        assert len(result) == 4

    def test_dangerous_tools_filtered_out(self):
        """危险工具被过滤。"""
        mock_tools = []
        for name in ["run_python", "file_write", "git_commit", "manage_mcp", "manage_skills"]:
            t = MagicMock()
            t.name = name
            mock_tools.append(t)

        result = _filter_tools_for_headless(mock_tools)
        result_names = [getattr(t, "name", "") for t in result]
        assert "manage_skills" in result_names
        assert "run_python" not in result_names
        assert "file_write" not in result_names

    def test_empty_input_returns_empty(self):
        """空输入返回空列表。"""
        assert _filter_tools_for_headless([]) == []
```

- [ ] **Step 2: Run tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_runner_pure.py -v`
Expected: PASS (all tests)

- [ ] **Step 3: Commit**

```bash
git add tests/test_agent/test_autonomy_runner_pure.py
git commit -m "test(autonomy): add pure function unit tests for runner helpers

Covers _build_self_improve_prompt (4 tests), _extract_final_answer
(6 tests), _filter_tools_for_headless (3 tests). Previously these
functions had zero direct test coverage."
```

---

### Task 12: system_diagnose Edge Case Tests

**Problem:** `system_diagnose` tool only has basic tests. Missing: multi-symptom matching, S01/S07 specific patterns, case insensitivity, fallback behavior.

**Files:**
- Create: `tests/test_tools/test_system_diagnose_edge.py`

- [ ] **Step 1: Write the tests**

Create `tests/test_tools/test_system_diagnose_edge.py`:

```python
"""system_diagnose 边界情况测试 — 验证 S01-S08 模式匹配。"""
import pytest

from tools.system.tool_system_diagnose import (
    SYSTEM_FAILURE_PATTERNS,
    diagnose_system_failure,
)


class TestSystemDiagnosePatterns:
    def test_s01_llm_unavailable(self):
        """S01: LLM Provider 不可用。"""
        result = diagnose_system_failure("LLM is none, provider 不可用")
        assert result["primary_pattern"] == "S01"
        assert result["confidence"] > 0

    def test_s01_runtime_not_initialized(self):
        """S01: runtime 未初始化。"""
        result = diagnose_system_failure("模型未加载，runtime 未初始化")
        assert result["primary_pattern"] == "S01"

    def test_s02_api_timeout(self):
        """S02: LLM API 超时。"""
        result = diagnose_system_failure("请求超时，429 rate limit")
        assert result["primary_pattern"] == "S02"

    def test_s07_websocket_disconnect(self):
        """S07: 会话/连接错误。"""
        result = diagnose_system_failure("websocket 连接断开，4001")
        assert result["primary_pattern"] == "S07"

    def test_s07_session_error(self):
        """S07: session 错误。"""
        result = diagnose_system_failure("session disconnect")
        assert result["primary_pattern"] == "S07"

    def test_s08_fallback_no_match(self):
        """S08: 无匹配时回退。"""
        result = diagnose_system_failure("一个完全不相关的描述 xyz123")
        assert result["primary_pattern"] == "S08"
        assert result["confidence"] == 0.0

    def test_case_insensitive(self):
        """匹配不区分大小写。"""
        result = diagnose_system_failure("TIMEOUT 429")
        assert result["primary_pattern"] == "S02"

    def test_multi_symptom_higher_score_wins(self):
        """多症状匹配时得分高的优先。"""
        # S03 有 7 个症状，匹配 "工具" + "tool" + "执行失败" = 3/7
        # S02 有 8 个症状，匹配 "timeout" = 1/8
        result = diagnose_system_failure("工具 tool 执行失败 timeout")
        # S03 score = 3/7 ≈ 0.43, S02 score = 1/8 = 0.125
        assert result["primary_pattern"] == "S03"

    def test_result_structure(self):
        """结果包含所有必要字段。"""
        result = diagnose_system_failure("LLM 不可用")
        assert "primary_pattern" in result
        assert "pattern_name" in result
        assert "minimal_fix" in result
        assert "confidence" in result
        assert isinstance(result["confidence"], float)

    def test_all_patterns_have_required_fields(self):
        """所有模式都有 name/symptoms/fix 字段。"""
        for key, pattern in SYSTEM_FAILURE_PATTERNS.items():
            assert "name" in pattern, f"{key} missing name"
            assert "symptoms" in pattern, f"{key} missing symptoms"
            assert "fix" in pattern, f"{key} missing fix"
            assert isinstance(pattern["symptoms"], list)
```

- [ ] **Step 2: Run tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_system_diagnose_edge.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_tools/test_system_diagnose_edge.py
git commit -m "test(tools): add system_diagnose edge case tests

Covers S01/S02/S03/S07/S08 patterns, case insensitivity, multi-symptom
score competition, result structure validation, and pattern DB integrity."
```

---

### Task 13: useWorkbench → Pinia Store Migration

**Problem:** `useWorkbench()` creates new `ref()` state on every call. `ChatView.vue:171` and `ReasoningTimeline.vue:48` each call `useWorkbench()`, getting independent states — toggling workbench in one component doesn't update the other.

**Files:**
- Create: `web/src/stores/workbench.ts`
- Modify: `web/src/views/ChatView.vue:154,171`
- Modify: `web/src/components/workbench/ReasoningTimeline.vue:42,48`

- [ ] **Step 1: Create the Pinia store**

Create `web/src/stores/workbench.ts`:

```typescript
/**
 * 工作台状态管理 — Pinia store（单例）。
 *
 * 职责：
 * - 管理 WorkbenchPanel 的展开/关闭、标签切换
 * - 管理 Canvas 卡片的增删
 * - 从 ChatTurn[] 派生 ReasoningEntry[] 时间线
 *
 * 不管理 WS 通信，不修改 ChatTurn 数据。纯前端状态。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ChatTurn } from '@/types'
import type { CanvasCard, CanvasCardType, ReasoningEntry, WorkbenchTab } from '@/types/workbench'

/** 最大保留的 turn 数量（推理时间线） */
const MAX_TURNS = 3

export const useWorkbenchStore = defineStore('workbench', () => {
  const isOpen = ref(false)
  const activeTab = ref<WorkbenchTab>('reasoning')
  const cards = ref<CanvasCard[]>([])

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function toggle() {
    isOpen.value = !isOpen.value
  }

  function setTab(tab: WorkbenchTab) {
    activeTab.value = tab
  }

  function addCard(params: {
    type: CanvasCardType
    title: string
    content: string
    sourceTool?: string
    sourceTurnId?: string
  }) {
    const card: CanvasCard = {
      id: crypto.randomUUID(),
      type: params.type,
      title: params.title,
      content: params.content,
      sourceTool: params.sourceTool,
      sourceTurnId: params.sourceTurnId,
      createdAt: Date.now(),
    }
    cards.value = [card, ...cards.value]
    open()
    setTab('canvas')
  }

  function removeCard(id: string) {
    cards.value = cards.value.filter(c => c.id !== id)
  }

  function buildReasoningTimeline(turns: ChatTurn[]): ReasoningEntry[] {
    const recentTurns = turns.slice(-MAX_TURNS)
    const entries: ReasoningEntry[] = []

    for (const turn of recentTurns) {
      for (const event of turn.events) {
        if (event.kind === 'thinking') {
          if (event.consumed) continue
          entries.push({
            id: `${turn.id}-thinking-${entries.length}`,
            kind: 'thinking',
            label: event.tokens.slice(0, 200),
            timestamp: Date.now(),
          })
        } else if (event.kind === 'tool') {
          entries.push({
            id: `${turn.id}-tool-${entries.length}`,
            kind: 'tool',
            label: event.input?.slice(0, 100) || '',
            toolName: event.name,
            status: event.status,
            elapsed: event.elapsed ?? undefined,
            timestamp: Date.now(),
          })
        }
      }
      if (turn.finalAnswer) {
        entries.push({
          id: `${turn.id}-answer`,
          kind: 'answer',
          label: turn.finalAnswer.slice(0, 200),
          timestamp: Date.now(),
        })
      }
    }

    return entries
  }

  return {
    isOpen,
    activeTab,
    cards,
    open,
    close,
    toggle,
    setTab,
    addCard,
    removeCard,
    buildReasoningTimeline,
  }
})
```

- [ ] **Step 2: Update ChatView.vue**

In `web/src/views/ChatView.vue`:

Replace line 154:
```typescript
import { useWorkbench } from '@/composables/useWorkbench'
```
with:
```typescript
import { useWorkbenchStore } from '@/stores/workbench'
```

Replace line 171:
```typescript
const workbench = useWorkbench()
```
with:
```typescript
const workbench = useWorkbenchStore()
```

- [ ] **Step 3: Update ReasoningTimeline.vue**

In `web/src/components/workbench/ReasoningTimeline.vue`:

Replace line 42:
```typescript
import { useWorkbench } from '@/composables/useWorkbench'
```
with:
```typescript
import { useWorkbenchStore } from '@/stores/workbench'
```

Replace line 48:
```typescript
const workbench = useWorkbench()
```
with:
```typescript
const workbench = useWorkbenchStore()
```

- [ ] **Step 4: Delete the old composable**

```bash
git rm web/src/composables/useWorkbench.ts
```

- [ ] **Step 5: Verify build**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add web/src/stores/workbench.ts web/src/views/ChatView.vue web/src/components/workbench/ReasoningTimeline.vue
git rm web/src/composables/useWorkbench.ts
git commit -m "refactor(frontend): migrate useWorkbench to Pinia store

Fixes non-singleton bug where ChatView and ReasoningTimeline had
independent states. Pinia store provides process-wide singleton state."
```

---

### Task 14: Scheduler Improvements

**Problem 1:** `scheduler.py:67` — `asyncio.get_event_loop()` is deprecated since Python 3.10. Since `start_autonomy` is called from async context (lifespan), should use `asyncio.get_running_loop()`.

**Problem 2:** No initial delay — scheduler immediately runs `_run_tick` on start, which may race with system initialization.

**Problem 3:** No status tracking — no way to query if scheduler is running, last tick time, or last report.

**Files:**
- Modify: `agent/autonomy/scheduler.py`
- Modify: `tests/test_agent/test_autonomy_scheduler.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_agent/test_autonomy_scheduler.py`:

```python
class TestSchedulerStatus:
    @pytest.mark.asyncio
    async def test_get_status_when_stopped(self):
        """调度器未启动时 status.running=False。"""
        from agent.autonomy.scheduler import get_autonomy_status
        status = get_autonomy_status()
        assert status["running"] is False
        assert status["last_tick_at"] is None

    @pytest.mark.asyncio
    async def test_get_status_when_running(self):
        """调度器启动后 status.running=True。"""
        from agent.autonomy import scheduler
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy, get_autonomy_status

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=1)
        await asyncio.sleep(0.1)

        status = get_autonomy_status()
        assert status["running"] is True
        assert "interval_seconds" in status

        await stop_autonomy()

    @pytest.mark.asyncio
    async def test_initial_delay_before_first_tick(self):
        """initial_delay 秒内不执行第一次 tick。"""
        from agent.autonomy import scheduler
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=10, initial_delay=5)
        await asyncio.sleep(0.2)

        # initial_delay=5, 短暂等待后不应有 tick 执行
        # (tick 会被 _get_error_collector 调用，如果执行了会有日志)
        # 验证：scheduler 记录的 _tick_count 应为 0
        assert scheduler._tick_count == 0

        await stop_autonomy()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_scheduler.py::TestSchedulerStatus -v`
Expected: FAIL with `ImportError: cannot import name 'get_autonomy_status'`

- [ ] **Step 3: Implement the improvements**

In `agent/autonomy/scheduler.py`:

Add module-level state variables after line 35:

```python
_scheduler_task: Optional[asyncio.Task] = None
_scheduler_loop: Optional[asyncio.AbstractEventLoop] = None

# 状态追踪（供 REST API 查询）
_last_tick_at: Optional[str] = None
_last_tick_report: Optional[dict] = None
_tick_count: int = 0
```

Change `start_autonomy` signature and implementation:

```python
def start_autonomy(
    app: Any,
    interval_seconds: int = 3600,
    self_improve_enabled: bool = False,
    initial_delay: int = 30,
) -> Optional[asyncio.Task]:
    """启动后台自治调度器。

    若已有任务在运行，先取消旧任务再启动新任务（幂等）。

    Args:
        app: FastAPI 应用实例（需 app.state.llm / app.state.session_manager）
        interval_seconds: 执行间隔（秒）
        self_improve_enabled: 是否允许自改进（创建/更新 Skills）
        initial_delay: 首次 tick 前的延迟（秒），让系统稳定

    Returns:
        已启动的 asyncio.Task，或 None（LLM 未就绪时）
    """
    global _scheduler_task, _scheduler_loop

    # 检查 LLM 是否就绪
    llm = getattr(app.state, "llm", None)
    if llm is None:
        logger.info("[autonomy] LLM 未就绪，调度器暂不启动")
        return None

    # 取消已有任务
    if _scheduler_task is not None and not _scheduler_task.done():
        _scheduler_task.cancel()

    _scheduler_loop = asyncio.get_running_loop()

    async def _autonomy_loop():
        global _last_tick_at, _last_tick_report, _tick_count
        logger.info(
            "[autonomy] 调度器已启动，间隔 %ds，自改进=%s，初始延迟 %ds",
            interval_seconds, self_improve_enabled, initial_delay,
        )
        # 初始延迟：让系统稳定后再开始诊断
        if initial_delay > 0:
            await asyncio.sleep(initial_delay)
        while True:
            try:
                report = await _run_tick(app, self_improve_enabled=self_improve_enabled)
                _last_tick_at = datetime.now().isoformat()
                _last_tick_report = report
                _tick_count += 1
            except asyncio.CancelledError:
                logger.info("[autonomy] 调度器被取消")
                break
            except Exception as e:
                logger.warning("[autonomy] tick 异常（不杀死循环）: %s", e)

            await asyncio.sleep(interval_seconds)

    _scheduler_task = _scheduler_loop.create_task(_autonomy_loop())
    return _scheduler_task
```

Add the `datetime` import at the top of the file:
```python
from datetime import datetime
```

Add `get_autonomy_status` function after `stop_autonomy`:

```python
def get_autonomy_status() -> dict:
    """获取调度器运行状态（供 REST API 查询）。"""
    running = _scheduler_task is not None and not _scheduler_task.done()
    return {
        "running": running,
        "last_tick_at": _last_tick_at,
        "last_tick_report_summary": (
            {
                "issues_count": len(_last_tick_report.get("issues", [])),
                "error_total": _last_tick_report.get("error_summary", {}).get("total", 0),
                "health_status": _last_tick_report.get("health_summary", {}).get("overall_status", "unknown"),
            }
            if _last_tick_report else None
        ),
        "tick_count": _tick_count,
        "interval_seconds": getattr(_scheduler_task, "_interval", None) if _scheduler_task else None,
    }
```

Update the `_reset_scheduler` fixture in `tests/test_agent/test_autonomy_scheduler.py`:

```python
@pytest.fixture(autouse=True)
def _reset_scheduler():
    """每个测试前后重置调度器状态。"""
    from agent.autonomy import scheduler
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None
    scheduler._last_tick_at = None
    scheduler._last_tick_report = None
    scheduler._tick_count = 0
    yield
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None
    scheduler._last_tick_at = None
    scheduler._last_tick_report = None
    scheduler._tick_count = 0
```

- [ ] **Step 4: Run tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_scheduler.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agent/autonomy/scheduler.py tests/test_agent/test_autonomy_scheduler.py
git commit -m "fix(autonomy): scheduler uses get_running_loop, adds initial delay + status

- Replace deprecated asyncio.get_event_loop() with get_running_loop()
- Add initial_delay parameter (default 30s) to let system stabilize
- Add get_autonomy_status() for monitoring (running, last_tick, count)"
```

---

### Task 15: Autonomy Status REST Endpoint

**Problem:** No way to check autonomy scheduler status from the frontend or monitoring tools. Need a REST endpoint.

**Files:**
- Modify: `api/server.py`
- Create: `tests/test_api/test_autonomy_status.py`
- Modify: `.env.example` (if exists)

- [ ] **Step 1: Write the failing test**

Create `tests/test_api/test_autonomy_status.py`:

```python
"""自治调度器状态 REST 端点测试。"""
import pytest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """创建测试客户端。"""
    from api.server import create_app
    app = create_app()
    return TestClient(app)


class TestAutonomyStatusEndpoint:
    def test_get_status_returns_200(self, client):
        """GET /api/autonomy/status 返回 200。"""
        with patch("agent.autonomy.scheduler._scheduler_task", None):
            response = client.get("/api/autonomy/status")
            assert response.status_code == 200

    def test_status_contains_required_fields(self, client):
        """状态包含 running/last_tick_at/tick_count 字段。"""
        with patch("agent.autonomy.scheduler._scheduler_task", None):
            response = client.get("/api/autonomy/status")
            data = response.json()
            assert "running" in data
            assert "last_tick_at" in data
            assert "tick_count" in data

    def test_status_when_stopped(self, client):
        """调度器未启动时 running=False。"""
        with patch("agent.autonomy.scheduler._scheduler_task", None):
            response = client.get("/api/autonomy/status")
            data = response.json()
            assert data["running"] is False
            assert data["last_tick_at"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_autonomy_status.py -v`
Expected: FAIL with 404 (endpoint doesn't exist)

- [ ] **Step 3: Add the endpoint**

In `api/server.py`, find the routes section and add:

```python
@app.get("/api/autonomy/status")
async def get_autonomy_status():
    """获取自治调度器运行状态。"""
    from agent.autonomy.scheduler import get_autonomy_status as _get_status
    return _get_status()
```

(Place this near other `/api/` routes. If there's a routes registration pattern, follow it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_autonomy_status.py -v`
Expected: PASS

- [ ] **Step 5: Update .env.example**

Check if `.env.example` exists. If it does, add autonomy settings:

```bash
# ── 自治层 ──
AUTONOMY_ENABLED=false
AUTONOMY_INTERVAL_SECONDS=3600
AUTONOMY_SELF_IMPROVE_ENABLED=false
AUTONOMY_MAX_AGENT_TIMEOUT=300
```

If `.env.example` doesn't exist, skip this step.

- [ ] **Step 6: Commit**

```bash
git add api/server.py tests/test_api/test_autonomy_status.py
git commit -m "feat(autonomy): add GET /api/autonomy/status REST endpoint

Returns running state, last tick time, tick count, and last report
summary. Enables frontend monitoring and external health checks."
```

---

## Self-Review

### 1. Spec Coverage

| Audit Finding | Task | Status |
|---|---|---|
| Runner tool blacklist insufficient (SECURITY) | Task 1 | Covered |
| prioritize_issues dedup silently drops categories (BUG) | Task 2 | Covered |
| diagnostics.py unused `field` import (QUALITY) | Task 3 | Covered |
| runner.py chr(10) anti-pattern (QUALITY) | Task 3 | Covered |
| TableCard.vue XSS (SECURITY) | Task 4 | Covered |
| Health status vocabulary mismatch (BUG) | Task 5 | Covered |
| Scheduler test mock API wrong (TEST) | Task 6 | Covered |
| Runner test tautological patch (TEST) | Task 6 | Covered |
| Dead query_rewriter module + flag (DEAD CODE) | Task 7 | Covered |
| Dead WorkbenchState type + clearCards (DEAD CODE) | Task 8 | Covered |
| Diagnose tool duplication (DRY) | Task 9 | Covered |
| ToolBubbleRouter console.log (CLEANUP) | Task 10 | Covered |
| Runner pure functions untested (TEST) | Task 11 | Covered |
| system_diagnose edge cases untested (TEST) | Task 12 | Covered |
| useWorkbench non-singleton (FRONTEND) | Task 13 | Covered |
| Scheduler get_event_loop deprecation + no delay (OPS) | Task 14 | Covered |
| No autonomy status endpoint (OPS) | Task 15 | Covered |

### 2. Placeholder Scan

No placeholders found — all steps contain complete code blocks.

### 3. Type Consistency

- `_filter_tools_for_headless` — used in Task 1 (definition) and Task 11 (test import). Name matches.
- `get_autonomy_status` — used in Task 14 (definition) and Task 15 (endpoint + test). Name matches.
- `useWorkbenchStore` — used in Task 13 (store definition + component imports). Name matches.
- `DiagnoseToolBase` — used in Task 9 (definition + subclasses). Name matches.
- `_ALLOWED_HEADLESS_TOOLS` — defined in Task 1, referenced in tests. Name matches.
