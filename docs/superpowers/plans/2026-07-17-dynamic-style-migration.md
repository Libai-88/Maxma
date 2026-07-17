# Dynamic :style= Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the simplest dynamic `:style=` bindings to CSS classes / CSS variables, preparing for CSP `'unsafe-inline'` removal.

**Architecture:** Classify each of the 36 `:style=` bindings by difficulty (Easy / Medium / Hard) → migrate all Easy + the safe Medium candidates to static CSS classes or CSS properties → document the remaining Hard bindings for a future batch. Regression-TDD: green baseline → migrate → still green.

**Tech Stack:** Vue 3, TypeScript, CSS, Vitest, vue-tsc

---

## Context

- Agent 6 already migrated 8 static inline `style="..."` bindings and recorded the remaining 28 dynamic `:style=` bindings. A fresh grep confirms **36** `:style=` instances across 26 files (Agent 6 left the dynamic ones untouched).
- This plan migrates the **simplest 8 instances** (2 Easy + 6 Medium). The remaining 28 are Hard (data-driven positioning / continuous percentages / data-driven colors) and are out of scope.
- **Constraints (do NOT touch):**
  - Agent 6 already-migrated files: `McpView.vue`, `SoulView.vue` (except `:35`), `SessionSidebar.vue` (except `:123`, `:165`).
  - Explicit Hard skip list: `ThemePicker.vue`, `AppearanceView.vue`, `TarotBubble.vue`, `App.vue` settings popup (`:42`), `NewsView.vue` timeline (`:20`, `:26`).

## Baseline (must be green before any change)

- [x] `cd d:\Maxma\MaxmaHere\web && npx vitest run` → 17 files / 47 tests passed
- [x] `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit` → exit 0, no errors

## Full `:style=` classification (36 instances)

### Easy — fixed value, redundant (2) → MIGRATE
| File:line | Binding | Why easy |
|-----------|---------|----------|
| `components/MarkdownEditor.vue:21` | `:style="{ height: '100%' }"` | Fixed value; Codemirror `.cm-editor` already fills wrapper |
| `views/SoulView.vue:35` | `:style="{ height: '100%' }"` | Fixed value; same pattern |

### Medium — prop/state-driven but enumerable (6) → MIGRATE
| File:line | Binding | Strategy |
|-----------|---------|----------|
| `components/Icon.vue:2` | `:style="{ width: size+'px', height: size+'px' }"` | `size` uses only 5 literals {12,14,16,18,20} (24 call sites) → size classes + narrow prop type to literal union |
| `components/tools/WeatherBubble.vue:69` | `:style="{ width: pBarWidth(range)+'%' }"` | `pBarWidth` maps intensity→{暴雨:100,大雨:72,中雨:44,小雨:22,微量:10}; element already gets `.p-level-{intensity}` class → move width into those classes |
| `components/ui/DsModal.vue:9` | `:style="{ width: maxWidth }"` | Component unused outside its own file; `maxWidth` defaults `'480px'` → CSS `width:480px`, drop prop |
| `components/ui/DsOverlay.vue:10` | `:style="{ zIndex }"` | Component unused outside its own file; `zIndex` defaults `1000` → CSS `z-index:1000`, drop prop |
| `components/HtmlSandbox.vue:14` | 7-property mixed `:style` | PARTIAL: move fixed (width/border/display/overflow) + state-toggles (visibility/position) to classes; keep only dynamic `height` |
| `views/OnboardingView.vue:18` | `:style="{ background: theme.preview.bg }"` | `quickThemes` = 3 fixed themes with hex bg → swatch classes `swatch--{id}` |

### Hard — out of scope (28) → DOCUMENT ONLY
Data-driven positioning, continuous percentages, or data-driven colors:
- `App.vue:42` — settings popup `top/left/maxHeight` (explicit skip)
- `views/AppearanceView.vue:20,21,22` — theme preview bg/accent/text (explicit skip)
- `components/ThemePicker.vue:15,16,17` — theme preview bg/accent/text (explicit skip)
- `views/NewsView.vue:20,26` — timeline bounds + `top: node.top+'px'` (explicit skip)
- `components/tools/TarotBubble.vue:30,37,59` — `suitColor(card.suit)` data-driven colors (explicit skip)
- `components/AutocompletePanel.vue:4` — `panelStyle` dynamic left/bottom
- `components/BarChartMini.vue:2,16` — `height:${height}px`, `width:${item.percent}%`
- `components/ChatInput.vue:20,209` — `containerStyle` dynamic height, `quoteFloatStyle` dynamic position
- `components/ContextMenu.vue:13` — `left/top` dynamic position
- `components/StickerContextMenu.vue:5` — `left/top` dynamic position
- `components/StickerPicker.vue:5` — `pickerStyle` dynamic transform
- `components/MediaViewer.vue:23` — `transform` + transition dynamic
- `components/ContextUsageBadge.vue:6` — `width: barPercent+'%'` continuous
- `components/TaskTrackerBar.vue:19` — `width: progressPercent+'%'` continuous
- `components/tools/AskUserBubble.vue:110` — `width: countdownPercent+'%'` continuous
- `components/tools/TaskTrackerBubble.vue:19` — `width: progressPercent+'%'` continuous
- `components/ui/DsTooltip.vue:10` — `tooltipStyle` dynamic position
- `views/OnboardingView.vue:18` — (migrated this batch; was originally listed Hard, reclassified Medium)
- `components/SessionSidebar.vue:123,165` — `cardStyle`/`constifyCardStyle` dynamic position (Agent 6 constraint)

---

## File Structure

Each migration is self-contained in a single `.vue` file (template + scoped style). No new files created. The `Icon.vue` change also narrows a prop TypeScript type.

---

## Task 1: Easy — MarkdownEditor.vue + SoulView.vue (remove redundant `:style`)

**Files:**
- Modify: `web/src/components/MarkdownEditor.vue:21`
- Modify: `web/src/views/SoulView.vue:35`

- [ ] **Step 1: MarkdownEditor.vue — remove `:style` line**

Delete the `:style="{ height: '100%' }"` attribute from the `<Codemirror>` element (line 21). The editor wrapper already constrains height.

- [ ] **Step 2: SoulView.vue — remove `:style` line**

Delete the `:style="{ height: '100%' }"` attribute from the `<Codemirror>` element (line 35).

- [ ] **Step 3: Verify**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run && npx vue-tsc --noEmit`
Expected: 47 tests pass, tsc exit 0.

## Task 2: Medium — Icon.vue (size classes + literal union type)

**Files:**
- Modify: `web/src/components/Icon.vue` (template line 2, script prop type, scoped style)

- [ ] **Step 1: Narrow `size` prop type to literal union**

Change `size?: number` → `size?: 12 | 14 | 16 | 18 | 20` (default stays `16`). All 24 call sites already pass these literals, so vue-tsc stays green; future misuse becomes a compile error.

- [ ] **Step 2: Replace `:style` with `:class` in template**

```vue
<span class="icon" :class="`icon--${size}`" v-html="svgContent"></span>
```

- [ ] **Step 3: Add size classes in scoped style**

```css
.icon--12 { width: 12px; height: 12px; }
.icon--14 { width: 14px; height: 14px; }
.icon--16 { width: 16px; height: 16px; }
.icon--18 { width: 18px; height: 18px; }
.icon--20 { width: 20px; height: 20px; }
```

- [ ] **Step 4: Verify**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run && npx vue-tsc --noEmit`
Expected: 47 tests pass, tsc exit 0.

- [ ] **Step 5: Commit batch 1**

```bash
git add web/src/components/MarkdownEditor.vue web/src/views/SoulView.vue web/src/components/Icon.vue
git commit -m "refactor(web): migrate redundant height + Icon size :style to CSS classes"
```

## Task 3: Medium — WeatherBubble.vue (p-level width classes)

**Files:**
- Modify: `web/src/components/tools/WeatherBubble.vue:69` (template) + scoped style + remove `pBarWidth` fn

- [ ] **Step 1: Remove `:style` from `.p-bar` span (line 69)**

The element already carries `:class="'p-level-' + range.intensity"`. Delete the `:style="{ width: pBarWidth(range) + '%' }"` attribute.

- [ ] **Step 2: Add width rules to existing `.p-level-*` classes in scoped style**

Map (from `pBarWidth`): 暴雨→100%, 大雨→72%, 中雨→44%, 小雨→22%, 微量→10% (default 10%).

```css
.p-bar.p-level-暴雨 { width: 100%; }
.p-bar.p-level-大雨 { width: 72%; }
.p-bar.p-level-中雨 { width: 44%; }
.p-bar.p-level-小雨 { width: 22%; }
.p-bar.p-level-微量 { width: 10%; }
```

- [ ] **Step 3: Remove now-dead `pBarWidth` function** (script, ~line 316)

- [ ] **Step 4: Verify**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run && npx vue-tsc --noEmit`
Expected: 47 tests pass, tsc exit 0.

## Task 4: Medium — DsModal.vue + DsOverlay.vue (unused components → CSS, drop props)

**Files:**
- Modify: `web/src/components/ui/DsModal.vue` (template line 9, script props, scoped style)
- Modify: `web/src/components/ui/DsOverlay.vue` (template line 10, script props, scoped style)

Grep confirms both components are referenced only in their own files (no external import), so dropping props is safe.

- [ ] **Step 1: DsModal — remove `:style="{ width: maxWidth }"`, drop `maxWidth` prop, add CSS**

Template: `<div v-if="modelValue" class="ds-modal">`
Script: remove `maxWidth?: string` prop + its default.
Style: add `width: 480px;` to `.ds-modal`.

- [ ] **Step 2: DsOverlay — remove `:style="{ zIndex }"`, drop `zIndex` prop, add CSS**

Template: remove the `:style` attribute from the overlay div.
Script: remove `zIndex?: number` prop + its default.
Style: add `z-index: 1000;` to `.ds-overlay`.

- [ ] **Step 3: Verify**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run && npx vue-tsc --noEmit`
Expected: 47 tests pass, tsc exit 0.

- [ ] **Step 4: Commit batch 2**

```bash
git add web/src/components/tools/WeatherBubble.vue web/src/components/ui/DsModal.vue web/src/components/ui/DsOverlay.vue
git commit -m "refactor(web): migrate WeatherBubble p-bar + DsModal/DsOverlay :style to CSS"
```

## Task 5: Medium (partial) — HtmlSandbox.vue (classes for fixed/state, keep height)

**Files:**
- Modify: `web/src/components/HtmlSandbox.vue:14` (template) + scoped style

- [ ] **Step 1: Replace 7-property `:style` with class + single dynamic height**

Template:
```vue
<iframe
  ref="iframeRef"
  :srcdoc="iframeContent"
  sandbox="allow-scripts allow-modals"
  class="html-sandbox-iframe"
  :class="{ 'is-loaded': iframeLoaded, 'is-loading': !iframeLoaded }"
  :style="{ height: iframeHeight + 'px' }"
  title="sandboxed-content"
  @load="onIframeLoad"
/>
```

- [ ] **Step 2: Add scoped CSS for the iframe classes**

```css
.html-sandbox-iframe {
  width: 100%;
  border: none;
  display: block;
  overflow: hidden;
}
.html-sandbox-iframe.is-loading {
  visibility: hidden;
  position: absolute;
}
.html-sandbox-iframe.is-loaded {
  visibility: visible;
  position: relative;
}
```

- [ ] **Step 3: Verify**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run && npx vue-tsc --noEmit`
Expected: 47 tests pass, tsc exit 0.

## Task 6: Medium — OnboardingView.vue (swatch classes for 3 fixed themes)

**Files:**
- Modify: `web/src/views/OnboardingView.vue:18` (template) + scoped style

`quickThemes` = THEMES filtered to `['warm-paper','midnight','high-contrast']` with fixed hex bg (`#F8F4ED`, `#3B4A54`, `#FAF8F7`).

- [ ] **Step 1: Replace `:style` with swatch class**

Template:
```vue
<span class="theme-swatch" :class="`swatch--${theme.id}`"></span>
```

- [ ] **Step 2: Add scoped CSS**

```css
.swatch--warm-paper { background: #F8F4ED; }
.swatch--midnight { background: #3B4A54; }
.swatch--high-contrast { background: #FAF8F7; }
```

- [ ] **Step 3: Verify**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run && npx vue-tsc --noEmit`
Expected: 47 tests pass, tsc exit 0.

- [ ] **Step 4: Commit batch 3**

```bash
git add web/src/components/HtmlSandbox.vue web/src/views/OnboardingView.vue
git commit -m "refactor(web): migrate HtmlSandbox + OnboardingView swatch :style to CSS classes"
```

---

## Self-Review

- **Spec coverage:** All 2 Easy + 6 Medium candidates have a task. The 28 Hard bindings are documented above and explicitly out of scope.
- **Placeholder scan:** None — every step shows exact code/commands.
- **Type consistency:** `Icon` `size` literal union {12,14,16,18,20} matches all 24 call sites verified by grep. `p-level-*` intensity strings match `pBarWidth` map keys. `swatch--*` ids match `quickThemes` filter.

## Remaining after this batch (29 instances, all Hard)

**Result: 36 → 29.** Migrated 7 instances fully + 1 partial (HtmlSandbox reduced from 7 inline properties to 1 dynamic `height`). 3 commits: `7b7c939`, `ef41e8f`, `720ae40`. Baseline green throughout (47 tests / vue-tsc exit 0).

### Remaining 29 `:style=` bindings (verified by grep after migration)

**Explicit skip list (do not migrate — per task constraints):**
- `App.vue:42` — settings popup `top/left/maxHeight`
- `views/AppearanceView.vue:20,21,22` — theme preview bg/accent/text
- `components/ThemePicker.vue:15,16,17` — theme preview bg/accent/text
- `views/NewsView.vue:20,26` — timeline bounds + `top: node.top+'px'`
- `components/tools/TarotBubble.vue:30,37,59` — `suitColor(card.suit)` data-driven colors
- `components/SessionSidebar.vue:123,165` — `cardStyle`/`constifyCardStyle` (Agent 6 constraint)

**Data-driven dynamic positioning (Hard — needs runtime coords):**
- `components/AutocompletePanel.vue:4` — `panelStyle` (left/bottom)
- `components/ChatInput.vue:20` — `containerStyle` (dynamic height)
- `components/ChatInput.vue:209` — `quoteFloatStyle` (dynamic position)
- `components/ContextMenu.vue:13` — `left/top`
- `components/StickerContextMenu.vue:5` — `left/top`
- `components/StickerPicker.vue:5` — `pickerStyle` (transform)
- `components/MediaViewer.vue:23` — `transform` + transition
- `components/ui/DsTooltip.vue:10` — `tooltipStyle` (position)

**Continuous data-driven percentages (Hard — 0-100% range, not enumerable):**
- `components/BarChartMini.vue:2,16` — `height:${height}px`, `width:${item.percent}%`
- `components/ContextUsageBadge.vue:6` — `width: barPercent+'%'`
- `components/TaskTrackerBar.vue:19` — `width: progressPercent+'%'`
- `components/tools/AskUserBubble.vue:110` — `width: countdownPercent+'%'`
- `components/tools/TaskTrackerBubble.vue:19` — `width: progressPercent+'%'`

**Partial — reduced this batch, 1 dynamic property remains:**
- `components/HtmlSandbox.vue:16` — `:style="{ height: iframeHeight + 'px' }"` (was 7 properties; 6 moved to classes). `iframeHeight` is a continuous postMessage value, cannot enumerate → keep as the sole remaining inline style in this file.

### Next steps for a future batch
1. The continuous-percentage progress bars (5 instances) would each need a CSS-variable-on-parent + `width: var(--pct)` approach, which still requires an inline `style` to set the variable — not CSP-safe. True removal needs either discretization (quantized steps) or a different rendering approach (e.g. SVG `<rect width>`).
2. The dynamic-positioning components (8 instances) fundamentally need runtime pixel coords; CSP-safe alternatives are `popper.js`/anchor positioning or pre-computed class buckets. Out of scope for inline-style→class migration.
3. The data-driven-color components (TarotBubble/AppearanceView/ThemePicker, 9 instances) could be migrated by enumerating the fixed color palette as classes, but TarotBubble/AppearanceView/ThemePicker are on the explicit skip list.

