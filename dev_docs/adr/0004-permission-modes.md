# ADR 0004: Permission Modes Are Additional Restrictions

The session modes are `read_only`, `ask`, `operate`, and `auto`
(`bun-sidecar/src/kernel/types.ts`; judged by `needsApprovalForMode` in
`kernel/approval-gate.ts` from the official `Tool.annotations`). They refine
tool allowlists, MaxmaBlocker anchors, MCP transport constraints and Provider
URL checks; none can relax a lower-level protection. No compatibility flag
gates them — the modes are always active, and `ask` is the fallback for an
invalid mode value.

```json
{"session_id":"opaque-session-id","permission_mode":"ask","updated_at":1735689600.0}
```

Audit stores IDs, decision codes and time, not prompts, keys, authorization
values, or complete tool arguments.

