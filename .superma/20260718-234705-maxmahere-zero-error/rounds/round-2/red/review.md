# Round 2 — Red review

## Scope
- Cross-team fixes for all open Blue issues (B-001 through B-005)
- New Red issue discovery around build reliability, dev environment, and production packaging
- Focus areas: web frontend template, PyInstaller spec, build scripts (batch/powershell), version consistency

## Methodology
- Read summary.md, project.md, and Blue handoff from Round 1
- Surveyed all files referenced in open Blue issues and surrounding areas
- Examined build pipeline (build-server.bat, build-desktop.bat, smoke-test-server.ps1, port-guard.ps1)
- Checked version consistency across version.py, package.json, tauri.conf.json, Cargo.toml
- Verified template syntax in ProvidersView.vue and other .vue files
- Checked PyInstaller spec completeness for sidecar resources

## Findings

### B-001 — Frontend Vite build fails: unclosed `<div class="form-group">` in ProvidersView.vue
**Priority**: high
**File**: `web/src/views/ProvidersView.vue:191,211`
**Symbol**: n/a (template)

**Description**: The `<div class="form-group">` for "模型参数" (line 191) was never closed before the "高级设置" `<div class="form-group">` (line 211) was opened. This creates an unclosed element that causes `vue-tsc` / Vite production build to fail.

**Evidence**:
- Line 210: `</div>` closes `form-row--3cols`, but the outer `form-group` from line 191 has no closing tag
- Blue reported: running `npx vite build` in `web/` triggers the error

**Reproduction** (no longer needed — fix applied):
1. Run `npx vite build` in `web/`
2. Observe Vue template compilation error on ProvidersView.vue
3. Expected: build succeeds; Actual: build fails with unclosed element error

**Fix applied**: Added `</div>` at line 211 (same indent as opening tag) to close the model-parameters form-group before opening advanced settings.

**Patch**: `patches/B-001.patch`

---

### B-002 — PyInstaller spec missing bun-sidecar/node_modules
**Priority**: medium
**File**: `build/maxma-server.spec:30-33`
**Symbol**: n/a (datas list)

**Description**: The spec comment on line 30-31 promises "Bun TypeScript 源码 + node_modules" but the datas list only includes `src/` and `package.json`. The `node_modules` directory exists in the source tree but was not included. At runtime the sidecar needs its dependency modules to function.

**Evidence**:
- `bun-sidecar/node_modules` exists on disk with all required packages
- Spec line 33 only adds `package.json`, not `node_modules`

**Fix applied**: Added `(str(project_root / "bun-sidecar" / "node_modules"), "bun-sidecar/node_modules")` to the datas list.

**Patch**: `patches/B-002.patch`

---

### B-003 — build-server.bat uses uv without checking availability
**Priority**: medium
**File**: `build/build-server.bat:44`
**Symbol**: n/a

**Description**: Line 44 runs `uv pip install pyinstaller` without checking if `uv` is installed first. If the developer hasn't installed `uv`, this command fails with an unhelpful error message. The `setup-dev.bat` script at the project root has a proper `where uv` guard that should be replicated.

**Evidence**:
- `setup-dev.bat` lines 17-24: has `where uv >nul 2>&1` check with helpful install instructions
- `build-server.bat` line 44: no such check before `uv pip install pyinstaller`

**Fix applied**: Added `where uv >nul 2>&1` guard before the install command, with same error message pattern as `setup-dev.bat`.

**Patch**: `patches/B-003.patch`

---

### B-004 — smoke-test-server.ps1 ignores MAXMA_API_PORT environment variable
**Priority**: medium
**File**: `build/smoke-test-server.ps1:4`
**Symbol**: n/a

**Description**: The script's `$Port` parameter defaults to 8000 and never checks `$env:MAXMA_API_PORT`. If the user has configured a non-default API port via the environment variable, the smoke test will try to connect to port 8000 and fail.

**Evidence**:
- Parameter `[int]$Port = 8000` on line 4 — no env var fallback
- Other scripts (`start.bat`, `run-desktop-dev.bat`) properly check `%MAXMA_API_PORT%`

**Fix applied**: Added `if ($env:MAXMA_API_PORT) { $Port = [int]::Parse($env:MAXMA_API_PORT) }` after the param block.

**Patch**: `patches/B-004.patch`

---

### B-005 — Version mismatch: web/package.json = 2.4.1 vs backend 2.6.6
**Priority**: low
**File**: `web/package.json:4`
**Symbol**: n/a

**Description**: The frontend package.json declares version 2.4.1 while all other version declarations (version.py = v2.6.6, tauri.conf.json = 2.6.6, Cargo.toml = 2.6.6) agree on 2.6.6. This causes confusion in diagnostics and error reports.

**Evidence**:
- `version.py`: `__version__ = "v2.6.6"`
- `web/package.json`: `"version": "2.4.1"`
- `tauri.conf.json`: `"version": "2.6.6"`
- `Cargo.toml`: `version = "2.6.6"`

**Fix applied**: Changed `"version": "2.4.1"` to `"version": "2.6.6"` in web/package.json.

**Patch**: `patches/B-005.patch`

---

### R-006 — build-server.bat hardcodes port 8000 in port-guard call, ignoring MAXMA_API_PORT
**Priority**: medium
**File**: `build/build-server.bat:16`
**Symbol**: n/a

**Description**: The port-guard cleanup on line 16 hardcodes `"8000"` as the port argument. When `MAXMA_API_PORT` is configured to a non-default value (e.g., 8001 or 8002), the port-guard kills processes on the wrong port (8000) and leaves the actual port uncleaned. Both `start.bat` and `run-desktop-dev.bat` properly use `%MAXMA_API_PORT%` for their port-guard calls.

**Evidence**:
- `build-server.bat:16`: `-PortsStr "8000"` (hardcoded)
- `start.bat:16`: `-PortsStr "%MAXMA_API_PORT%"` (env var)
- `run-desktop-dev.bat:13,38`: `-PortsStr "%MAXMA_API_PORT%"` (env var)

**Reproduction**:
1. Set `MAXMA_API_PORT=8001` in environment
2. Run `build-server.bat`
3. Port-guard kills processes on port 8000 instead of port 8001
4. Old server on port 8001 may still be running, causing bind conflict when new server starts

**Fix applied**: Added `if "%MAXMA_API_PORT%"=="" set "MAXMA_API_PORT=8000"` and changed the port-guard call to use `"%MAXMA_API_PORT%"`.

**Patch**: `patches/R-006.patch`

---

### R-007 — build-server.bat runs npm run build without checking for node_modules or npm
**Priority**: medium
**File**: `build/build-server.bat:70`
**Symbol**: n/a

**Description**: The script runs `cd web && call npm run build` on line 70 without first checking whether `web\node_modules` exists or whether `npm` is available. If the frontend dependencies haven't been installed, the command fails with a confusing error. The `start.bat` script at the project root has a proper check (`if not exist "web\node_modules"`).

**Evidence**:
- `build-server.bat:70`: `call npm run build 2>&1` — no dependency check
- `start.bat:33`: `if not exist "web\node_modules"` — has the check

**Reproduction**:
1. Delete or rename `web/node_modules`
2. Run `build-server.bat`
3. Frontend build step fails with unhelpful "module not found" cascade error

**Fix applied**: Added `if not exist "web\node_modules"` check with clear instructions before the npm build step.

**Patch**: `patches/R-007.patch`

---

### R-008 — build-server.bat does not ensure bun-sidecar dependencies are installed before packaging
**Priority**: medium
**File**: `build/build-server.bat:85-93`
**Symbol**: n/a

**Description**: The PyInstaller spec now packages `bun-sidecar/node_modules` (see B-002), but there is no step in the build pipeline to ensure those dependencies are current. If `bun-sidecar/package.json` is updated without running `bun install`, the packaged app will ship stale or missing dependencies. The frontend equivalent (`npm run build`) implicitly uses already-installed `node_modules`, and the same implicit assumption is risky for the sidecar.

**Evidence**:
- `bun-sidecar/package.json` lists dependencies like `@oh-my-pi/pi-coding-agent: 16.5.2`
- No existing step in `build-server.bat` runs `bun install` before packaging

**Reproduction**:
1. Update `bun-sidecar/package.json` with a new dependency
2. Run `build-server.bat`
3. The new dependency is not in `node_modules`, but it gets packaged as-is
4. At runtime, the sidecar fails with a missing module error

**Fix applied**: Added a `bun install --frozen-lockfile` step with graceful fallback, and a warning if `bun` is not installed.

**Patch**: `patches/R-008.patch`

---

## Summary
- Fixed: 5 Blue issues (B-001, B-002, B-003, B-004, B-005)
  - High: 1
  - Medium: 3
  - Low: 1
- Filed new: 3 Red issues (R-006, R-007, R-008)
  - Medium: 3
- Estimated cross-fix points: 3 + 2 + 2 + 2 + 1 = 10
- Estimated new-issue points: 2 + 2 + 2 = 6
- Total estimated points: 16
- Areas deliberately NOT covered: deep Tauri/Rust code audit (out of scope for dev build reliability), oh-my-pi sidecar functional testing (agent behavior)
