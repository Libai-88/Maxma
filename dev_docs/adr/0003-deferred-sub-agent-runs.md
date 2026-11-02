# ADR 0003: Deferred Sub-Agent Runs

> Status: **execution side not implemented.** pi has no sub-agent runtime
> (`pi-contract.ts` registers `deferred_subagent_submitted` as unproduced), so
> `deferred_runs` is always empty and the entry point is capability-gated off.
> The privacy rule below already binds the read path (`AgentTasksView`,
> `useAgentTasks`); the rest constrains the future execution side.

Async sub-agents will receive a durable run id, immutable parent session/turn
and delegation snapshots, a lease-owned state transition, result reference,
cancellation reason and expiry. The parent gets one summary; child token events
require an explicit child-run subscription.

```json
{"run_id":"opaque-run-id","parent_session_id":"opaque-session-id","status":"queued","updated_at":1735689600.0}
```

Full prompts, child transcripts, credentials and raw tool results do not enter
the parent summary or audit event. The read path titles cards with the opaque
`run_id` and never reads `task` / `name`.

