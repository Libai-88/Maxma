# Project: MaxmaHere

## Target
- **Root path**: `d:\Maxma\MaxmaHere`
- **Repository**: git-tracked; current HEAD `611ab3c` with uncommitted working-tree changes from prior session
- **Project type**: AI Agent desktop client (Vue 3 + FastAPI + Tauri + oh-my-pi sidecar)

## Architecture
```
Vue 3 Frontend (web/)  ── HTTP/WS ──  Python Backend (api/)  ── JSON-RPC ──  oh-my-pi Bun sidecar (bun-sidecar/)
        │                                      │                                       │
   Pinia stores                          FastAPI routes                              Agent tools
   Vue views                             SQLite + YAML stores                         MCP servers
   Tauri shell (desktop/)                Session/checkpoint persistence
```

## Scope (in-scope directories)
- `agent/` — Python agent core (context_manager, persona_loader, prompts)
- `api/` — FastAPI backend (routes, db, middleware, security, ws_registry, session_manager)
- `web/src/` — Vue 3 frontend (stores, views, components, composables, utils, themes)
- `bun-sidecar/src/` — Bun/TypeScript RPC bridge to oh-my-pi
- `config/` — settings + persona YAML
- `tests/` — pytest suite
- `build/` — Windows build scripts (bat/ps1)
- `desktop/src-tauri/` — Tauri Rust config
- `main.py`, `app_paths.py`, `start_dev.py` — entry points

## Out of scope
- `node_modules/`, `.venv/`, `dist/`, `target/`, `__pycache__/`
- `bun-sidecar/node_modules/`
- `web/package-lock.json` (generated)
- Generated logs: `*.log`, `vitest_*.log`, `tsc-*.txt`
- `RED_TEAM_ROUND*_REPORT.md`, `BLUE_TEAM_ROUND*_REPORT.md` (prior superma artifacts)
- `.superma/` (this run dir)
- `.superpowers/` (unrelated brainstorm artifact)

## Known constraints / conventions (from project memory)
- Python: 3.13 in isolated `.venv`; tests via `pytest.bat` or `.venv\Scripts\python.exe -m pytest`
- FastAPI: rate-limit middleware exempts read-only list prefixes, restricts writes
- Vue: NO `v-html` for dynamic content (XSS); use template rendering
- Tauri: capabilities must use only recognized permissions; `single-instance:default` is invalid
- Path access: `MaxmaBlocker` first, then whitelist — `api/data/` is blocked
- Health status vocabulary: `'ok'` / `'degraded'` / `'error'`
- Async locks required for global state, ws_registry, session_manager
- Scheduler: use `asyncio.get_running_loop()` (NOT `get_event_loop`)
- Build scripts: English output only (GBK console issues)

## Test commands (for verification)
- Backend tests: `pytest.bat` or `.venv\Scripts\python.exe -m pytest tests/ -x`
- Frontend typecheck: `cd web && bun run typecheck` (or `npx tsc --noEmit`)
- Frontend unit tests: `cd web && bun run test`
- Smoke import: `.venv\Scripts\python.exe -c "import api; import agent"`

## What to look for (priority order)
1. **High**: security (XSS, path traversal, auth bypass, injection), data loss, crashes, deadlocks, race conditions, unhandled exceptions in hot paths
2. **Medium**: logic bugs, broken UX flows, incorrect API contracts, memory leaks, incorrect error handling, schema mismatches, missing rate limits
3. **Low**: dead code, typos in user-visible strings, minor style issues, missing types, cosmetic inconsistencies
