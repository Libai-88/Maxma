# Security Module Coverage Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase coverage for 7 security-critical modules (`api/security/credential_envelope.py` 0%, `api/security/credential_mask.py` 0%, `api/security/__init__.py` 0%, `api/db/auth.py` 32%, `api/db/hooks.py` 0%, `api/db/providers.py` 0%, `api/dependencies.py` 0%) to 70%+ each.

**Architecture:** Read each module's source → design supplementary tests for happy path + security boundaries (empty input, malformed input, injection attempts) → implement → verify by running pytest + ruff → commit per module. Only create new test files; do not modify production source.

**Tech Stack:** Python 3.13, pytest, pytest-cov, security testing.

---

## Baseline (measured 2026-07-17)

```
Name                                  Stmts   Miss  Cover   Missing
api\db\auth.py                           19     13    32%   15-26, 31-35
api\db\hooks.py                          33     33     0%   5-65
api\db\providers.py                      15     15     0%   8-31
api\dependencies.py                      11     11     0%   3-20
api\security\__init__.py                  2      2     0%   8-15
api\security\credential_envelope.py      48     48     0%   9-109
api\security\credential_mask.py          32     32     0%   12-111
```

### Missing-line summary per module

- **credential_envelope.py**: 9-109 — 整个文件未覆盖。需要覆盖 `create_credential_envelope` / `parse_credential_envelope` / `decrypt_credential_envelope` / `is_credential_envelope` / `is_legacy_encrypted` / `CredentialEnvelopeError`。
- **credential_mask.py**: 12-111 — 整个文件未覆盖。需要覆盖 `is_sensitive_key` / `mask_sensitive_fields` / `unmask_sentinels`。
- **db/auth.py**: 15-26 (load_or_create_token SELECT + INSERT 路径), 31-35 (rotate_token)。
- **db/hooks.py**: 5-65 — 整个文件未覆盖。`HookDbStore.load_all/get/save/delete` 四个方法。
- **db/providers.py**: 8-31 — 整个文件未覆盖。STUB 类，所有方法都是 no-op。
- **dependencies.py**: 3-20 — `get_system_prompt` / `get_tools` 单例缓存。
- **security/__init__.py**: 8-15 — 仅 re-export，靠子模块测试联动触发。

---

## Constraints

- **Only create new test files** under `tests/test_api/`.
- **Do NOT modify** any production source under `api/` or `agent/`.
- **Do NOT modify** other agents' files: `agent/`, `api/routes/`, `api/pi_bridge/`, `bun-sidecar/`, `web/`, `pyproject.toml`, `requirements-lock.txt`, existing tests, `.github/workflows/`.
- Run tests: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -v`
- Run ruff: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`
- Commit after each module's tests pass with message format `test(security): cover <module>`.

### Shared DB isolation pattern

`api/db/auth.py` / `api/db/hooks.py` 都通过 `from api.db.core import transaction` 直接使用全局 `DB_PATH`。测试隔离采用：

```python
@pytest.fixture
def isolated_db(tmp_path, monkeypatch):
    """重定向 DB_PATH 到 tmp_path，并初始化 schema。"""
    import api.db.core as db_core
    test_db = tmp_path / "test_security.db"
    monkeypatch.setattr(db_core, "DB_PATH", test_db)
    monkeypatch.setattr(db_core, "_db_initialized", False)
    db_core.initialize_database()
    yield test_db
    # 清理可能存在的 .wal/.shm
    for suffix in ["", "-wal", "-shm"]:
        p = tmp_path / f"test_security.db{suffix}"
        if p.exists():
            p.unlink()
```

这样能保证测试间 DB 隔离，且不会污染真实 `~/.maxma` 数据。

---

## Task 1: `api/security/credential_envelope.py` (0% → 95%+)

**Why:** 凭据封装的最高安全优先级 — 直接关系到磁盘上凭据的加密/解密。整个模块都是纯函数 + dataclass，无外部依赖，最易覆盖。

**Files:**
- Create: `tests/test_api/test_credential_envelope.py`

**Tests:**

### `is_credential_envelope` / `is_legacy_encrypted`
- `test_is_credential_envelope_true` — `encv1:xxx` → True
- `test_is_credential_envelope_false_for_plain` — `"plaintext"` → False
- `test_is_credential_envelope_false_for_legacy_enc` — `enc:xxx` → False（区分新旧格式）
- `test_is_credential_envelope_false_for_non_string` — None / int / bytes → False
- `test_is_legacy_encrypted_true` — `enc:xxx` → True
- `test_is_legacy_encrypted_false_for_new_format` — `encv1:xxx` → False
- `test_is_legacy_encrypted_false_for_non_string`

### `create_credential_envelope`
- `test_create_returns_encv1_prefixed_string` — 返回值以 `encv1:` 开头
- `test_create_uses_encrypt_payload_result` — encrypt_payload 返回 `enc:ct`，验证 base64 解码后 ct 字段为 `ct`
- `test_create_payload_includes_alg_kid_v` — 解析 envelope，验证 `alg` / `kid` / `v=1`
- `test_create_raises_when_encrypt_payload_not_legacy_prefixed` — encrypt_payload 返回 `"raw"` → `CredentialEnvelopeError`
- `test_create_with_empty_plaintext` — 空字符串 plaintext 也能封装（边界场景）
- `test_create_with_unicode_plaintext` — 中文/emoji 测试（边界场景）
- `test_create_with_long_plaintext` — 10KB 字符串（边界场景）

### `parse_credential_envelope`
- `test_parse_round_trip` — create → parse，字段一致
- `test_parse_raises_when_not_envelope` — `"plaintext"` → `CredentialEnvelopeError("not a credential envelope")`
- `test_parse_raises_when_invalid_base64` — `encv1:@@@@invalid` → `CredentialEnvelopeError` ("invalid credential envelope encoding")
- `test_parse_raises_when_payload_not_dict` — base64(JSON list) → "unsupported credential envelope version" 或 "invalid fields"
- `test_parse_raises_when_wrong_version` — `{"v": 99}` → "unsupported credential envelope version"
- `test_parse_raises_when_missing_alg` — `{"v":1,"kid":"k","ct":"c"}` → "invalid fields"
- `test_parse_raises_when_empty_string_field` — `{"v":1,"alg":"","kid":"k","ct":"c"}` → "invalid fields"
- `test_parse_raises_when_missing_kid` / `_ct`
- `test_parse_with_padding_missing` — base64 末尾无 `=`，应自动 padding 补齐

### `decrypt_credential_envelope`
- `test_decrypt_round_trip` — create → decrypt，明文一致
- `test_decrypt_passes_legacy_prefix_to_decrypt_payload` — 验证 decrypt_payload 接收到 `enc:` + ciphertext
- `test_decrypt_raises_when_algorithm_mismatch` — envelope.algorithm != supported_algorithm → `CredentialEnvelopeError`
- `test_decrypt_returns_decrypt_payload_result` — decrypt_payload 返回 `"decrypted_value"`，函数返回该值

### 边界与安全场景
- `test_envelope_prefix_constant` — `ENVELOPE_PREFIX="encv1:"`，`LEGACY_PREFIX="enc:"`，`ENVELOPE_VERSION=1` 常量值验证
- `test_credential_envelope_error_is_value_error_subclass` — `CredentialEnvelopeError` 是 `ValueError` 子类
- `test_credential_envelope_dataclass_frozen` — `CredentialEnvelope` 实例 frozen，赋值应 raise `FrozenInstanceError`
- `test_create_does_not_leak_plaintext_into_payload` — 验证 payload 中不出现原始 plaintext（除通过 encrypt_payload 加密外）

- [ ] **Step 1:** 写测试文件 `tests/test_api/test_credential_envelope.py`。
- [ ] **Step 2:** 运行 `pytest tests/test_api/test_credential_envelope.py -v` → 全部 PASS。
- [ ] **Step 3:** 运行 ruff → 无 E9/F63/F7/F821 错误。
- [ ] **Step 4:** 提交 `test(security): cover credential_envelope create/parse/decrypt`。

---

## Task 2: `api/security/credential_mask.py` (0% → 95%+)

**Why:** 凭据脱敏层 — 所有离开进程边界的配置都需脱敏。安全重要性最高。模块是纯函数，无外部依赖。

**Files:**
- Create: `tests/test_api/test_credential_mask.py`

**Tests:**

### `is_sensitive_key`
- `test_is_sensitive_key_explicit_fields` — `api_key`/`apikey`/`token`/`secret`/`password`/`credential`/`credentials`/`access_token`/`accesstoken`/`refresh_token`/`refreshtoken`/`auth_token`/`authtoken`/`private_key`/`privatekey` → True
- `test_is_sensitive_key_case_insensitive_explicit` — `API_KEY` / `ApiKey` → True（lower 匹配）
- `test_is_sensitive_key_pattern_match_key` — `my_key`/`api_key_id` → True（正则匹配 `key` 词根）
- `test_is_sensitive_key_pattern_match_token` — `auth_token_value` → True
- `test_is_sensitive_key_pattern_match_secret` — `client_secret_v2` → True
- `test_is_sensitive_key_pattern_match_password` — `user_password` → True
- `test_is_sensitive_key_pattern_match_credential` — `aws_credential` → True
- `test_is_sensitive_key_pattern_match_auth` — `auth_header` → True
- `test_is_sensitive_key_false_for_safe_keys` — `name`/`label`/`base_url`/`enabled`/`models`/`created_at` → False
- `test_is_sensitive_key_false_for_empty_string` — `""` → False
- `test_is_sensitive_key_false_for_random_string` — `foo`/`bar` → False

### `mask_sensitive_fields`
- `test_mask_simple_dict` — `{"api_key":"sk-xxx","name":"foo"}` → `{"api_key":"***","name":"foo"}`
- `test_mask_nested_dict` — `{"outer":{"token":"abc","label":"x"}}` → 外层不变，inner token 替换
- `test_mask_does_not_modify_original` — 原始 dict 引用不变
- `test_mask_none_value_kept_as_none` — `{"api_key": None}` → `{"api_key": None}`（v is None 不替换）
- `test_mask_list_of_dicts` — `[{"api_key":"a"},{"name":"b"}]` → 列表内 dict 递归处理
- `test_mask_empty_dict` — `{}` → `{}`
- `test_mask_empty_list` — `[]` → `[]`
- `test_mask_scalar_passthrough` — `"hello"` / `42` / `True` → 原值
- `test_mask_nested_list_in_dict` — `{"items":[{"token":"a"}]}` → 内层递归
- `test_mask_deeply_nested` — 3 层嵌套 dict 递归到底
- `test_mask_multiple_sensitive_keys_in_same_dict` — 同时存在 api_key + token + secret

### `unmask_sentinels`
- `test_unmask_replaces_sentinel_with_original` — `{"api_key":"***","name":"x"}` + original `{"api_key":"sk-real","name":"x"}` → `{"api_key":"sk-real","name":"x"}`
- `test_unmask_keeps_non_sentinel_values` — `{"api_key":"new-val","name":"x"}` → `{"api_key":"new-val","name":"x"}`（new-val 不是 *** 保留）
- `test_unmask_sentinel_missing_in_original_defaults_to_empty_string` — `{"api_key":"***"}` + original `{"name":"x"}` → `{"api_key":""}`
- `test_unmask_recurses_nested_dict` — `{"env":{"token":"***"}}` + original `{"env":{"token":"real"}}` → 嵌套 sentinel 替换
- `test_unmask_skips_nested_when_original_not_dict` — `{"env":{"token":"***"}}` + original `{"env":"str"}` → 不递归，但顶层 value 不是 sentinel，原样返回
- `test_unmask_does_not_modify_received_input` — received dict 引用不变
- `test_unmask_empty_received` — `{}` → `{}`
- `test_unmask_no_overlap` — received 和 original 完全不同的 key → received 原样返回
- `test_unmask_only_exact_sentinel_string_replaced` — `"****"` (4 个星) 不替换为 original（必须是精确 `***`）
- `test_unmask_mixed_sentinel_and_real_values` — 混合场景

### 边界与安全场景
- `test_mask_sentinel_constant` — `MASK_SENTINEL == "***"`
- `test_mask_injection_attempt_in_key_name` — `"api_key; DROP TABLE--"` 不在敏感列表 → False（注入尝试）
- `test_mask_key_with_sql_injection_pattern` — `"name; SELECT * FROM users"` → False（key 名本身不含敏感词根）
- `test_mask_dict_with_non_string_keys` — `{1:"v"}` → key 是 int，`is_sensitive_key(int)` 应处理（注意：源码 `key.lower()` 假设 str，会 raise AttributeError？需验证）
- `test_mask_preserves_non_sensitive_complex_values` — `{"models":[{"id":"gpt-4"}]}` → list 整体保留

- [ ] **Step 1:** 写测试文件 `tests/test_api/test_credential_mask.py`。
- [ ] **Step 2:** 运行 `pytest tests/test_api/test_credential_mask.py -v` → 全部 PASS。
- [ ] **Step 3:** 运行 ruff → 无错误。
- [ ] **Step 4:** 提交 `test(security): cover credential_mask is_sensitive_key/mask/unmask`。

---

## Task 3: `api/security/__init__.py` (0% → 100%)

**Why:** 仅是 re-export，靠 test_credential_mask.py 的 import 联动触发。无需单独测试文件 — 验证 `from api.security import ...` 导出的常量/函数可访问即可。

**Files:** 添加少量导出验证测试到 `tests/test_api/test_credential_mask.py` 末尾（避免单独文件）

**Tests:**
- `test_security_package_exports_mask_sensitive_fields` — `from api.security import mask_sensitive_fields` 可调用
- `test_security_package_exports_unmask_sentinels`
- `test_security_package_exports_is_sensitive_key`
- `test_security_package_exports_mask_sentinel`
- `test_security_package_all_list` — `api.security.__all__` 包含上述 4 个名字

- [ ] **Step 1:** 在 `tests/test_api/test_credential_mask.py` 末尾追加 `class TestSecurityPackageExports`。
- [ ] **Step 2:** 运行 `pytest tests/test_api/test_credential_mask.py -v` → 全部 PASS。
- [ ] **Step 3:** ruff → 无错误。
- [ ] **Step 4:** 提交 `test(security): verify api.security package exports`。

---

## Task 4: `api/db/auth.py` (32% → 90%+)

**Why:** 数据库认证 token 存储 — 安全关键。需要 DB 隔离测试。

**Files:**
- Create: `tests/test_api/test_db_auth.py`

**Tests:** 使用 `isolated_db` fixture（见上方 shared pattern）

### `load_or_create_token`
- `test_load_returns_existing_token` — 预先 INSERT 一行，load 返回该值
- `test_load_creates_new_when_empty` — 空表 → INSERT 新 token，返回 64 字符 hex
- `test_load_returns_latest_when_multiple` — 多行时返回最新（ORDER BY id DESC LIMIT 1）

### `rotate_token`
- `test_rotate_returns_new_token` — 返回 64 字符 hex
- `test_rotate_inserts_new_row` — rotate 后表多一行
- `test_rotate_does_not_delete_old_tokens` — 旧 token 仍在表里
- `test_rotate_new_token_differs_from_previous` — 两次 rotate，token 不同

### 边界与安全场景
- `test_token_is_hex_64_chars` — `secrets.token_hex(32)` → 64 字符 hex 字符串
- `test_token_format_url_safe_no_special_chars` — 仅 `[0-9a-f]`
- `test_load_after_rotate_returns_latest` — rotate 后 load_or_create 返回新值

- [ ] **Step 1:** 写测试文件 `tests/test_api/test_db_auth.py`。
- [ ] **Step 2:** 运行 `pytest tests/test_api/test_db_auth.py -v` → 全部 PASS。
- [ ] **Step 3:** ruff → 无错误。
- [ ] **Step 4:** 提交 `test(db): cover auth token load/create/rotate`。

---

## Task 5: `api/db/hooks.py` (0% → 95%+)

**Why:** 事件钩子配置 SQLite 存储。安全相关 — 钩子可触发外部动作。需要 DB 隔离。

**Files:**
- Create: `tests/test_api/test_db_hooks.py`

**Tests:**

### `load_all`
- `test_load_all_empty_returns_empty_list` — 空表 → `[]`
- `test_load_all_returns_rows_ordered_by_created_at` — INSERT 多条，验证排序
- `test_load_all_parses_config_json` — config 列是 JSON 字符串 → 解析为 dict
- `test_load_all_converts_enabled_to_bool` — enabled=1/0 → True/False
- `test_load_all_handles_null_config` — config 列为 NULL/缺失 → 默认 `{}`（dict(r) 后 `.get("config", "{}")`）

### `get`
- `test_get_returns_none_when_missing` — 不存在的 hook_id → None
- `test_get_returns_dict_when_found` — 返回 dict 含 hook_id/name/config/enabled 等
- `test_get_parses_config_json`
- `test_get_converts_enabled_to_bool`

### `save` (UPSERT)
- `test_save_inserts_new_hook` — save 后 get 返回该 hook
- `test_save_upserts_on_conflict` — 同一 hook_id save 两次，最终只有一行且为新值
- `test_save_serializes_config_to_json` — config dict → JSON 字符串存入 DB
- `test_save_enabled_true_false` — True → 1，False → 0
- `test_save_defaults_when_optional_fields_missing` — `hook.get("name","")`/`hook_type`/`action`/`status`/`created_at`/`trigger_count` 默认值
- `test_save_preserves_last_triggered_and_trigger_count` — 显式传入字段值

### `delete`
- `test_delete_returns_true_when_exists` — 删除存在的 hook → True
- `test_delete_returns_false_when_missing` — 删除不存在的 → False
- `test_delete_actually_removes_row` — delete 后 get 返回 None

### 边界与安全场景
- `test_save_with_empty_config_dict` — `{"hook_id":"h","config":{}}` → 存储为 `"{}"`
- `test_save_with_missing_config_key` — `{"hook_id":"h"}` → hook.get("config",{}) → `{}`
- `test_save_with_unicode_in_name` — 中文 name
- `test_save_with_injection_attempt_in_hook_id` — hook_id=`"'; DROP TABLE event_hooks; --`，验证不会 SQL 注入（参数化查询）

- [ ] **Step 1:** 写测试文件 `tests/test_api/test_db_hooks.py`。
- [ ] **Step 2:** 运行 `pytest tests/test_api/test_db_hooks.py -v` → 全部 PASS。
- [ ] **Step 3:** ruff → 无错误。
- [ ] **Step 4:** 提交 `test(db): cover HookDbStore CRUD and SQL injection safety`。

---

## Task 6: `api/db/providers.py` (0% → 95%+)

**Why:** STUB 类，所有方法都是 no-op。简单但需要覆盖以验证 stub 行为。安全相关 — 确保 stub 不返回任何凭据。

**Files:**
- Create: `tests/test_api/test_db_providers.py`

**Tests:**
- `test_load_all_returns_empty_list` — `ProviderDbStore().load_all()` → `[]`
- `test_get_returns_none` — `ProviderDbStore().get("any")` → None
- `test_save_is_noop` — `ProviderDbStore().save({...})` → None，无副作用
- `test_delete_returns_false` — `ProviderDbStore().delete("any")` → False
- `test_is_empty_true` — `ProviderDbStore().is_empty` → True
- `test_migrate_from_yaml_returns_zero` — `ProviderDbStore().migrate_from_yaml()` → 0
- `test_multiple_instances_independent` — 两个 ProviderDbStore 实例互不影响

### 边界与安全场景
- `test_get_with_empty_id` — `get("")` → None
- `test_get_with_none_id_raises_or_returns_none` — `get(None)` 行为验证
- `test_delete_with_empty_id` — `delete("")` → False
- `test_save_with_none` — `save(None)` → 无异常

- [ ] **Step 1:** 写测试文件 `tests/test_api/test_db_providers.py`。
- [ ] **Step 2:** 运行 `pytest tests/test_api/test_db_providers.py -v` → 全部 PASS。
- [ ] **Step 3:** ruff → 无错误。
- [ ] **Step 4:** 提交 `test(db): cover ProviderDbStore stub methods`。

---

## Task 7: `api/dependencies.py` (0% → 95%+)

**Why:** 系统提示词 + 工具列表的惰性单例。需要 mock `build_system_prompt` 避免真实加载文件。

**Files:**
- Create: `tests/test_api/test_dependencies.py`

**Tests:**
- `test_get_system_prompt_caches_first_call` — 首次调用触发 `build_system_prompt()`，结果缓存
- `test_get_system_prompt_returns_cached_on_second_call` — 第二次不调用 `build_system_prompt`
- `test_get_system_prompt_returns_same_instance` — 两次返回同一字符串对象
- `test_get_tools_returns_empty_list_initially` — 首次返回 `[]`
- `test_get_tools_returns_cached_list` — 第二次返回同一 list 对象
- `test_get_tools_can_be_mutated_externally` — 因为返回的是缓存 list 引用，外部 append 会持久化（验证当前实现行为）

### 重置 fixture
- 通过 monkeypatch 重置 `api.dependencies._system_prompt` 和 `_tools` 为 None，确保测试间隔离

- [ ] **Step 1:** 写测试文件 `tests/test_api/test_dependencies.py`。
- [ ] **Step 2:** 运行 `pytest tests/test_api/test_dependencies.py -v` → 全部 PASS。
- [ ] **Step 3:** ruff → 无错误。
- [ ] **Step 4:** 提交 `test(api): cover dependencies singleton caching`。

---

## Task 8: Remeasure and verify

- [ ] **Step 1:** 运行完整覆盖率：
  ```
  cd d:\Maxma\MaxmaHere
  .venv\Scripts\python.exe -m pytest tests/ --cov=api.security --cov=api.db --cov=api.dependencies --cov-report=term-missing -q
  ```
- [ ] **Step 2:** 确认 7 个模块各 ≥ 70%。
- [ ] **Step 3:** 运行 ruff 检查所有新测试文件：
  ```
  .venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests
  ```
- [ ] **Step 4:** 若发现真实 bug，记录在最终报告中（不修复源代码）。

---

## Expected outcome

| Module | Before | After (target) |
|---|---|---|
| `api/security/credential_envelope.py` | 0% | 95%+ |
| `api/security/credential_mask.py` | 0% | 95%+ |
| `api/security/__init__.py` | 0% | 100% |
| `api/db/auth.py` | 32% | 90%+ |
| `api/db/hooks.py` | 0% | 95%+ |
| `api/db/providers.py` | 0% | 95%+ |
| `api/dependencies.py` | 0% | 95%+ |

**Commits (one per module):**
1. `test(security): cover credential_envelope create/parse/decrypt`
2. `test(security): cover credential_mask is_sensitive_key/mask/unmask`
3. `test(security): verify api.security package exports`
4. `test(db): cover auth token load/create/rotate`
5. `test(db): cover HookDbStore CRUD and SQL injection safety`
6. `test(db): cover ProviderDbStore stub methods`
7. `test(api): cover dependencies singleton caching`
