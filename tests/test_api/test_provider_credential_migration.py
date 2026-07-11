"""Provider credential envelope migration tests.

These tests use real local crypto primitives but never print credential values.
"""

from __future__ import annotations

import pytest
import yaml

from api.providers.store import ProviderConfigStore
from api.security.credential_envelope import is_credential_envelope, parse_credential_envelope
from tools import crypto


_TEST_KEY = "provider-credential-migration-test-key"


def _provider_data(api_key: str) -> dict:
    return {
        "id": "migration-provider",
        "provider_type": "openai",
        "label": "Migration Provider",
        "api_key": api_key,
        "base_url": "https://api.example.test/v1",
        "models": ["example-model"],
        "enabled": True,
        "context_window": 8192,
        "priority": 0,
    }


def test_new_credentials_use_a_versioned_envelope_without_plaintext():
    stored = crypto.encrypt_value(_TEST_KEY)

    assert is_credential_envelope(stored)
    assert _TEST_KEY not in stored
    assert crypto.decrypt_value(stored) == _TEST_KEY

    envelope = parse_credential_envelope(stored)
    assert envelope.version == 1
    assert envelope.algorithm in {"dpapi-current-user", "fernet"}
    assert envelope.key_id
    assert envelope.ciphertext


def test_yaml_plaintext_is_migrated_atomically_with_an_encrypted_backup(tmp_path):
    yaml_path = tmp_path / "providers.yaml"
    backup_path = tmp_path / "credential-backup.yaml"
    yaml_path.write_text(yaml.safe_dump({"providers": [_provider_data(_TEST_KEY)]}), encoding="utf-8")
    store = ProviderConfigStore(yaml_path, migration_backup_path=backup_path)

    configs = store.load_all()

    assert configs[0].api_key == _TEST_KEY
    stored_text = yaml_path.read_text(encoding="utf-8")
    backup_text = backup_path.read_text(encoding="utf-8")
    assert _TEST_KEY not in stored_text
    assert _TEST_KEY not in backup_text
    assert yaml.safe_load(stored_text)["providers"][0]["api_key"].startswith("encv1:")
    assert yaml.safe_load(backup_text)["providers"][0]["api_key"].startswith("encv1:")


def test_yaml_legacy_ciphertext_is_migrated_once_and_remains_readable(tmp_path):
    yaml_path = tmp_path / "providers.yaml"
    legacy_value = crypto._encrypt_legacy_value(_TEST_KEY)
    yaml_path.write_text(yaml.safe_dump({"providers": [_provider_data(legacy_value)]}), encoding="utf-8")
    store = ProviderConfigStore(yaml_path, migration_backup_path=tmp_path / "backup.yaml")

    assert store.load_all()[0].api_key == _TEST_KEY
    first_migrated_value = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))["providers"][0]["api_key"]
    assert first_migrated_value.startswith("encv1:")

    assert store.load_all()[0].api_key == _TEST_KEY
    assert yaml.safe_load(yaml_path.read_text(encoding="utf-8"))["providers"][0]["api_key"] == first_migrated_value


def test_yaml_interrupted_migration_preserves_live_file_and_can_recover(tmp_path, monkeypatch):
    yaml_path = tmp_path / "providers.yaml"
    backup_path = tmp_path / "backup.yaml"
    yaml_path.write_text(yaml.safe_dump({"providers": [_provider_data(_TEST_KEY)]}), encoding="utf-8")
    store = ProviderConfigStore(yaml_path, migration_backup_path=backup_path)

    def fail_atomic_write(*_args, **_kwargs):
        raise OSError("simulated interruption")

    with monkeypatch.context() as scoped:
        scoped.setattr("api.providers.store.dump_yaml_atomic", fail_atomic_write)
        assert store.load_all()[0].api_key == _TEST_KEY

    assert _TEST_KEY in yaml_path.read_text(encoding="utf-8")
    assert _TEST_KEY not in backup_path.read_text(encoding="utf-8")

    assert store.load_all()[0].api_key == _TEST_KEY
    assert _TEST_KEY not in yaml_path.read_text(encoding="utf-8")


def test_yaml_corrupt_ciphertext_is_not_overwritten(tmp_path):
    yaml_path = tmp_path / "providers.yaml"
    corrupt = "encv1:not-valid"
    yaml_path.write_text(yaml.safe_dump({"providers": [_provider_data(corrupt)]}), encoding="utf-8")
    store = ProviderConfigStore(yaml_path, migration_backup_path=tmp_path / "backup.yaml")

    config = store.load_all()[0]

    assert config.api_key == corrupt
    assert corrupt in yaml_path.read_text(encoding="utf-8")
    assert not (tmp_path / "backup.yaml").exists()


@pytest.fixture
def isolated_provider_db(monkeypatch, tmp_path):
    import api.db.core as core
    import api.db.providers as providers_db

    db_path = tmp_path / "maxma.db"
    backup_path = tmp_path / "maxma.migration.bak"
    monkeypatch.setattr(core, "DB_DIR", tmp_path)
    monkeypatch.setattr(core, "DB_PATH", db_path)
    monkeypatch.setattr(core, "_db_initialized", False)
    monkeypatch.setattr(providers_db, "PROVIDER_DB_CREDENTIAL_BACKUP_PATH", backup_path)
    core.initialize_database()
    return core, providers_db.ProviderDbStore(), db_path, backup_path


@pytest.mark.parametrize("legacy", [False, True])
def test_sqlite_old_credential_migrates_in_one_transaction(isolated_provider_db, legacy):
    core, store, db_path, backup_path = isolated_provider_db
    old_value = crypto._encrypt_legacy_value(_TEST_KEY) if legacy else _TEST_KEY
    provider = _provider_data(old_value)
    with core.transaction() as db:
        db.execute(
            """INSERT INTO providers (id, provider_type, label, api_key, base_url, models,
               enabled, context_window, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                provider["id"], provider["provider_type"], provider["label"], provider["api_key"],
                provider["base_url"], "[\"example-model\"]", 1, provider["context_window"], 0,
            ),
        )

    assert store.get(provider["id"]).api_key == _TEST_KEY
    with core.transaction() as db:
        stored = db.execute("SELECT api_key FROM providers WHERE id = ?", (provider["id"],)).fetchone()[0]
    assert stored.startswith("encv1:")
    assert _TEST_KEY not in db_path.read_bytes().decode("latin1")
    assert backup_path.exists()


def test_sqlite_corrupt_ciphertext_is_not_overwritten(isolated_provider_db):
    core, store, _db_path, backup_path = isolated_provider_db
    corrupt = "encv1:not-valid"
    provider = _provider_data(corrupt)
    with core.transaction() as db:
        db.execute(
            """INSERT INTO providers (id, provider_type, label, api_key, base_url, models,
               enabled, context_window, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                provider["id"], provider["provider_type"], provider["label"], corrupt,
                provider["base_url"], "[]", 1, provider["context_window"], 0,
            ),
        )

    assert store.get(provider["id"]).api_key == ""
    with core.transaction() as db:
        assert db.execute("SELECT api_key FROM providers WHERE id = ?", (provider["id"],)).fetchone()[0] == corrupt
    assert not backup_path.exists()
