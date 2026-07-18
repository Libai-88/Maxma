```yaml
# Round meta
round: 2
team: red
phase_completed_at: 2026-07-18T16:00:00Z

# What was done this round
issues_fixed:
  - id: B-001
    title: Frontend Vite build fails due to unclosed element in ProvidersView.vue
    patch_path: rounds/round-2/red/patches/B-001.patch
  - id: B-002
    title: PyInstaller spec missing bun-sidecar/node_modules for sidecar runtime
    patch_path: rounds/round-2/red/patches/B-002.patch
  - id: B-003
    title: build-server.bat uses uv pip install pyinstaller without checking uv availability
    patch_path: rounds/round-2/red/patches/B-003.patch
  - id: B-004
    title: smoke-test-server.ps1 ignores MAXMA_API_PORT environment variable
    patch_path: rounds/round-2/red/patches/B-004.patch
  - id: B-005
    title: Version mismatch between web frontend (2.4.1) and backend (2.6.6)
    patch_path: rounds/round-2/red/patches/B-005.patch

issues_filed:
  - id: R-006
    title: build-server.bat hardcodes port 8000 in port-guard call, ignoring MAXMA_API_PORT
  - id: R-007
    title: build-server.bat runs npm run build without checking for node_modules or npm
  - id: R-008
    title: build-server.bat does not ensure bun-sidecar dependencies before packaging

challenges_filed: []

items_deferred: []

# Guidance for the next team
areas_of_concern:
  - web/src/views/ProvidersView.vue: The template has mixed tab/space indentation around lines 191-221. While the unclosed div was fixed, the inconsistent indentation pattern could harbor other subtle template issues. Consider running a Vue template linter across all .vue files.
  - build/build-server.bat: Multiple edits were applied (B-003, R-006, R-007, R-008) — verify the script still works as a whole. The step numbering may be off since informational steps were added.
  - build/maxma-server.spec: bun-sidecar/node_modules is now in the datas list, but this directory is large (~hundreds of MB). Monitor PyInstaller build time and final exe size impact.
  - config/personas/memory.yaml.ltm-outbox.sqlite3: This SQLite database still lives in the source tree (flagged by Blue in Round 1). If the schema changes, stale data could cause runtime errors.
  - web/package.json: Version was synced to 2.6.6, but verify that the frontend build process doesn't embed the version string in a way that conflicts with the backend's "v2.6.6" format (note the "v" prefix in version.py).

suspicions_about_opponent_fixes: []
```