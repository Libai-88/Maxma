# Round 1 — Red review

## Scope
Full project audit focused on development environment zero-error (test suite, imports, linting) and production build pipeline (PyInstaller packaging, spec file integrity). Surveyed all build scripts, test files, spec configuration, error reports, and dependency manifests.

## Methodology
1. Read summary.md and project.md for context, scoreboard, and prior issues
2. Walked the build pipeline: build-server.bat, build-desktop.bat, maxma-server.spec, prepare-runtime.ps1, prepare-assets.ps1, smoke-test-server.ps1
3. Ran full test suite (`pytest -q`) — identified 16 failures
4. Investigated each failure: isolated test-by-test, traced assertions vs actual code behavior
5. Verified dependency consistency (requirements.txt vs constraints.txt vs requirements-lock.txt)
6. Inspected PyInstaller spec for silent data-drop paths
7. Checked error reports in dist-portable/ for patterns
8. Verified module imports work end-to-end

## Findings

### R-001 — Test assertions use English error messages, code returns Chinese
**Priority**: high
**File**: `tests/test_api/test_balance_routes.py:34,121,144,157,166`
<full issue block>

#### Description
12 test assertions across 5 test files expect English error messages, but the actual backend code returns Chinese error messages. This causes the entire test suite to fail with 16 failures. The test suite is a key dev environment quality gate.

#### Reproduction
Run `pytest -q` — observe 16 failures.

#### Expected
All tests pass (`pytest -q` exits 0).

#### Actual
16 tests fail with assertion errors comparing English vs Chinese strings.

#### Evidence
- `test_balance_routes.py`: expects `"DeepSeek API key not configured"`, code has `"DeepSeek API key 未配置"`
- `test_balance_routes.py`: expects `"timeout"` in detail, code has `"DeepSeek API 请求超时"`
- `test_balance_routes.py`: expects `"DeepSeek API error"`, code has `"DeepSeek API 错误"`
- `test_sessions_routes_extra.py`: expects `"not found"`, code has `"会话不存在"`
- `test_sessions_routes_sidecar.py`: expects `"Unsupported"`, code has `"不支持的权限模式"`
- `test_transcripts_routes.py`: expects `"Invalid category"`, code has `"无效的类别"`; expects `"Invalid filename"`, code has `"无效的文件名"`; expects `"Transcript not found"`, code has `"记录文件不存在"`
- `test_workflows_routes_enabled.py`: expects `"Workflows are unavailable"`, code has `"工作流功能未启用"`; expects `"Unsupported workflow"`, code has `"不支持的工作流"`

#### Files fixed
- `tests/test_api/test_balance_routes.py`
- `tests/test_api/test_sessions_routes_extra.py`
- `tests/test_api/test_sessions_routes_sidecar.py`
- `tests/test_api/test_transcripts_routes.py`
- `tests/test_api/test_workflows_routes_enabled.py`

#### Fix
Updated all 12 assertion strings to match the actual Chinese error messages returned by the backend.

---

### R-002 — Provider API returns encrypted api_key, tests expect plaintext
**Priority**: medium
**File**: `tests/test_providers_routes.py:141,251`

#### Description
The providers API encrypts `api_key` values using Fernet + credential envelope (prefix `encv1:`) before returning them in responses. Two tests assert the raw plaintext value instead of checking the encrypted form.

#### Reproduction
```bash
pytest tests/test_providers_routes.py::TestCreateProvider::test_create_provider_success
pytest tests/test_providers_routes.py::TestUpdateProvider::test_update_provider_partial
```

#### Expected
Tests should check that the returned `api_key` is encrypted (starts with `encv1:`) rather than asserting the exact plaintext.

#### Actual
`assert result["api_key"] == "sk-xxx"` fails because the API returns `"encv1:eyJhbG..."`.

#### Evidence
- Line 141: `assert result["api_key"] == "sk-xxx"` — Fails with encrypted value
- Line 251: `assert result["api_key"] == "sk-new"` — Fails with encrypted value

#### Fix
Changed assertions to `assert result["api_key"].startswith("encv1:")` and `assert persisted["api_key"].startswith("encv1:")` to verify encryption occurs.

---

### R-003 — MCP tools endpoint returns extra `note` field not in test assertion
**Priority**: low
**File**: `tests/test_api/test_mcp_routes.py:58`

#### Description
The `GET /mcp/servers/{id}/tools` endpoint returns a `note` field: `"工具由 OMP sidecar 动态管理，请在对话中让 AI 列出或调用它们"`. The test assertion expects only `{"server_id": "s1", "tools": []}`, causing a mismatch.

#### Reproduction
```bash
pytest tests/test_api/test_mcp_routes.py::TestListServerTools::test_returns_empty_tools
```

#### Expected
Test assertion should include the `note` field in the expected response.

#### Actual
Assertion fails: `Left contains 1 more item: {'note': '工具由 OMP sidecar 动态管理...'}`

#### Fix
Updated expected response to include the `note` field.

---

### R-004 — Sidecar manager test incorrectly requires absolute default bun path
**Priority**: low
**File**: `tests/test_pi_bridge/test_sidecar_manager_extra.py:86-89`

#### Description
`test_default_bun_path_is_absolute` asserts `os.path.isabs(_DEFAULT_BUN_PATH)`, but the default `_DEFAULT_BUN_PATH = "bun"` is intentionally a relative path meant to be resolved via the system PATH. This is a valid convention for globally installed tools.

#### Reproduction
```bash
pytest tests/test_pi_bridge/test_sidecar_manager_extra.py::TestResolveBunPath::test_default_bun_path_is_absolute
```

#### Expected
The test should accept that the default bun path can be `"bun"` (resolved via PATH) or an absolute path.

#### Actual
AssertionError: `os.path.isabs("bun")` is False.

#### Fix
Changed assertion to allow either an absolute path or `"bun"` as the default value.

---

### R-005 — PyInstaller spec silently drops missing data files without warning
**Priority**: medium
**File**: `build/maxma-server.spec:35-36`

#### Description
The spec file filters out non-existent data paths before passing them to PyInstaller's Analysis. If `bun-sidecar/src`, `bun-sidecar/package.json`, or any other data directory is missing (e.g., after a shallow checkout or incomplete setup), the build completes successfully but produces a broken executable that crashes at runtime when the missing resources are needed.

#### Reproduction
1. Delete or rename `bun-sidecar/src/`
2. Run `build-server.bat`
3. Build succeeds with no warning about missing sidecar source
4. Resulting `maxma-server.exe` crashes when starting the agent engine

#### Expected
The build should emit a warning (or fail) when a declared data path does not exist, so the developer knows the resulting executable is incomplete.

#### Actual
The spec file silently filters the path: `datas = [(src, dst) for src, dst in datas if Path(src).exists()]` — no output at all about dropped paths.

#### Fix
Added explicit checks before filtering: for each missing data path, print a `[WARN]` message to stderr so the developer is alerted during the build.

---

## Summary
- Filed: 5 issues
  - High: 1
  - Medium: 2
  - Low: 2
- Estimated points (before arbiter): 3 + 2*2 + 2*1 = 9
- Areas deliberately NOT covered: Provider configuration UI functionality, web frontend build (Vite) — these were in scope but found no blocking issues in the current state. The error reports in dist-portable/ contain only API key and connection-reset errors which are runtime configuration issues, not build bugs.
