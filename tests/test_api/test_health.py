"""测试 — api/health.py 健康检查组件。"""

import asyncio

import pytest
from fastapi import FastAPI

from api import health as health_mod
from api.health import (
    ComponentHealth,
    HealthResponse,
    LtmDiagnostic,
    associate_ltm_provider,
    check_health_sync,
    check_llm,
    check_mcp_tools,
    check_memory,
    check_native_tools,
    get_health_report,
    get_ltm_diagnostic,
)


class FakeSettings:
    """带 health 模块所需属性的 fake settings。"""

    provider_diagnostics_enabled = False
    think_path_enabled = False


@pytest.fixture
def app():
    a = FastAPI()
    a.state.native_tools = [{"name": "t1"}]
    a.state.mcp_tools = [{"name": "m1"}]
    return a


# ── ComponentHealth 模型 ────────────────────────────


class TestComponentHealthModel:
    def test_ok_status_fills_runtime_fields(self):
        c = ComponentHealth(status="ok", detail="all good")
        # ok 状态 reason_code 为 None
        assert c.reason_code is None
        assert c.updated_at is not None
        # ok 状态 summary 为 None（user_summary_for(None) → None）
        assert c.summary is None

    def test_error_status_fills_reason_and_summary(self):
        c = ComponentHealth(status="error", detail="401 Unauthorized")
        assert c.reason_code == "authentication_failed"
        assert c.summary == "Configuration could not be authenticated."

    def test_detail_sanitized(self):
        c = ComponentHealth(status="error", detail="token=super-secret-value")
        assert "super-secret-value" not in (c.detail or "")

    def test_from_runtime_ok(self):
        c = ComponentHealth.from_runtime("ok", latency_ms=5.0, technical_detail="fine")
        assert c.status == "ok"
        assert c.latency_ms == 5.0
        assert c.reason_code is None

    def test_from_runtime_error_redacts_technical_detail(self):
        c = ComponentHealth.from_runtime(
            "error", technical_detail="api_key=super-secret"
        )
        # "api_key=..." 不含 401/authentication 等关键词 → runtime_error
        assert c.reason_code == "runtime_error"
        # 但 public_detail 仍应脱敏敏感凭据
        assert "super-secret" not in (c.detail or "")


class TestLtmDiagnostic:
    def test_ltm_diagnostic_optional_provider_id(self):
        d = LtmDiagnostic(status="ok", detail="ok")
        assert d.provider_id is None
        d2 = LtmDiagnostic(status="ok", detail="ok", provider_id="prov1")
        assert d2.provider_id == "prov1"


# ── LTM 占位 ────────────────────────────────────────


class TestLtmPlaceholders:
    def test_get_ltm_diagnostic_returns_none(self, app):
        assert get_ltm_diagnostic(app) is None

    def test_associate_ltm_provider_returns_none(self, app):
        assert associate_ltm_provider(app, None) is None
        assert associate_ltm_provider(app, LtmDiagnostic(status="ok")) is None


# ── check_llm ───────────────────────────────────────


class TestCheckLlm:
    def test_no_probe_returns_ok(self, app):
        import asyncio

        result = asyncio.run(check_llm(app, probe_remote=False))
        assert result.status == "ok"
        assert result.latency_ms == 0.0
        assert "OMP" in result.detail or "未执行" in result.detail

    def test_probe_no_sidecar_manager(self, app):
        # app.state 没有 sidecar_manager
        result = asyncio.run(check_llm(app, probe_remote=True))
        assert result.status == "error"
        assert "Sidecar" in result.detail

    def test_probe_sidecar_manager_none(self, app):
        app.state.sidecar_manager = None
        result = asyncio.run(check_llm(app, probe_remote=True))
        assert result.status == "error"
        assert "Sidecar" in result.detail

    def test_probe_client_none(self, app):
        class Mgr:
            async def start(self):
                return None

            client = None

        app.state.sidecar_manager = Mgr()
        result = asyncio.run(check_llm(app, probe_remote=True))
        assert result.status == "error"
        assert "客户端不可用" in result.detail

    def test_probe_success(self, app):
        class Client:
            async def call(self, method, params):
                return {"status": "ok"}

        class Mgr:
            async def start(self):
                return None

            client = Client()

        app.state.sidecar_manager = Mgr()
        result = asyncio.run(check_llm(app, probe_remote=True))
        assert result.status == "ok"
        assert "OMP sidecar 健康" in result.detail
        assert result.latency_ms is not None

    def test_probe_sidecar_reports_error(self, app):
        class Client:
            async def call(self, method, params):
                return {"status": "error", "message": "down"}

        class Mgr:
            async def start(self):
                return None

            client = Client()

        app.state.sidecar_manager = Mgr()
        result = asyncio.run(check_llm(app, probe_remote=True))
        assert result.status == "error"
        assert "down" in result.detail

    def test_probe_timeout(self, app):
        class Client:
            async def call(self, method, params):
                await asyncio.sleep(100)
                return {}

        class Mgr:
            async def start(self):
                return None

            client = Client()

        app.state.sidecar_manager = Mgr()
        # monkeypatch wait_for timeout via patching asyncio.wait_for is complex;
        # 直接让 client.call 抛 TimeoutError
        class TimeoutClient:
            async def call(self, method, params):
                raise asyncio.TimeoutError()

        class TimeoutMgr:
            async def start(self):
                return None

            client = TimeoutClient()

        app.state.sidecar_manager = TimeoutMgr()
        result = asyncio.run(check_llm(app, probe_remote=True))
        assert result.status == "error"
        assert "超时" in result.detail

    def test_probe_exception(self, app):
        class BoomClient:
            async def call(self, method, params):
                raise RuntimeError("boom")

        class Mgr:
            async def start(self):
                return None

            client = BoomClient()

        app.state.sidecar_manager = Mgr()
        result = asyncio.run(check_llm(app, probe_remote=True))
        assert result.status == "error"
        assert "boom" in result.detail

    def test_probe_start_raises(self, app):
        class Mgr:
            async def start(self):
                raise RuntimeError("start failed")

            client = None

        app.state.sidecar_manager = Mgr()
        result = asyncio.run(check_llm(app, probe_remote=True))
        assert result.status == "error"


# ── check_memory / check_native_tools / check_mcp_tools ──


class TestComponentChecks:
    def test_check_memory_returns_ok(self, app):
        result = asyncio.run(check_memory(app))
        assert result.status == "ok"
        assert "memory/" in result.detail or "OMP" in result.detail

    def test_check_native_tools_ok(self, app):
        result = asyncio.run(check_native_tools(app))
        assert result.status == "ok"
        assert "1" in result.detail  # 1 个工具

    def test_check_native_tools_error_when_missing(self, app):
        # 删除 native_tools 属性 → AttributeError → error
        del app.state.native_tools
        result = asyncio.run(check_native_tools(app))
        assert result.status == "error"

    def test_check_mcp_tools_with_tools(self, app):
        result = asyncio.run(check_mcp_tools(app))
        assert result.status == "ok"
        assert "1" in result.detail

    def test_check_mcp_tools_empty(self, app):
        app.state.mcp_tools = []
        result = asyncio.run(check_mcp_tools(app))
        assert result.status == "ok"
        assert "0" in result.detail

    def test_check_mcp_tools_error_when_missing(self, app):
        del app.state.mcp_tools
        result = asyncio.run(check_mcp_tools(app))
        assert result.status == "error"


# ── get_health_report ───────────────────────────────


class TestGetHealthReport:
    def test_overall_ok(self, app, monkeypatch):
        monkeypatch.setattr("config.settings.get_settings", lambda: FakeSettings())
        result = asyncio.run(get_health_report(app, probe_remote=False))
        assert isinstance(result, HealthResponse)
        assert result.status == "ok"
        assert result.llm.status == "ok"
        assert result.memory.status == "ok"
        assert result.native_tools.status == "ok"
        assert result.mcp_tools.status == "ok"
        assert result.provider_diagnostics_enabled is False
        assert result.think_path_enabled is False
        assert isinstance(result.anthropic_skills_count, int)
        assert result.timestamp > 0

    def test_degraded_when_native_tools_missing(self, app, monkeypatch):
        # native_tools 缺失 → check_native_tools 返回 error → overall degraded
        del app.state.native_tools
        monkeypatch.setattr("config.settings.get_settings", lambda: FakeSettings())
        result = asyncio.run(get_health_report(app, probe_remote=False))
        assert result.status == "degraded"
        assert result.native_tools.status == "error"


# ── check_health_sync ───────────────────────────────


class TestCheckHealthSync:
    def test_ok(self, app):
        result = check_health_sync(app)
        assert result["status"] == "ok"
        assert result["llm"]["status"] == "ok"
        assert result["memory"]["status"] == "ok"
        assert result["native_tools"]["status"] == "ok"
        assert result["native_tools"]["count"] == 1
        assert result["mcp_tools"]["status"] == "ok"

    def test_degraded_when_no_native_tools(self, app):
        app.state.native_tools = []
        result = check_health_sync(app)
        assert result["status"] == "degraded"
        assert result["native_tools"]["status"] == "degraded"

    def test_exception_returns_unknown(self, app, monkeypatch):
        # 让 getattr 抛异常：传一个非 app 的对象
        result = check_health_sync(object())  # type: ignore[arg-type]
        assert result["status"] == "unknown"
        assert result["llm"]["status"] == "unknown"
