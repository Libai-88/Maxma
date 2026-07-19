# BC-006: Backend WS handler silently drops all non-chat messages

## Summary

The backend WebSocket message handler in `api/routes/chat.py` unconditionally drops every WebSocket message type except `ping` and `chat`. At least 5 message types that the frontend deliberately sends are silently discarded. Simultaneously, 6+ sidecar event types that the frontend handles are never forwarded.

## Code location

- `api/routes/chat.py:321` — message type filter that drops non-chat messages
- `api/routes/chat.py:193-197` — sidecar event registration missing ask_user and plan_* events

## Evidence A: Frontend sends, backend drops

### `cancel` (useChat.ts:1137-1142)
```typescript
function cancel() {
  const ch = activeChannel.value
  if (!ch.ws || ch.ws.readyState !== WebSocket.OPEN) return
  const payload: ClientMessage = { type: 'cancel', payload: {} }
  ch.ws.send(JSON.stringify(payload))
}
```
### `user_response` (useChat.ts:1144-1152)
```typescript
function sendUserResponse(interactionId: string, response: string | string[]) {
  // ...
  const payload: ClientMessage = {
    type: 'user_response',
    payload: { interaction_id: interactionId, response },
  }
  ch.ws.send(JSON.stringify(payload))
}
```
### `plan_response` (useChat.ts:1165-1181)
Sends `{ type: 'plan_response', payload: { plan_id, action } }` via WS.
### `artifact_action` (useChat.ts:1154-1163)
Sends `{ type: 'artifact_action', payload: { artifact_id, action_id, token } }` via WS.
### `update_auto_approve` (useChat.ts:952-958)
Sends `{ type: 'update_auto_approve', payload: { auto_approve } }` via WS.

### Backend handler (chat.py:307-323)
```python
while True:
    raw = await ws.receive_text()
    # ...
    if msg.get("type") == "ping":
        await ws.send_json({"type": "pong"})
        continue

    if msg.get("type") != "chat":
        continue  # ← ALL of the above message types land here and are DROPPED
```

## Evidence B: Sidecar emits, backend doesn't forward

### Sidecar event registration (chat.py:193-197)
```python
unsubs = []
for evt_type in ("token", "tool_start", "tool_end", "tool_error", "error"):
    unsubs.append(client.on(evt_type, _make_handler(evt_type)))
unsubs.append(client.on("answer", _on_answer))
unsubs.append(client.on("done", _on_done))
```

Events NOT forwarded:
- `ask_user` — the sidecar needs user input (approval, question answer)
- `plan_proposed` — sidecar proposes a plan
- `plan_step_start` — plan step begins
- `plan_step_end` — plan step completes
- `plan_step_error` — plan step fails
- `plan_completed` — plan execution finishes

### Frontend handles these events (useChat.ts:710-854)
The frontend's `handleEventForChannel()` has full handlers for ALL of the above event types:
- `case 'ask_user'` at line 710
- `case 'plan_proposed'` at line 771
- `case 'plan_step_start'` at line 795
- `case 'plan_step_end'` at line 812
- `case 'plan_step_error'` at line 822
- `case 'plan_completed'` at line 841

## Reproduction

### 1. Cancel button has no effect
1. Send a message and wait for streaming to begin
2. Click the stop/cancel button in ChatInput
3. Observe: The `cancel` message is sent via WebSocket (`{ type: "cancel" }`)
4. The backend handler reads it, but `msg.get("type") != "chat"` → `continue` → dropped
5. Streaming continues uninterrupted
6. The cancel button appears to do nothing (actually does nothing)

### 2. Tool approval flow is broken
1. Configure the agent with a tool that requires user approval (ask_user with mode='approval')
2. The sidecar (oh-my-pi) emits an `ask_user` event during turn processing
3. The backend does NOT forward this event to the frontend (not in the registered event types)
4. The frontend never shows the approval dialog
5. The turn hangs until the sidecar's timeout or default behavior
6. The user has no way to approve or reject the tool call

### 3. Plan review is broken
1. Configure the agent to use plan/approve flow
2. The sidecar emits `plan_proposed` event
3. The backend does NOT forward it
4. The frontend never shows the plan card
5. If the user somehow receives the plan and calls `sendPlanResponse()`, the WS message is dropped by the backend filter

## Impact assessment

The interactive agent features (tool approval with ask_user, plan review, cancel) are completely non-functional through the WebSocket bridge. This affects all users who:
- Use tools that require approval (ask_user mode)
- Use the plan/approve workflow
- Try to cancel an in-progress streaming response
- Use artifact actions
- Toggle auto-approve during an active session

The basic chat-only flow (send message → receive streaming answer) works correctly because `chat` and `ping` message types are handled.

## Fix suggestion

The backend WS handler needs to:
1. Forward `ask_user`, `plan_proposed`, `plan_step_start`, `plan_step_end`, `plan_step_error`, `plan_completed` events from the sidecar to the frontend
2. Handle `cancel`, `user_response`, `plan_response`, `artifact_action`, `update_auto_approve` messages from the frontend and forward them to the sidecar
3. For `cancel`: abort the in-progress `_stream_turn_sidecar()` call (e.g., via an asyncio.Event or task cancellation) and call `client.call("cancel", ...)` on the sidecar
4. For `user_response`: forward to the sidecar via the appropriate RPC call
