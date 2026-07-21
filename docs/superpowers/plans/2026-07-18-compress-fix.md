# Plan: Fix session_compress Shell — Connect to OMP SnapCompact via Sidecar

## Current State

- **`session_compress.py`**: Both endpoints (`POST /{session_id}/compress` and `POST /{session_id}/fresh-compact`) return fake `{compressed: true, method: "automatic"}` with no real compression.
- **`session-bridge.ts`**: Sidecar has NO `compact` RPC method. It only has: `create_session`, `prompt`, `cancel`, `destroy_session`, `undo`, `get_messages`.
- **`SidecarManager`**: Manages Bun subprocess lifecycle; exposes `.client` (JsonRpcClient).
- **`SessionMap`**: Provides `get_sidecar_id(maxma_id)` for Maxma-to-sidecar session ID mapping.
- **`JsonRpcClient.call(method, params)`**: Sends JSON-RPC and returns result dict; raises `JsonRpcError` on error responses (including `Unknown method`).

## Changes

### 1. Rewrite `session_compress.py` (single endpoint — the real caller)

Convert `compress_session` to attempt real sidecar compression:

```python
async def compress_session(session_id: str, request: Request) -> dict:
```

Logic flow:
1. Check session exists via `request.app.state.session_manager.get(session_id)` (preserve existing 404).
2. Get `SidecarManager` from `request.app.state.sidecar_manager`.
3. If manager is None or not running -> return `{compressed: false, method: "unavailable", detail: "..."}`.
4. Get sidecar session ID via `SessionMap().get_sidecar_id(session_id)`.
5. If no sidecar mapping -> return degraded.
6. Call `client.call("compact", {"session_id": sidecar_sid})`.
7. On success -> return `{compressed: true, method: "sidecar", removed_count: ..., detail: ...}`.
8. Catch `JsonRpcError` (unknown method) -> return degraded `{compressed: false, method: "degraded", detail: "compact not supported by sidecar"}`.
9. Catch other exceptions -> return `{compressed: false, method: "error", detail: ...}`.

### 2. Add `compact` RPC method stub to `session-bridge.ts` (optional)

Backfill a `compact` handler that calls `session.agent.compact()` or similar — **this depends on whether `@oh-my-pi/pi-coding-agent` exposes a SnapCompact API**. If it doesn't, the RPC will return `Unknown method` and the Python side degrades gracefully.

**Decision**: Since we don't know the pi-coding-agent SnapCompact API, we will:
- Not add a sidecar `compact` handler now (leave it unknown → degraded response).
- The Python side handles degradation cleanly; future work can add the sidecar handler when the API is known.

### 3. Keep `trigger_compaction` (fresh-compact) as simple alias or remove

The `fresh-compact` endpoint (`trigger_compaction`) is the same pattern. We'll either:
- Make it call the same logic, OR
- Leave it as-is with a note.

**Decision**: Rewrite it identically (same logic, same sidecar call) for consistency.

---

## Files to Modify

| File | Action |
|---|---|
| `D:/Maxma/MaxmaHere/api/routes/session_compress.py` | Rewrite both endpoints to use sidecar |
| No other files needed | |

## Files to Read (prerequisites, done)

- `D:/Maxma/MaxmaHere/api/routes/session_compress.py`
- `D:/Maxma/MaxmaHere/bun-sidecar/src/session-bridge.ts`
- `D:/Maxma/MaxmaHere/api/pi_bridge/sidecar_manager.py`
- `D:/Maxma/MaxmaHere/api/pi_bridge/session_adapter.py`
- `D:/Maxma/MaxmaHere/api/pi_bridge/rpc_client.py`

## Rollout

1. Confirm plan with user.
2. Apply edits to `session_compress.py`.
3. Print summary of changes.
