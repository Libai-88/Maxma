# Round 3 — Red review

## Scope
- Cross-team fixes for all open Blue issues (B-006, B-007, B-008)
- New Red issue discovery around build/environment configuration
- Focus areas: Vite production build, Tauri window config, Python deprecations, general project health

## Methodology
- Read summary.md, project.md, and Blue handoff from Round 2
- Reviewed arbiter verification notes from Round 2
- Fixed B-006 (terser dependency), B-007 (quick-chat URL), B-008 (deprecated asyncio)
- Surveyed build scripts, Tauri Rust source, Python bridge modules, config files, test suite
- Checked for Windows-specific issues, hardcoded values, deprecation warnings

## Findings

### B-006 — Terser dependency missing for Vite production build
**Priority**: high
**File**: `web/vite.config.ts:42`
**Symbol**: n/a (build config)

**Description**: Vite config uses `minify: 'terser'` with `terserOptions.compress.drop_console`, but `terser` is not listed as a dependency in `web/package.json`. Running `npx vite build` produces `[vite:terser] terser not found`.

**Resolution**: Switched from `minify: 'terser'` to `minify: 'esbuild'` (built into Vite 5, no extra dependency). Equivalent console dropping is achieved via `esbuild.drop: ['console']` instead of the previous `terserOptions.compress.drop_console`.

**Patch**: `patches/B-006.patch`

---

### B-007 — Quick-chat Tauri window missing URL configuration
**Priority**: medium
**File**: `desktop/src-tauri/tauri.conf.json:25`
**Symbol**: n/a (window config)

**Description**: The quick-chat window definition has no `url` property, defaulting to the main `index.html` instead of the dedicated `quick-chat.html`. The Vite multi-page build correctly produces `quick-chat.html` as a separate entry point, but Tauri never loads it.

**Resolution**: Added `"url": "quick-chat.html"` to the quick-chat window object, matching the Vite rollupOptions input entry.

**Patch**: `patches/B-007.patch`

---

### B-008 — Deprecated `asyncio.iscoroutinefunction()` in rpc_client.py
**Priority**: low
**File**: `api/pi_bridge/rpc_client.py:184`
**Symbol**: `asyncio.iscoroutinefunction`

**Description**: The code uses `asyncio.iscoroutinefunction(handler)` which has been deprecated since Python 3.12 and will be removed in Python 3.16. Current Python is 3.14.5, producing 6 DeprecationWarning instances.

**Resolution**: Replaced with `inspect.iscoroutinefunction(handler)` from the stdlib `inspect` module (same API, no deprecation). Added `import inspect` alongside existing imports.

**Patch**: `patches/B-008.patch`

---

### R-009 — Tauri bundle identifier conflicts with macOS `.app` extension (informational)
**Priority**: low (informational — Windows-only app)
**File**: `desktop/src-tauri/tauri.conf.json:5`
**Symbol**: n/a (identifier)

**Description**: The bundle identifier `"com.maxmahere.app"` ends with `.app`, which conflicts with the macOS application bundle extension convention. While MaxmaHere targets Windows (NSIS installer), the Tauri build emits a warning:
```
Warn The bundle identifier "com.maxmahere.app" set in `"tauri.conf.json" identifier`
ends with `.app`. This is not recommended because it conflicts with the application
bundle extension on macOS.
```

This does not block the build or affect Windows functionality. However, it may cause confusion if the project ever targets macOS, and the warning adds noise to the build log.

**Suggested fix**: Change the identifier to something like `"com.maxmahere.desktop"` or `"com.maxmahere.app"` → `"com.maxmahere.maxmahere"`. Low priority since it's Windows-only.

---

## Areas investigated with no findings
- **Tauri Rust source** (`main.rs`, `port_manager.rs`): Code quality is solid — proper Job Object handling, port fallback, panic hooks, proxy bypass via NO_PROXY.
- **Build scripts** (`build-server.bat`, `build-desktop.bat`): Previously filed issues (R-006, R-007, R-008) addressed in Round 2. Remaining patterns look consistent with the project's established conventions.
- **Python bridge layer** (`sidecar_manager.py`, `session_adapter.py`, `security_adapter.py`, `approval_adapter.py`, `ws_event_mapper.py`): No new deprecation or correctness issues found. The `asyncio.iscoroutinefunction` fix was the only deprecation.
- **Test suite**: 7 skipped tests remain as previously documented (legitimate — agent tests for modules replaced by oh-my-pi, symlink test unavailable). No new test failures introduced by the fixes.
- **Vite configuration**: After the terser->esbuild switch, the build config is consistent with Vite 5 defaults. The multi-page entry setup (`main`, `quick-chat`, `splash`) is properly configured.
- **Version consistency**: All version declarations in `version.py` (v2.6.6), `web/package.json` (2.6.6), `tauri.conf.json` (2.6.6), `Cargo.toml` (2.6.6) remain consistent.
- **Config files**: Settings, environment variables, CSP, and Tauri capabilities are coherent with the project's port range and security requirements.

## Summary
- Fixed: 3 Blue issues (B-006, B-007, B-008)
  - High: 1
  - Medium: 1
  - Low: 1
- Filed new: 1 Red issue (R-009, low/informational)
- Estimated cross-fix points: 3 + 2 + 1 = 6
- Estimated new-issue points: 1 (low)
- Total estimated points: 7
- Areas deliberately NOT covered: oh-my-pi sidecar functional testing (agent behavior), deep frontend component audit (outside dev/build environment scope), production portable build end-to-end verification (requires Windows hardware with specific build tools)
