# Round 2 — Blue review

## Mode
Mode A: independent hunt

## Scope
- Frontend Vite production build configuration (`web/vite.config.ts`, `web/package.json`)
- Desktop Tauri configuration (`desktop/src-tauri/tauri.conf.json`)
- Build scripts (`build/build-server.bat`, `build/maxma-server.spec`, `build/prepare-runtime.ps1`, `build/prepare-assets.ps1`)
- Python backend `api/pi_bridge/rpc_client.py`
- Python test suite (1824 tests)
- Config files (`config/settings.py`, `config/providers.yaml`)
- Bun sidecar (`bun-sidecar/src/session-bridge.ts`)
- Error reports in `dist-portable/`
- Red's patches for R-006..R-008 and B-001..B-005

## Methodology
1. Read `summary.md`, `project.md`, Red's `handoff.md` and arbiter `verification.md` to establish competition context
2. Ran `npx vite build` to reproduce the terser issue flagged by the arbiter
3. Ran `pytest -q --tb=short` to evaluate test suite health (1824 passed, 7 skipped, 0 failed after cache clear)
4. Read all 8 Red patches (B-001..B-005 fixes, R-006..R-008 fixes) and verified current state of targeted files
5. Inspected `desktop/src-tauri/tauri.conf.json` for window configuration gaps
6. Reviewed `api/pi_bridge/rpc_client.py` for deprecation issues
7. Surveyed `build/` scripts, `config/`, and `dist-portable/` error reports for recurring patterns
8. Verified skipped tests are legitimate (6 agent modules replaced by OMP, 1 symlink unavailable on host)

## Findings

### B-006 — Terser dependency missing for Vite production build
**Priority**: high
**File**: `web/vite.config.ts:42-47`, `web/package.json`
**Symbol**: `build.minify`

**Description**: Vite config specifies `minify: 'terser'` with `terserOptions` for production builds, but the `terser` package is NOT listed in `web/package.json` (neither `dependencies` nor `devDependencies`). Since Vite v3, terser became an optional dependency that must be explicitly installed. Running `npx vite build` fails with `[vite:terser] terser not found`. This is a production build blocker — the entire build pipeline (build-server.bat -> PyInstaller -> Tauri NSIS) fails at the first step.

**Reproduction**:
- Step 1: `cd web`
- Step 2: `npx vite build`

**Expected**: Successful production build output in `web/dist/`.

**Actual**: Build fails with error:
```
[vite:terser] terser not found. Since Vite v3, terser has become an optional dependency. You need to install it.
```

**Evidence**:
- `web/vite.config.ts:42`: `minify: 'terser'`
- `web/vite.config.ts:43-47`: `terserOptions` with `compress.drop_console: true`
- `web/package.json` (entire file): no `terser` entry
- Console output: `npx vite build` failure log

### B-007 — Quick-chat Tauri window missing URL configuration
**Priority**: medium
**File**: `desktop/src-tauri/tauri.conf.json:24-38`
**Symbol**: `app.windows[1]`

**Description**: The Tauri config defines a "quick-chat" window (label: `"quick-chat"`) but does not specify a `url` property. In Tauri 2, when a window has no `url`, it defaults to the `frontendDist` path (the main `index.html`). However, the frontend has a separate multi-page entry at `web/quick-chat.html` which loads `web/src/quick-chat/main.ts` — a compact Vue app distinct from the main UI. Without `"url": "quick-chat.html"`, the Quick Chat window loads the full main application UI instead of the intended compact quick-chat interface, making the feature non-functional.

**Reproduction**:
- Step 1: Inspect `desktop/src-tauri/tauri.conf.json` windows array
- Step 2: Note the second window has `"label": "quick-chat"` but no `url` field
- Step 3: Verify `web/quick-chat.html` exists and references `src/quick-chat/main.ts`
- Step 4: Build and launch Tauri app — the Quick Chat window (shown via Ctrl+Shift+Space) displays the main interface instead of the compact chat UI

**Expected**: Quick-chat window should load `quick-chat.html` to show the compact chat interface.

**Actual**: Quick-chat window loads `index.html` (the full main application) by default.

**Evidence**:
- `desktop/src-tauri/tauri.conf.json` lines 24-38: window definition missing `url`
- `web/quick-chat.html` line 17: `<script type="module" src="/src/quick-chat/main.ts"></script>` — separate entry point
- Vite config multi-page input confirms `quick-chat.html` is a separate build entry

### B-008 — Deprecated `asyncio.iscoroutinefunction()` will break in Python 3.16
**Priority**: low
**File**: `api/pi_bridge/rpc_client.py:184`
**Symbol**: `_dispatch_event` (inline handler loop)

**Description**: The RPC client uses `asyncio.iscoroutinefunction(handler)` to distinguish sync vs async event handlers. This function has been deprecated since Python 3.12 and is scheduled for removal in Python 3.16. The test suite emits 6 `DeprecationWarning` instances for this call. It should use `inspect.iscoroutinefunction()` instead. While not a current build blocker, this will become a hard `AttributeError` when the project updates to Python 3.16+.

**Reproduction**:
- Step 1: Run `pytest -q` — observe 6 deprecation warnings:
  ```
  DeprecationWarning: 'asyncio.iscoroutinefunction' is deprecated and slated for removal in Python 3.16; use inspect.iscoroutinefunction() instead
  ```

**Expected**: No deprecation warnings from project code.

**Actual**: 6 `DeprecationWarning` instances from `rpc_client.py:184`.

**Evidence**:
- `api/pi_bridge/rpc_client.py:184`: `if asyncio.iscoroutinefunction(handler):`
- pytest output: 6 deprecation warnings referencing this line
- Python docs: `asyncio.iscoroutinefunction()` deprecated since 3.12, removal planned

## Summary
- Filed: 3 issues
  - High: 1
  - Medium: 1
  - Low: 1
- Estimated points (before arbiter): 3 + 2 + 1 = 6
- Areas deliberately NOT covered:
  - Bun sidecar full integration testing (requires oh-my-pi SDK which is not installed locally)
  - Full Tauri cargo build (requires Rust toolchain and would take >30 minutes)
  - Cross-platform testing (Windows-only environment)

## Suspicions about opponent's work
- R-006..R-008 patches look correct and the fixes match the issue descriptions. The `build-server.bat` now properly handles `MAXMA_API_PORT`, checks for `node_modules` before `npm run build`, and installs bun-sidecar dependencies before packaging. No residual issues found.
- The B-001 fix (providers view unclosed div) was confirmed working by the arbiter. The remaining terser issue was a pre-existing gap that neither team caught.
