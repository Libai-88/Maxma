# Plan: Eliminate `as any` / `as unknown` Type Assertions

## Principle Priority
1. Use proper TypeScript interface/type definitions (preferred)
2. Use type guard functions (`isXxx(data): data is Xxx`)
3. Use `Record<string, unknown>` as fallback
4. Declare global `Window` interface extensions in `.d.ts` files

---

## Location 1: `ChatInput.vue:854` — `refs.value[idx] as any`

**Context:**
```ts
const idx = refs.value.length
refs.value.push({ type: refType, path, label: getFileName(path) } as ParsedRef)
// ...
const entry = refs.value[idx] as any
entry.blocked = true
entry.blockedReason = result.reason
```

**Analysis:** `refs` is `ref<ParsedRef[]>`. `ParsedRef` is a union of `FileRef | FolderRef | CiteRef | WebLinkRef | SkillRef | ToolRef | MacroRef | ImageRef | SelectionRef`. Only `FileRef` and `FolderRef` have `blocked` and `blockedReason` fields. The pushed entry is either a `FileRef` or `FolderRef` depending on `type === 'folder'`.

**Proposed fix:** Use a type-narrowing helper or cast to the correct branch:
```ts
const entry = refs.value[idx] as FileRef | FolderRef
```
Or better, extract a helper that narrows by type. Since we know `idx` points to the freshly pushed item (which is a `FileRef` or `FolderRef`), the direct cast is safe.

**Action:** Replace `as any` with `as FileRef | FolderRef`.

---

## Location 2: `ChatInput.vue:872` — `(window as any).__TAURI_INTERNALS__`

**Context:**
```ts
const invoke = (window as any).__TAURI_INTERNALS__?.invoke ?? (window as any).__TAURI__?.core?.invoke
```

**Proposed fix:** Declare `Window` interface augmentation in `src/env.d.ts`:
```ts
interface Window {
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
    // ... other fields as needed
  }
  __TAURI__?: {
    core?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
    }
  }
}
```

**Action:** Add `Window` interface to `src/env.d.ts`; remove `as any` casts.

---

## Location 3: `ChatWindow.vue:434, 544` — `scrollerRef.value as unknown as { $el?: HTMLElement } | null`

**Context:**
```ts
const scrollerRef = ref<{
  scrollToBottom: () => void
  scrollToItem: (index: number, options?: ...) => void
  scrollToPosition: (position: number, options?: ...) => void
} | null>(null)
// Later:
const scrollerEl = (scrollerRef.value as unknown as { $el?: HTMLElement } | null)?.$el
```

**Proposed fix:** Add `$el?: HTMLElement` to the existing inline type definition of `scrollerRef`. The `DynamicScroller` component instance does have `$el`. Then no cast is needed.

**Action:** Update the `scrollerRef` type to include `$el?: HTMLElement`.

---

## Location 4: `TaskTrackerBubble.vue:42` — `(toolCall.toolData.todos as any[])`

**Context:**
```ts
v-for="(todo, i) in (toolCall.toolData.todos as any[])"
// Template accesses: todo.status, todo.content
```

**Analysis:** `ToolCall.toolData` is typed as `Record<string, unknown>`. `TaskTrackerBar.vue` already defines `TaskTrackerTodo` and `TaskTrackerData` interfaces with exact shapes. We should extract those into a shared type file.

**Proposed fix:** Move `TaskTrackerTodo` and `TaskTrackerData` to a shared types file (e.g., `src/types/task-tracker.ts` or reuse from `TaskTrackerBar.vue`). Then cast `toolCall.toolData.todos` to `TaskTrackerTodo[]`.

**Action:**
1. Extract `TaskTrackerTodo` and `TaskTrackerData` interfaces to a shared file.
2. Replace `as any[]` with `as TaskTrackerTodo[]`.

---

## Location 5: `TaskTrackerBubble.vue:73` — `props.toolCall.toolData?.todos as any[] | undefined`

**Context:**
```ts
const todos = props.toolCall.toolData?.todos as any[] | undefined
```

**Same fix as Location 4.**

**Action:** Replace with `as TaskTrackerTodo[] | undefined`.

---

## Location 6: `WeatherBubble.vue:144` — `props.toolCall.toolData as unknown as WeatherData`

**Context:**
```ts
const td = computed<WeatherData | null>(() => {
  if (props.toolCall.toolData) return props.toolCall.toolData as unknown as WeatherData
```

**Proposed fix:** Write a type guard `isWeatherData(data: unknown): data is WeatherData` that checks required fields (city, temp, condition, humidity, wind).

**Action:** Add type guard function `isWeatherData` in `weather-types.ts` and use it.

---

## Location 7: `WeatherBubble.vue:148` — `p.data as unknown as WeatherData`

**Context:**
```ts
const p = JSON.parse(props.toolCall.output)
if (p?.data) return p.data as unknown as WeatherData
```

**Same fix as Location 6.**

**Action:** Replace with `isWeatherData(p.data) && p.data` pattern, or cast through the type guard.

---

## Location 8: `useChat.ts:341` — `event.payload as unknown as Record<string, unknown>`

**Context:**
```ts
if (event.type === 'context_usage') {
  ch.contextUsage = event.payload
  const p = event.payload as unknown as Record<string, unknown>
  getChatStore().updateContextUsage({
    estimatedTokens: (p.estimated_tokens as number) || 0,
    // ...
  })
}
```

**Analysis:** `event` is `ServerEvent`. When `event.type === 'context_usage'`, the TypeScript narrowing should make `event.payload` be `ContextUsage` (from `ContextUsageEvent`). `ContextUsage` already has all the fields being accessed.

**Proposed fix:** Remove the cast entirely — TypeScript should already know the shape. But the issue is that `event` is typed as the union `ServerEvent`, and the narrowing may not work if `event` is not the discriminated union directly. We need to check. If narrowing works, just remove the cast. If not, use `event.payload as ContextUsage`.

**Action:** Verify narrowing works; if yes, remove `as unknown as Record<string, unknown>`. If not, cast to `ContextUsage`.

---

## Location 9: `env.ts:22` — `(window as any).__TAURI_INTERNALS__`

**Context:**
```ts
function detectTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__
}
```

**Action:** Same `Window` interface fix as Location 2. Remove `as any`.

---

## Location 10: `env.ts:149-150` — `(window as any).__TAURI_INTERNALS__`

**Context:**
```ts
if (detectTauri() && (window as any).__TAURI_INTERNALS__) {
  ;(window as any).__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: url })
}
```

**Action:** Same `Window` interface fix as Location 2. Remove `as any`.

---

## Location 11: `ChatView.vue:77` — `taskTrackerData as any`

**Context:**
```vue
<TaskTrackerBar :data="taskTrackerData as any" />
```

**Analysis:** `taskTrackerData` is typed as `Record<string, unknown> | null`. `TaskTrackerBar` expects `TaskTrackerData | null`.

**Proposed fix:** Cast to `TaskTrackerData` (or unknown then to TaskTrackerData). Since the runtime shape should match, we can do `taskTrackerData as unknown as TaskTrackerData`. But better: define `TaskTrackerData` in a shared location and import it.

**Action:** Import `TaskTrackerData` from the shared types file (created for Location 4), then cast `taskTrackerData as TaskTrackerData | null` via `as unknown as`.

---

## Location 12: `McpView.vue:326` — `await res.json() as unknown`

**Context:**
```ts
const res = await fetch('/api/mcp/discovered')
const data = await res.json() as unknown
discoveredServers.value = Array.isArray(data) ? (data as DiscoveredServer[]) : []
```

**Proposed fix:** Change to `const data: unknown = await res.json()` or cast `res.json() as unknown` is fine, but the `as unknown` by itself is unnecessary since `res.json()` already returns `Promise<unknown>`. Actually `res.json()` returns `Promise<any>` in TypeScript's lib, so `as unknown` does nothing. The real fix: after the array check, use `data as DiscoveredServer[]`.

Actually, `Response.json()` returns `Promise<any>`, not `Promise<unknown>`. So `as unknown` is redundant. The fix: remove `as unknown`, then `data as DiscoveredServer[]` in the true branch.

**Action:** Remove `as unknown`, keep `data as DiscoveredServer[]`.

---

## Location 13: `MetricsView.vue:256` — `(s.http as any)?.total_requests`

**Context:**
```ts
return history.value.snapshots.map(s => (s.http as any)?.total_requests ?? 0)
```

**Analysis:** `MetricsHistoryResponse.snapshots` has `http: Record<string, any>` in its type. This is a problem in the type itself — it uses `any`. We should fix the source type.

**Proposed fix:** Change `MetricsHistoryResponse` in `src/types/metrics.ts` to use concrete types:
- `http: { total_requests: number } & Record<string, unknown>` or simply cast properly.

Actually, looking at the `MetricsHistoryResponse`:
```ts
export interface MetricsHistoryResponse {
  window_seconds: number
  snapshots: Array<{
    timestamp: string
    uptime_seconds: number
    http: Record<string, any>
    tools: Record<string, any>
    llm: Record<string, any>
    errors: Record<string, any>
  }>
}
```

The proper fix is to define these snapshot fields more concretely. But the history API might return varying data. A pragmatic approach: define interfaces for the history snapshot items.

Since `MetricsSnapshot` already has the exact shape, we can create `MetricsHistorySnapshot` with the fields we access:
```ts
interface MetricsHistorySnapshot {
  timestamp: string
  uptime_seconds: number
  http: { total_requests?: number }
  tools: { total_calls?: number }
  llm: { total_tokens_out?: number }
  errors: Record<string, number>
}
```

But wait — `MetricsSnapshot.http` has `total_requests` as required, and also `latency_ms`, `status_codes`, `top_paths`. The history snapshot might have a subset. Let's just use optional fields.

**Action:** Fix `MetricsHistoryResponse` to use structured types instead of `Record<string, any>`.

---

## Location 14: `MetricsView.vue:261` — `(s.tools as any)?.total_calls`

**Same as Location 13** but for `tools`.

**Action:** Handled by the same type fix.

---

## Location 15: `MetricsView.vue:266` — `(s.llm as any)?.total_tokens_out`

**Same as Location 13** but for `llm`.

**Action:** Handled by the same type fix.

---

## Location 16 (bonus): `SkillsView.vue:252` — `(skillsData as any)?.skills`

**Context:**
```ts
skills.value = Array.isArray(skillsData) ? skillsData : (skillsData as any)?.skills || []
```

**Analysis:** `skillsData` comes from `api.listSkills()` which returns `ListSkillsResponse`. But the API response might be either `SkillInfo[]` (new API) or `ListSkillsResponse` (old API). `ListSkillsResponse` has `{ skills: SkillInfo[] }`.

**Proposed fix:** Use a type guard:
```ts
if (Array.isArray(skillsData)) {
  skills.value = skillsData
} else if (isListSkillsResponse(skillsData)) {
  skills.value = skillsData.skills
} else {
  skills.value = []
}
```

Or more simply, since the else branch expects `skillsData` to possibly be a `ListSkillsResponse`, we can cast it:
```ts
skills.value = Array.isArray(skillsData) ? skillsData : (skillsData as ListSkillsResponse).skills || []
```

**Action:** Replace `as any` with `as ListSkillsResponse`.

---

## Summary of Edits

| # | File | Line(s) | Current | Fix |
|---|------|---------|---------|-----|
| 1 | `src/utils/env.ts` | 22, 149, 150 | `(window as any).__TAURI_INTERNALS__` | Add `Window` interface to `env.d.ts` |
| 2 | `src/env.d.ts` | — | (empty Window) | Add `Window` interface with `__TAURI_INTERNALS__` and `__TAURI__` |
| 3 | `src/components/ChatInput.vue` | 854 | `as any` | `as FileRef \| FolderRef` |
| 4 | `src/components/ChatInput.vue` | 872 | `(window as any)` | Use typed `window.__TAURI_INTERNALS__` |
| 5 | `src/components/ChatWindow.vue` | 339 | `scrollerRef` type | Add `$el?: HTMLElement` to type |
| 6 | `src/components/ChatWindow.vue` | 434, 544 | `as unknown as {...}` | Remove cast (type now includes `$el`) |
| 7 | `src/components/tools/TaskTrackerBubble.vue` | 42, 73 | `as any[]` | `as TaskTrackerTodo[]` |
| 8 | `src/types/task-tracker.ts` | (new) | — | Extract `TaskTrackerTodo`, `TaskTrackerData` |
| 9 | `src/components/tools/WeatherBubble.vue` | 144, 148 | `as unknown as WeatherData` | Type guard `isWeatherData()` |
| 10 | `src/components/tools/weather-types.ts` | (append) | — | Add `isWeatherData()` type guard |
| 11 | `src/composables/useChat.ts` | 341 | `as unknown as Record<string, unknown>` | Remove cast (narrowed type is `ContextUsage`) |
| 12 | `src/views/ChatView.vue` | 77 | `as any` | `as unknown as TaskTrackerData` |
| 13 | `src/views/McpView.vue` | 326 | `as unknown` | Remove (redundant) |
| 14 | `src/types/metrics.ts` | 37-47 | `Record<string, any>` | Concrete types for history snapshots |
| 15 | `src/views/MetricsView.vue` | 256, 261, 266 | `(s.http as any)` etc. | Remove casts (after type fix) |
| 16 | `src/views/SkillsView.vue` | 252 | `(skillsData as any)?.skills` | `(skillsData as ListSkillsResponse).skills` |

---

## Verification
After all edits, run:
```bash
npx vue-tsc --noEmit
```
To confirm no type errors are introduced.
