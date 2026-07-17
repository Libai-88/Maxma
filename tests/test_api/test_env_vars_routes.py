"""测试 — api/routes/env_vars.py 环境变量管理。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import env_vars as env_mod
from api.routes.env_vars import router


@pytest.fixture
def client(monkeypatch, tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text("", encoding="utf-8")
    monkeypatch.setattr(env_mod, "ENV_PATH", env_path)
    # 默认 stub：无已知值
    monkeypatch.setattr(env_mod, "dotenv_values", lambda *a, **k: {})
    monkeypatch.setattr(env_mod, "reload_settings", lambda: None)
    monkeypatch.setattr(env_mod, "_refresh_runtime_settings", lambda: None)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


class TestMaskValue:
    def test_short_value(self):
        # len <= 8 → value[:2] + "****"
        assert env_mod._mask_value("abc") == "ab****"

    def test_long_value(self):
        # len > 8 → value[:4] + "****" + value[-4:]
        v = "abcdefghijklmnop"
        assert env_mod._mask_value(v) == "abcd****mnop"

    def test_empty_value(self):
        # len("") == 0 <= 8 → ""[:2] + "****" = "****"
        assert env_mod._mask_value("") == "****"


class TestRefreshRuntimeSettings:
    def test_populates_environ_for_known_keys(self, monkeypatch, tmp_path):
        env_path = tmp_path / ".env"
        env_path.write_text("", encoding="utf-8")
        monkeypatch.setattr(env_mod, "ENV_PATH", env_path)
        # 模拟 dotenv_values 返回部分已知 key
        monkeypatch.setattr(
            env_mod,
            "dotenv_values",
            lambda *a, **k: {"ZHIPUAI_API_KEY": "zhi", "TODOIST_API_TOKEN": "todo"},
        )
        reloaded = {"called": False}

        def fake_reload():
            reloaded["called"] = True

        monkeypatch.setattr("api.routes.env_vars.reload_settings", fake_reload)
        # 清理已知 key 的 environ
        import os

        for k in env_mod.ENV_VAR_META:
            os.environ.pop(k, None)

        env_mod._refresh_runtime_settings()

        assert os.environ.get("ZHIPUAI_API_KEY") == "zhi"
        assert os.environ.get("TODOIST_API_TOKEN") == "todo"
        # 未提供的已知 key 应被 pop 掉
        assert "UAPIS_API_KEY" not in os.environ
        assert reloaded["called"] is True

        # 清理
        for k in env_mod.ENV_VAR_META:
            os.environ.pop(k, None)


class TestListEnvVars:
    def test_list_returns_all_known_keys(self, client, monkeypatch):
        # 模拟 settings 属性 + dotenv 值
        class FakeSettings:
            zhipuai_api_key = "abcdefghijk"  # len > 8
            todoist_api_token = ""
            uapis_api_key = ""
            amap_api_key = ""
            tavily_api_key = ""

        monkeypatch.setattr(env_mod, "get_settings", lambda: FakeSettings())
        monkeypatch.setattr(env_mod, "dotenv_values", lambda *a, **k: {})

        resp = client.get("/env-vars")
        assert resp.status_code == 200
        body = resp.json()
        keys = {item["key"] for item in body["env_vars"]}
        assert keys == set(env_mod.ENV_VAR_META.keys())
        # 已设置的 key 应 is_set=True 且 value 脱敏
        zhipu = next(i for i in body["env_vars"] if i["key"] == "ZHIPUAI_API_KEY")
        assert zhipu["is_set"] is True
        assert zhipu["value"] == "abcd****hijk"
        assert zhipu["label"] == env_mod.ENV_VAR_META["ZHIPUAI_API_KEY"]["label"]
        # 未设置的 key 应 is_set=False 且 value 为空
        todo = next(i for i in body["env_vars"] if i["key"] == "TODOIST_API_TOKEN")
        assert todo["is_set"] is False
        assert todo["value"] == ""

    def test_list_uses_dotenv_fallback_when_settings_missing(self, client, monkeypatch):
        class FakeSettings:
            zhipuai_api_key = None
            todoist_api_token = None
            uapis_api_key = None
            amap_api_key = None
            tavily_api_key = None

        monkeypatch.setattr(env_mod, "get_settings", lambda: FakeSettings())
        monkeypatch.setattr(
            env_mod, "dotenv_values", lambda *a, **k: {"TAVILY_API_KEY": "tavilyval"}
        )

        resp = client.get("/env-vars")
        body = resp.json()
        tav = next(i for i in body["env_vars"] if i["key"] == "TAVILY_API_KEY")
        assert tav["is_set"] is True
        assert tav["value"]  # 脱敏非空


class TestUpdateEnvVar:
    def test_unknown_key_400(self, client):
        resp = client.put("/env-vars", json={"key": "UNKNOWN_KEY", "value": "v"})
        assert resp.status_code == 400
        assert "未知环境变量" in resp.json()["detail"]

    def test_empty_value_400(self, client):
        resp = client.put(
            "/env-vars", json={"key": "ZHIPUAI_API_KEY", "value": ""}
        )
        assert resp.status_code == 400
        assert "不能为空" in resp.json()["detail"]

    def test_success(self, client, monkeypatch):
        called = {"set_key": None, "refreshed": False}

        def fake_set_key(path, key, value):
            called["set_key"] = (str(path), key, value)
            return None

        monkeypatch.setattr(env_mod, "set_key", fake_set_key)

        def fake_refresh():
            called["refreshed"] = True

        monkeypatch.setattr(env_mod, "_refresh_runtime_settings", fake_refresh)

        resp = client.put(
            "/env-vars", json={"key": "ZHIPUAI_API_KEY", "value": "abcdefghijk"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["key"] == "ZHIPUAI_API_KEY"
        assert body["masked_value"] == "abcd****hijk"
        assert called["set_key"][1] == "ZHIPUAI_API_KEY"
        assert called["refreshed"] is True

    def test_set_key_failure_500(self, client, monkeypatch):
        def boom(*a, **k):
            raise OSError("disk full")

        monkeypatch.setattr(env_mod, "set_key", boom)
        resp = client.put(
            "/env-vars", json={"key": "ZHIPUAI_API_KEY", "value": "v"}
        )
        assert resp.status_code == 500
        assert "写入 .env 失败" in resp.json()["detail"]


class TestBatchUpdate:
    def test_skips_unknown_and_empty(self, client, monkeypatch):
        set_calls = []

        def fake_set_key(path, key, value):
            set_calls.append((key, value))
            return None

        monkeypatch.setattr(env_mod, "set_key", fake_set_key)
        monkeypatch.setattr(env_mod, "_refresh_runtime_settings", lambda: None)

        resp = client.put(
            "/env-vars/batch",
            json={
                "env_vars": [
                    {"key": "ZHIPUAI_API_KEY", "value": "abcdefghijk"},
                    {"key": "UNKNOWN_KEY", "value": "x"},  # 跳过
                    {"key": "TODOIST_API_TOKEN", "value": ""},  # 跳过
                    {"key": "TAVILY_API_KEY", "value": "tavilyval1"},
                ]
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        updated_keys = {u["key"] for u in body["updated"]}
        assert updated_keys == {"ZHIPUAI_API_KEY", "TAVILY_API_KEY"}
        # 只对两个有效项调用 set_key
        assert len(set_calls) == 2
        # 每项都有 masked_value
        for u in body["updated"]:
            assert "masked_value" in u

    def test_set_key_failure_500(self, client, monkeypatch):
        def boom(path, key, value):
            if key == "TAVILY_API_KEY":
                raise OSError("boom")

        monkeypatch.setattr(env_mod, "set_key", boom)
        resp = client.put(
            "/env-vars/batch",
            json={
                "env_vars": [
                    {"key": "ZHIPUAI_API_KEY", "value": "v1"},
                    {"key": "TAVILY_API_KEY", "value": "v2"},
                ]
            },
        )
        assert resp.status_code == 500
        assert "TAVILY_API_KEY" in resp.json()["detail"]

    def test_empty_batch_returns_empty_updated(self, client, monkeypatch):
        monkeypatch.setattr(env_mod, "set_key", lambda *a, **k: None)
        monkeypatch.setattr(env_mod, "_refresh_runtime_settings", lambda: None)
        resp = client.put("/env-vars/batch", json={"env_vars": []})
        assert resp.status_code == 200
        assert resp.json()["updated"] == []
