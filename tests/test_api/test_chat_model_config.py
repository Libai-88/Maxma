from __future__ import annotations

import pytest

from api.routes import chat as chat_mod
from api.routes import providers as providers_mod
from api.security.credential_envelope import parse_credential_envelope
from api.yaml_store import dump_yaml_atomic


def test_resolve_chat_model_uses_selected_provider_configuration():
    config = chat_mod._resolve_chat_model("本地", "combo")

    assert config["model"] == "combo"
    assert config["base_url"] == "http://localhost:20128/v1"
    assert config["api_key"]


def _write_provider(path, api_key):
    dump_yaml_atomic(
        path,
        {
            "providers": [
                {
                    "id": "runtime",
                    "provider_type": "openai",
                    "label": "Runtime",
                    "api_key": api_key,
                    "base_url": "https://api.example.test/v1",
                    "models": ["runtime-model"],
                    "enabled": True,
                }
            ]
        },
    )


@pytest.mark.parametrize(
    ("stored_value", "expected_key"),
    [("", ""), ("plain-compatible-key", "plain-compatible-key"), ("encv1:invalid", "")],
)
def test_resolve_chat_model_api_key_contract(
    tmp_path, monkeypatch, stored_value, expected_key
):
    path = tmp_path / "providers.yaml"
    monkeypatch.setattr(chat_mod, "PROVIDERS_YAML_PATH", path)
    monkeypatch.setattr(providers_mod, "PROVIDERS_YAML_PATH", path)
    _write_provider(path, stored_value)

    config = chat_mod._resolve_chat_model("runtime", "runtime-model")

    assert config["api_key"] == expected_key


def test_resolve_chat_model_decrypts_current_and_legacy_credentials(
    tmp_path, monkeypatch
):
    key_path = tmp_path / "credential.key"
    monkeypatch.setattr(providers_mod, "_CREDENTIAL_KEY_PATH", key_path)
    current_value = providers_mod._encrypt_api_key("runtime-secret")
    legacy_value = "enc:" + parse_credential_envelope(current_value).ciphertext
    path = tmp_path / "providers.yaml"
    monkeypatch.setattr(chat_mod, "PROVIDERS_YAML_PATH", path)
    monkeypatch.setattr(providers_mod, "PROVIDERS_YAML_PATH", path)

    for stored_value in (current_value, legacy_value):
        _write_provider(path, stored_value)
        config = chat_mod._resolve_chat_model("runtime", "runtime-model")
        assert config["api_key"] == "runtime-secret"
        assert stored_value not in config["api_key"]
