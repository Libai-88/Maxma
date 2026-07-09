# Autonomy Layer: Scheduled Agents + Self-Diagnosis + Self-Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a background autonomy scheduler to Maxma that periodically runs headless agent sessions for self-diagnosis (scan error logs + health checks + suggest fixes) and self-improvement (create/update skills based on observed patterns), all feature-flagged and backward-compatible.

**Architecture:** A new `agent/autonomy/scheduler.py` singleton (modeled after `memory/ttl.py`) runs an `asyncio.sleep` loop. Each tick reads from `api/diagnostics.py`'s `ErrorCollector` and `api/health.py` to produce a diagnostic summary, then optionally invokes a headless agent session (reusing the `_run_event_hook_action` pattern from `server.py`) with a self-improvement prompt. A new `tool_system_diagnose.py` extends the `rag_diagnose` pattern to system-level failures. Feature flags in `config/settings.py` gate each capability independently (all default off).

**Tech Stack:** Python 3.13, asyncio, FastAPI lifespan, pytest + pytest-asyncio + pytest-mock (matching Maxma's existing test stack).

---

## Scope Check

This plan covers **one cohesive subsystem: the autonomy scheduler** (periodic background self-diagnosis + self-improvement agent sessions). It produces working, testable software — the scheduler starts/stops cleanly, the diagnostic tool is independently invocable, and all existing tests pass when flags are off. The other layers (orchestration, retrieval, workbench) are already implemented in prior plans.

## File Structure

### New files

- `agent/autonomy/__init__.py` — Package init.
- `agent/autonomy/scheduler.py` — Singleton asyncio scheduler. One responsibility: run periodic ticks that trigger self-diagnosis and (optionally) self-improvement. Modeled after `memory/ttl.py`.
- `agent/autonomy/diagnostics.py` — Pure functions that collect diagnostic data from `ErrorCollector` + `api/health.py` and produce a structured summary. No I/O side effects (reads only).
- `agent/autonomy/runner.py` — Headless agent runner for self-improvement sessions. Wraps the `_run_event_hook_action` pattern: create session → build agent (no HITL) → invoke → cleanup.
- `tools/system/tool_system_diagnose.py` — System health diagnostics tool. Maps error patterns to diagnostic categories + fix suggestions. Extends the `rag_diagnose` pattern.
- `tests/test_agent/test_autonomy_scheduler.py` — Unit tests for the scheduler.
- `tests/test_agent/test_autonomy_diagnostics.py` — Unit tests for diagnostic functions.
- `tests/test_agent/test_autonomy_runner.py` — Unit tests for the headless runner.
- `tests/test_tools/test_system_diagnose.py` — Unit tests for the diagnostics tool.

### Modified files

- `config/settings.py` — Add `autonomy_enabled`, `autonomy_interval_seconds`, `autonomy_self_improve_enabled`, `autonomy_max_agent_timeout` flags (default off).
- `api/server.py` — Start/stop autonomy scheduler in lifespan (after hooks startup, before yield / after hooks stop).
- `tools/__init__.py` — Register `system_diagnose` in `TOOL_CATEGORIES["system"]`.

### Files NOT touched (boundary discipline)

- `agent/hooks.py` — no changes to the existing event hooks system (autonomy is separate)
- `memory/ttl.py` — no changes to the TTL scheduler (autonomy uses the same pattern but independently)
- `api/routes/` — no new REST routes in this plan (scheduler is config-driven, not API-driven; API routes can be a follow-up)
- `web/src/` — no frontend changes (autonomy runs in background; UI for viewing autonomy history is a follow-up)
- `desktop/src-tauri/` — no Tauri changes

---

## Task 1: Feature flags in settings

**Files:**
- Modify: `config/settings.py`
- Modify: `tests/test_config_settings.py`

Add feature flags for the autonomy layer, defaulting OFF for safe rollout.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_config_settings.py`:

```python
class TestAutonomyFlags:
    """自治层特性开关测试。"""

    def test_autonomy_enabled_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "autonomy_enabled")
        assert s.autonomy_enabled is False

    def test_autonomy_interval_default(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "autonomy_interval_seconds")
        assert s.autonomy_interval_seconds == 3600

    def test_autonomy_self_improve_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "autonomy_self_improve_enabled")
        assert s.autonomy_self_improve_enabled is False

    def test_autonomy_max_agent_timeout_default(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "autonomy_max_agent_timeout")
        assert s.autonomy_max_agent_timeout == 300
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_config_settings.py::TestAutonomyFlags -v`
Expected: FAIL — AttributeError

- [ ] **Step 3: Add fields to config/settings.py**

Find the retrieval flags block (where `rag_grade_threshold: float = 0.3` is, around line 122). Add after it:

```python
    # ── 自治层特性开关（默认关闭，安全滚动）──
    # 自治调度器：周期性后台自诊断 + 自改进
    autonomy_enabled: bool = False
    # 自治调度器执行间隔（秒），默认 1 小时
    autonomy_interval_seconds: int = 3600
    # 自改进：允许自治 Agent 创建/更新 Skills
    autonomy_self_improve_enabled: bool = False
    # 自治 Agent 单次执行最大超时（秒）
    autonomy_max_agent_timeout: int = 300
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_config_settings.py::TestAutonomyFlags -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run all config tests for regressions**

Run: `.venv\Scripts\python.exe -m pytest tests/test_config_settings.py -v`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add config/settings.py tests/test_config_settings.py
git commit -m "feat(config): add autonomy layer feature flags (default off)"
```

---

## Task 2: Diagnostic data collection (pure functions)

**Files:**
- Create: `agent/autonomy/__init__.py`
- Create: `agent/autonomy/diagnostics.py`
- Test: `tests/test_agent/test_autonomy_diagnostics.py`

Pure functions that collect diagnostic data from existing sources (ErrorCollector, health endpoint) and produce a structured summary. No I/O side effects — just reads and transforms.

- [ ] **Step 1: Create the package init**

Create `agent/autonomy/__init__.py` (empty file):

```python
"""自治层 — 后台自诊断 + 自改进调度。"""
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_agent/test_autonomy_diagnostics.py`:

```python
"""自治层诊断函数单元测试 — agent/autonomy/diagnostics.py。

测试策略：
- mock ErrorCollector 和 health 数据
- 覆盖：错误汇总、健康状态分类、诊断报告生成、优先级排序
"""
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime

from agent.autonomy.diagnostics import (
    DiagnosticReport,
    ErrorSummary,
    HealthSummary,
    collect_error_summary,
    collect_health_summary,
    build_diagnostic_report,
    prioritize_issues,
)


class TestErrorSummary:
    def test_empty_errors(self):
        """无错误时返回空摘要。"""
        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = []
        summary = collect_error_summary(mock_collector)
        assert summary.total == 0
        assert summary.by_category == {}

    def test_categorizes_errors(self):
        """按类别分类错误。"""
        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = [
            {"category": "tool_error", "message": "kb_search failed", "timestamp": "2026-07-09T10:00:00"},
            {"category": "tool_error", "message": "run_python failed", "timestamp": "2026-07-09T10:01:00"},
            {"category": "llm_error", "message": "API timeout", "timestamp": "2026-07-09T10:02:00"},
        ]
        summary = collect_error_summary(mock_collector)
        assert summary.total == 3
        assert summary.by_category.get("tool_error") == 2
        assert summary.by_category.get("llm_error") == 1

    def test_collects_recent_messages(self):
        """收集最近 N 条错误消息。"""
        errors = [
            {"category": "tool_error", "message": f"error {i}", "timestamp": f"2026-07-09T1{i}:00:00"}
            for i in range(10)
        ]
        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = errors
        summary = collect_error_summary(mock_collector, max_recent=5)
        assert len(summary.recent_messages) == 5
        assert summary.recent_messages[0] == "error 9"  # 最新在前


class TestHealthSummary:
    def test_all_healthy(self):
        """全部组件健康。"""
        health_data = {
            "status": "ok",
            "llm": {"status": "ok"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "ok"},
        }
        summary = collect_health_summary(health_data)
        assert summary.overall_status == "ok"
        assert len(summary.degraded_components) == 0

    def test_degraded_components(self):
        """检测到降级组件。"""
        health_data = {
            "status": "degraded",
            "llm": {"status": "degraded"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "degraded"},
        }
        summary = collect_health_summary(health_data)
        assert summary.overall_status == "degraded"
        assert "llm" in summary.degraded_components
        assert "mcp_tools" in summary.degraded_components


class TestBuildDiagnosticReport:
    def test_report_contains_sections(self):
        """诊断报告包含错误摘要和健康摘要。"""
        error_summary = ErrorSummary(total=2, by_category={"tool_error": 2}, recent_messages=["err1", "err2"])
        health_summary = HealthSummary(overall_status="ok", degraded_components=[])

        report = build_diagnostic_report(error_summary, health_summary)

        assert "error_summary" in report
        assert "health_summary" in report
        assert report["error_summary"]["total"] == 2
        assert report["health_summary"]["overall_status"] == "ok"
        assert "generated_at" in report

    def test_report_includes_issues_list(self):
        """报告包含问题列表。"""
        error_summary = ErrorSummary(total=1, by_category={"llm_error": 1}, recent_messages=["API timeout"])
        health_summary = HealthSummary(overall_status="degraded", degraded_components=["llm"])

        report = build_diagnostic_report(error_summary, health_summary)

        assert "issues" in report
        assert len(report["issues"]) >= 1


class TestPrioritizeIssues:
    def test_empty_when_no_issues(self):
        """无问题时返回空列表。"""
        error_summary = ErrorSummary(total=0, by_category={}, recent_messages=[])
        health_summary = HealthSummary(overall_status="ok", degraded_components=[])
        issues = prioritize_issues(error_summary, health_summary)
        assert issues == []

    def test_llm_degraded_is_high_priority(self):
        """LLM 降级是高优先级。"""
        error_summary = ErrorSummary(total=0, by_category={}, recent_messages=[])
        health_summary = HealthSummary(overall_status="degraded", degraded_components=["llm"])
        issues = prioritize_issues(error_summary, health_summary)
        assert len(issues) == 1
        assert issues[0]["priority"] == "high"
        assert "llm" in issues[0]["component"]

    def test_repeated_tool_errors_are_medium_priority(self):
        """重复工具错误是中优先级。"""
        error_summary = ErrorSummary(total=5, by_category={"tool_error": 5}, recent_messages=["err"] * 5)
        health_summary = HealthSummary(overall_status="ok", degraded_components=[])
        issues = prioritize_issues(error_summary, health_summary)
        assert len(issues) == 1
        assert issues[0]["priority"] == "medium"
        assert issues[0]["category"] == "tool_error"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_diagnostics.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 4: Write minimal implementation**

Create `agent/autonomy/diagnostics.py`:

```python
"""自治层诊断数据收集 — 从现有错误收集器和健康检查中提取诊断信息。

职责：收集错误摘要 + 健康状态 → 生成结构化诊断报告 → 按优先级排序问题。
纯函数，不修改任何状态。调度器（scheduler.py）负责调用本模块并据结果决定是否触发自改进。

来源：
- api/diagnostics.py 的 ErrorCollector — 收集所有运行时错误
- api/health.py 的 HealthResponse — 四部件健康状态
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ErrorSummary:
    """错误摘要。"""
    total: int
    by_category: dict[str, int]
    recent_messages: list[str]


@dataclass
class HealthSummary:
    """健康摘要。"""
    overall_status: str
    degraded_components: list[str]


def collect_error_summary(
    error_collector: Any,
    max_recent: int = 10,
) -> ErrorSummary:
    """从 ErrorCollector 收集错误摘要。

    Args:
        error_collector: api/diagnostics.py 的 ErrorCollector 单例
        max_recent: 最多收集的最近消息数

    Returns:
        ErrorSummary
    """
    try:
        errors = error_collector.get_errors()
    except Exception as e:
        logger.warning("[autonomy:diagnostics] 收集错误失败: %s", e)
        return ErrorSummary(total=0, by_category={}, recent_messages=[])

    if not errors:
        return ErrorSummary(total=0, by_category={}, recent_messages=[])

    by_category: dict[str, int] = {}
    for err in errors:
        cat = err.get("category", "unknown")
        by_category[cat] = by_category.get(cat, 0) + 1

    # 最近消息（最新在前）
    recent = [
        err.get("message", "")
        for err in reversed(errors[-max_recent:])
    ]

    return ErrorSummary(
        total=len(errors),
        by_category=by_category,
        recent_messages=recent,
    )


def collect_health_summary(health_data: dict) -> HealthSummary:
    """从健康检查数据提取健康摘要。

    Args:
        health_data: api/health.py HealthResponse 的 dict 表示

    Returns:
        HealthSummary
    """
    overall = health_data.get("status", "unknown")
    degraded = []

    for component in ("llm", "memory", "native_tools", "mcp_tools"):
        comp_data = health_data.get(component, {})
        if isinstance(comp_data, dict) and comp_data.get("status") == "degraded":
            degraded.append(component)

    return HealthSummary(
        overall_status=overall,
        degraded_components=degraded,
    )


def prioritize_issues(
    error_summary: ErrorSummary,
    health_summary: HealthSummary,
) -> list[dict]:
    """按优先级排序问题列表。

    优先级规则：
    - high: LLM/memory 降级（影响核心功能）
    - medium: 重复工具错误（>=3 次）或 native_tools/mcp_tools 降级
    - low: 少量错误（<3 次）且无降级

    Returns:
        问题列表，每项 {priority, component, category, description}
    """
    issues: list[dict] = []

    # 高优先级：核心组件降级
    for component in health_summary.degraded_components:
        priority = "high" if component in ("llm", "memory") else "medium"
        issues.append({
            "priority": priority,
            "component": component,
            "category": "degraded",
            "description": f"组件 {component} 状态降级",
        })

    # 中/低优先级：重复错误
    for category, count in error_summary.by_category.items():
        if count >= 3:
            issues.append({
                "priority": "medium",
                "component": "tools",
                "category": category,
                "description": f"类别 {category} 出现 {count} 次错误",
            })
        elif count > 0 and not any(i["component"] == "tools" for i in issues):
            issues.append({
                "priority": "low",
                "component": "tools",
                "category": category,
                "description": f"类别 {category} 出现 {count} 次错误",
            })

    # 按优先级排序
    priority_order = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda x: priority_order.get(x["priority"], 3))

    return issues


def build_diagnostic_report(
    error_summary: ErrorSummary,
    health_summary: HealthSummary,
) -> dict:
    """构建完整诊断报告。

    Args:
        error_summary: 错误摘要
        health_summary: 健康摘要

    Returns:
        诊断报告 dict，包含 error_summary、health_summary、issues、generated_at
    """
    issues = prioritize_issues(error_summary, health_summary)

    return {
        "generated_at": datetime.now().isoformat(),
        "error_summary": {
            "total": error_summary.total,
            "by_category": error_summary.by_category,
            "recent_messages": error_summary.recent_messages,
        },
        "health_summary": {
            "overall_status": health_summary.overall_status,
            "degraded_components": health_summary.degraded_components,
        },
        "issues": issues,
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_diagnostics.py -v`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add agent/autonomy/__init__.py agent/autonomy/diagnostics.py tests/test_agent/test_autonomy_diagnostics.py
git commit -m "feat(autonomy): add diagnostic data collection from ErrorCollector + health checks"
```

---

## Task 3: System diagnostics tool

**Files:**
- Create: `tools/system/tool_system_diagnose.py`
- Test: `tests/test_tools/test_system_diagnose.py`
- Modify: `tools/__init__.py`

A standalone tool that diagnoses system-level failures (LLM errors, tool failures, memory issues, provider timeouts). Extends the `rag_diagnose` pattern. Pure rule matching — no LLM, no I/O.

- [ ] **Step 1: Write the failing test**

Create `tests/test_tools/test_system_diagnose.py`:

```python
"""系统诊断工具测试 — tools/system/tool_system_diagnose.py。

测试策略：
- 验证 S01-S08 诊断模式数据库完整
- 验证诊断逻辑：输入故障描述 → 返回 primary_pattern + fix
- 验证未知故障的回退
- 验证工具注册
"""
import pytest


class TestSystemDiagnosePatterns:
    def test_all_patterns_exist(self):
        """S01-S08 模式数据库完整。"""
        from tools.system.tool_system_diagnose import SYSTEM_FAILURE_PATTERNS

        assert len(SYSTEM_FAILURE_PATTERNS) == 8
        for key in SYSTEM_FAILURE_PATTERNS:
            pattern = SYSTEM_FAILURE_PATTERNS[key]
            assert "name" in pattern
            assert "symptoms" in pattern
            assert "fix" in pattern

    def test_s01_pattern_content(self):
        """S01（LLM 不可用）模式内容正确。"""
        from tools.system.tool_system_diagnose import SYSTEM_FAILURE_PATTERNS

        s01 = SYSTEM_FAILURE_PATTERNS["S01"]
        assert "LLM" in s01["name"] or "llm" in s01["name"].lower()
        assert isinstance(s01["symptoms"], list)


class TestDiagnoseSystemFailure:
    def test_diagnose_llm_timeout(self):
        """诊断 LLM 超时 → S02。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("LLM API 请求超时，返回 timeout 错误")
        assert result["primary_pattern"] == "S02"
        assert "minimal_fix" in result

    def test_diagnose_tool_error(self):
        """诊断工具错误 → S03。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("工具执行失败，run_python 报错")
        assert result["primary_pattern"] == "S03"

    def test_diagnose_provider_error(self):
        """诊断 provider 配置错误 → S04。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("provider API key 无效，认证失败 401")
        assert result["primary_pattern"] == "S04"

    def test_diagnose_memory_error(self):
        """诊断记忆错误 → S05。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("记忆写入失败，ChromaDB 连接错误")
        assert result["primary_pattern"] == "S05"

    def test_diagnose_loop(self):
        """诊断死循环 → S06。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("Agent 反复调用同一工具，陷入死循环")
        assert result["primary_pattern"] == "S06"

    def test_diagnose_unknown_returns_s08(self):
        """未知故障回退到 S08。"""
        from tools.system.tool_system_diagnose import diagnose_system_failure

        result = diagnose_system_failure("一个完全无法归类的奇怪问题")
        assert result["primary_pattern"] == "S08"


class TestSystemDiagnoseTool:
    def test_tool_registration(self):
        """工具能正常实例化。"""
        from tools.system.tool_system_diagnose import SystemDiagnoseTool

        tool = SystemDiagnoseTool()
        assert tool.name == "system_diagnose"

    def test_tool_run_returns_formatted(self):
        """工具 _run 返回格式化结果。"""
        from tools.system.tool_system_diagnose import SystemDiagnoseTool

        tool = SystemDiagnoseTool()
        result_str = tool._run(failure_description="LLM API 超时")
        assert "S02" in result_str or "超时" in result_str

    def test_tool_run_empty_returns_error(self):
        """空描述返回错误。"""
        from tools.system.tool_system_diagnose import SystemDiagnoseTool

        tool = SystemDiagnoseTool()
        result_str = tool._run(failure_description="")
        assert "错误" in result_str or "error" in result_str.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_system_diagnose.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Implement the diagnostics tool**

Create `tools/system/tool_system_diagnose.py`:

```python
"""系统级故障诊断工具 — 将系统故障描述映射到 S01-S08 诊断模式。

来源：autonomy layer 的 self-diagnosis 能力，扩展自 rag_diagnose 的 P01-P12 模式。
职责：输入系统故障描述，返回最匹配的诊断模式 + 最小修复建议。
纯规则匹配，不调用 LLM、不依赖外部服务。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool


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
    """诊断系统故障，返回最匹配的模式。

    Args:
        failure_description: 故障描述文本

    Returns:
        {"primary_pattern": "S0x", "pattern_name": str, "minimal_fix": str, "confidence": float}
    """
    text = failure_description.lower()

    best_match = "S08"
    best_score = 0

    for key, pattern in SYSTEM_FAILURE_PATTERNS.items():
        score = 0
        for symptom in pattern["symptoms"]:
            if symptom.lower() in text:
                score += 1
        max_possible = max(len(pattern["symptoms"]), 1)
        normalized = score / max_possible
        if normalized > best_score:
            best_score = normalized
            best_match = key

    pattern = SYSTEM_FAILURE_PATTERNS[best_match]
    return {
        "primary_pattern": best_match,
        "pattern_name": pattern["name"],
        "minimal_fix": pattern["fix"],
        "confidence": round(best_score, 2),
    }


class SystemDiagnoseInput(BaseModel):
    """system_diagnose 输入参数"""
    failure_description: str = Field(
        description="系统故障的描述（错误信息、症状、复现步骤等）",
    )


@register_tool
class SystemDiagnoseTool(ToolBase):
    """系统级故障诊断工具：将系统故障描述映射到 S01-S08 诊断模式 + 最小修复建议。"""

    name: str = "system_diagnose"
    description: str = (
        "诊断系统级故障。输入故障描述，返回最匹配的 S01-S08 诊断模式、"
        "模式名称、最小修复建议和置信度。"
        "当用户报告系统错误、LLM 不可用、工具失败、provider 问题时使用。"
        "[调用积极性: 用户报告系统级问题时主动调用] [get_doc: 无]"
    )
    args_schema: type[BaseModel] = SystemDiagnoseInput

    def _run(self, failure_description: str = "") -> str:
        if not failure_description.strip():
            return format_error("failure_description 不能为空")

        result = diagnose_system_failure(failure_description)

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

- [ ] **Step 4: Register in TOOL_CATEGORIES**

In `tools/__init__.py`, find the `"system"` category line (should be around line 184):
```python
    "system": ["run_python", "project_info", "context_strategy", "forget", "create_persona", "rag_diagnose"],
```

Change to:
```python
    "system": ["run_python", "project_info", "context_strategy", "forget", "create_persona", "rag_diagnose", "system_diagnose"],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_system_diagnose.py -v`
Expected: PASS (10 tests)

- [ ] **Step 6: Run tool registry tests for regressions**

Run: `.venv\Scripts\python.exe -m pytest tests/test_tools/test_tool_registry.py -v`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add tools/system/tool_system_diagnose.py tests/test_tools/test_system_diagnose.py tools/__init__.py
git commit -m "feat(tools): add system diagnostics tool (S01-S08 patterns)"
```

---

## Task 4: Autonomy scheduler (singleton asyncio loop)

**Files:**
- Create: `agent/autonomy/scheduler.py`
- Test: `tests/test_agent/test_autonomy_scheduler.py`

The core scheduler — a singleton asyncio task that periodically runs diagnostic ticks. Modeled after `memory/ttl.py`'s `schedule_purge`/`stop_purge` pattern. Each tick: collect diagnostics → if issues found and self-improve enabled → trigger headless agent runner.

- [ ] **Step 1: Write the failing test**

Create `tests/test_agent/test_autonomy_scheduler.py`:

```python
"""自治调度器单元测试 — agent/autonomy/scheduler.py。

测试策略：
- mock 诊断函数和 runner
- 验证调度器启动/停止/幂等
- 验证 tick 流程：收集诊断 → 有问题时触发 runner
- 验证 autonomy_enabled=False 时不执行
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agent.autonomy.diagnostics import ErrorSummary, HealthSummary


@pytest.fixture(autouse=True)
def _reset_scheduler():
    """每个测试前后重置调度器状态。"""
    from agent.autonomy import scheduler
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None
    yield
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None


class TestSchedulerLifecycle:
    @pytest.mark.asyncio
    async def test_start_creates_task(self):
        """start_autonomy 启动后台任务。"""
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy, _scheduler_task

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=1)
        await asyncio.sleep(0.1)  # 让任务启动

        assert _scheduler_task() is not None
        assert not _scheduler_task().done()

        await stop_autonomy()

    @pytest.mark.asyncio
    async def test_stop_cancels_task(self):
        """stop_autonomy 取消后台任务。"""
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy, _scheduler_task

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=1)
        await asyncio.sleep(0.1)
        await stop_autonomy()

        task = _scheduler_task()
        if task:
            assert task.done()

    @pytest.mark.asyncio
    async def test_start_is_idempotent(self):
        """重复调用 start_autonomy 不创建多个任务。"""
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy, _scheduler_task

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=1)
        task1 = _scheduler_task()
        start_autonomy(mock_app, interval_seconds=1)
        task2 = _scheduler_task()

        # 应该是同一个任务（或旧的被取消后新的创建，但只有一个活跃）
        assert task2 is not None
        await stop_autonomy()

    @pytest.mark.asyncio
    async def test_start_without_llm_does_not_crash(self):
        """LLM 未就绪时不崩溃。"""
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy

        mock_app = MagicMock()
        mock_app.state.llm = None

        start_autonomy(mock_app, interval_seconds=1)
        await asyncio.sleep(0.1)
        await stop_autonomy()
        # 不崩溃即通过


class TestSchedulerTick:
    @pytest.mark.asyncio
    async def test_tick_collects_diagnostics(self):
        """tick 调用诊断函数收集数据。"""
        from agent.autonomy.scheduler import _run_tick

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = []

        mock_health_data = {"status": "ok", "llm": {"status": "ok"}, "memory": {"status": "ok"},
                           "native_tools": {"status": "ok"}, "mcp_tools": {"status": "ok"}}

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health_data):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app)

                    assert "error_summary" in report
                    assert "health_summary" in report
                    mock_improve.assert_not_called()  # 无问题时不触发自改进

    @pytest.mark.asyncio
    async def test_tick_triggers_self_improve_on_issues(self):
        """有高优先级问题时触发自改进。"""
        from agent.autonomy.scheduler import _run_tick

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = [
            {"category": "llm_error", "message": "API timeout", "timestamp": "2026-07-09T10:00:00"}
        ]

        mock_health_data = {"status": "degraded", "llm": {"status": "degraded"},
                           "memory": {"status": "ok"}, "native_tools": {"status": "ok"},
                           "mcp_tools": {"status": "ok"}}

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health_data):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=True)

                    assert len(report["issues"]) > 0
                    mock_improve.assert_called_once()

    @pytest.mark.asyncio
    async def test_tick_does_not_trigger_without_self_improve_flag(self):
        """self_improve_enabled=False 时不触发自改进。"""
        from agent.autonomy.scheduler import _run_tick

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = [
            {"category": "llm_error", "message": "API timeout", "timestamp": "2026-07-09T10:00:00"}
        ]

        mock_health_data = {"status": "degraded", "llm": {"status": "degraded"}}

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health_data):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=False)

                    assert len(report["issues"]) > 0
                    mock_improve.assert_not_called()

    @pytest.mark.asyncio
    async def test_tick_exception_does_not_crash(self):
        """tick 内部异常不崩溃，返回错误报告。"""
        from agent.autonomy.scheduler import _run_tick

        mock_app = MagicMock()

        with patch("agent.autonomy.scheduler._get_error_collector", side_effect=RuntimeError("crash")):
            report = await _run_tick(mock_app)

            assert "error" in report
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_scheduler.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Write minimal implementation**

Create `agent/autonomy/scheduler.py`:

```python
"""自治调度器 — 后台周期性自诊断 + 自改进。

模式：参考 memory/ttl.py 的单例调度器模式。
- start_autonomy() 幂等启动（先 cancel 旧任务）
- stop_autonomy() 幂等关闭
- _run_tick() 单次诊断 + 可选自改进
- 异常隔离：tick 内部异常不杀死循环

用法::

    from agent.autonomy.scheduler import start_autonomy, stop_autonomy

    start_autonomy(app, interval_seconds=3600)
    # ...
    await stop_autonomy()
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from agent.autonomy.diagnostics import (
    ErrorSummary,
    HealthSummary,
    collect_error_summary,
    collect_health_summary,
    build_diagnostic_report,
)

logger = logging.getLogger(__name__)

# 全局调度状态（单例，进程内只允许一个调度任务）
_scheduler_task: Optional[asyncio.Task] = None
_scheduler_loop: Optional[asyncio.AbstractEventLoop] = None


def _scheduler_task() -> Optional[asyncio.Task]:
    """获取当前调度任务（供测试检查）。"""
    return _scheduler_task


def start_autonomy(
    app: Any,
    interval_seconds: int = 3600,
    self_improve_enabled: bool = False,
) -> Optional[asyncio.Task]:
    """启动后台自治调度器。

    若已有任务在运行，先取消旧任务再启动新任务（幂等）。

    Args:
        app: FastAPI 应用实例（需 app.state.llm / app.state.session_manager）
        interval_seconds: 执行间隔（秒）
        self_improve_enabled: 是否允许自改进（创建/更新 Skills）

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

    _scheduler_loop = asyncio.get_event_loop()

    async def _autonomy_loop():
        logger.info("[autonomy] 调度器已启动，间隔 %ds，自改进=%s", interval_seconds, self_improve_enabled)
        while True:
            try:
                await _run_tick(app, self_improve_enabled=self_improve_enabled)
            except asyncio.CancelledError:
                logger.info("[autonomy] 调度器被取消")
                break
            except Exception as e:
                logger.warning("[autonomy] tick 异常（不杀死循环）: %s", e)

            await asyncio.sleep(interval_seconds)

    _scheduler_task = _scheduler_loop.create_task(_autonomy_loop())
    return _scheduler_task


async def stop_autonomy() -> None:
    """停止后台自治调度器（幂等）。"""
    global _scheduler_task, _scheduler_loop
    if _scheduler_task is not None and not _scheduler_task.done():
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
    _scheduler_task = None
    _scheduler_loop = None
    logger.info("[autonomy] 调度器已停止")


def _get_error_collector() -> Any:
    """获取 ErrorCollector 单例。"""
    try:
        from api.diagnostics import error_collector
        return error_collector
    except Exception:
        return None


def _get_health_data() -> dict:
    """获取健康检查数据（同步读取，不调用 HTTP）。"""
    try:
        from api.health import check_health_sync
        return check_health_sync()
    except Exception:
        # 回退：返回最小健康数据
        return {
            "status": "unknown",
            "llm": {"status": "unknown"},
            "memory": {"status": "unknown"},
            "native_tools": {"status": "unknown"},
            "mcp_tools": {"status": "unknown"},
        }


async def _run_tick(
    app: Any,
    self_improve_enabled: bool = False,
) -> dict:
    """执行一次诊断 tick。

    流程：
    1. 收集错误摘要
    2. 收集健康摘要
    3. 构建诊断报告
    4. 如果有问题且 self_improve_enabled → 触发自改进

    Returns:
        诊断报告 dict
    """
    try:
        # 1. 收集错误
        collector = _get_error_collector()
        error_summary = collect_error_summary(collector) if collector else ErrorSummary(
            total=0, by_category={}, recent_messages=[]
        )

        # 2. 收集健康
        health_data = _get_health_data()
        health_summary = collect_health_summary(health_data)

        # 3. 构建报告
        report = build_diagnostic_report(error_summary, health_summary)
        logger.info(
            "[autonomy] tick 完成: %d 错误, 状态=%s, %d 问题",
            error_summary.total,
            health_summary.overall_status,
            len(report["issues"]),
        )

        # 4. 自改进
        if self_improve_enabled and report["issues"]:
            llm = getattr(app.state, "llm", None)
            if llm is not None:
                try:
                    await _run_self_improve(app, report)
                except Exception as e:
                    logger.warning("[autonomy] 自改进执行失败: %s", e)

        return report
    except Exception as e:
        logger.warning("[autonomy] tick 异常: %s", e)
        return {"error": str(e), "generated_at": None}


async def _run_self_improve(app: Any, report: dict) -> str:
    """触发自改进 Agent 会话。

    使用 headless Agent 执行（无 WS、无 HITL）。
    复用 server.py 的 _run_event_hook_action 模式。

    Args:
        app: FastAPI 应用实例
        report: 诊断报告

    Returns:
        Agent 执行结果文本
    """
    from agent.autonomy.runner import run_self_improvement_agent
    from config.settings import get_settings

    settings = get_settings()
    timeout = settings.autonomy_max_agent_timeout

    return await run_self_improvement_agent(
        app=app,
        diagnostic_report=report,
        timeout=timeout,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_scheduler.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/autonomy/scheduler.py tests/test_agent/test_autonomy_scheduler.py
git commit -m "feat(autonomy): add singleton scheduler with diagnostic tick + self-improve trigger"
```

---

## Task 5: Headless self-improvement runner

**Files:**
- Create: `agent/autonomy/runner.py`
- Test: `tests/test_agent/test_autonomy_runner.py`

The headless agent runner that executes self-improvement sessions. Reuses the `_run_event_hook_action` pattern: create session → build agent (no HITL) → invoke with diagnostic report → cleanup.

- [ ] **Step 1: Write the failing test**

Create `tests/test_agent/test_autonomy_runner.py`:

```python
"""自治层自改进 Runner 单元测试 — agent/autonomy/runner.py。

测试策略：
- mock SessionManager、build_agent、app.state
- 验证 runner 创建临时会话、执行、清理
- 验证超时处理
- 验证 LLM 未就绪时的安全回退
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agent.autonomy.runner import run_self_improvement_agent


@pytest.fixture
def mock_app():
    """创建 mock FastAPI app。"""
    app = MagicMock()
    app.state.llm = MagicMock()
    app.state.session_manager = MagicMock()
    app.state.session_manager.create = AsyncMock()
    app.state.session_manager.delete = AsyncMock()
    app.state.system_prompt = "test prompt"
    app.state.episodic_mm = None
    app.state.tools = []
    return app


@pytest.fixture
def sample_report():
    """创建样例诊断报告。"""
    return {
        "generated_at": "2026-07-09T10:00:00",
        "error_summary": {"total": 2, "by_category": {"tool_error": 2}, "recent_messages": ["err1", "err2"]},
        "health_summary": {"overall_status": "ok", "degraded_components": []},
        "issues": [
            {"priority": "medium", "component": "tools", "category": "tool_error", "description": "2 errors"}
        ],
    }


class TestRunSelfImprovementAgent:
    @pytest.mark.asyncio
    async def test_creates_and_deletes_session(self, mock_app, sample_report):
        """runner 创建临时会话并在完成后删除。"""
        mock_session = MagicMock()
        mock_session.session_id = "test-session-123"
        mock_session.checkpointer = MagicMock()
        mock_app.state.session_manager.create.return_value = mock_session

        mock_graph = MagicMock()
        mock_graph.ainvoke = AsyncMock(return_value={
            "messages": [MagicMock(content="Self-improvement complete")]
        })

        with patch("agent.autonomy.runner.build_agent", return_value=mock_graph):
            with patch("agent.autonomy.runner._extract_final_answer", return_value="Self-improvement complete"):
                result = await run_self_improvement_agent(
                    app=mock_app,
                    diagnostic_report=sample_report,
                    timeout=30,
                )

                mock_app.state.session_manager.create.assert_called_once()
                mock_app.state.session_manager.delete.assert_called_once_with("test-session-123")
                assert "Self-improvement" in result

    @pytest.mark.asyncio
    async def test_llm_not_ready_raises(self, mock_app, sample_report):
        """LLM 未就绪时抛出异常。"""
        mock_app.state.llm = None

        with pytest.raises(RuntimeError, match="LLM"):
            await run_self_improvement_agent(
                app=mock_app,
                diagnostic_report=sample_report,
                timeout=30,
            )

    @pytest.mark.asyncio
    async def test_timeout_handling(self, mock_app, sample_report):
        """超时时不崩溃，清理会话。"""
        mock_session = MagicMock()
        mock_session.session_id = "test-session-timeout"
        mock_session.checkpointer = MagicMock()
        mock_app.state.session_manager.create.return_value = mock_session

        mock_graph = MagicMock()
        mock_graph.ainvoke = AsyncMock(side_effect=asyncio.TimeoutError())

        with patch("agent.autonomy.runner.build_agent", return_value=mock_graph):
            result = await run_self_improvement_agent(
                app=mock_app,
                diagnostic_report=sample_report,
                timeout=1,
            )

            # 超时后应清理会话
            mock_app.state.session_manager.delete.assert_called_once_with("test-session-timeout")
            assert "超时" in result or "timeout" in result.lower()

    @pytest.mark.asyncio
    async def test_session_cleanup_on_exception(self, mock_app, sample_report):
        """任何异常都确保会话被清理。"""
        mock_session = MagicMock()
        mock_session.session_id = "test-session-err"
        mock_session.checkpointer = MagicMock()
        mock_app.state.session_manager.create.return_value = mock_session

        mock_graph = MagicMock()
        mock_graph.ainvoke = AsyncMock(side_effect=RuntimeError("Agent crashed"))

        with patch("agent.autonomy.runner.build_agent", return_value=mock_graph):
            try:
                await run_self_improvement_agent(
                    app=mock_app,
                    diagnostic_report=sample_report,
                    timeout=30,
                )
            except Exception:
                pass

            # 无论是否异常，会话都应被清理
            mock_app.state.session_manager.delete.assert_called_once_with("test-session-err")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_runner.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: Write minimal implementation**

Create `agent/autonomy/runner.py`:

```python
"""自治层自改进 Runner — 无 WS 的 headless Agent 执行。

模式：参考 server.py 的 _run_event_hook_action。
- 创建临时会话
- 构建 Agent（禁用 HITL，过滤交互工具）
- 注入诊断报告作为提示词
- 超时控制 + finally 清理会话

安全边界：
- 不允许 ask_user_* 工具（headless 模式无用户交互）
- 超时后安全清理
- 任何异常都确保会话被删除
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)

# 交互工具黑名单（headless 模式不可用）
_INTERACTIVE_TOOL_PATTERNS = {"ask_user", "approval"}


def _filter_interactive_tools(tools: list) -> list:
    """过滤掉交互式工具（ask_user_* 等）。"""
    filtered = []
    for tool in tools:
        tool_name = getattr(tool, "name", "")
        if any(pattern in tool_name for pattern in _INTERACTIVE_TOOL_PATTERNS):
            continue
        filtered.append(tool)
    return filtered


def _build_self_improve_prompt(report: dict) -> str:
    """构建自改进提示词。"""
    issues_text = "\n".join(
        f"- [{issue['priority']}] {issue['component']}: {issue['description']}"
        for issue in report.get("issues", [])
    )
    errors_text = "\n".join(
        f"  [{cat}] x{count}" for cat, count in report.get("error_summary", {}).get("by_category", {}).items()
    )
    health_text = report.get("health_summary", {}).get("overall_status", "unknown")
    degraded = ", ".join(report.get("health_summary", {}).get("degraded_components", []))

    return f"""[自治自改进任务]

你是 Maxma 的自治自改进 Agent。以下是系统自诊断报告，请分析问题并采取改进措施。

## 诊断报告

### 健康状态: {health_text}
{f"降级组件: {degraded}" if degraded else "所有组件正常"}

### 错误摘要
{errors_text if errors_text else "无错误"}

### 问题列表
{issues_text if issues_text else "无问题"}

### 最近错误消息
{chr(10).join(report.get('error_summary', {}).get('recent_messages', [])[:5])}

## 你的任务

1. 分析上述问题，判断是否有可自动修复的
2. 如果是重复工具错误，检查工具配置或创建改进 Skill
3. 如果是 LLM/Provider 问题，建议用户检查配置（不要尝试自动修改 provider）
4. 如果发现可改进的模式，使用 manage_skills 工具创建或更新 Skill
5. 输出简短的改进总结

注意：
- 你是后台自治模式，不要请求用户确认
- 只能创建/更新 Skills，不要修改系统配置文件
- 如果问题需要人工干预，明确说明
"""


def _extract_final_answer(output: dict) -> str:
    """从 Agent 输出中提取最终答案。"""
    try:
        messages = output.get("messages", [])
        for msg in reversed(messages):
            content = getattr(msg, "content", "")
            if content and isinstance(content, str) and len(content.strip()) > 0:
                # 跳过工具消息
                msg_type = getattr(msg, "type", "")
                if msg_type == "ai":
                    return content
        # 回退：取最后一条消息
        if messages:
            return getattr(messages[-1], "content", "") or ""
    except Exception:
        pass
    return ""


async def run_self_improvement_agent(
    app: Any,
    diagnostic_report: dict,
    timeout: int = 300,
) -> str:
    """执行自改进 Agent 会话。

    Args:
        app: FastAPI 应用实例
        diagnostic_report: 诊断报告 dict
        timeout: 最大执行时间（秒）

    Returns:
        Agent 执行结果文本

    Raises:
        RuntimeError: LLM 未就绪
    """
    llm = getattr(app.state, "llm", None)
    if llm is None:
        raise RuntimeError("LLM 未就绪，无法执行自改进")

    session_manager = getattr(app.state, "session_manager", None)
    if session_manager is None:
        raise RuntimeError("SessionManager 未初始化")

    # 获取工具列表并过滤交互工具
    all_tools = getattr(app.state, "tools", []) or []
    tools = _filter_interactive_tools(all_tools)

    # 创建临时会话
    session = await session_manager.create()
    session_id = session.session_id

    try:
        # 构建系统提示词
        system_prompt = getattr(app.state, "system_prompt", "") or ""
        system_prompt = (
            system_prompt
            + "\n\n[自治自改进模式]\n"
            + "当前任务由自治调度器自动触发，没有可交互的聊天 WebSocket。"
            + "不要请求用户确认或等待用户输入。"
            + "你可以使用 manage_skills 工具创建或更新 Skills 来改进系统。"
        )

        # 构建 Agent
        from agent.graph import build_agent
        episodic_mm = getattr(app.state, "episodic_mm", None)
        graph = build_agent(
            model=llm,
            tools=tools,
            system_prompt=system_prompt,
            checkpointer=session.checkpointer,
            episodic_mm=episodic_mm,
            enable_hitl=False,
        )
        session._graph = graph

        # 构建提示词
        prompt = _build_self_improve_prompt(diagnostic_report)

        # 执行
        logger.info("[autonomy:runner] 启动自改进 Agent (session=%s, timeout=%ds)", session_id, timeout)
        output = await asyncio.wait_for(
            graph.ainvoke(
                {"messages": [HumanMessage(content=prompt)]},
                config={
                    "configurable": {"thread_id": session_id},
                    "recursion_limit": 80,
                },
            ),
            timeout=timeout,
        )

        result = _extract_final_answer(output) or "自改进任务已执行，但没有生成文本结果"
        logger.info("[autonomy:runner] 自改进完成 (session=%s): %s", session_id, result[:200])
        return result

    except asyncio.TimeoutError:
        logger.warning("[autonomy:runner] 自改进超时 (session=%s, timeout=%ds)", session_id, timeout)
        return f"自改进任务超时（{timeout}s），已终止"
    except Exception as e:
        logger.warning("[autonomy:runner] 自改进异常 (session=%s): %s", session_id, e)
        raise
    finally:
        delete_fn = getattr(session_manager, "delete", None)
        if callable(delete_fn):
            await delete_fn(session_id)
        logger.info("[autonomy:runner] 会话已清理 (session=%s)", session_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_runner.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/autonomy/runner.py tests/test_agent/test_autonomy_runner.py
git commit -m "feat(autonomy): add headless self-improvement runner with timeout + cleanup"
```

---

## Task 6: Lifespan integration + health check sync function

**Files:**
- Modify: `api/health.py`
- Modify: `api/server.py`

Wire the autonomy scheduler into FastAPI lifespan (start after hooks, stop after hooks). Also add a `check_health_sync()` function to `api/health.py` that the scheduler can call without async context.

- [ ] **Step 1: Read api/health.py**

Read `D:\Maxma\MaxmaHere\api\health.py` to understand the existing health check function structure. Find the main health check function (likely async).

- [ ] **Step 2: Add check_health_sync to api/health.py**

Append a synchronous wrapper to `api/health.py`:

```python
def check_health_sync(probe_remote: bool = False) -> dict:
    """同步获取健康检查数据（供自治调度器调用）。

    不调用远程 provider 探测（probe_remote=False），仅查本地状态。
    返回 dict 格式，与 HealthResponse.model_dump() 一致。

    Returns:
        健康状态 dict
    """
    try:
        # 复用已有的同步检查逻辑
        from config.settings import get_settings
        from api.providers.provider_manager import get_provider_manager

        settings = get_settings()
        pm = get_provider_manager()

        # LLM 状态
        llm_status = "ok" if settings else "degraded"
        # 简化：检查 provider 是否已配置
        providers = pm.list_providers() if pm else []
        llm_status = "ok" if providers else "degraded"

        # 记忆状态（检查 LTM consumer 是否运行）
        memory_status = "ok"
        try:
            from memory.long_term import get_ltm_consumer
            ltm = get_ltm_consumer()
            if ltm and not ltm._running:
                memory_status = "degraded"
        except Exception:
            memory_status = "unknown"

        # 工具数量
        try:
            from tools import get_all_tools
            tool_count = len(get_all_tools())
            native_status = "ok" if tool_count > 0 else "degraded"
        except Exception:
            native_status = "unknown"
            tool_count = 0

        # MCP 工具
        mcp_status = "ok"

        overall = "ok" if all(s == "ok" for s in [llm_status, memory_status, native_status, mcp_status]) else "degraded"

        return {
            "status": overall,
            "llm": {"status": llm_status},
            "memory": {"status": memory_status},
            "native_tools": {"status": native_status, "count": tool_count},
            "mcp_tools": {"status": mcp_status, "count": 0},
        }
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("[health:sync] 健康检查失败: %s", e)
        return {
            "status": "unknown",
            "llm": {"status": "unknown"},
            "memory": {"status": "unknown"},
            "native_tools": {"status": "unknown"},
            "mcp_tools": {"status": "unknown"},
        }
```

IMPORTANT: Read the existing health.py code first to ensure this function doesn't conflict with existing functions. Adapt the imports and logic to match the actual codebase. If `get_ltm_consumer` or `get_provider_manager` don't exist with those names, find the correct names by reading the code.

- [ ] **Step 3: Wire scheduler into server.py lifespan**

Read `D:\Maxma\MaxmaHere\api\server.py` around lines 409-420 (after hooks startup, before `yield`) and around lines 449-465 (after hooks stop, in the shutdown section).

**3a. Add startup code** (after `hook_manager.start_all()` and `app.state.hook_manager = hook_manager`, before `yield`):

```python
    # 7. 启动自治调度器
    from config.settings import get_settings as _get_autonomy_settings
    _autonomy_settings = _get_autonomy_settings()
    if _autonomy_settings.autonomy_enabled:
        from agent.autonomy.scheduler import start_autonomy
        start_autonomy(
            app,
            interval_seconds=_autonomy_settings.autonomy_interval_seconds,
            self_improve_enabled=_autonomy_settings.autonomy_self_improve_enabled,
        )
        logger.info("[autonomy] 自治调度器已启动")
    else:
        logger.info("[autonomy] 自治调度器未启用（autonomy_enabled=False）")
```

**3b. Add shutdown code** (after `hook_manager.stop_all()`, in the shutdown section):

```python
    # 停止自治调度器
    from agent.autonomy.scheduler import stop_autonomy
    await stop_autonomy()
```

- [ ] **Step 4: Run existing tests for regressions**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/ tests/test_tools/ tests/test_config_settings.py -q`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/health.py api/server.py
git commit -m "feat(autonomy): wire scheduler into FastAPI lifespan + add sync health check"
```

---

## Task 7: End-to-end integration test + full regression

**Files:**
- Test: `tests/test_agent/test_autonomy_e2e.py`

A single end-to-end test that exercises the full autonomy pipeline (diagnostics → report → scheduler tick → runner) with mocked components, plus a regression test that all features off reproduces the original behavior.

- [ ] **Step 1: Write the e2e test**

Create `tests/test_agent/test_autonomy_e2e.py`:

```python
"""自治层端到端集成测试。

验证完整流程：诊断收集 → 报告生成 → 调度器 tick → 自改进 Runner（mocked），
以及全部关闭时不执行任何操作。
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agent.autonomy.diagnostics import (
    ErrorSummary,
    HealthSummary,
    collect_error_summary,
    collect_health_summary,
    build_diagnostic_report,
    prioritize_issues,
)
from agent.autonomy.scheduler import _run_tick


@pytest.fixture(autouse=True)
def _reset_scheduler():
    from agent.autonomy import scheduler
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None
    yield
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None


class TestAutonomyFullPipeline:
    """完整流程测试。"""

    @pytest.mark.asyncio
    async def test_diagnostics_to_runner_full_flow(self):
        """诊断 → 报告 → 有问题 → 触发 runner。"""
        # 准备 mock
        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()
        mock_app.state.session_manager = MagicMock()
        mock_app.state.session_manager.create = AsyncMock()
        mock_app.state.session_manager.delete = AsyncMock()

        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = [
            {"category": "tool_error", "message": "kb_search failed", "timestamp": "2026-07-09T10:00:00"},
            {"category": "tool_error", "message": "run_python failed", "timestamp": "2026-07-09T10:01:00"},
            {"category": "tool_error", "message": "file_read failed", "timestamp": "2026-07-09T10:02:00"},
        ]

        mock_health = {
            "status": "degraded",
            "llm": {"status": "ok"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "degraded"},
        }

        # 执行 tick
        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=True)

                    # 验证报告
                    assert report["error_summary"]["total"] == 3
                    assert report["health_summary"]["overall_status"] == "degraded"
                    assert len(report["issues"]) >= 1

                    # 验证 runner 被触发
                    mock_improve.assert_called_once()
                    call_args = mock_improve.call_args
                    # 传入的 report 应该包含 issues
                    assert "issues" in call_args[0][1] or "issues" in call_args[1].get("report", {})

    @pytest.mark.asyncio
    async def test_no_issues_no_runner(self):
        """无问题时不触发 runner。"""
        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = []

        mock_health = {
            "status": "ok",
            "llm": {"status": "ok"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "ok"},
        }

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=True)

                    assert len(report["issues"]) == 0
                    mock_improve.assert_not_called()

    @pytest.mark.asyncio
    async def test_self_improve_disabled_no_runner(self):
        """self_improve_enabled=False 时不触发 runner，即使有问题。"""
        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = [
            {"category": "llm_error", "message": "timeout", "timestamp": "2026-07-09T10:00:00"}
        ]

        mock_health = {
            "status": "degraded",
            "llm": {"status": "degraded"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "ok"},
        }

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=False)

                    assert len(report["issues"]) >= 1
                    mock_improve.assert_not_called()


class TestAutonomyPriorityOrdering:
    """优先级排序测试。"""

    def test_high_before_medium_before_low(self):
        """high 优先级排在 medium 和 low 之前。"""
        error_summary = ErrorSummary(
            total=5,
            by_category={"tool_error": 4, "llm_error": 1},
            recent_messages=["err"] * 5,
        )
        health_summary = HealthSummary(
            overall_status="degraded",
            degraded_components=["llm", "mcp_tools"],
        )

        issues = prioritize_issues(error_summary, health_summary)

        # llm 降级 → high
        # mcp_tools 降级 → medium
        # tool_error 4次 → medium
        # llm_error 1次 → low (但 llm 已在 degraded 中)
        assert issues[0]["priority"] == "high"
        assert "llm" in issues[0]["component"]
```

- [ ] **Step 2: Run e2e tests**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/test_autonomy_e2e.py -v`
Expected: PASS (4 tests)

- [ ] **Step 3: Run the entire test suite for final regression check**

Run: `.venv\Scripts\python.exe -m pytest tests/test_agent/ tests/test_tools/ tests/test_memory/ tests/test_config_settings.py -q`
Expected: All tests PASS with zero failures.

- [ ] **Step 4: Commit**

```bash
git add tests/test_agent/test_autonomy_e2e.py
git commit -m "test(autonomy): add e2e integration tests for full pipeline"
```

---

## Self-Review

**1. Spec coverage check against the master proposal's autonomy layer:**

- ✅ Scheduled agents (periodic background execution) → Task 4 (scheduler singleton) + Task 6 (lifespan integration)
- ✅ Self-diagnosis (scan errors + health → report) → Task 2 (diagnostics pure functions) + Task 3 (system_diagnose tool)
- ✅ Self-improvement (Agent creates/updates Skills) → Task 5 (headless runner) + reuses existing `manage_skills` tool
- ✅ Feature flags (all default off) → Task 1
- ✅ Backward compatible (autonomy_enabled=False → scheduler doesn't start) → Task 6 + Task 7 e2e
- ✅ Safe fallback (LLM not ready → skip; timeout → cleanup; exception → cleanup) → Task 5
- ⚠️ Cron expression support — deferred. The scheduler uses fixed `interval_seconds` (like the existing `schedule` hook type). Cron expressions can be added later as a config enhancement.
- ⚠️ Autonomy REST API (CRUD tasks, view history) — deferred. The scheduler is config-driven in this plan. An API for dynamic task management can be a follow-up.
- ⚠️ Frontend autonomy dashboard — deferred. No UI changes in this plan. A follow-up can add an autonomy history view.

**2. Placeholder scan:** Searched for "TBD", "TODO", "implement later", "add appropriate". Found none. All code steps contain complete code. The "IMPORTANT: Read the existing..." notes in Task 6 are guidance for the implementer to adapt to the actual codebase, not placeholders.

**3. Type consistency check:**
- `ErrorSummary(total: int, by_category: dict, recent_messages: list)` — defined in Task 2, used in Task 4 tests ✓
- `HealthSummary(overall_status: str, degraded_components: list)` — defined in Task 2, used in Task 4 ✓
- `collect_error_summary(collector, max_recent=10) -> ErrorSummary` — consistent between Task 2 (definition) and Task 4 (usage) ✓
- `collect_health_summary(health_data: dict) -> HealthSummary` — consistent ✓
- `build_diagnostic_report(error_summary, health_summary) -> dict` — consistent ✓
- `prioritize_issues(error_summary, health_summary) -> list[dict]` — consistent ✓
- `_run_tick(app, self_improve_enabled=False) -> dict` — consistent between Task 4 (definition) and Task 7 (e2e test) ✓
- `run_self_improvement_agent(app, diagnostic_report, timeout) -> str` — consistent between Task 5 (definition) and Task 4 (_run_self_improve calls it) ✓
- `start_autonomy(app, interval_seconds, self_improve_enabled) -> Optional[Task]` — consistent between Task 4 (definition) and Task 6 (lifespan) ✓
- `stop_autonomy() -> None` — consistent ✓
- Settings fields: `autonomy_enabled`, `autonomy_interval_seconds`, `autonomy_self_improve_enabled`, `autonomy_max_agent_timeout` — defined in Task 1, referenced in Tasks 4, 5, 6 ✓
- Tool name `system_diagnose` — consistent between Task 3 (definition), Task 3 (TOOL_CATEGORIES registration), and Task 3 (tests) ✓

No issues found. Plan is complete.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-09-autonomy-layer.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
