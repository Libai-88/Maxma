# Round 4 — Blue review

## Mode
A — Independent hunt. Also verified Red's R4 fixes (MODE B) as prerequisite.

## Red Fix Verification
- `npm run build` passes cleanly (vue-tsc + vite build complete in 6.90s)
- All 10 TS errors claimed fixed by R-010 are confirmed resolved
- esbuild console dropping verified: grep of dist JS files found zero console.* calls
- **Red's fixes: CONFIRMED** ✅

## Issues Filed

### R-011 — yaml_file_lock does not create lock file parent directory when portalocker unavailable (Medium)

**File**: `D:\Maxma\MaxmaHere\api\yaml_store.py` (lines 86-87)

**Description**: The `yaml_file_lock` context manager only creates the lock file's parent directory inside the `if _check_portalocker():` branch. When portalocker is not available (no pywin32), `lock_path.parent.mkdir(parents=True, exist_ok=True)` is never called, leaving the parent directory uncreated.

**Impact**: 2 test failures:
- `test_lock_acquires_and_releases` — asserts `_lock_path(target).parent.exists()` fails
- `test_lock_creates_parent_dirs` — same assertion fails

**Root cause**: Lines 86-87 nest the `mkdir()` call inside the portalocker-availability branch instead of running it unconditionally.

**Fix**: Move `lock_path.parent.mkdir(parents=True, exist_ok=True)` before the `if _check_portalocker():` check so parent directories are always created regardless of portalocker availability. Patch provided in `patches/R-011-yaml-filelock-dir.patch`.

### R-012 — Test instability: stat OSError monkeypatch broken on Python 3.14 (Low)

**Files**:
- `D:\Maxma\MaxmaHere\tests\test_api\test_diagnostics_coverage.py` — `test_get_log_files_info_handles_stat_oserror`
- `D:\Maxma\MaxmaHere\tests\test_api\test_diagnostics_routes_push.py` — `test_cleanup_stat_oserror_sets_zero_size`

**Description**: These tests monkeypatch `Path.stat` and assume `Path.is_file()` calls `self.stat()` internally. In Python 3.14, `Path.is_file()` (with default `follow_symlinks=True`) calls `os.path.isfile()` directly rather than `self.stat()`. This means the call-count tracking in the monkeypatch never sees the first call, and the second call (from the explicit `entry.stat().st_size`) succeeds instead of raising OSError.

**Impact**: 2 test failures when running `pytest -q` on Python 3.14.

**Root cause**: Python 3.14 changed the implementation of `Path.is_file()`:
```python
# Python 3.14
def is_file(self, *, follow_symlinks=True):
    if follow_symlinks:
        return os.path.isfile(self)  # Does NOT call self.stat()
    ...
```

**Note**: The production code's OSError handling at `api/diagnostics.py` lines 408-411 is correct — it catches `OSError` from `entry.stat().st_size` and falls back to 0. Only the test verification is broken on Python 3.14.

**Fix**: Update tests to either:
1. Set `follow_symlinks=False` so `is_file()` calls `self.stat()` (which is monkeypatched)
2. Patch `os.path.isfile` instead of `Path.stat`
3. Use a different approach to simulate stat failure (e.g., set file permissions to deny read)

## Summary
- **pytest -q**: 4 failed, 1820 passed, 7 skipped (4 failures are the 2+2 described above)
- **npm run build**: passes ✅
- **build-server.bat**: clean, well-structured. Minor: errorlevel from `port-guard.ps1` (line 19) is not checked after stderr/stdout redirection to nul
- **web/dist/**: console.* calls verified stripped by esbuild `drop: ['console']`
- **capabilities/default.json**: no obvious security misconfigurations — HTTP restricted to localhost:8000-8010, sidecar spawn/kill scoped to maxma-server only
- **config/settings.py**: no edge cases found
- **api/ routes**: error handling looks solid with try/except patterns throughout
