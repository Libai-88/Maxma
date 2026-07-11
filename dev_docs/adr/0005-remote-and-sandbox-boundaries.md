# ADR 0005: Remote and Sandbox Boundaries

MCP lifecycle and Windows restricted-process work are independently gated.
Credential refresh or reconnect never weakens TLS, host/port allowlists, rate
limits, path validation or the application sandbox. A process reports only the
isolation level it actually established; unsupported capability is `degraded`.

```json
{"status":"degraded","reason_code":"runtime_degraded","summary":"The component is temporarily degraded."}
```

Telemetry redacts server identifiers, tool names, tokens and URL query values.

