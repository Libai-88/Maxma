# CSP CSSOM Mechanical Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 25 remaining `:style=` bindings to CSP-safe CSSOM operations (`element.style.setProperty`), enabling removal of `'unsafe-inline'` from the Tauri CSP `style-src` directive.

**Architecture:** Apply Agent 28's verified CSSOM template uniformly across 3 categories (single-element dynamic positioning, v-for data-driven styles, imperative-positioned floating cards). Each migration replaces the `:style` template binding with a `ref` + `watchEffect(flush: 'post')` + `style.setProperty` pattern. The `flush: 'post'` timing naturally handles `v-if`/`v-else` conditional rendering without extra guards.

**Tech Stack:** Vue 3, TypeScript, CSSOM (`HTMLElement.style.setProperty`), Vitest, vue-tsc.

---

## Background & Verified Template

Agent 28 pilot-migrated 4 bindings in `BarChartMini.vue`, `ContextUsageBadge.vue`, `TaskTrackerBar.vue` and confirmed the W3C CSP spec exempts CSSOM mutations from `style-src 'unsafe-inline'` (only inline `style=` attributes and `<style>` elements are blocked).

### Template A — Single element (computed/ref-driven value)

```vue
<!-- BEFORE -->
<div :style="{ width: pct + '%' }"></div>

<!-- AFTER -->
<div ref="fillRef" class="..."></div>

<script setup lang="ts">
import { ref, watchEffect } from 'vue'
const fillRef = ref<HTMLElement>()
watchEffect(() => {
  const el = fillRef.value
  if (el) el.style.setProperty('width', `${pct.value}%`)
}, { flush: 'post' })
</script>
```

### Template B — v-for (function-ref array)

```vue
<!-- BEFORE -->
<div v-for="(item, idx) in items" :style="{ width: item.pct + '%' }"></div>

<!-- AFTER -->
<div v-for="(item, idx) in items" :ref="(el) => setRef(el, idx)"></div>

<script setup lang="ts">
import { watchEffect } from 'vue'
import type { ComponentPublicInstance } from 'vue'
const els: HTMLElement[] = []
const setRef = (el: Element | ComponentPublicInstance | null, idx: number) => {
  if (el) els[idx] = el as HTMLElement
}
watchEffect(() => {
  items.value.forEach((item, idx) => {
    const el = els[idx]
    if (el) el.style.setProperty('width', `${item.pct}%`)
  })
}, { flush: 'post' })
</script>
```

### Key constraints
- `flush: 'post'` is mandatory so refs are populated after DOM patch (handles `v-if`).
- `element.style.setProperty(prop, value)` is CSP-safe; `el.style.prop = value` is also CSP-safe but `setProperty` is the canonical form used by Agent 28.
- For imperative-positioned elements (popup/tooltip set inside event handlers), keep the existing `nextTick(updatePosition)` flow but have it call `style.setProperty` instead of writing to a reactive `style` object.

---

## File Inventory (25 occurrences across 16 files)

### Step 1 — Easy/Medium CSSOM (13 occurrences)
| File | Line | Binding | Category |
|------|------|---------|---------|
| `components/tools/AskUserBubble.vue` | 110 | `{ width: countdownPercent + '%' }` | progress fill (v-if) |
| `components/tools/TaskTrackerBubble.vue` | 19 | `{ width: progressPercent + '%' }` | progress fill (v-else-if) |
| `components/AutocompletePanel.vue` | 4 | `panelStyle` (left/bottom) | floating panel (v-if) |
| `components/ChatInput.vue` | 20 | `containerStyle` (height/minHeight) | dynamic height |
| `components/ChatInput.vue` | 209 | `quoteFloatStyle` (left/top/transformOrigin) | floating btn (v-if+Transition) |
| `components/ContextMenu.vue` | 13 | `{ left, top }` | floating menu (v-if+Transition) |
| `components/StickerContextMenu.vue` | 5 | `{ left, top }` | floating menu (v-if) |
| `components/StickerPicker.vue` | 5 | `pickerStyle` (transform/maxWidth) | position adjust (imperative) |
| `components/MediaViewer.vue` | 23 | `{ transform, transition }` | image transform (v-if) |
| `components/ui/DsTooltip.vue` | 10 | `tooltipStyle` (top/left) | tooltip (v-if+Transition, imperative) |
| `components/HtmlSandbox.vue` | 16 | `{ height: iframeHeight + 'px' }` | iframe height |
| `components/SessionSidebar.vue` | 123 | `cardStyle` (top/left/position/zIndex/pointerEvents) | hover card (v-if+Transition) |
| `components/SessionSidebar.vue` | 165 | `constifyCardStyle` (top/left/position/zIndex) | constify card (v-if+Transition) |

### Step 2 — Data-driven colors (6 occurrences)
| File | Line | Binding |
|------|------|---------|
| `views/AppearanceView.vue` | 20 | `{ background: t.preview.bg }` (v-for) |
| `views/AppearanceView.vue` | 21 | `{ background: t.preview.accent }` (v-for) |
| `views/AppearanceView.vue` | 22 | `{ color: t.preview.text }` (v-for) |
| `components/ThemePicker.vue` | 15 | `{ background: t.preview.bg }` (v-for) |
| `components/ThemePicker.vue` | 16 | `{ background: t.preview.accent }` (v-for) |
| `components/ThemePicker.vue` | 17 | `{ color: t.preview.text }` (v-for) |

### Step 3 — Dynamic positioning & data-driven colors (6 occurrences)
| File | Line | Binding |
|------|------|---------|
| `App.vue` | 42 | `{ top, left, maxHeight }` settings popup (v-if+Transition, imperative) |
| `views/NewsView.vue` | 20 | `tlBounds` (top/height) timeline (v-if, imperative) |
| `views/NewsView.vue` | 26 | `{ top: node.top + 'px' }` (v-for) |
| `components/tools/TarotBubble.vue` | 30 | `{ borderColor: suitColor(card.suit) }` (v-for) |
| `components/tools/TarotBubble.vue` | 37 | `{ background, color }` (v-for) |
| `components/tools/TarotBubble.vue` | 59 | `{ borderLeftColor: suitColor(card.suit) }` (v-for) |

### Step 4 — CSP removal
- File: `desktop/src-tauri/tauri.conf.json`
- Target: `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;` → `style-src 'self' https://fonts.googleapis.com;`

---

## Green Baseline (recorded before migration)
- `cd web && npx vitest run` → 17 files / 47 tests PASS
- `cd web && npx vue-tsc --noEmit` → exit 0 (no errors)

---

## TDD Note

CSS migrations cannot follow red-green TDD (no behavior change, only rendering mechanism). We use **regression TDD**: record green baseline → migrate → re-run same suites → assert still green. If a test breaks, the migration is wrong.

---

## Task 1: AskUserBubble countdown fill (single element, v-if)

**Files:**
- Modify: `web/src/components/tools/AskUserBubble.vue` (template line 107-111, script line 148-150)

- [ ] **Step 1: Add ref + watchEffect, remove `:style`**

Template change (line 107-111):
```vue
<!-- BEFORE -->
<div
  class="countdown-fill"
  :class="{ urgent: countdownPercent < 20 }"
  :style="{ width: countdownPercent + '%' }"
></div>

<!-- AFTER -->
<div
  ref="countdownFillRef"
  class="countdown-fill"
  :class="{ urgent: countdownPercent < 20 }"
></div>
```

Script change — add to imports (line 150):
```ts
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
```
Add after `countdownSeconds` computed (after line 179):
```ts
// CSP-safe CSSOM: set countdown fill width via style.setProperty
const countdownFillRef = ref<HTMLElement>()
watchEffect(() => {
  const el = countdownFillRef.value
  if (el) el.style.setProperty('width', `${countdownPercent.value}%`)
}, { flush: 'post' })
```

- [ ] **Step 2: Verify** — `cd web && npx vitest run` (expect 47 pass) + `npx vue-tsc --noEmit` (expect exit 0)

---

## Task 2: TaskTrackerBubble progress fill (single element, v-else-if)

**Files:**
- Modify: `web/src/components/tools/TaskTrackerBubble.vue` (template line 19, script line 65)

- [ ] **Step 1: Add ref + watchEffect, remove `:style`**

Template (line 18-20):
```vue
<!-- BEFORE -->
<div class="progress-track">
  <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
</div>

<!-- AFTER -->
<div class="progress-track">
  <div ref="progressFillRef" class="progress-fill"></div>
</div>
```

Script — update import (line 65):
```ts
import { computed, ref, watchEffect } from 'vue'
```
Add after `progressPercent` computed (after line 86):
```ts
// CSP-safe CSSOM: set progress fill width via style.setProperty
const progressFillRef = ref<HTMLElement>()
watchEffect(() => {
  const el = progressFillRef.value
  if (el) el.style.setProperty('width', `${progressPercent.value}%`)
}, { flush: 'post' })
```

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 3: AutocompletePanel floating panel (single element, v-if, computed style)

**Files:**
- Modify: `web/src/components/AutocompletePanel.vue` (template line 4, script line 77-80)

- [ ] **Step 1: Replace `panelStyle` computed with watchEffect CSSOM**

Template (line 4):
```vue
<!-- BEFORE -->
<div v-if="visible" ref="panelRef" class="ac-panel" :style="panelStyle">

<!-- AFTER -->
<div v-if="visible" ref="panelRef" class="ac-panel">
```

Script — replace `panelStyle` computed (lines 77-80) with:
```ts
// CSP-safe CSSOM: position panel via style.setProperty (was :style binding)
watchEffect(() => {
  const el = panelRef.value
  if (!el || !props.visible) return
  el.style.setProperty('left', `${props.position.x}px`)
  el.style.setProperty('bottom', `${window.innerHeight - props.position.y + 28}px`)
}, { flush: 'post' })
```
Add `watchEffect` to imports (line 24): `import { computed, nextTick, ref, watch, watchEffect } from 'vue'`
Delete the `panelStyle` computed (lines 77-80).

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 4: ChatInput container height + quote float button (2 bindings)

**Files:**
- Modify: `web/src/components/ChatInput.vue` (template lines 20, 209; script lines 282-296, 1019-1023)

- [ ] **Step 1: Migrate `containerStyle` (line 20)**

Template (line 20):
```vue
<!-- BEFORE -->
:class="{ 'is-resizing': isResizing, 'is-dragover': isDragover }"
:style="containerStyle"

<!-- AFTER -->
:class="{ 'is-resizing': isResizing, 'is-dragover': isDragover }"
```

Script — replace `containerStyle` computed (lines 1019-1023) with watchEffect:
```ts
// CSP-safe CSSOM: set container height/minHeight via style.setProperty
watchEffect(() => {
  const el = inputContainerRef.value
  if (!el) return
  el.style.setProperty('min-height', `${initialHeight.value}px`)
  if (customHeight.value !== null) {
    el.style.setProperty('height', `${customHeight.value}px`)
  } else {
    el.style.removeProperty('height')
  }
}, { flush: 'post' })
```
Add `watchEffect` to imports (line 236): `import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'`

- [ ] **Step 2: Migrate `quoteFloatStyle` (line 209)**

Template (lines 206-214):
```vue
<!-- BEFORE -->
<button
  v-if="quoteCandidate"
  class="quote-float-btn"
  :style="quoteFloatStyle"
  @click="$emit('commitQuote')"
  title="引用选中文本"
>

<!-- AFTER -->
<button
  v-if="quoteCandidate"
  ref="quoteFloatRef"
  class="quote-float-btn"
  @click="$emit('commitQuote')"
  title="引用选文本"
>
```

Script — add ref + watchEffect, replace `quoteFloatStyle` computed (lines 282-296):
```ts
const quoteFloatRef = ref<HTMLElement | null>(null)
watchEffect(() => {
  const el = quoteFloatRef.value
  if (!el || !props.quoteCandidate) return
  const result = computeFloatingInputPosition(
    props.quoteCandidate.rect,
    { width: 100, height: 32 },
    window.innerWidth,
    window.innerHeight,
    'top',
  )
  el.style.setProperty('left', `${result.left}px`)
  el.style.setProperty('top', `${result.top}px`)
  el.style.setProperty('transform-origin', result.origin)
}, { flush: 'post' })
```
Delete the old `quoteFloatStyle` computed.

- [ ] **Step 3: Verify** — vitest + vue-tsc

---

## Task 5: ContextMenu floating menu (single element, v-if+Transition)

**Files:**
- Modify: `web/src/components/ContextMenu.vue` (template line 13, script line 33-34)

- [ ] **Step 1: Add ref + watchEffect**

Template (lines 10-16):
```vue
<!-- BEFORE -->
<div
  v-if="visible"
  class="context-menu"
  :style="{ left: position.x + 'px', top: position.y + 'px' }"
  @click.stop
  @contextmenu.stop
>

<!-- AFTER -->
<div
  v-if="visible"
  ref="menuRef"
  class="context-menu"
  @click.stop
  @contextmenu.stop
>
```

Script — add ref + watchEffect (after line 34 imports, add):
```ts
import { onMounted, onUnmounted, ref, watchEffect } from 'vue'
```
Add after props/emit:
```ts
const menuRef = ref<HTMLElement | null>(null)
watchEffect(() => {
  const el = menuRef.value
  if (!el || !props.visible) return
  el.style.setProperty('left', `${props.position.x}px`)
  el.style.setProperty('top', `${props.position.y}px`)
}, { flush: 'post' })
```

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 6: StickerContextMenu floating menu (single element, v-if)

**Files:**
- Modify: `web/src/components/StickerContextMenu.vue` (template line 5, script line 24)

- [ ] **Step 1: Add ref + watchEffect**

Template (lines 2-7):
```vue
<!-- BEFORE -->
<div
  v-if="visible"
  class="sticker-context-menu"
  :style="{ left: position.x + 'px', top: position.y + 'px' }"
  @click.stop
>

<!-- AFTER -->
<div
  v-if="visible"
  ref="menuRef"
  class="sticker-context-menu"
  @click.stop
>
```

Script — update imports (line 24):
```ts
import { ref, watch, watchEffect } from 'vue'
```
Add after props/emit:
```ts
const menuRef = ref<HTMLElement | null>(null)
watchEffect(() => {
  const el = menuRef.value
  if (!el || !props.visible) return
  el.style.setProperty('left', `${props.position.x}px`)
  el.style.setProperty('top', `${props.position.y}px`)
}, { flush: 'post' })
```

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 7: StickerPicker transform/maxWidth (imperative position adjust)

**Files:**
- Modify: `web/src/components/StickerPicker.vue` (template line 5, script lines 150, 417-433)

- [ ] **Step 1: Remove `:style`, drive via CSSOM in `updatePickerPosition`**

Template (lines 2-8):
```vue
<!-- BEFORE -->
<div
  class="sticker-picker"
  :class="{ visible }"
  :style="pickerStyle"
  ref="pickerRootRef"
  @click.stop
>

<!-- AFTER -->
<div
  class="sticker-picker"
  :class="{ visible }"
  ref="pickerRootRef"
  @click.stop
>
```

Script:
- Delete `pickerStyle` ref declaration (line 150).
- Update `updatePickerPosition` (lines 417-433) to write directly to `pickerRootRef.value.style`:
```ts
function updatePickerPosition() {
  nextTick(() => {
    const root = pickerRootRef.value
    if (!root || !props.visible) return
    const rect = root.getBoundingClientRect()
    let shift = 0
    if (rect.left < 12) {
      shift = 12 - rect.left
    } else if (rect.right > window.innerWidth - 12) {
      shift = window.innerWidth - 12 - rect.right
    }
    // CSP-safe CSSOM: was reactive :style pickerStyle
    root.style.setProperty('transform', shift ? `translateX(${shift}px)` : '')
    root.style.setProperty('max-width', 'calc(100vw - 24px)')
  })
}
```

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 8: MediaViewer image transform + transition (single element, v-if)

**Files:**
- Modify: `web/src/components/MediaViewer.vue` (template line 23, script line 45)

- [ ] **Step 1: Add ref + watchEffect for transform & transition**

Template (lines 18-26):
```vue
<!-- BEFORE -->
<img
  v-if="currentItem"
  :src="currentItem.src"
  :alt="currentItem.alt || ''"
  class="mv-image"
  :style="{ transform: transformStyle, transition: isDragging ? 'none' : 'transform 0.1s ease-out' }"
  draggable="false"
  @click.stop
/>

<!-- AFTER -->
<img
  v-if="currentItem"
  ref="imageRef"
  :src="currentItem.src"
  :alt="currentItem.alt || ''"
  class="mv-image"
  draggable="false"
  @click.stop
/>
```

Script — add ref + watchEffect (after line 52 `rootRef`):
```ts
const imageRef = ref<HTMLImageElement | null>(null)
watchEffect(() => {
  const el = imageRef.value
  if (!el) return
  el.style.setProperty('transform', transformStyle.value)
  el.style.setProperty('transition', isDragging.value ? 'none' : 'transform 0.1s ease-out')
}, { flush: 'post' })
```
Add `watchEffect` to imports (line 45): `import { ref, watch, onMounted, onUnmounted, nextTick, watchEffect } from 'vue'`

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 9: DsTooltip top/left (imperative position, v-if+Transition)

**Files:**
- Modify: `web/src/components/ui/DsTooltip.vue` (template line 10, script lines 34, 53-71)

- [ ] **Step 1: Remove `:style`, write CSSOM in `updatePosition`**

Template (lines 5-13):
```vue
<!-- BEFORE -->
<div
  v-if="visible"
  ref="tooltipRef"
  class="ds-tooltip"
  :class="`ds-tooltip--${placement}`"
  :style="tooltipStyle"
  role="tooltip"
  :id="tooltipId"
>

<!-- AFTER -->
<div
  v-if="visible"
  ref="tooltipRef"
  class="ds-tooltip"
  :class="`ds-tooltip--${placement}`"
  role="tooltip"
  :id="tooltipId"
>
```

Script:
- Delete `tooltipStyle` ref (line 34).
- Update `updatePosition` (lines 53-71) to write directly to `tooltipRef.value.style`:
```ts
function updatePosition() {
  if (!triggerEl || !tooltipRef.value) return
  actualPlacement = computePlacement()
  const triggerRect = triggerEl.getBoundingClientRect()
  const tipRect = tooltipRef.value.getBoundingClientRect()
  const gap = 8

  const positions: Record<string, { top: number; left: number }> = {
    top: { top: triggerRect.top - tipRect.height - gap, left: triggerRect.left + (triggerRect.width - tipRect.width) / 2 },
    bottom: { top: triggerRect.bottom + gap, left: triggerRect.left + (triggerRect.width - tipRect.width) / 2 },
    left: { top: triggerRect.top + (triggerRect.height - tipRect.height) / 2, left: triggerRect.left - tipRect.width - gap },
    right: { top: triggerRect.top + (triggerRect.height - tipRect.height) / 2, left: triggerRect.right + gap },
  }
  const pos = positions[actualPlacement]
  // CSP-safe CSSOM: was reactive :style tooltipStyle
  tooltipRef.value.style.setProperty('top', `${Math.max(4, Math.min(window.innerHeight - tipRect.height - 4, pos.top))}px`)
  tooltipRef.value.style.setProperty('left', `${Math.max(4, Math.min(window.innerWidth - tipRect.width - 4, pos.left))}px`)
}
```

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 10: HtmlSandbox iframe height (single element)

**Files:**
- Modify: `web/src/components/HtmlSandbox.vue` (template line 16, script line 24)

- [ ] **Step 1: Add ref + watchEffect for iframe height**

Template (line 16):
```vue
<!-- BEFORE -->
:style="{ height: iframeHeight + 'px' }"

<!-- AFTER -->
(remove the :style attribute entirely; iframeRef already exists on line 11)
```

Script — add watchEffect (after `iframeHeight` ref, line 32):
```ts
import { ref, computed, onMounted, onUnmounted, watchEffect } from 'vue'
// ...
// CSP-safe CSSOM: set iframe height via style.setProperty
watchEffect(() => {
  const el = iframeRef.value
  if (el) el.style.setProperty('height', `${iframeHeight.value}px`)
}, { flush: 'post' })
```

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 11: SessionSidebar hover card + constify card (2 bindings)

**Files:**
- Modify: `web/src/components/SessionSidebar.vue` (template lines 123, 165; script lines 331-340, 375-383)

> **DO NOT touch line 29** (Agent 6 territory — `Icon` component, no `:style` anyway).

- [ ] **Step 1: Migrate `cardStyle` (line 123)**

Template (line 123):
```vue
<!-- BEFORE -->
<div v-if="hoveredSession" :key="hoveredSession.session_id" ref="hoverCardRef" class="session-hover-card" :style="cardStyle">

<!-- AFTER -->
<div v-if="hoveredSession" :key="hoveredSession.session_id" ref="hoverCardRef" class="session-hover-card">
```

Script — replace `cardStyle` computed (lines 331-340) with watchEffect:
```ts
// CSP-safe CSSOM: position hover card via style.setProperty (was :style cardStyle)
watchEffect(() => {
  const el = hoverCardRef.value
  if (!el || !hoveredSession.value) return
  el.style.setProperty('position', 'fixed')
  el.style.setProperty('top', `${cardTop.value}px`)
  el.style.setProperty('left', `${cardLeft.value}px`)
  el.style.setProperty('z-index', '100')
  el.style.setProperty('pointer-events', 'none')
}, { flush: 'post' })
```
Add `watchEffect` to imports (line 229): `import { computed, nextTick, ref, watch, watchEffect } from 'vue';`

- [ ] **Step 2: Migrate `constifyCardStyle` (line 165)**

Template (lines 161-167):
```vue
<!-- BEFORE -->
<div
  v-if="constifyTarget"
  ref="constifyCardRef"
  class="constify-card"
  :style="constifyCardStyle"
  @click.stop
>

<!-- AFTER -->
<div
  v-if="constifyTarget"
  ref="constifyCardRef"
  class="constify-card"
  @click.stop
>
```

Script — replace `constifyCardStyle` computed (lines 375-383) with watchEffect:
```ts
// CSP-safe CSSOM: position constify card via style.setProperty (was :style constifyCardStyle)
watchEffect(() => {
  const el = constifyCardRef.value
  if (!el) return
  if (!constifyTarget.value) {
    el.style.setProperty('display', 'none')
    return
  }
  el.style.setProperty('display', '')
  el.style.setProperty('position', 'fixed')
  el.style.setProperty('top', `${constifyCardTop.value}px`)
  el.style.setProperty('left', `${constifyCardLeft.value}px`)
  el.style.setProperty('z-index', '1001')
}, { flush: 'post' })
```

- [ ] **Step 3: Verify** — vitest + vue-tsc

---

## Step 1 Checkpoint: Commit

- [ ] **Commit after Tasks 1-11** (every 3-4 tasks also acceptable). Example message:
```
refactor(csp): migrate 13 easy/medium :style bindings to CSSOM setProperty

Apply Agent 28 CSSOM template (ref + watchEffect flush:post + style.setProperty)
across AskUserBubble, TaskTrackerBubble, AutocompletePanel, ChatInput (x2),
ContextMenu, StickerContextMenu, StickerPicker, MediaViewer, DsTooltip,
HtmlSandbox, SessionSidebar (x2). No behavior change; enables CSP
style-src 'unsafe-inline' removal.
```

---

## Task 12: AppearanceView theme preview colors (v-for, 3 bindings)

**Files:**
- Modify: `web/src/views/AppearanceView.vue` (template lines 20-22, script line 60)

- [ ] **Step 1: Use function-ref arrays for 3 nested v-for children**

Template (lines 12-25):
```vue
<!-- BEFORE -->
<button v-for="t in THEMES" :key="t.id" ...>
  <div class="theme-preview" :style="{ background: t.preview.bg }">
    <span class="theme-preview-accent" :style="{ background: t.preview.accent }"></span>
    <span class="theme-preview-text" :style="{ color: t.preview.text }">Aa</span>
  </div>
  <div class="theme-name">{{ t.name }}</div>
</button>

<!-- AFTER -->
<button v-for="(t, idx) in THEMES" :key="t.id" ...>
  <div class="theme-preview" :ref="(el) => setPreviewRef(el, idx)">
    <span class="theme-preview-accent" :ref="(el) => setAccentRef(el, idx)"></span>
    <span class="theme-preview-text" :ref="(el) => setTextRef(el, idx)">Aa</span>
  </div>
  <div class="theme-name">{{ t.name }}</div>
</button>
```

Script — add imports + ref arrays + watchEffect:
```ts
import { ref, watchEffect } from 'vue'
import type { ComponentPublicInstance } from 'vue'
// ...
const previewEls: HTMLElement[] = []
const accentEls: HTMLElement[] = []
const textEls: HTMLElement[] = []
const setPreviewRef = (el: Element | ComponentPublicInstance | null, idx: number) => { if (el) previewEls[idx] = el as HTMLElement }
const setAccentRef = (el: Element | ComponentPublicInstance | null, idx: number) => { if (el) accentEls[idx] = el as HTMLElement }
const setTextRef = (el: Element | ComponentPublicInstance | null, idx: number) => { if (el) textEls[idx] = el as HTMLElement }

watchEffect(() => {
  THEMES.forEach((t, idx) => {
    previewEls[idx]?.style.setProperty('background', t.preview.bg)
    accentEls[idx]?.style.setProperty('background', t.preview.accent)
    textEls[idx]?.style.setProperty('color', t.preview.text)
  })
}, { flush: 'post' })
```

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 13: ThemePicker theme preview colors (v-for, 3 bindings)

**Files:**
- Modify: `web/src/components/ThemePicker.vue` (template lines 15-17, script line 46)

- [ ] **Step 1: Same pattern as Task 12** (identical structure)

Template (lines 7-20): add `idx` to v-for and 3 function-refs as in Task 12.
Script: same ref arrays + watchEffect pattern.

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Step 2 Checkpoint: Commit

- [ ] **Commit after Tasks 12-13.**

---

## Task 14: App.vue settings popup (imperative, v-if+Transition)

**Files:**
- Modify: `web/src/src/App.vue` (template line 42, script lines 143-145, 239-249)

- [ ] **Step 1: Remove `:style`, write CSSOM in `updatePopupPosition`**

Template (line 42):
```vue
<!-- BEFORE -->
<div v-if="showSettingsMenu" ref="settingsPopupRef" class="settings-popup" :style="{ top: popupTop, left: popupLeft, maxHeight: popupMaxHeight }" @click.stop>

<!-- AFTER -->
<div v-if="showSettingsMenu" ref="settingsPopupRef" class="settings-popup" @click.stop>
```

Script:
- Delete `popupTop`, `popupLeft`, `popupMaxHeight` refs (lines 143-145).
- Update `updatePopupPosition` (lines 239-249) to write directly:
```ts
function updatePopupPosition() {
  const trigger = settingsTriggerRef.value
  const popup = settingsPopupRef.value
  if (!trigger || !popup) return
  const rect = trigger.getBoundingClientRect()
  // CSP-safe CSSOM: was reactive :style {top,left,maxHeight}
  popup.style.setProperty('top', `${rect.top}px`)
  popup.style.setProperty('left', `${rect.right + 8}px`)
  const available = window.innerHeight - rect.top - 16
  popup.style.setProperty('max-height', `${Math.max(160, available)}px`)
}
```

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 15: NewsView timeline bounds + node tops (2 bindings, v-for)

**Files:**
- Modify: `web/src/views/NewsView.vue` (template lines 20, 26; script lines 45-46, 50-86)

- [ ] **Step 1: Migrate `tlBounds` (line 20) + node tops (line 26)**

Template (lines 20-31):
```vue
<!-- BEFORE -->
<div v-if="versionNodes.length > 0" class="version-timeline" :style="tlBounds">
  <div class="tl-track"></div>
  <div
    v-for="node in versionNodes"
    :key="node.version"
    class="tl-node"
    :style="{ top: node.top + 'px' }"
  >

<!-- AFTER -->
<div v-if="versionNodes.length > 0" ref="timelineRef" class="version-timeline">
  <div class="tl-track"></div>
  <div
    v-for="(node, idx) in versionNodes"
    :key="node.version"
    class="tl-node"
    :ref="(el) => setNodeRef(el, idx)"
  >
```

Script:
- Delete `tlBounds` ref (line 45).
- Add `timelineRef` + node ref array:
```ts
import { onMounted, onUnmounted, ref, watchEffect } from 'vue'
import type { ComponentPublicInstance } from 'vue'
// ...
const timelineRef = ref<HTMLElement | null>(null)
const nodeEls: HTMLElement[] = []
const setNodeRef = (el: Element | ComponentPublicInstance | null, idx: number) => { if (el) nodeEls[idx] = el as HTMLElement }
watchEffect(() => {
  const tl = timelineRef.value
  if (tl && tlBounds.value) {
    tl.style.setProperty('top', tlBounds.value.top)
    tl.style.setProperty('height', tlBounds.value.height)
  }
  versionNodes.value.forEach((node, idx) => {
    nodeEls[idx]?.style.setProperty('top', `${node.top}px`)
  })
}, { flush: 'post' })
```
Keep `tlBounds` ref but keep it as the internal state (renamed conceptually, still a ref). Actually `tlBounds` was the ref bound to `:style`; we keep it as state and read it in watchEffect.

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Task 16: TarotBubble suit colors (v-for, 3 bindings across 2 loops)

**Files:**
- Modify: `web/src/components/tools/TarotBubble.vue` (template lines 30, 37, 59; script line 83)

- [ ] **Step 1: Function-ref arrays for both v-for branches (mutually exclusive v-if/v-else)**

Template — cards-row branch (lines 23-47):
```vue
<!-- BEFORE -->
<div v-for="(card, i) in cards" :key="i" class="tarot-card" ...>
  <div class="card-position">{{ card.position }}</div>
  <div class="card-face" :style="{ borderColor: suitColor(card.suit) }">
    ...
    <span class="tag" :style="{ background: suitColor(card.suit) + '22', color: suitColor(card.suit) }">

<!-- AFTER -->
<div v-for="(card, i) in cards" :key="i" class="tarot-card" ...>
  <div class="card-position">{{ card.position }}</div>
  <div class="card-face" :ref="(el) => setRowFaceRef(el, i)">
    ...
    <span class="tag" :ref="(el) => setRowTagRef(el, i)">
```

Template — cards-list branch (lines 52-73):
```vue
<!-- BEFORE -->
<div v-for="(card, i) in cards" :key="i" class="card-row" ...>
  <span class="card-row-num">{{ i + 1 }}</span>
  <div class="card-row-face" :style="{ borderLeftColor: suitColor(card.suit) }">

<!-- AFTER -->
<div v-for="(card, i) in cards" :key="i" class="card-row" ...>
  <span class="card-row-num">{{ i + 1 }}</span>
  <div class="card-row-face" :ref="(el) => setListFaceRef(el, i)">
```

Script — add ref arrays + watchEffect:
```ts
import { computed, ref, watchEffect } from 'vue'
import type { ComponentPublicInstance } from 'vue'
// ...
const rowFaceEls: HTMLElement[] = []
const rowTagEls: HTMLElement[] = []
const listFaceEls: HTMLElement[] = []
const setRowFaceRef = (el: Element | ComponentPublicInstance | null, i: number) => { if (el) rowFaceEls[i] = el as HTMLElement }
const setRowTagRef = (el: Element | ComponentPublicInstance | null, i: number) => { if (el) rowTagEls[i] = el as HTMLElement }
const setListFaceRef = (el: Element | ComponentPublicInstance | null, i: number) => { if (el) listFaceEls[i] = el as HTMLElement }

watchEffect(() => {
  cards.value.forEach((card, i) => {
    const color = suitColor(card.suit as string)
    rowFaceEls[i]?.style.setProperty('border-color', color)
    rowTagEls[i]?.style.setProperty('background', color + '22')
    rowTagEls[i]?.style.setProperty('color', color)
    listFaceEls[i]?.style.setProperty('border-left-color', color)
  })
}, { flush: 'post' })
```

- [ ] **Step 2: Verify** — vitest + vue-tsc

---

## Step 3 Checkpoint: Commit

- [ ] **Commit after Tasks 14-16.**

---

## Task 17: Verify zero `:style=` remain + remove CSP `'unsafe-inline'`

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json` (line 41, `style-src` directive)

- [ ] **Step 1: Grep confirms zero `:style=` in `web/src/`**

Run: `grep -rn ":style=" web/src/` — expect NO matches.

- [ ] **Step 2: Remove `'unsafe-inline'` from tauri.conf.json**

`desktop/src-tauri/tauri.conf.json` line 41 — change:
```
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
```
to:
```
style-src 'self' https://fonts.googleapis.com;
```

- [ ] **Step 3: Final verification** — `cd web && npx vitest run` (expect 47 pass) + `npx vue-tsc --noEmit` (expect exit 0)

- [ ] **Step 4: Commit**

```
refactor(csp): remove 'unsafe-inline' from style-src after CSSOM migration

All 25 :style= bindings in web/src/ have been migrated to CSP-safe
element.style.setProperty() calls. style-src 'unsafe-inline' is no
longer needed; only 'self' + fonts.googleapis.com remain.
```

---

## Risks & Mitigations

1. **`flush: 'post'` timing** — verified by Agent 28 to handle v-if/v-else conditional rendering. If a ref is null when the effect runs, the `if (el)` guard skips safely.
2. **Imperative-positioned elements** (StickerPicker, DsTooltip, App popup, NewsView timeline) — these set position inside `nextTick`/event handlers. Writing directly to `el.style` in those handlers is CSP-safe and avoids the reactive round-trip. The `flush: 'post'` watchEffect is NOT used for these; the imperative function owns the update.
3. **v-for with mutually exclusive v-if/v-else** (TarotBubble) — only one branch renders, so only its ref array gets populated; the other stays empty and the watchEffect's `?.` guards skip it. No conflict.
4. **`<style scoped>` selectors** — unaffected; CSSOM writes inline `style` properties which have higher specificity than scoped classes, same as the old `:style` binding behavior.

## Out of Scope (DO NOT TOUCH)
- Python files, `bun-sidecar/`, `pyproject.toml`, `requirements-lock.txt`
- Agent 6 files: `McpView.vue`, `SoulView.vue`, `SessionSidebar.vue:29`
- Agent 11 files: `Icon.vue`, `WeatherBubble.vue`, `DsModal.vue`, `DsOverlay.vue`, `OnboardingView.vue`, `MarkdownEditor.vue`
- Agent 28 files: `BarChartMini.vue`, `ContextUsageBadge.vue`, `TaskTrackerBar.vue`
