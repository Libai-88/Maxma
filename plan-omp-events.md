# Plan: OMP Agent Event Protocol Frontend Adaptation Audit & Fix

## Audit Findings Summary

### Data Flow
```
OMP Pi Agent → AgentEvent → session-bridge.ts → JSON-RPC (event) → pi_bridge/rpc_client.py → chat.py → WebSocket → frontend
```

### OMP AgentEvent Types (pi-agent-core)
The OMP library emits these `AgentEvent` types:
- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update` (with `AssistantMessageEvent` inside), `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`

There is **no** `agent_status`, `capture`, or `user_needs_input` — those are not real OMP events. No action needed.

### 10 Documented Events (ws_event_mapper.py)
`thinking_start`, `token`, `thinking_end`, `tool_start`, `tool_end`, `tool_error`, `answer`, `done`, `error`, `context_usage`

---

## Finding 1: `thinking_start` / `thinking_end` / `thinking_delta` Not Mapped by Sidecar

**File**: `bun-sidecar/src/session-bridge.ts`, function `mapPiEventToMaxma()` (lines 163-260)

The `message_update` handler only maps `text_delta` → `token` and `error` → `error`. But `AssistantMessageEvent` also includes:
- `thinking_start` → should map to `{ type: "thinking_start", payload: { timestamp } }`
- `thinking_delta` → should map to `{ type: "token", payload: { token: delta } }`
- `thinking_end` → should map to `{ type: "thinking_end", payload: { timestamp } }`

**Status**: Frontend handlers for these events exist (lines 423-439 of `useChat.ts`) but are **dead code**.

**Fix A1**: Add `thinking_start`/`thinking_delta`/`thinking_end` mapping in `message_update` handler.

---

## Finding 2: `context_usage` Standalone Event Never Sent

**Files**: `bun-sidecar/src/session-bridge.ts`, `api/routes/chat.py`

The sidecar never emits `context_usage` as a standalone event. The Python bridge computes context usage inline and embeds it in the `done` event payload.

**Status**: The `context_usage` case in `handleEventForChannel` (line 339-350) is **dead code**.

**Fix A2**: Keep the handler but add a comment noting it is reserved for future use. No code change needed — just documentation cleanup.

---

## Finding 3: `ContextUsage` Type Mismatch (Frontend)

**File**: `web/src/types/index.ts` (lines 505-511)

Three different shapes for the same data:

| Source | Fields |
|--------|--------|
| Backend `_calculate_context_usage()` | `estimated_tokens`, `max_tokens`, `percentage`, `message_count`, `model_name` |
| Frontend `ContextUsage` (current) | `current_tokens`, `max_tokens`, `usage_percent`, `model_name`, `breakdown?` |
| Frontend `ChatContextUsage` (chat.ts) | `estimatedTokens`, `maxTokens`, `percentage`, `messageCount`, `modelName` |

**Fix B**: Update `ContextUsage` to match the backend shape. Remove `TokenBreakdown`/`breakdown` as they are unused.

---

## Finding 4: `ToolErrorEvent` Missing `elapsed` Field

**File**: `web/src/types/index.ts` (lines 32-35)

Sidecar sends `tool_error` with `elapsed: number` (see rpc-types.ts:127), but frontend `ToolErrorEvent` payload only has `{ tool_name, error }`.

**Fix C**: Add `elapsed: number` to `ToolErrorEvent.payload`.

---

## Finding 5: `DoneEvent` Uses Wrong Type for `context_usage`

**File**: `web/src/types/index.ts` (line 44)

Current: `payload: { turn_id?: string; context_usage?: ContextUsage }`

After Fix B, `ContextUsage` will match the backend shape. The `done` handler assigns raw backend data to `ch.contextUsage` (which is `ContextUsage | null`). No additional type change needed after Fix B.

---

## Proposed Changes

| # | File | Change |
|---|------|--------|
| A1a | `bun-sidecar/src/session-bridge.ts` | Add `thinking_start`/`thinking_delta`/`thinking_end` mapping in `message_update` branch |
| A1b | `api/routes/chat.py` | Register `thinking_start`/`thinking_end` WS forwarding handler |
| B | `web/src/types/index.ts` | Rewrite `ContextUsage` to match backend shape; remove unused `TokenBreakdown`/`breakdown` |
| C | `web/src/types/index.ts` | Add `elapsed: number` to `ToolErrorEvent.payload` |

**No changes needed to**: `ws_event_mapper.py`, `rpc-types.ts` (already correct after fixes), useChat.ts handler logic, `chat.ts` store types.

---

## Verification

After applying all fixes:
```sh
cd D:/Maxma/MaxmaHere/web
npx vue-tsc --noEmit
```
