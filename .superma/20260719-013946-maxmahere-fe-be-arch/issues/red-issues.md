# Red Team Issues

| ID | Priority | Discovered by | Round | Status | Title |
|----|----------|---------------|-------|--------|-------|
| R-001 | high | red | 1 | open | Silent message drop when WebSocket closes between canSend check and send() call |
| R-002 | medium | red | 1 | open | connectSession() promise rejection unhandled in ensureConnected() and reconnection timer |
| R-003 | medium | red | 1 | open | waitForBackend() return value ignored; connection proceeds regardless |
| R-004 | medium | red | 1 | open | Auth token exposed in SSE URL query parameter |
| R-005 | medium | red | 1 | open | Missing application-level WebSocket heartbeat/ping mechanism |
| R-006 | low | red | 1 | open | Default waitForBackend timeout mismatched with documented sidecar startup time |
| R-007 | low | red | 1 | open | Global error handler only logs to console, no user-facing feedback |
