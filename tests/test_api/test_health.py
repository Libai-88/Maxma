from pathlib import Path
from types import SimpleNamespace

import pytest

import api.health as health


class _DummyMemoryManager:
    def __init__(self, yaml_file: str):
        self.yaml_file = yaml_file

    def show(self):
        return [{"id": "m1"}]


class _DummyProvider:
    def __init__(self, name: str, calls: list[str]):
        self.provider_name = name
        self._calls = calls

    async def check_health(self):
        self._calls.append(self.provider_name)
        return SimpleNamespace(status="ok", latency_ms=12.3, detail="remote ok")


def _build_app(provider, llm=object()):
    manager = SimpleNamespace(
        count=1,
        iter_enabled=lambda: [provider],
    )
    state = SimpleNamespace(
        provider_manager=manager,
        llm=llm,
        ltm=SimpleNamespace(is_listening=True),
        native_tools=["tool-a"],
        mcp_tools=[],
    )
    return SimpleNamespace(state=state)


@pytest.mark.asyncio
async def test_health_report_is_lightweight_by_default(monkeypatch, tmp_path: Path):
    calls: list[str] = []
    provider = _DummyProvider("demo", calls)
    app = _build_app(provider)
    memory_path = tmp_path / "memory.yaml"
    memory_path.write_text("[]", encoding="utf-8")

    monkeypatch.setattr(health, "MEMORY_PATH", memory_path)
    monkeypatch.setattr(health, "MemoryManager", _DummyMemoryManager)

    report = await health.get_health_report(app)

    assert calls == []
    assert report.llm.status == "ok"
    assert "未执行远端探测" in (report.llm.detail or "")
    assert report.providers["demo"].status == "ok"
    assert report.providers["demo"].detail == "已配置，未执行远端探测"
    assert report.think_path_enabled is False


@pytest.mark.asyncio
async def test_health_report_exposes_server_owned_think_path_capability(monkeypatch, tmp_path: Path):
    from config.settings import get_settings

    calls: list[str] = []
    provider = _DummyProvider("demo", calls)
    app = _build_app(provider)
    memory_path = tmp_path / "memory.yaml"
    memory_path.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(health, "MEMORY_PATH", memory_path)
    monkeypatch.setattr(health, "MemoryManager", _DummyMemoryManager)
    monkeypatch.setattr(get_settings(), "think_path_enabled", True)

    report = await health.get_health_report(app)

    assert report.think_path_enabled is True


@pytest.mark.asyncio
async def test_health_report_full_mode_probes_remote_provider(monkeypatch, tmp_path: Path):
    calls: list[str] = []
    provider = _DummyProvider("demo", calls)
    app = _build_app(provider)
    memory_path = tmp_path / "memory.yaml"
    memory_path.write_text("[]", encoding="utf-8")

    monkeypatch.setattr(health, "MEMORY_PATH", memory_path)
    monkeypatch.setattr(health, "MemoryManager", _DummyMemoryManager)

    report = await health.get_health_report(app, probe_remote=True)

    assert calls == ["demo", "demo"]
    assert report.llm.status == "ok"
    assert report.providers["demo"].detail == "remote ok"


@pytest.mark.asyncio
async def test_health_report_surfaces_safe_ltm_diagnostic_for_current_provider(
    monkeypatch, tmp_path: Path
):
    from config.settings import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "provider_diagnostics_enabled", False)
    calls: list[str] = []
    provider = _DummyProvider("demo", calls)
    mapped_provider = SimpleNamespace(config=SimpleNamespace(id="demo"))
    manager = SimpleNamespace(
        count=1,
        iter_enabled=lambda: [provider],
        find_provider_for_llm=lambda llm: mapped_provider,
    )
    ltm = SimpleNamespace(
        is_listening=True,
        get_diagnostic_summary=lambda: {
            "status": "error",
            "reason_code": "authentication_failed",
            "retry_at": None,
            "updated_at": 123.0,
            "summary": "Long-term memory could not authenticate.",
            # The public API must never expose an internal exception/payload.
            "last_error": "Authorization: Bearer secret-value",
            "payload": "private conversation",
        },
    )
    app = SimpleNamespace(
        state=SimpleNamespace(
            provider_manager=manager,
            llm=SimpleNamespace(model_name="demo-model"),
            ltm=ltm,
            native_tools=["tool-a"],
            mcp_tools=[],
        )
    )
    memory_path = tmp_path / "memory.yaml"
    memory_path.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(health, "MEMORY_PATH", memory_path)
    monkeypatch.setattr(health, "MemoryManager", _DummyMemoryManager)

    disabled_report = await health.get_health_report(app)
    assert disabled_report.status == "ok"
    assert disabled_report.memory.status == "ok"
    assert disabled_report.ltm is not None

    monkeypatch.setattr(settings, "provider_diagnostics_enabled", True)
    report = await health.get_health_report(app)
    payload = report.model_dump_json()

    assert report.status == "degraded"
    assert report.memory.status == "degraded"
    assert report.memory.reason_code == "authentication_failed"
    assert report.ltm is not None
    assert report.ltm.provider_id == "demo"
    assert report.ltm.summary == "Long-term memory could not authenticate."
    assert "secret-value" not in payload
    assert "private conversation" not in payload
