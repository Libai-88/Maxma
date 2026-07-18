```yaml
# Round meta
round: 1
team: blue
phase_completed_at: 2026-07-18T16:05:00Z

# What was done this round
issues_filed:
  - id: B-001
    title: Frontend Vite production build fails due to unclosed element in ProvidersView.vue
  - id: B-002
    title: PyInstaller spec missing bun-sidecar/node_modules for sidecar runtime
  - id: B-003
    title: build-server.bat uses uv pip install pyinstaller without checking uv availability
  - id: B-004
    title: smoke-test-server.ps1 ignores MAXMA_API_PORT environment variable
  - id: B-005
    title: Version mismatch between web frontend (2.4.1) and backend (2.6.6)

issues_fixed: []

challenges_filed: []

items_deferred: []

# Guidance for the next team
areas_of_concern:
  - web/src/views/ProvidersView.vue: The template has mixed tab/space indentation (lines 191-221 use tabs, surrounding code uses spaces). This suggests the broken section may have been introduced by an automated merge or copy-paste. Check for similar template issues in other .vue files.
  - build/maxma-server.spec: The datas list may be missing other runtime-required directories beyond node_modules (e.g., does the bun-sidecar need tsconfig.json or bun.lock at runtime?).
  - build/build-server.bat: Consider adding a `bun install` step before packaging the server, to ensure bun-sidecar dependencies are present.
  - config/personas/memory.yaml.ltm-outbox.sqlite3: This SQLite database is in the source tree — it might contain stale data that fails when the schema changes.
  - dist-portable/maxma-error-report-*.txt: The reports show recurring openai.AuthenticationError and ConnectionResetError. While these are runtime config issues (missing valid API key), they flood the error log and could mask real build bugs. Consider rate-limiting the LTM agent's auth error logging.

suspicions_about_opponent_fixes:
  - target_issue: R-005
    suspicion: R-005 added warnings for missing data paths already in the datas list, but the spec is still missing entire categories of required data (specifically bun-sidecar/node_modules, see B-002). The warning mechanism is correct but incomplete. Not filing a challenge because the fix itself (the warning logic) is correct; the gap is a different issue (B-002).
```
