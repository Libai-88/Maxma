# ADR 0003: Deferred Sub-Agent Runs

Async sub-agents will receive a durable run id, immutable parent session/turn
and delegation snapshots, a lease-owned state transition, result reference,
cancellation reason and expiry. The parent gets one summary; child token events
require an explicit child-run subscription.

```json
{"run_id":"opaque-run-id","parent_session_id":"opaque-session-id","status":"queued","updated_at":1735689600.0}
```

Full prompts, child transcripts, credentials and raw tool results do not enter
the parent summary or audit event.

