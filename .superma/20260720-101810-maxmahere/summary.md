# Superma Run — MaxmaHere Quality Review

## Run metadata
- **Run ID**: `20260720-101810-maxmahere`
- **Run dir**: `d:\Maxma\MaxmaHere\.superma\20260720-101810-maxmahere\`
- **Target project**: `d:\Maxma\MaxmaHere`
- **Started**: 2026-07-20 10:18:10 (Asia/Shanghai)
- **MAX_COMPETITION**: 60 (score normalization cap)
- **Persona set**: enthusiast / power-user / novice

## State machine
- **state**: `terminated → user_evaluation`
- **current_round**: 5 complete (contest terminated by arbiter judgment)
- **consecutive_empty_rounds**: 1 (Round 5 = first empty round; arbiter judged Round 6 redundant)
- **red_score**: 38
- **blue_score**: 42
- **last_updated**: 2026-07-20 12:30:00 (Asia/Shanghai)

## Issue counters
- R-### issued: 2 (R-001 HIGH, R-002 MEDIUM)
- B-### issued: 15 (B-001 HIGH, B-002 HIGH, B-003..B-008 MEDIUM, B-009..B-010 LOW, B-011..B-012 MEDIUM, B-013..B-015 LOW)
- BC-### issued: 3 (BC-001 MEDIUM targets B-010, BC-002 MEDIUM targets B-007, BC-003 MEDIUM targets B-012)
- B-### fixed by Red in Round 2: 8/10 (B-007, B-010 partially fixed)
- BC-### resolved by Red in Round 3: 2/2 (both fixed+verified)
- B-### fixed by Red in Round 4: 5/5 (B-011..B-015 all fixed+verified)
- BC-### open from Round 4 Blue: 1 (BC-003 — production parser still vulnerable)

## Scoring rules (canonical)
| Event                                                          | Points                |
| -------------------------------------------------------------- | --------------------- |
| Red fixes a high/medium/low issue (arbiter-verified)           | +3 / +2 / +1          |
| Blue discovers a new high/medium/low issue                     | +3 / +2 / +1          |
| Blue challenge confirmed (Red fix still broken, any priority)  | +5 per confirmation   |
| Blue challenge rejected (false alarm)                          | -1 to Red (consolation) |

## Termination rule
Contest ends when **2 consecutive rounds** produce **zero new medium-or-high issues** from either side. Low-only rounds leave `consecutive_empty_rounds` unchanged.

## Issue index (live)
| ID    | Priority | Team | Discovered Round | Status         | Fixed By | Title |
| ----- | -------- | ---- | ---------------- | -------------- | -------- | ----- |
| R-001 | HIGH     | Red  | 1                | fixed+verified | Red      | MaxmaBlocker filename mismatch — API created markers invisible to security_adapter (silent bypass) |
| R-002 | MEDIUM   | Red  | 1                | fixed+verified | Red      | httpx.AsyncClient singleton in balance.py never closed on FastAPI shutdown (resource leak) |
| B-001 | HIGH     | Blue | 1                | fixed+verified | Red R2   | bun-sidecar config tools use process.cwd() but sidecar spawned with cwd=bun-sidecar/ — fixed via MAXMA_PROJECT_ROOT env var |
| B-002 | HIGH     | Blue | 1                | fixed+verified | Red R2   | chat.py sends str(PROJECT_ROOT) instead of "." — coupled with B-001 |
| B-003 | MEDIUM   | Blue | 1                | fixed+verified | Red R2   | compact RPC implemented in session-bridge.ts:601 |
| B-004 | MEDIUM   | Blue | 1                | fixed+verified | Red R2   | manage_macros.ts validateName + assertWithinMacrosDir added |
| B-005 | MEDIUM   | Blue | 1                | fixed+verified | Red R2   | balance.py _client_lock + async _get_async_client |
| B-006 | MEDIUM   | Blue | 1                | fixed+verified | Red R2   | /memory returns 501 instead of fabricated data |
| B-007 | MEDIUM   | Blue | 1                | fixed+verified | Red R2   | undo backwards-walk replaces steps*2 arithmetic |
| B-008 | MEDIUM   | Blue | 1                | fixed+verified | Red R2   | mcp_test.py _ALLOWED_COMMANDS whitelist + _resolve_command + _validate_args |
| B-009 | LOW      | Blue | 1                | fixed+verified | Red R2   | server.py lifespan startup calls migrate_plaintext_keys_to_encrypted() |
| B-010 | LOW      | Blue | 1                | fixed+verified | Red R2   | manage_mcp.ts parseYaml rewritten with proper indent-aware stack |

## Round history
| Round | Red Issues (H/M/L) | Blue Issues (H/M/L) | Blue Challenges | Red Δ | Blue Δ | Empty? |
| ----- | ------------------ | ------------------- | --------------- | ----- | ------ | ------ |
| 1     | 1H / 1M / 0L       | 2H / 6M / 2L        | 0 (Mode A)      | +5    | +20    | No (8 new H/M) |
| 2     | 0 new (fixed 10 B) | 0 new (Mode B)      | 2 confirmed (BC-001, BC-002) | +20 | +10 | No (2 confirmed challenges = 2 M issues persist) |
| 3     | 0 new (fixed 2 BC) | 0H / 2M / 3L        | 0 (Mode A)      | +4    | +7     | No (2 new M from Blue) |
| 4     | 0 new (fixed 5 B)  | 0H / 0M / 0L        | 1 confirmed (BC-003) | +7 | +5  | No (1 confirmed challenge = M-equivalent) |
| 5     | 0 new (fixed 1 BC) | 0H / 0M / 0L        | 0 (Mode B+A)    | +2    | +0     | Yes #1 (arbiter judged R6 redundant — terminated) |

## Notes
- Working tree has uncommitted prior-session changes (api/routes/chat.py, providers.py, bun-sidecar/src/session-bridge.ts, web/src/composables/useChat.ts, etc.). Red team should treat the current working tree as the project's "head" state and review it as-is.
- Prior superma runs finalized — these uncommitted changes appear to be continued work after the last contest. Do NOT trust prior `RED_TEAM_ROUND*_REPORT.md` / `BLUE_TEAM_ROUND*_REPORT.md` as ground truth; re-review from scratch.
