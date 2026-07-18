# Round 5 — Red review

## Mode
A — Independent fix of open Blue issues B-009 and B-010.

## Issues Fixed

### B-009 (MEDIUM, +2) — yaml_file_lock does not create lock file parent directory when portalocker unavailable

**File fixed**: `api/yaml_store.py`

**Fix**: Moved `lock_path = _lock_path(path)` and `lock_path.parent.mkdir(parents=True, exist_ok=True)` before the `if _check_portalocker():` block so the parent directory is always created regardless of portalocker availability.

**Details**:
- Before: `mkdir()` was inside the `if _check_portalocker():` branch (lines 86-87)
- After: Both `_lock_path()` and `mkdir()` execute unconditionally before the try block
- The portalocker branch now just uses the already-created `lock_path`

**Patch**: `patches/B-009-yaml-filelock-dir.patch`

### B-010 (LOW, +1) — Test instability: stat OSError monkeypatch on Python 3.14+

**Files fixed**:
- `tests/test_api/test_diagnostics_coverage.py` — `test_get_log_files_info_handles_stat_oserror`
- `tests/test_api/test_diagnostics_routes_push.py` — `test_cleanup_stat_oserror_sets_zero_size`

**Root cause**: Python 3.14+ changed `Path.is_file()` to call `os.path.isfile()` directly instead of `self.stat()`. The old tests relied on call-count tracking of `stat()` to let the first call (from `is_file()`) succeed and raise on the second call (from `entry.stat().st_size`). On Python 3.14+, `is_file()` never calls `stat()`, so the first stat call is from `entry.stat()` and the threshold is never crossed.

**Fix**: Both tests now:
1. Monkeypatch `Path.is_file` to return `True` unconditionally (so the entry passes the `is_file()` guard regardless of Python version)
2. Monkeypatch `Path.stat` to raise `OSError` immediately for the target file (no call-count tracking needed)

This approach works across all Python versions.

**Patch**: `patches/B-010-stat-monkeypatch.patch`

## Verification
- `pytest -q`: **1824 passed, 7 skipped, 0 failed** (25.72s)
- All previously passing tests continue to pass
- The specific tests patched for B-010 execute correctly on Python 3.14

## Summary
- B-009 and B-010 fully resolved
- No regressions detected
- Zero test failures
