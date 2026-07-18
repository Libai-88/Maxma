# Round 5 Red Handoff

## State
All tasks complete. B-009 and B-010 have been fixed and verified with `pytest -q` (1824 passed, 0 failed).

## Summary

### B-009 (MEDIUM, +2) — `api/yaml_store.py`
- **What**: `lock_path.parent.mkdir()` was nested inside `if _check_portalocker():` block, so parent directory was not created when portalocker is unavailable.
- **Fix**: Moved `lock_path = _lock_path(path)` and `lock_path.parent.mkdir(parents=True, exist_ok=True)` before the if-check so they execute unconditionally.
- **Patch**: `patches/B-009-yaml-filelock-dir.patch`

### B-010 (LOW, +1) — Two test files
- **What**: Tests monkeypatched `Path.stat` with call-count tracking, but Python 3.14+ `Path.is_file()` calls `os.path.isfile()` directly (not `self.stat()`), so the threshold was never crossed.
- **Fix**: Monkeypatch `Path.is_file` to return `True` unconditionally, and `Path.stat` to raise OSError immediately (removed call-count tracking). Works on all Python versions.
- **Files**: `tests/test_api/test_diagnostics_coverage.py`, `tests/test_api/test_diagnostics_routes_push.py`
- **Patch**: `patches/B-010-stat-monkeypatch.patch`

## Test results
```
1824 passed, 7 skipped, 0 failed in 25.72s
```

## Next (Blue phase)
Blue may verify these fixes or file new issues.
