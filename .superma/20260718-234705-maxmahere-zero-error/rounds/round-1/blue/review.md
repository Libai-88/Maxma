# Round 1 — Blue review

## Mode
Mode A: independent hunt

## Scope
Full project audit with emphasis on areas Red did NOT cover. Focus on build pipeline breakage (frontend Vite build, PyInstaller spec completeness, build scripts), environment configuration, and runtime integrity. Surveyed:

- Frontend Vite build (`web/`) — actual build execution
- PyInstaller spec (`build/maxma-server.spec`) — data file completeness for sidecar
- Build scripts (`build/build-server.bat`, `build/build-desktop.bat`, `build/smoke-test-server.ps1`)
- Dependency manifests (`requirements.txt`, `requirements-lock.txt`, `constraints.txt`, `pyproject.toml`)
- Environment config (`.env`, `.env.example`, `config/`, `providers.yaml`)
- Version consistency (`version.py`, `web/package.json`, `tauri.conf.json`, `Cargo.toml`)
- Error reports (`dist-portable/maxma-error-report-*.txt`)
- Test suite health after Red's patches
- Sidecar bundle completeness (`bun-sidecar/`)

## Methodology
1. Read `summary.md`, `project.md`, and Red's `handoff.md` for context on what Red covered and their areas of concern.
2. Read Red's patches (R-001 through R-005) to understand their fixes.
3. Ran the full test suite to verify Red's fixes work (1824 passed, 7 skipped).
4. Executed `npx vite build` in `web/` to test frontend production build — **discovered build failure**.
5. Traced the broken Vue template to identify the exact unclosed element.
6. Audited PyInstaller spec data files against what `sidecar_manager.py` requires at runtime.
7. Checked `build-server.bat` for missing `uv` availability guard.
8. Checked `smoke-test-server.ps1` for `MAXMA_API_PORT` env var respect.
9. Compared version strings across all manifest files.
10. Inspected error reports for missing sidecar errors confirming the node_modules gap.

## Findings

### B-001 — Frontend Vite production build fails: ProvidersView.vue unclosed element
**Priority**: high
**File**: `web/src/views/ProvidersView.vue:191`

#### Description
The Vite production build (`vite build`) fails with a Vue template compilation error. The `<div class="form-group">` opened at line 191 (模型参数) is never closed before `</form>` at line 254. A nested `<div class="form-group">` opened at line 211 (高级设置) has a proper closing tag, but the parent form-group remains unclosed, causing the Vue compiler to report "Element is missing end tag."

This is a **blocker** for the entire production build pipeline:
- `build-server.bat` step [1/4] "构建前端" fails with "前端构建失败"
- `build-desktop.bat` cascades (calls `build-server.bat` first)
- Both portable server build and desktop installer build are blocked

#### Reproduction
```bash
cd web
npx vite build
```

#### Expected
Build succeeds with no errors.

#### Actual
```
[vite:vue] [plugin vite:vue] src/views/ProvidersView.vue (191:7): Element is missing end tag.
Build failed in 451ms
```

#### Evidence
- Template structure (lines 162-254): `<form>` wraps two `<div class="form-group">` elements. The second form-group (line 191) opens but has no closing `</div>` before `</form>`.
- Line 189: `</div>` closes the first form-group (基础设置).
- Line 191: `<div class="form-group">` opens the second form-group (模型参数).
- Line 211: `<div class="form-group">` opens a nested form-group (高级设置) inside the second one.
- Line 221: `</div>` closes the nested form-group.
- Line 254: `</form>` closes the form, but the form-group from line 191 was never closed.

---

### B-002 — PyInstaller spec missing bun-sidecar/node_modules for sidecar runtime
**Priority**: medium
**File**: `build/maxma-server.spec:30-33`
**Symbol**: `datas` list

#### Description
The PyInstaller spec includes `bun-sidecar/src` and `bun-sidecar/package.json` in its data files, but does NOT include `bun-sidecar/node_modules` (390 MB on disk, gitignored). The sidecar manager (`api/pi_bridge/sidecar_manager.py`) starts the Bun sidecar by running `bun run src/session-bridge.ts` with `cwd=SIDECAR_DIR`. The Bun project depends on `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-agent-core`, `@oh-my-pi/pi-ai`, etc. (see `bun-sidecar/package.json`). Without `node_modules`, these imports cannot be resolved at runtime.

The `build-server.bat` also has no `bun install` step in its pipeline, so even if `node_modules` is missing at build time, there's no warning or auto-installation.

Note: R-005 (Red's fix) added warnings for missing data paths, but since `bun-sidecar/node_modules` is not in the `datas` list at all, no warning is emitted.

#### Reproduction
1. Remove `bun-sidecar/node_modules` (simulating a fresh clone scenario where `bun install` was not run).
2. Run `build\build-server.bat`.
3. Build completes without warning.
4. Launch the resulting `maxma-server.exe` — sidecar fails to start because `@oh-my-pi/pi-*` imports in `session-bridge.ts` cannot resolve.

#### Expected
The spec should either include `bun-sidecar/node_modules` in `datas`, or the build pipeline should run `bun install` before packaging and include the result.

#### Actual
- `datas` list: only `bun-sidecar/src` and `bun-sidecar/package.json` are included.
- No warning is emitted for the missing `node_modules` because it's not in the datas list.
- Production portable build produces an executable with a broken sidecar.

#### Evidence
- `build/maxma-server.spec` lines 30-33: datas includes only `src/` and `package.json`.
- `api/pi_bridge/sidecar_manager.py` lines 31-35, 120-128: sidecar is launched as `bun run src/session-bridge.ts` from `SIDECAR_DIR`, which requires `node_modules/` for import resolution.
- `bun-sidecar/package.json` lists `@oh-my-pi/pi-coding-agent` (16.5.2), `@oh-my-pi/pi-agent-core` (16.5.2), `@oh-my-pi/pi-ai` (16.5.2), `@oh-my-pi/pi-catalog` (16.5.2), `zod` as dependencies.
- `bun-sidecar/node_modules` is 390 MB on disk.
- `.gitignore` line 45: `bun-sidecar/node_modules/` is gitignored.

---

### B-003 — build-server.bat uses `uv pip install pyinstaller` without checking `uv` availability
**Priority**: medium
**File**: `build/build-server.bat:44`

#### Description
`build-server.bat` calls `setup-dev-env.bat` (which sets up Rust/Python environment vars via `dev-tools.ps1`) and then directly uses `uv pip install pyinstaller` on line 44 without checking if `uv` is installed. Unlike the root-level `setup-dev.bat` which has a `where uv >nul 2>&1` guard, neither `setup-dev-env.bat` nor `build-server.bat` checks for `uv`. If `uv` is not available on the system PATH (e.g., a developer only has `pip` installed), the error message will be an opaque `'uv' is not recognized` rather than a helpful installation guide.

#### Reproduction
1. Ensure `uv` is NOT on PATH (or temporarily rename it).
2. Run `build\build-server.bat`.
3. Build fails at line 44 with: `'uv' is not recognized as an internal or external command`.

#### Expected
Script should check for `uv` before using it, similar to `setup-dev.bat`, and print a helpful installation guide.

#### Actual
`uv pip install pyinstaller` on line 44 fails with an opaque error if `uv` is not installed.

#### Evidence
- `build/build-server.bat` line 44: `uv pip install pyinstaller` — no guard.
- `build/setup-dev-env.bat` calls `dev-tools.ps1 -EmitCmdEnv` which does not check for `uv`.
- `setup-dev.bat` (root) lines 17-24: has `where uv >nul 2>&1` with a helpful install guide.

---

### B-004 — smoke-test-server.ps1 ignores MAXMA_API_PORT environment variable
**Priority**: medium
**File**: `build/smoke-test-server.ps1:5`

#### Description
The smoke test script accepts `$Port` as a parameter with default 8000, but never reads the `MAXMA_API_PORT` environment variable. If a user has configured a different API port in `.env` (via `MAXMA_API_PORT=8001`), the backend server will be listening on that port, but the smoke test will attempt to connect to 8000 and fail.

Compare with `run-desktop-dev.bat` which properly reads `%MAXMA_API_PORT%` (line 8). The Vite config in `web/vite.config.ts` also respects `MAXMA_API_PORT`. The `config/settings.py` has `maxma_api_port: int = 8000` as default but reads from `.env`. The smoke test is the only component that ignores this configuration.

#### Reproduction
1. Set `MAXMA_API_PORT=8001` in `.env`.
2. Build server with `build\build-server.bat`.
3. Build reaches step [3/4] (smoke test).
4. Smoke test connects to `http://127.0.0.1:8000/api/auth/token` but the server is on port 8001.

#### Expected
Smoke test should read `MAXMA_API_PORT` from the environment and use that port.

#### Actual
Smoke test hardcodes port 8000 regardless of configuration.

#### Evidence
- `build/smoke-test-server.ps1` line 5: `[int]$Port = 8000` — no env var fallback.
- `build/run-desktop-dev.bat` line 8: `if "%MAXMA_API_PORT%"=="" set "MAXMA_API_PORT=8000"` — properly reads env var.
- `web/vite.config.ts` lines 8-11: reads `MAXMA_API_PORT` from env.
- `config/settings.py` line 19: `maxma_api_port: int = 8000` (overridable via `.env`).

---

### B-005 — Version mismatch between web frontend and backend
**Priority**: low
**Files**: `version.py`, `web/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`

#### Description
The project has inconsistent version numbers across its components:
- `version.py`: `"v2.6.6"` (backend)
- `tauri.conf.json`: `"2.6.6"` (desktop shell)
- `Cargo.toml`: `"2.6.6"` (Rust package)
- `web/package.json`: `"2.4.1"` (frontend)

The frontend lags behind by 5 minor versions (2.4.1 vs 2.6.6). This causes confusion when reading version-reported diagnostics, error reports, or when users compare frontend and backend capabilities. The error reports in `dist-portable/` show "应用版本: v2.6.6" which is the backend version — users may check the frontend and see 2.4.1, creating unnecessary support queries.

#### Reproduction
```
grep version version.py web/package.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml
```

#### Expected
All components should declare the same version number.

#### Actual
- `version.py`: `"v2.6.6"`
- `web/package.json`: `"2.4.1"`
- `tauri.conf.json`: `"2.6.6"`
- `Cargo.toml`: `"2.6.6"`

#### Evidence
- `version.py` line 3: `__version__ = "v2.6.6"`
- `web/package.json` line 4: `"version": "2.4.1"`
- `desktop/src-tauri/tauri.conf.json` line 4: `"version": "2.6.6"`
- `desktop/src-tauri/Cargo.toml` line 3: `version = "2.6.6"`

## Summary
- Filed: 5 issues
  - High: 1
  - Medium: 3
  - Low: 1
- Estimated points (before arbiter): 3 + 3*2 + 1 = 10
- Areas deliberately NOT covered: ChromaDB integration depth, Tauri Rust source code logic, Playwright E2E tests (these were in scope but no blocking issues found in current state)

## Suspicions about opponent's work (optional)
- R-005 (PyInstaller spec missing data warning): The fix is correct but partial — it only warns about data paths already in the `datas` list. The spec is still missing `bun-sidecar/node_modules` entirely (see B-002). This is not a challenge to R-005 per se, but a complement: R-005's warning mechanism can't catch paths that were never declared.
- R-001..R-004: All appear correct and verified by the passing test suite (1824 passed, 7 skipped — the 7 skipped are pre-existing and unrelated: 6 agent modules removed by OMP migration, 1 symlink-unavailable test).
