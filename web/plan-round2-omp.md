# Plan Round 2 — OMP Provider Preset Verification + Tool Error Elapsed + ThinkingDeltaEvent

## Task 1: Verify Provider Preset (already correct in v1)

**Files**: `src/views/ProvidersView.vue`

- [x] `presets` array contains 26 providers (lines 188–215) — **already correct**
- [x] `handleSave()` at line 396 uses `form.value.provider_type` instead of hardcoded `'openai'` — **already correct**
- [x] Card badge at line 22 uses `p.provider_type.toUpperCase()` instead of hardcoded `'OPENAI'` — **already correct**

**Action**: No code changes needed. Just confirm in summary.

---

## Task 2: Tool Error — populate `elapsed` + `output` from event, and display in UI

### 2a. Fix `useChat.ts` — `tool_error` handler

**Current** (lines 497–503):
```typescript
case 'tool_error': {
  const tc = findRunningTool(turn.events, event.payload.tool_name)
  if (tc) {
    tc.status = 'error'
  }
  break
}
```

**Problem**: `event.payload.elapsed` and `event.payload.error` are ignored. The `ToolCall` retains `output: null` and `elapsed: null`, so the elapsed badge shows nothing for errors.

**Change**: Set `tc.output = event.payload.error` and `tc.elapsed = event.payload.elapsed ?? null` on the tool call, so the card can display the error message and the elapsed time.

### 2b. Fix `ToolCallCard.vue` — show error output when status is `'error'`

**Current**: Template shows `toolCall.output` section (lines 33–46) only if `toolCall.output` is truthy. The header shows `toolCall.elapsed` for all statuses (lines 10–12). But the error case renders nothing when `output` is null.

**Change**: After 2a populates `output` with the error string, the existing result section will display it automatically. No template change needed in ToolCallCard.vue — the data flow will make it work.

**But**: For better UX, ensure the output section shows even when status is `'error'`. Currently the condition is `v-if="toolCall.output"` (line 33), which will work once 2a sets `output` to the error text. So **no template change needed**.

---

## Task 3: Add `ThinkingDeltaEvent` type (forward-looking)

**File**: `src/types/index.ts`

**Change**: Add a new interface and include it in the `ServerEvent` union:

```typescript
export interface ThinkingDeltaEvent {
  type: 'thinking_delta'
  payload: { delta: string }
}
```

Append to `ServerEvent` union type after `ThinkingEndEvent`.

---

## Verification

Run `npx vue-tsc --noEmit` to ensure TypeScript type-safety.
