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
