# Competition Summary — 20260719-013946-maxmahere-fe-be-arch

> Single source of truth. All agents (host + sub-agents) read this first. The host (arbiter) is the only one who writes to the state machine and scoreboard sections; teams append their round reports to the linked files.

---

## State machine

```
state: done
round: 4
round_state: blue          # Blue phase active - if empty, contest terminates
consecutive_empty_rounds: 2
empty_threshold: 2
max_competition_score: 60
```
- `state` is updated by the host only.
consecutive_empty_rounds: 0
empty_threshold: 2
max_competition_score: 60
```

- `state` is updated by the host only.
- `round_state` tracks within-round progress.
- `consecutive_empty_rounds` resets to 0 whenever a round produces ≥1 new medium/high issue.
- Termination triggers when `consecutive_empty_rounds >= empty_threshold`.

---

## Project under review

See `project.md`. Quick recap:
- **Root**: `D:\Maxma\MaxmaHere`
- **Language/framework**: Python FastAPI + Vue 3/Vite + oh-my-pi (Bun/TS) + Tauri 2 (Rust)
- **Scope**: Frontend-backend communication architecture — WebSocket, REST API, session sync, proxy config, error resilience
- **Known prior issues (from previous competition)**: handleProtocols fix for Vite WS proxy, OnboardingView null-safety fix

---

## Scoreboard

**Competition points**

| Team | Round-by-round subtotal | Running total |
| ---- | ----------------------- | ------------- |
| Blue | +15 (R1) +5 (R2) +2 (R3) | 22            |
| Red  | +13 (R1) -3 +3 (R2) +5 (R3) | 18        |

Competition points in the open: 40 / 60

**User evaluation** (mean of 3 personas, 0-10 scale): TBD

---

## Issue index (live)

| ID | Priority | Discovered by | Round | Status | Title |
|----|----------|---------------|-------|--------|-------|
| R-001 | high | Red | 1 | verified | Silent message drop when WebSocket closes between canSend and send() |
| R-002 | medium | Red | 1 | verified | connectSession() promise rejection unhandled (re-fixed) |
| R-003 | medium | Red | 1 | verified | waitForBackend() return value ignored |
| R-004 | medium | Red | 1 | verified | Auth token exposed in SSE URL query parameter |
| R-005 | medium | Red | 1 | verified | Missing heartbeat with pong timeout (re-fixed) |
| R-006 | low | Red | 1 | verified | Default waitForBackend timeout mismatched |
| R-007 | low | Red | 1 | verified | Global error handler no user feedback (re-fixed) |
| R-008 | medium | Red | 2 | verified | api/index.ts request() has no timeout/AbortController |
| R-009 | low | Red | 2 | verified | ensureConnected() sets initialized=true before WS established |
| B-001 | medium | Blue | 2 | verified | resetToken() race with in-flight ensureTokenLoaded() |
| B-002 | low | Blue | 2 | verified | Quick Chat entry point lacks global error handler |
| B-003 | medium | Blue | 2 | verified | Backend WS handler silently drops all non-chat messages |
| B-004 | medium | Blue | 3 | verified | RateLimitMiddleware never registered on FastAPI app (dead code) |
| BC-001 | — | Blue | 1 | confirmed | Challenge: R-002 missed .catch() at line 271 |
| BC-002 | — | Blue | 1 | confirmed | Challenge: R-005 no pong timeout monitoring |
| BC-003 | — | Blue | 1 | confirmed | Challenge: R-007 no listener for maxma:error event |

- Statuses: `open` / `fixed-by-red` / `verified` / `challenged` / `confirmed` / `refuted` / `disputed` / `wontfix`

---

## Round log

### Round 1
- **Red phase**: 7 issues filed (R-001..R-007) — 7/7 confirmed (+13 pts)
- **Blue phase**: 3 challenges (BC-001..BC-003) — 3/3 confirmed (+15 pts, Red -3 consolation)
- **Round 1 outcome**: High-scoring round. Blue's Mode B strategy paid off. consecutive_empty_rounds = 0

### Round 2
- **Red phase**: fixed BC-001..BC-003 (challenge re-fixes), filed R-008..R-009
- **Arbiter verification**: 5/5 confirmed (+3 pts)
- **Red points this round**: 0 (challenge re-fixes) + 2+1 (new) = 3
- **Blue phase**: 3 new issues (B-001..B-003), Mode A
- **Arbiter verification**: 3/3 confirmed (+5 pts)
- **Blue points this round**: 2+1+2 = 5
- **Round 2 outcome**: 2 new medium issues → consecutive_empty_rounds = 0

### Round 3
- **Red phase**: fixed B-001..B-003 (cross-team) + updated 9 test mock signatures
- **Arbiter verification**: 3/3 confirmed (+5 pts) — Red 18
- **Blue phase**: B-004 (medium) new finding — RateLimitMiddleware dead code (+2 pts)
- **Arbiter verification**: confirmed
- **Blue points this round**: 2 — Blue 22

### Round 4
- **Red phase**: fixed B-004 — RateLimitMiddleware registered on FastAPI app (+2 pts)
- **Red points this round**: 2 | Red: 20
- **Blue phase**: Mode A, 0 new items — empty round
- **Blue points this round**: 0 | Blue: 22
- **Round 4 outcome**: 2 consecutive empty rounds → **TERMINATE**

---

## User evaluation log

- Persona 1 (enthusiast): **7.6**
- Persona 2 (power user): **7.0**
- Persona 3 (novice): **6.5**
- **User-eval mean**: **7.03**

---

## Final

Champion: **Blue Team** 🏆 (22 pts vs Red 20 pts)
Final score: **7.02 / 10** (0.5 × 7.00 normalized competition + 0.5 × 7.03 user eval)
See `result.md` for the full breakdown.

- Persona 1 (enthusiast): *(pending)*
- Persona 2 (power user): *(pending)*
- Persona 3 (novice): *(pending)*

---

## Final

*(pending)*
