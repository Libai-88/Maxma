# User Evaluation: Persona 2 — Power User

**Reviewer role**: Power user / daily operator
**Date**: 2026-07-19
**Project**: MaxmaHere — Frontend-Backend Communication Architecture

---

## Overall Score: 7.0 / 10

### Score breakdown

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| aesthetic_notes | 6.5 | The three-state connection indicator (connecting/online/offline) and the initial connecting=true guard are nice touches that make the app feel intentional. The error bar in Quick Chat (B-002 fix) provides visible feedback. However, the SSE token-in-URL pattern is visible to anyone inspecting dev tools — unsettling for a daily user. The absence of any in-flight message indicator or send-queue visualization means the app offers no insight when the network is flaky. Error feedback depends on the maxma:error event being heard (was broken for Quick Chat until fixed), and there is still no toast/notification when the backend silently drops unknown message types. The overall polish is solid for a personal project but not production-grade. |
| agent_capability_notes | 7.5 | The agent engine (oh-my-pi) sidecar architecture is ambitious and mostly works. WebSocket streaming with cancel support, plan step-by-step output, and artifact actions are genuinely useful features for an AI-powered chat. The exponential backoff reconnection with jitter means the agent recovers gracefully from backend restarts. The per-session WebSocket isolation prevents one broken session from taking down others, which is a real win for multi-chat users. Downside: the turn streaming error silence (backend exception leaves the frontend stuck in isStreaming until manual cancel) is a daily frustration — you send a prompt, get no response, and have to hit cancel blindly. The WS rate limiter config fields silently fall back to defaults because they don't exist in the Settings model, which erodes confidence that the agent is properly rate-governed. |
| trust_notes | 6.5 | This is the weakest dimension. The silent message drop on WebSocket close-while-sending (R-001) is the kind of bug that destroys trust — you type a message, hit send, it disappears with zero feedback. That was flagged as high priority and still shows as open in the issue tracker. The HTTP requests have no timeout (R-008), so a hung backend means a hung UI with no recourse. The rate limiting was entirely dead for the first three rounds (B-004), meaning the only thing preventing abuse was localhost-only deployment — a configuration accident, not design. Auth token exposure in the SSE URL (R-004) means any browser extension or plugin seeing your network tab has your token. On the positive side, the token version-counter race fix (B-001), the localStorage quota eviction strategy, and the thorough re-fix cycles across 4 rounds show genuine investment in reliability. The final sweep confirmed no remaining medium/high issues, which is reassuring for ongoing use. |

### Overall assessment

MaxmaHere shows a strong architectural foundation with thoughtful WebSocket lifecycle management, session isolation, and reconnection resilience. For daily use as a local AI chat client, it works well — the core chat flow is functional, the agent responds, sessions reconnect, and the UI gives basic connection state feedback.

However, as a power user who relies on this tool day in and day out, the trust gap is real. The silent message-drop race is the most concerning: if I type something important and it vanishes, I have no way to know. The lack of HTTP request timeouts means a single slow endpoint can freeze the UI. The SSE token exposure and the now-fixed rate-limiting gap suggest a pattern where security and reliability features are designed but not always wired through to the running application.

The 4-round competition was productive — the codebase is genuinely better at the end than at the start. Most medium and high issues are now fixed. But the remaining open items (R-001, R-008, R-004 in particular) are exactly the kind of things a daily user would hit and lose confidence over.

---

## Aesthetic Notes

**What works:**
- The three-state connection indicator (connecting/online/offline) with an initial `connecting=true` state prevents the embarrassing "offline on first paint" UI flicker. This is a small touch that a daily user notices and appreciates.
- The error bar in Quick Chat (added in B-002 fix) provides visible, dismissible error feedback. Before the fix, errors were dispatched into the void — a clear rough edge.
- The per-session WebSocket architecture means opening multiple conversations feels snappy; each session manages its own lifecycle independently.
- Middleware ordering is documented with rationale — the attention to "rate-limit before auth" shows the team thinks about operational behavior.

**What could be better:**
- No visual feedback for in-flight messages. When the network is slow, there is no send queue indicator, no "queued" badge, no retry affordance. The user sends and waits, unsure if anything happened.
- The SSE token-in-URL (activity.ts) is visible in the browser's network inspector. Even if the token is short-lived, seeing `?token=...` in a request URL feels wrong to any technically aware user.
- When the backend WebSocket handler drops an unknown message type, it does so silently — no log, no frontend notification. If an extended message type goes missing, the user sees a gap in functionality with no explanation.
- The error bar uses `var(--status-error, #e74c3c)` which means it inherits theme colors, but there is no success/info toast system for non-error feedback (e.g., "Reconnected", "Session synced").

**Polish verdict**: Functional but not delightful. The connection UI is the standout feature; everything else is baseline.

---

## Agent Capability Notes

**What works:**
- The oh-my-pi sidecar integration is ambitious: WebSocket streaming with step-by-step plan output (`plan_step_start`, `plan_step_end`, `plan_step_error`), artifact actions, and cancel support. For an AI chat agent, this provides real-time visibility into the agent's thinking.
- Cancel works at multiple levels: frontend sends cancel message -> backend sets cancel_event -> sidecar receives RPC cancel. The asyncio.wait interleaving in the message loop keeps the UI responsive even during long streaming turns.
- Per-session WebSocket isolation is a genuine architectural win. A corrupted or crashing session doesn't affect other conversations. This is especially important for an agent that might end up in inconsistent states.
- Reconnection with exponential backoff and jitter means the agent recovers gracefully from backend restarts without overwhelming the server.
- The heartbeat/ping-pong mechanism (R-005 fix) keeps connections alive and detects dead connections proactively rather than waiting for a send failure.

**What could be better:**
- **Turn streaming error silence**: When `_stream_turn_sidecar` raises an exception, `_handle_turn_result` logs the error but sends no event to the frontend. The frontend remains stuck in `isStreaming` state — the user sees the streaming indicator but nothing happens. The only recovery is manual cancel or WebSocket reconnect. As a daily user, this means a non-trivial fraction of prompts end in a "stuck" state requiring manual intervention. This should have been a filed issue; it was noted as a minor observation in Round 4.
- **WS rate limiter config fallback**: `get_ws_rate_limiter()` tries to load `rate_limit_ws_capacity` and `rate_limit_ws_window_seconds` from Settings, but these fields don't exist in the Pydantic model (which has `extra="forbid"`). It silently falls back to defaults. This means any attempt to configure per-session rate limits via settings is silently ignored — the user might think they've tuned the rate limiter when they haven't.
- **The message type whitelist in the backend handler** (KNOWN_TYPES) drops unlisted types without logging. If the agent engine introduces a new message type in an update, it will be silently dropped, and the user won't see the expected behavior. A debug-level log on unknown types would save significant debugging time.
- **No automatic retry on 401** in the REST API `request()` wrapper. For local deployment this is acceptable, but it means any mid-session token expiry would require a manual reload.

**Agent verdict**: Capable and well-architected for a personal project. The streaming, cancel, and per-session isolation are genuine strengths. But the streaming error silence and silent config fallbacks create a "works until it doesn't" experience that a power user relying on the agent daily would find frustrating.

---

## Trust Notes

**What inspires confidence:**
- The competition was genuinely productive: 4 rounds of finding and fixing issues, and the final sweep confirmed zero remaining medium/high issues. This signals that the team cares about reliability and can systematically improve the codebase.
- The token lifecycle with version counter (B-001 fix) is a correct solution to a subtle async race. It passed rigorous verification including concurrent scenarios, nested resets, and mid-flight resetToken calls. This is the kind of foundation you need to trust the auth layer.
- The localStorage quota eviction strategy (evict oldest half of other sessions' caches before giving up) demonstrates operational thinking — the app degrades gracefully rather than crashing or losing data.
- The heartbeat/ping-pong infrastructure, now fixed, means the system proactively detects and recovers from dead connections rather than leaving the user staring at a frozen UI.
- The middleware ordering and the fact that RateLimitMiddleware was eventually registered (B-004 fix) shows the team acts on findings and closes the gap between design intent and running code.

**What erodes trust:**
- **Silent message drop (R-001, high, still open)**: This is the single biggest trust issue. The race between `canSend` (checking `readyState === WebSocket.OPEN`) and the actual `ws.send()` means a message can vanish with zero feedback. For a chat application, message loss is existential. The user types something, presses enter, sees no error, but the message never arrives and never will. There is no queuing, no retry, no acknowledgment pattern. A power user relying on this for work would eventually lose a message and lose trust.
- **No HTTP request timeout (R-008, medium, still open)**: The `request()` wrapper has no AbortController or timeout. If the backend hangs on any API call (session creation, token loading, chat history fetch), the UI hangs indefinitely with no recourse. In practice this means any transient backend issue makes the entire frontend unresponsive.
- **SSE token in URL query (R-004, medium, still open)**: The token is passed as `?token=...` in the SSE connection URL. The codebase acknowledges this tradeoff but doesn't resolve it. Any browser extension, proxy, or network inspector can capture the token. For a local Tauri app this is lower risk, but it trains the habit that "token in URL is acceptable" — a dangerous pattern.
- **Rate limiting was entirely dead code (B-004)**: For the first three rounds of the competition, `RateLimitMiddleware` was defined, exported, tested, but never registered. The only thing protecting the backend from request flooding was the localhost-only network binding. This is a gap between designed architecture and running application — and one the development team didn't notice until external review.
- **The sheer volume of issues discovered**: 9 Red issues (R-001..R-009) across high, medium, and low priorities. 4 Blue issues (B-001..B-004). While most are now fixed or addressed, the concentration of bugs in the communication layer (WebSocket lifecycle, auth, error handling) means this was a rough codebase before the competition. A power user who joined before these fixes would have had a noticeably worse experience.

**Trust verdict**: The product is on an upward trajectory — the competition has driven meaningful fixes. But the remaining open issues (especially R-001 silent message drop) are dealbreakers for a trust-sensitive daily user. I would use this for experimentation and learning, but I would not depend on it for important conversations until the send reliability and HTTP timeout gaps are closed.

---

## Would I Use This Daily? — Yes, with reservations

I would use MaxmaHere as my primary AI chat client for personal experimentation, prototyping, and learning. The per-session WebSocket architecture, the streaming agent integration, and the thoughtful reconnection logic make it a genuinely capable tool. The connection state UI and the localStorage eviction strategy show that the developers think about real-world use.

**However, I would not use it for anything I couldn't afford to lose.** The silent message-drop race means every sent message is at risk of vanishing without a trace. The lack of HTTP timeouts means a random backend hiccup can freeze the UI. These are not theoretical concerns — they are verified bugs that remain open.

**What would it take to earn full trust?**
1. Fix the silent message drop (R-001) — add a send queue with retry or at minimum a send-with-acknowledgment pattern
2. Add AbortController-based timeouts to all HTTP requests (R-008)
3. Migrate SSE auth from URL query parameter to a short-lived one-time ticket or header-based approach (R-004)
4. Add user-visible streaming error recovery so a failed turn doesn't leave the UI stuck in isStreaming

If these four items were addressed, I would upgrade my recommendation from "use with caution" to "daily driver."
