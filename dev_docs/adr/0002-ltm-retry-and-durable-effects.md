# ADR 0002: LTM Retry and Durable Effects

LTM remains an outbox-backed, idempotent projection. The phase-1 policy will
separate permanent failures from bounded, jittered transient retries and will
not sleep while holding a SQLite transaction or lease. Terminal outcomes are
retained as a queryable summary.

```json
{"type":"memory_done","payload":{"turn_id":"opaque-turn-id","status":"failed","reason_code":"authentication_failed"}}
```

Conversation text, provider credentials, raw HTTP bodies and stack traces are
not event fields. Cancellation remains `CancelledError`, never a retry.

