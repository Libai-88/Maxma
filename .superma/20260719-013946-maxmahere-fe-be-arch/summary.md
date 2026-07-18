# Competition Summary — 20260719-013946-maxmahere-fe-be-arch

> Single source of truth. All agents (host + sub-agents) read this first. The host (arbiter) is the only one who writes to the state machine and scoreboard sections; teams append their round reports to the linked files.

---

## State machine

```
state: running
round: 1
round_state: red           # Red phase active
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
| Red  | —                       | 0             |
| Blue | —                       | 0             |

Competition points in the open: 0 / 60

**User evaluation** (mean of 3 personas, 0-10 scale): TBD

---

## Issue index (live)

| ID | Priority | Discovered by | Round | Status | Title |
|----|----------|---------------|-------|--------|-------|
| —  | —        | —             | —     | —      | —     |

- Statuses: `open` / `fixed-by-red` / `verified` / `challenged` / `confirmed` / `refuted` / `disputed` / `wontfix`

---

## Round log

### Round 1
- **Red phase**: *(pending)*
- **Blue phase**: *(pending)*

---

## User evaluation log

- Persona 1 (enthusiast): *(pending)*
- Persona 2 (power user): *(pending)*
- Persona 3 (novice): *(pending)*

---

## Final

*(pending)*
