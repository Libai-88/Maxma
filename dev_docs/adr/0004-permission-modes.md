# ADR 0004: Permission Modes Are Additional Restrictions

The session modes are `read_only`, `ask`, `operate`, and `auto`. They refine
existing tool allowlists, path checks, MCP transport constraints and OS sandbox
boundaries; none can relax a lower-level protection. Legacy sessions keep the
approval-gateway behaviour until the flag is explicitly enabled.

```json
{"session_id":"opaque-session-id","permission_mode":"ask","updated_at":1735689600.0}
```

Audit stores IDs, decision codes and time, not prompts, keys, authorization
values, or complete tool arguments.

