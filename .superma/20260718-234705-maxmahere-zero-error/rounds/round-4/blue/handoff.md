# Round 4 — Blue handoff

## Round meta
round: 4
team: blue
phase_completed_at: 2026-07-19T01:00:00Z

## What was done this round
challenges_resolved: []
  # No new challenges created this round. Red resolved BC-001 (R-010 re-fix).

issues_filed:
  - id: R-011
    title: yaml_file_lock does not create lock file parent directory when portalocker unavailable
    severity: medium
    files:
      - api/yaml_store.py
    summary: |
      `yaml_file_lock` calls `lock_path.parent.mkdir()` only inside the
      `if _check_portalocker():` branch. When portalocker is unavailable
      (no pywin32), parent directories are never created, causing 2 test
      failures and a potential issue if portalocker becomes available later.
      Fix: move mkdir() call before the portalocker check.

  - id: R-012
    title: Test instability — stat OSError monkeypatch broken on Python 3.14
    severity: low
    files:
      - tests/test_api/test_diagnostics_coverage.py
      - tests/test_api/test_diagnostics_routes_push.py
    summary: |
      Tests monkeypatch `Path.stat` and assume `Path.is_file()` calls
      `self.stat()`. Python 3.14 changed `is_file()` to call `os.path.isfile()`
      directly, breaking the call-count tracking. Production code OSError
      handling is correct; only the test verification is affected.
      Fix: use `follow_symlinks=False` or patch `os.path.isfile`.

items_deferred: []
  # No items deferred.

## Guidance for the next team
areas_of_concern:
  - The project runs on Python 3.14. Several tests rely on internal implementation
    details of pathlib.Path that changed in 3.14 (is_file, stat). Any new test
    that monkeypatches Path.stat should verify is_file() behavior on 3.14.
  - yaml_file_lock's parent directory creation is a subtle pattern: the mkdir()
    call is only in the portalocker branch. Any new lock-based features should
    ensure parent directories are created unconditionally.
  - The build-server.bat line 19 runs port-guard.ps1 with stderr/stdout to nul
    and no errorlevel check. If port cleanup fails, the build continues silently.
    Consider adding an errorlevel check or a warning.
  - project-wide check: any `.parent.mkdir(parents=True, exist_ok=True)` call
    inside a conditional branch should be reviewed for unconditional execution.

suspicions_about_opponent_fixes:
  - Red's R-010 patches look correct and complete. All 10 TS errors are fixed.
  - The double-cast pattern (`as unknown as Record<string, unknown>`) used in
    useTheme.ts and chat.ts is a legitimate TypeScript idiom but bypasses type
    safety. If these runtime-attached properties ever need proper typing, module
    augmentation or interface extension should be preferred.
  - No suspicions.
