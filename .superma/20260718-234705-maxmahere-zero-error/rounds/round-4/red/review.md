# Round 4 — Red review

## Mode
Fix challenge BC-001: complete the B-006 fix by resolving all 10 TypeScript errors blocking `npm run build`.

## Methodology
1. Read summary.md, project.md, Blue's Round 3 review/handoff/repro, arbiter verification
2. Identified all 10 TypeScript errors across 6 files enumerated in BC-001
3. Applied targeted fixes to each error
4. Ran `npm run build` (the actual pipeline command: `vue-tsc --noEmit && vite build`) to verify

## Fixes Applied — R-010: TypeScript errors blocking `npm run build`

### 1. ChatInput.vue (2 errors) — `@update:model-value` type mismatch
**File**: `web/src/components/ChatInput.vue`
**Changes**:
- `selectProvider(value: string | number)` → `selectProvider(value: string | number | null)` with null guard
- `selectModel(value: string | number)` → `selectModel(value: string | number | null)` with null guard

The DsSelect component emits `update:modelValue` with type `string | number | null`. The handlers were typed too narrowly as `string | number`, causing TS2322 when used as `@update:model-value` listeners.

### 2. ModelSelector.vue (1 error) — `@update:model-value` type mismatch
**File**: `web/src/components/ModelSelector.vue`
**Change**:
- `onSelectModel(value: string | number)` → `onSelectModel(value: string | number | null)` with null guard

Same root cause as ChatInput.vue. DsSelect emits null-able value.

### 3. WeatherBubble.vue (1 error) — `WeatherData | null` not assignable to `Record<string, unknown> | null | undefined`
**File**: `web/src/components/tools/WeatherBubble.vue`
**Change**:
- `hasObjectKeys(td.value)` → `hasObjectKeys(td.value as unknown as Record<string, unknown> | null | undefined)`

The `hasObjectKeys` function expects `Record<string, unknown> | null | undefined` but `td` is `ComputedRef<WeatherData | null>`. The `WeatherData` interface has no index signature, so it's not directly assignable. Used double-assertion via `unknown`.

### 4. DsInput.vue (1 error) — `props` declared but never read
**File**: `web/src/components/ui/DsInput.vue`
**Change**:
- `const props = defineProps<{...}>()` → `defineProps<{...}>()` (removed unused variable)

The `defineProps` return value was never referenced in the script section — template bindings access props via inline syntax, not through the `props` variable. Removed the assignment to eliminate TS6133.

### 5-7. useTheme.ts (3 errors) — False `as Record<string, unknown>` casts of MediaQueryList
**File**: `web/src/composables/useTheme.ts`
**Changes**:
- 3 occurrences of `systemMql as Record<string, unknown>` → `systemMql as unknown as Record<string, unknown>`

TypeScript's strict mode flags the direct cast because `MediaQueryList` does not sufficiently overlap with `Record<string, unknown>`. Using the double-assertion pattern (`as unknown as T`) to bypass the overlap check, which is the standard TypeScript idiom for runtime property attachment on typed objects.

### 8. chat.ts (1 error) — False `as Record<string, unknown>` cast of API response
**File**: `web/src/stores/chat.ts`
**Change**:
- `(data as Record<string, unknown>)` → `(data as unknown as Record<string, unknown>)`

Same double-assertion pattern as useTheme.ts. The `ListProvidersResponse` type doesn't overlap with `Record<string, unknown>` in strict mode.

### 9. ProvidersView.vue (1 error) — `Object.keys()` on possibly-undefined
**File**: `web/src/views/ProvidersView.vue`
**Change**:
- `Object.keys(extraHeaders)` → `Object.keys(extraHeaders ?? {})`

The `extraHeaders` variable is typed as `Record<string, string> | undefined`. When `form.value.extra_headers_raw` is empty, it stays `undefined`. `Object.keys(undefined)` throws at runtime. Using `?? {}` provides safe fallback.

## Build Verification

Before fix: `npm run build` failed with exit code 2 (10 TS errors).
After fix: `npm run build` succeeds — vue-tsc passes, vite build completes in 7.89s.

Build output verified in `web/dist/`:
- `index.html` (1626 bytes)
- `quick-chat.html` (1847 bytes)
- `splash.html` (2922 bytes)

## Summary
- Challenge BC-001 resolved: B-006 fix is now complete
- R-010 filed: 10 TS errors fixed across 6 files
- Production build pipeline (`npm run build` → `vue-tsc --noEmit && vite build`) is fully unblocked
- No regression risk: all fixes are type-only or null-safety changes with no runtime behavior alteration beyond null guards
