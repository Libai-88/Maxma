"""Tests for provider route runtime refresh behavior."""

import asyncio
import importlib.util
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest


def _load_providers_module():
    module_path = Path(__file__).resolve().parents[2] / "api" / "routes" / "providers.py"
    spec = importlib.util.spec_from_file_location("providers_under_test", module_path)
    module = importlib.util.module_from_spec(spec)

    fake_modules: dict[str, types.ModuleType] = {}

    def add_module(name: str, module_obj: types.ModuleType):
        fake_modules[name] = sys.modules.get(name)
        sys.modules[name] = module_obj

    class _Router:
        def get(self, *args, **kwargs):
            return lambda fn: fn

        def post(self, *args, **kwargs):
            return lambda fn: fn

        def put(self, *args, **kwargs):
            return lambda fn: fn

        def delete(self, *args, **kwargs):
            return lambda fn: fn

    fastapi = types.ModuleType("fastapi")
    fastapi.APIRouter = _Router
    fastapi.HTTPException = type("HTTPException", (Exception,), {})
    fastapi.Request = object
    add_module("fastapi", fastapi)

    pydantic = types.ModuleType("pydantic")
    pydantic.BaseModel = object
    add_module("pydantic", pydantic)

    api_providers = types.ModuleType("api.providers")
    api_providers.ProviderConfig = object
    add_module("api.providers", api_providers)

    api_dependencies = types.ModuleType("api.dependencies")
    api_dependencies.get_llm = lambda provider_manager: None
    add_module("api.dependencies", api_dependencies)

    previous_api = sys.modules.get("api")
    if previous_api is None:
        api_pkg = types.ModuleType("api")
        api_pkg.__path__ = []
        sys.modules["api"] = api_pkg

    try:
        spec.loader.exec_module(module)
    finally:
        for name, previous in fake_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous
        if previous_api is None:
            sys.modules.pop("api", None)

    return module, api_dependencies


providers, fake_dependencies = _load_providers_module()


def test_maybe_initialize_llm_clears_stale_runtime_when_no_provider(monkeypatch):
    old_llm = object()
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                llm=old_llm,
                provider_manager=object(),
            )
        )
    )

    monkeypatch.setattr(
        fake_dependencies,
        "get_llm",
        lambda provider_manager: (_ for _ in ()).throw(RuntimeError("No enabled LLM provider configured")),
    )
    monkeypatch.setitem(sys.modules, "api.dependencies", fake_dependencies)

    asyncio.run(providers._maybe_initialize_llm(request, force=True))

    assert request.app.state.llm is None


def test_maybe_initialize_llm_replaces_runtime_on_force_refresh(monkeypatch):
    new_llm = object()
    calls: list[tuple[object, object]] = []
    ltm = SimpleNamespace(
        start_listening=lambda llm, ws_registry: calls.append((llm, ws_registry))
    )
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                llm=object(),
                provider_manager=object(),
                ltm=ltm,
                ws_registry=object(),
            )
        )
    )

    fake_dependencies.get_llm = lambda provider_manager: new_llm
    monkeypatch.setitem(sys.modules, "api.dependencies", fake_dependencies)

    asyncio.run(providers._maybe_initialize_llm(request, force=True))

    assert request.app.state.llm is new_llm
    assert calls == [(new_llm, request.app.state.ws_registry)]
