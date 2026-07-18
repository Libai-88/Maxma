```yaml
# Round meta
round: 1
team: red
phase_completed_at: 2026-07-18T15:57:00Z

# What was done this round
issues_filed:
  - id: R-001
    title: Test assertions use English error messages, code returns Chinese
  - id: R-002
    title: Provider API returns encrypted api_key, tests expect plaintext
  - id: R-003
    title: MCP tools endpoint returns extra note field not in test assertion
  - id: R-004
    title: Sidecar manager test incorrectly requires absolute default bun path
  - id: R-005
    title: PyInstaller spec silently drops missing data files without warning

issues_fixed:
  - id: R-001
    patch_path: rounds/round-1/red/patches/R-001.patch
  - id: R-002
    patch_path: rounds/round-1/red/patches/R-002.patch
  - id: R-003
    patch_path: rounds/round-1/red/patches/R-003.patch
  - id: R-004
    patch_path: rounds/round-1/red/patches/R-004.patch
  - id: R-005
    patch_path: rounds/round-1/red/patches/R-005.patch

challenges_filed: []

items_deferred:
  - id: <none>
    reason: All discovered issues were within scope and fixable this round.

# Guidance for the next team
areas_of_concern:
  - build-server.bat: calls `uv pip install pyinstaller` without checking if `uv` is available first (unlike setup-dev.bat which has a `where uv` check). If uv is missing, the error message will be confusing.
  - .venv state: The current .venv was likely created with `pip install -r requirements.txt` (production deps only) rather than with `uv pip sync requirements-lock.txt` (which includes dev deps like mypy). Running `setup-dev.bat` would produce a complete dev environment.
  - smoke-test-server.ps1: Uses hardcoded port 8000 and doesn't respect MAXMA_API_PORT env var. The build-server.bat always uses port 8000 for the smoke test regardless of configuration.
  - dist-portable/maxma-server.exe (211 MB) and dist/maxma-server.exe (172 MB) are stale pre-built artifacts. The build pipeline should regenerate them, but the old ones may cause confusion about what's current.
  - Error reports in dist-portable/ show repeated `openai.AuthenticationError` (invalid API key) and `ConnectionResetError` — these are runtime configuration issues (no valid API key configured), not build bugs, but they indicate the app needs a configured provider to function fully.
  - `version.py` declares `v2.6.6` but the web/package.json has `"version": "2.4.1"` — version mismatch between backend and frontend. Not a build-breaker but worth reconciling.
```
