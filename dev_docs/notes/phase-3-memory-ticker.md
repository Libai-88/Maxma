# Phase 3 Memory Ticker Foundation

`memory.memory_ticker.MemoryTicker` is a default-off, reusable daily pipeline.
Its constructor reads `memory_ticker_enabled` and remains a no-op until a
caller supplies a source and compiler; the application intentionally does not
invent a conversation-to-fact compiler during startup.

Each item is identified by `day`, `session_id`, `persona_id`, `source_id`, and
`source_version`. The ticker persists only hashed identity and completion time,
not conversation content. It invokes the compiler with a stable idempotency
key and checkpoints after each success using an atomic replacement.

The delivery contract is at-least-once across a crash between projection and
checkpoint. Compilers that write facts must pass the key to
`FactStore.add(..., idempotency_key=key)`, which makes replay safe. Compilers
for narrative memory need an equivalent idempotency boundary before they are
connected.

The cache-preserving compaction helper is wired to chat and manual compaction
when `cache_preserving_compaction_enabled=true`. It records a stable
fixed-prefix hash, source turn boundary, source/retained hashes, and token
counts as `additional_kwargs["maxma_compaction"]` on the summary message.
With the flag off, the legacy summary format remains unchanged.

FactStore is wired as a separate `facts` layer only when
`fact_store_retrieval_enabled=true`. It supplements rather than replaces the
existing semantic path, requires an explicit `session_id`, and removes expired
facts and their FTS rows through the ordinary TTL scheduler.
