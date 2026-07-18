# Plan: Add `get_health` RPC handler to sidecar

## Problem

`health.py` calls `client.call("get_health", {"probe": True})` (line 126 of `D:\Maxma\MaxmaHere\api\health.py`), but the Bun sidecar has no matching handler. This results in `Unknown method: get_health` errors.

## File to modify

`D:\Maxma\MaxmaHere\bun-sidecar\src\session-bridge.ts`

## Change

Insert a new `if (method === "get_health")` block into the existing RPC handler chain, after the `destroy_session` block (ends at line 504) and before the `undo` block (starts at line 506).

The handler returns `{ status: "ok", message: "sidecar running" }` — matching what `health.py` checks on line 130 (`result.get("status") == "ok"`).

## Verification

- The handler doesn't access any session state, so it works regardless of whether any sessions exist.
- `health.py` catches `Exception` broadly (line 146), so even if the entire call fails the endpoint still degrades gracefully.
- After the change, a probe like `{"jsonrpc": "2.0", "id": 1, "method": "get_health", "params": {"probe": true}}` should return `{"jsonrpc": "2.0", "id": 1, "result": {"status": "ok", "message": "sidecar running"}}`.
