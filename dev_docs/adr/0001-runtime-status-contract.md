# ADR 0001: Runtime Status Contract

## Decision

Components use `api.runtime_status`: health is `ok`, `degraded`, or `error`;
background jobs are `queued`, `running`, `succeeded`, `failed`, or `cancelled`.
Public payloads can contain `reason_code`, `retry_at`, `updated_at`, and a safe
summary. Technical detail is redacted before HTTP, WebSocket, or browser output.

Existing `detail` remains for compatibility only. Consumers use `reason_code`,
never an English exception string.

```json
{"status":"degraded","reason_code":"rate_limited","retry_at":1735689660.0,"updated_at":1735689600.0,"summary":"The upstream service is rate limited."}
```

