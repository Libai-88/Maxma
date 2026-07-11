# Permission Modes

The backend authorization contract has four ordered modes:

| Mode | Read | Local write | External, executable, destructive, unknown |
| --- | --- | --- | --- |
| `read_only` | allow | deny | deny |
| `ask` | allow | ask | ask |
| `operate` | allow | allow | ask |
| `auto` | allow | allow only when explicitly whitelisted | ask |

The policy is an additional restriction layer.  Tool allow-lists, path access
checks, MCP restrictions, sandbox policy, and approval delivery remain
independent enforcement points.  Delegated work takes the more restrictive of
the parent and requested child modes; malformed child input becomes
`read_only`.

`permission_modes_enabled` is intentionally read with a compatibility default
of `False` until session persistence and UI selection are wired.  When disabled
the approval gateway retains its existing `approval_required_tools` behavior.
The remaining work is to add the configuration field, persist a selected mode
per session, expose the UI control, and record durable audit events.
