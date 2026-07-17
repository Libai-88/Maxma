# CSP Hard Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Design and pilot migration of 3-5 Hard-level `:style=` bindings using CSSOM operations, evaluating CSP `'unsafe-inline'` removal feasibility.

**Architecture:** Phase 1: design CSSOM approach (element.style.setProperty in watchEffect, CSP-exempt vs. inline-style-not-exempt). Phase 2: pilot 4 bindings across 3 files (BarChartMini ×2, ContextUsageBadge ×1, TaskTrackerBar ×1). Phase 3: assess remaining 25 Hard bindings. Phase 4: evaluate CSP removal.

**Tech Stack:** Vue 3, TypeScript, CSS Custom Properties, CSSOM (`HTMLElement.style.setProperty`), Vitest, vue-tsc

---

## Context

- Agents 6 + 11 already migrated 7 `:style=` instances fully + 1 partial (HtmlSandbox). Baseline after their work: **29 Hard `:style=` bindings remain** across 19 files.
- This plan migrates the **4 simplest Hard bindings** (continuous percentages + enumerable height) in 3 files using **CSSOM operations** — the only CSP-safe way to set runtime-computed style values without `'unsafe-inline'`.
- **Constraints (do NOT touch):**
  - Agent 6 already-migrated files: `McpView.vue`, `SoulView.vue`, `SessionSidebar.vue` (lines other than `:123`, `:165`), `MarkdownEditor.vue`, `Icon.vue`, `WeatherBubble.vue`, `DsModal.vue`, `DsOverlay.vue`, `HtmlSandbox.vue`, `OnboardingView.vue`.
  - Agent 11 already-migrated files: same as above (no overlap with this plan's targets).
  - Explicit Hard skip list (data-driven colors / popups): `App.vue`, `AppearanceView.vue`, `ThemePicker.vue`, `TarotBubble.vue`, `NewsView.vue`, `SessionSidebar.vue:123,165`.
  - No Python, no `bun-sidecar/`, no `pyproject.toml` / `requirements-lock.txt`.

### Why CSSOM (not CSS variables on `:style=`)

Two approaches were considered:

| Approach | Mechanism | CSP-safe? |
|----------|-----------|-----------|
| `:style="{ '--var': value }"` + CSS `width: var(--var)` | Vue compiles to inline `style="--var: ..."`, browser reads via CSS var | ❌ No — inline `style=` attribute is still subject to `style-src 'unsafe-inline'` |
| `element.style.setProperty('width', value)` in JS | Direct CSSOM mutation, no inline attribute | ✅ Yes — W3C CSP spec explicitly exempts CSSOM mutations from `style-src` checks |

**Conclusion:** Only CSSOM operations (or pre-rendered static classes) can remove `'unsafe-inline'`. This pilot uses CSSOM.

### CSSOM pattern (used by all pilot tasks)

```ts
import { ref, watchEffect } from 'vue'

const fillRef = ref<HTMLElement>()
const percent = computed(() => /* ... */)

// flush: 'post' runs after DOM updates, guaranteeing refs are bound
watchEffect(() => {
  const el = fillRef.value
  const p = percent.value            // track percent
  if (el) el.style.setProperty('width', `${p}%`)
}, { flush: 'post' })
```

Template change: replace `:style="{ width: percent + '%' }"` with `ref="fillRef"`.

For `v-for` lists (BarChartMini), use a function ref to collect elements into an array, then iterate in the same `watchEffect`:

```ts
const fillEls: HTMLElement[] = []
const setFillRef = (el: Element | ComponentPublicInstance | null, idx: number) => {
  if (el) fillEls[idx] = el as HTMLElement
}
```

```vue
<div v-for="(item, idx) in items" :key="..." :ref="(el) => setFillRef(el, idx)" ...>
```

## Baseline (verified green before any change)

- [x] `cd d:\Maxma\MaxmaHere\web && npx vitest run` → 17 files / 47 tests passed
- [x] `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit` → exit 0

## Pilot targets (4 bindings, 3 files)

| File:line | Binding | Category | Strategy |
|-----------|---------|----------|----------|
| `components/BarChartMini.vue:2` | `:style="{ height: \`${height}px\` }"` | Enumerable height (5 values: 80/100/140/160/180) | CSSOM on root ref |
| `components/BarChartMini.vue:16` | `:style="{ width: \`${item.percent}%\` }"` | Continuous percentage (v-for) | CSSOM on function-ref array |
| `components/ContextUsageBadge.vue:6` | `:style="{ width: barPercent + '%' }"` | Continuous percentage | CSSOM on single ref |
| `components/TaskTrackerBar.vue:19` | `:style="{ width: progressPercent + '%' }"` | Continuous percentage (conditional render) | CSSOM on single ref |

---

## Task 1: BarChartMini.vue — migrate 2 `:style=` bindings (root height + v-for width)

**Files:**
- Modify: `web/src/components/BarChartMini.vue` (template lines 2, 13-17; script; no style change)

- [ ] **Step 1: Replace template `:style` with refs**

Current template (lines 1-22):
```vue
<template>
  <div class="bar-chart" :style="{ height: `${height}px` }">
    <div v-if="items.length === 0" class="bar-empty">无数据</div>
    <template v-else>
      <div
        v-for="(item, idx) in normalizedItems"
        :key="`${item.label}-${idx}`"
        class="bar-row"
        :title="`${item.label}: ${item.value}`"
      >
        <div class="bar-label" :title="item.label">{{ item.label }}</div>
        <div class="bar-track">
          <div
            class="bar-fill"
            :class="{ 'bar-fill-error': item.kind === 'error' }"
            :style="{ width: `${item.percent}%` }"
          ></div>
        </div>
        <div class="bar-value">{{ item.display }}</div>
      </div>
    </template>
  </div>
</template>
```

New template (root gets `ref="rootRef"`; bar-fill gets function ref `:ref="(el) => setFillRef(el, idx)"`; both `:style=` removed):
```vue
<template>
  <div ref="rootRef" class="bar-chart">
    <div v-if="items.length === 0" class="bar-empty">无数据</div>
    <template v-else>
      <div
        v-for="(item, idx) in normalizedItems"
        :key="`${item.label}-${idx}`"
        class="bar-row"
        :title="`${item.label}: ${item.value}`"
      >
        <div class="bar-label" :title="item.label">{{ item.label }}</div>
        <div class="bar-track">
          <div
            class="bar-fill"
            :class="{ 'bar-fill-error': item.kind === 'error' }"
            :ref="(el) => setFillRef(el, idx)"
          ></div>
        </div>
        <div class="bar-value">{{ item.display }}</div>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Add CSSOM logic to script**

Current script (lines 25-50):
```ts
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  items: Array<{ label: string; value: number; display?: string; kind?: 'default' | 'error' }>
  height?: number
  /** 最大值（用于多图对齐），不传则自适应 */
  maxValue?: number
}>(), {
  height: 140,
})

const maxVal = computed(() => {
  if (props.items.length === 0) return 1
  if (props.maxValue !== undefined && props.maxValue > 0) return props.maxValue
  return Math.max(...props.items.map(i => i.value), 1)
})

const normalizedItems = computed(() =>
  props.items.map(item => ({
    ...item,
    display: item.display ?? String(item.value),
    percent: maxVal.value > 0 ? Math.max(2, (item.value / maxVal.value) * 100) : 0,
  })),
)
</script>
```

New script (add `ref`, `watchEffect` imports; add `rootRef`, `fillEls`, `setFillRef`, `watchEffect` with `flush: 'post'`):
```ts
<script setup lang="ts">
import { computed, ref, watchEffect, type ComponentPublicInstance } from 'vue'

const props = withDefaults(defineProps<{
  items: Array<{ label: string; value: number; display?: string; kind?: 'default' | 'error' }>
  height?: number
  /** 最大值（用于多图对齐），不传则自适应 */
  maxValue?: number
}>(), {
  height: 140,
})

const maxVal = computed(() => {
  if (props.items.length === 0) return 1
  if (props.maxValue !== undefined && props.maxValue > 0) return props.maxValue
  return Math.max(...props.items.map(i => i.value), 1)
})

const normalizedItems = computed(() =>
  props.items.map(item => ({
    ...item,
    display: item.display ?? String(item.value),
    percent: maxVal.value > 0 ? Math.max(2, (item.value / maxVal.value) * 100) : 0,
  })),
)

// CSP-safe CSSOM: set height + per-bar width via element.style.setProperty
// (inline style attribute would be blocked by CSP 'unsafe-inline' removal)
const rootRef = ref<HTMLElement>()
const fillEls: HTMLElement[] = []
const setFillRef = (el: Element | ComponentPublicInstance | null, idx: number) => {
  if (el) fillEls[idx] = el as HTMLElement
}

watchEffect(() => {
  const root = rootRef.value
  if (root) root.style.setProperty('height', `${props.height}px`)
  normalizedItems.value.forEach((item, idx) => {
    const el = fillEls[idx]
    if (el) el.style.setProperty('width', `${item.percent}%`)
  })
}, { flush: 'post' })
</script>
```

- [ ] **Step 3: Verify**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run && npx vue-tsc --noEmit`
Expected: 47 tests pass, vue-tsc exit 0.

## Task 2: ContextUsageBadge.vue — migrate 1 `:style=` binding (width)

**Files:**
- Modify: `web/src/components/ContextUsageBadge.vue` (template line 6; script; no style change)

- [ ] **Step 1: Replace template `:style` with ref**

Current template line 6:
```vue
      <div class="usage-bar-fill" :style="{ width: barPercent + '%' }"></div>
```

New template line 6:
```vue
      <div ref="fillRef" class="usage-bar-fill"></div>
```

- [ ] **Step 2: Add CSSOM logic to script**

Current script (lines 18-39):
```ts
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useChatStore } from '../stores/chat'

const store = useChatStore()
const showDetail = ref(false)

const usage = computed(() => store.contextUsage)
const barPercent = computed(() => Math.min(usage.value.percentage, 100))
const displayText = computed(() => `${formatNum(usage.value.estimatedTokens)} / ${formatNum(usage.value.maxTokens)}`)
const statusClass = computed(() => {
  if (usage.value.percentage > 90) return 'status-critical'
  if (usage.value.percentage > 70) return 'status-warn'
  return ''
})

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
</script>
```

New script (add `watchEffect` import; add `fillRef` + `watchEffect` with `flush: 'post'`):
```ts
<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { useChatStore } from '../stores/chat'

const store = useChatStore()
const showDetail = ref(false)

const usage = computed(() => store.contextUsage)
const barPercent = computed(() => Math.min(usage.value.percentage, 100))
const displayText = computed(() => `${formatNum(usage.value.estimatedTokens)} / ${formatNum(usage.value.maxTokens)}`)
const statusClass = computed(() => {
  if (usage.value.percentage > 90) return 'status-critical'
  if (usage.value.percentage > 70) return 'status-warn'
  return ''
})

// CSP-safe CSSOM: set width via element.style.setProperty
const fillRef = ref<HTMLElement>()
watchEffect(() => {
  const el = fillRef.value
  const p = barPercent.value
  if (el) el.style.setProperty('width', `${p}%`)
}, { flush: 'post' })

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
</script>
```

- [ ] **Step 3: Verify**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run && npx vue-tsc --noEmit`
Expected: 47 tests pass, vue-tsc exit 0.

- [ ] **Step 4: Commit batch 1**

```bash
git -C d:\Maxma\MaxmaHere add web/src/components/BarChartMini.vue web/src/components/ContextUsageBadge.vue
git -C d:\Maxma\MaxmaHere commit -m "refactor(web): migrate BarChartMini + ContextUsageBadge :style to CSSOM"
```

## Task 3: TaskTrackerBar.vue — migrate 1 `:style=` binding (width, conditional render)

**Files:**
- Modify: `web/src/components/TaskTrackerBar.vue` (template line 19; script; no style change)

**Note:** The `.bar-progress-fill` element is inside a `v-else` (`<template v-else>`) that only renders when `data` is truthy. The `flush: 'post'` `watchEffect` handles this naturally: when `data` becomes null, the element unmounts and `fillRef.value` becomes null (the effect re-runs, sees `null`, does nothing). When `data` becomes truthy, the element mounts, `fillRef.value` is set, the effect re-runs and applies the width.

- [ ] **Step 1: Replace template `:style` with ref**

Current template line 19:
```vue
        <span class="bar-progress-fill" :style="{ width: progressPercent + '%' }"></span>
```

New template line 19:
```vue
        <span ref="fillRef" class="bar-progress-fill"></span>
```

- [ ] **Step 2: Add CSSOM logic to script**

Current script (lines 25-51):
```ts
<script setup lang="ts">
import { computed } from 'vue'

interface TaskTrackerTodo {
  content: string
  status: string
  activeForm: string | null
}

interface TaskTrackerData {
  total: number
  completed: number
  in_progress?: number
  todos: TaskTrackerTodo[]
}

const props = defineProps<{ data: TaskTrackerData | null }>()

const currentStep = computed(() => {
  if (!props.data) return 0
  return props.data.completed + ((props.data.in_progress ?? 0) > 0 ? 1 : 0)
})

const progressPercent = computed(() => {
  if (!props.data || props.data.total <= 0) return 0
  return Math.round((props.data.completed / props.data.total) * 100)
})
```

New script (add `ref`, `watchEffect` imports; add `fillRef` + `watchEffect` with `flush: 'post'`):
```ts
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'

interface TaskTrackerTodo {
  content: string
  status: string
  activeForm: string | null
}

interface TaskTrackerData {
  total: number
  completed: number
  in_progress?: number
  todos: TaskTrackerTodo[]
}

const props = defineProps<{ data: TaskTrackerData | null }>()

const currentStep = computed(() => {
  if (!props.data) return 0
  return props.data.completed + ((props.data.in_progress ?? 0) > 0 ? 1 : 0)
})

const progressPercent = computed(() => {
  if (!props.data || props.data.total <= 0) return 0
  return Math.round((props.data.completed / props.data.total) * 100)
})

// CSP-safe CSSOM: set width via element.style.setProperty
const fillRef = ref<HTMLElement>()
watchEffect(() => {
  const el = fillRef.value
  const p = progressPercent.value
  if (el) el.style.setProperty('width', `${p}%`)
}, { flush: 'post' })
```

(Rest of script — `activeForm`, `statusLabel` computeds — unchanged.)

- [ ] **Step 3: Verify**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run && npx vue-tsc --noEmit`
Expected: 47 tests pass, vue-tsc exit 0.

- [ ] **Step 4: Commit batch 2**

```bash
git -C d:\Maxma\MaxmaHere add web/src/components/TaskTrackerBar.vue
git -C d:\Maxma\MaxmaHere commit -m "refactor(web): migrate TaskTrackerBar :style to CSSOM"
```

---

## Task 4: Assess remaining 25 Hard `:style=` bindings

**Files:**
- Modify: this plan file (the table below is the deliverable).

After Tasks 1-3, **25 Hard `:style=` bindings remain** (29 − 4 migrated). Classification and recommended approach:

| File:line | Category | Recommended approach | Feasibility |
|-----------|----------|----------------------|-------------|
| `components/tools/AskUserBubble.vue:110` | Continuous % (countdown) | CSSOM (same as pilot pattern) | ✅ Easy — single ref, conditional `v-if="showCountdown"` handled like TaskTrackerBar |
| `components/tools/TaskTrackerBubble.vue:19` | Continuous % | CSSOM (same as pilot pattern) | ✅ Easy — single ref inside `v-else-if` |
| `components/AutocompletePanel.vue:4` | Dynamic position (left/bottom) | CSSOM | ✅ Medium — single root ref, watchEffect on `panelStyle` computed |
| `components/ChatInput.vue:20` | Dynamic height | CSSOM | ✅ Medium — single ref |
| `components/ChatInput.vue:209` | Dynamic position (quote float) | CSSOM | ✅ Medium — single ref |
| `components/ContextMenu.vue:13` | Dynamic position (left/top) | CSSOM | ✅ Medium — single ref |
| `components/StickerContextMenu.vue:5` | Dynamic position (left/top) | CSSOM | ✅ Medium — single ref |
| `components/StickerPicker.vue:5` | Dynamic transform | CSSOM (`setProperty('transform', ...)`) | ✅ Medium — single ref |
| `components/MediaViewer.vue:23` | Dynamic transform + transition | CSSOM (set both `transform` and `transition`) | ✅ Medium — single ref |
| `components/ui/DsTooltip.vue:10` | Dynamic position | CSSOM | ✅ Medium — single ref |
| `App.vue:42` | Dynamic position (popup) | CSSOM | ⚠️ Skip per task constraints (explicit skip list) — but technically CSSOM-able |
| `components/SessionSidebar.vue:123` | Dynamic position (cardStyle) | CSSOM | ⚠️ Skip per Agent 6 constraint |
| `components/SessionSidebar.vue:165` | Dynamic position (constifyCardStyle) | CSSOM | ⚠️ Skip per Agent 6 constraint |
| `views/AppearanceView.vue:20,21,22` | Data-driven colors (theme preview) | CSSOM (`setProperty('background', ...)` etc.) | ⚠️ Skip per task constraints — but technically CSSOM-able |
| `components/ThemePicker.vue:15,16,17` | Data-driven colors (theme preview) | CSSOM | ⚠️ Skip per task constraints |
| `views/NewsView.vue:20` | Timeline bounds (continuous) | CSSOM | ⚠️ Skip per task constraints |
| `views/NewsView.vue:26` | Dynamic position (top: node.top+'px') | CSSOM | ⚠️ Skip per task constraints |
| `components/tools/TarotBubble.vue:30,37,59` | Data-driven colors (suitColor) | CSSOM (`setProperty('color'/'background', ...)`) | ⚠️ Skip per task constraints |
| `components/HtmlSandbox.vue:16` | Continuous height (postMessage) | CSSOM | ✅ Easy — single ref (already partially migrated by Agent 11; one `:style=` remains) |

### Summary by feasibility

- **✅ Easy/Medium CSSOM-able (12 bindings):** AskUserBubble, TaskTrackerBubble, AutocompletePanel, ChatInput ×2, ContextMenu, StickerContextMenu, StickerPicker, MediaViewer, DsTooltip, HtmlSandbox. All follow the exact same pattern proven in this pilot.
- **⚠️ Explicit skip (13 bindings):** App.vue, SessionSidebar ×2, AppearanceView ×3, ThemePicker ×3, NewsView ×2, TarotBubble ×3. Technically CSSOM-able, but out of scope per task constraints.
- **❌ Not CSP-removable without CSSOM (0 bindings):** All remaining bindings CAN be migrated to CSSOM if the skip constraints are lifted.

---

## Task 5: Evaluate CSP `'unsafe-inline'` removal

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json` (only if all `:style=` are migrated — see conclusion).

### Current CSP (tauri.conf.json line 41)

```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
```

### Removal feasibility

| Scenario | Can remove `'unsafe-inline'`? |
|----------|------------------------------|
| All 29 Hard `:style=` migrated to CSSOM (including skip list) | ✅ Yes |
| Only pilot 4 migrated (this plan) | ❌ No — 25 `:style=` remain |
| All non-skip `:style=` migrated (12 more, total 16) | ❌ No — 13 skip-list `:style=` remain |
| All 29 migrated + audit for any `<style>` inline attrs | ✅ Yes (final state) |

### Conclusion

**After this pilot (4 bindings migrated):** `'unsafe-inline'` CANNOT be removed — 25 `:style=` bindings still produce inline `style="..."` attributes that CSP would block.

**Path to removal:**
1. Migrate the 12 non-skip CSSOM-able bindings (Task 4 table, ✅ rows) — mechanical repetition of this pilot's pattern.
2. Re-evaluate the skip list with stakeholders: many skip items (AppearanceView, ThemePicker, NewsView, TarotBubble) are data-driven colors that CSSOM handles cleanly. App.vue popup, SessionSidebar cards, AutocompletePanel, ContextMenu, etc. are dynamic positioning that CSSOM also handles.
3. After all 29 are migrated, run the app under CSP without `'unsafe-inline'` and verify no console violations.
4. **Keep `'unsafe-inline'` for now.** Do NOT edit `tauri.conf.json` in this pilot.

### Why CSSOM is CSP-safe (reference)

W3C CSP spec (§8.3, "Should inline style be blocked?"): style mutations via `CSSStyleDeclaration` (i.e., `element.style.setProperty(...)`, `element.style.foo = ...`) are **NOT** subject to `style-src` checks. Only inline `style="..."` attributes and `<style>` element text content are checked. This is why the CSSOM pattern in this pilot is CSP-safe while `:style=` is not.

---

## Self-Review

- **Spec coverage:** Step 1 (CSS variable design) covered in "Why CSSOM" section. Step 2 (true CSP solution) covered — CSSOM chosen. Step 3 (pilot 3-5) = Tasks 1-3 (4 bindings, 3 files). Step 4 (assess remaining) = Task 4 table. Step 5 (CSP removal eval) = Task 5.
- **Placeholder scan:** None — every step shows exact code/commands.
- **Type consistency:** `fillRef = ref<HTMLElement>()` matches `<div ref="fillRef">`. `setFillRef(el: Element | ComponentPublicInstance | null, idx: number)` matches Vue 3 function-ref signature. `rootRef = ref<HTMLElement>()` matches `<div ref="rootRef">`. All `watchEffect` callbacks use `flush: 'post'`.
- **Pattern consistency:** All 3 pilot tasks use the identical CSSOM pattern (`ref` + `watchEffect` with `flush: 'post'` + `el.style.setProperty`), making it a clean template for the remaining 12 CSSOM-able bindings.

## Execution notes

- Regression-TDD: baseline green (verified above) → migrate each task → re-run vitest + vue-tsc → still green.
- No new test files created — the pilot files have no existing spec tests, and CSSOM behavior is verified by vue-tsc (types) + existing 47-test suite (no regressions in consumers: `ChatView.vue`, `ChatInput.vue`, `AuditLogView.vue`, `MetricsView.vue`).
- Commits: 2 batches (Task 1+2 together; Task 3 alone) — matches "frequent commits, every 2-3 migrations" constraint.
