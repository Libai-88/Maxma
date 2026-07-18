# CSP Progressive Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Progressively migrate a small set of simple static inline `style="..."` declarations to scoped CSS classes, as the first safe step toward eventually removing `'unsafe-inline'` from the Tauri CSP `style-src` directive.

**Architecture:** Phase 1 investigates whether Tauri 2 supports CSP Report-Only / `report-uri` (conclusion: not practical — skipped). Phase 2 migrates 8 simple fixed-value inline styles across 3 files (`McpView.vue`, `SoulView.vue`, `SessionSidebar.vue`) to scoped CSS classes, guarded by the existing vitest suite + `vue-tsc` type check as regression gates. Phase 3 documents the remaining inline styles (dynamic `:style=` and v-html generated) for future work.

**Tech Stack:** Tauri 2, Vue 3 (`<style scoped>`), TypeScript, vitest, vue-tsc

---

## Background & Constraints

- Current CSP (line 41 of `desktop/src-tauri/tauri.conf.json`):
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
- This plan **does NOT** modify `tauri.conf.json`. Removing `'unsafe-inline'` is a later step that depends on migrating all inline styles. This plan only reduces the inline-style surface area.
- **Only these files may be modified:**
  - `web/src/views/McpView.vue`
  - `web/src/views/SoulView.vue`
  - `web/src/components/SessionSidebar.vue`
- **Do NOT touch** dynamic `:style="..."` bindings — they need refactoring beyond this scope.
- **Do NOT touch** `RenderMarkdown.vue` inline styles (lines 52, 63) — they live inside JS template strings rendered via `v-html`; scoped styles do not apply to `v-html` content.

## TDD / Regression Strategy

CSS-only migrations have no behavioral test to write. The regression gate is:
1. Run the **full vitest suite** before any change to capture a green baseline.
2. After each file's migration, re-run vitest + `vue-tsc --noEmit`; both must stay green.
3. The mechanical equivalence rule: a `class` whose scoped rule contains the **exact same CSS declarations** produces identical rendering to the removed inline `style`.

Commands (run from `d:\Maxma\MaxmaHere\web`):
- Tests: `npx vitest run`
- Type check: `npx vue-tsc --noEmit`

---

## Phase 1: CSP Report-Only Investigation (already complete — no code changes)

**Findings (do not implement, just recorded):**

- Tauri 2 injects the `app.security.csp` string as a `<meta http-equiv="Content-Security-Policy">` tag in the webview, not as an HTTP response header.
- `Content-Security-Policy-Report-Only` is **only** delivered via an HTTP response header; it is **not** honored in a `<meta>` tag. Tauri 2's config schema has no `report-only` field.
- The `report-uri` / `report-to` directives are likewise **ignored inside `<meta>` CSP** (browsers only honor them from real HTTP headers). Even if they were honored, a Tauri desktop app has no always-on HTTP endpoint to POST violation reports to.

**Conclusion:** Phase 1 is **skipped**. Proceed directly to Phase 2.

---

## Phase 2: Migrate Static Inline Styles to Scoped CSS Classes

### Task 1: Establish green baseline

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: all tests PASS. Record the passing count.

- [ ] **Step 2: Run type check**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit nothing** (baseline only — no file changes).

---

### Task 2: Migrate McpView.vue — simple single-property inline styles

**Files:**
- Modify: `web/src/views/McpView.vue` (template lines 15, 73, 75; style block ends at line ~1043)

These three are fixed single/simple-value inline styles.

- [ ] **Step 1: Migrate the retry-button wrapper (line 15)**

Before:
```html
        <div style="margin-top: 12px">
          <button class="btn primary" @click="loadServers">重试</button>
        </div>
```

After:
```html
        <div class="retry-row">
          <button class="btn primary" @click="loadServers">重试</button>
        </div>
```

- [ ] **Step 2: Migrate the OMP section wrapper (line 73)**

Before:
```html
      <div v-if="discoveredServers.length > 0" class="section" style="margin-top: 24px;">
```

After (keep existing `section` class, add `omp-section`):
```html
      <div v-if="discoveredServers.length > 0" class="section omp-section">
```

- [ ] **Step 3: Migrate the discovered server-card opacity (line 75)**

Before:
```html
        <div v-for="s in discoveredServers" :key="s.id" class="server-card" style="opacity: 0.85;">
```

After:
```html
        <div v-for="s in discoveredServers" :key="s.id" class="server-card">
```

(The `.server-card` rule added in Step 5 will carry the opacity.)

- [ ] **Step 4: Add the scoped CSS rules**

Insert the following block immediately **before** the closing `</style>` tag (after the `.tool-pick-danger:hover` rule at line ~1042):

```css

/* ── OMP 自动发现区 ── */
.retry-row {
  margin-top: 12px;
}

.omp-section {
  margin-top: 24px;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary, #6b7280);
  margin-bottom: 8px;
}

.server-card {
  opacity: 0.85;
}

.auto-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 100px;
  background: var(--border, #e5e7eb);
  color: var(--text-tertiary, #9ca3af);
  margin-left: 8px;
}

.tool-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-secondary, #f9fafb);
  color: var(--text-secondary, #6b7280);
}
```

(Note: `.section-title`, `.auto-tag`, `.tool-tag` rules are added here so the next task only needs template edits.)

- [ ] **Step 5: Run tests + type check**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: same passing count as baseline, no failures.

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: exits 0.

---

### Task 3: Migrate McpView.vue — multi-property static inline styles

**Files:**
- Modify: `web/src/views/McpView.vue` (template lines 74, 79, 82)

The CSS rules for these were already added in Task 2 Step 4. This task only swaps the template.

- [ ] **Step 1: Migrate the section title (line 74)**

Before:
```html
        <div class="section-title" style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary, #6b7280); margin-bottom: 8px;">OMP 自动发现</div>
```

After:
```html
        <div class="section-title">OMP 自动发现</div>
```

- [ ] **Step 2: Migrate the "自动" tag (line 79)**

Before:
```html
            <span style="font-size: 10px; padding: 1px 6px; border-radius: 100px; background: var(--border, #e5e7eb); color: var(--text-tertiary, #9ca3af); margin-left: 8px;">自动</span>
```

After:
```html
            <span class="auto-tag">自动</span>
```

- [ ] **Step 3: Migrate the tool tag (line 82)**

Before:
```html
            <span v-for="t in s.tools" :key="t" style="font-size: 11px; padding: 2px 8px; border-radius: 4px; background: var(--bg-secondary, #f9fafb); color: var(--text-secondary, #6b7280);">{{ t }}</span>
```

After:
```html
            <span v-for="t in s.tools" :key="t" class="tool-tag">{{ t }}</span>
```

- [ ] **Step 4: Run tests + type check**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: no failures.

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: exits 0.

- [ ] **Step 5: Commit McpView changes**

```bash
cd d:\Maxma\MaxmaHere
git add web/src/views/McpView.vue
git commit -m "refactor(web): migrate McpView static inline styles to scoped CSS classes"
```

---

### Task 4: Migrate SoulView.vue — PersonaCard margin

**Files:**
- Modify: `web/src/views/SoulView.vue` (template line 3; style block at lines 247–496)

Note: `PersonaCard` is a child component. In Vue 3, the parent's scoped data attribute is applied to the child's root element, so a scoped `.persona-card-spacing` rule in `SoulView.vue` will match `PersonaCard`'s root. No `:deep()` needed.

- [ ] **Step 1: Migrate the PersonaCard margin (line 3)**

Before:
```html
    <PersonaCard style="margin-bottom: 16px;" />
```

After:
```html
    <PersonaCard class="persona-card-spacing" />
```

- [ ] **Step 2: Add the scoped CSS rule**

Insert immediately **before** the closing `</style>` tag (after the `.create-btn.save:disabled` rule at line ~495):

```css

.persona-card-spacing {
  margin-bottom: 16px;
}
```

- [ ] **Step 3: Run tests + type check**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: no failures.

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit SoulView changes**

```bash
cd d:\Maxma\MaxmaHere
git add web/src/views/SoulView.vue
git commit -m "refactor(web): migrate SoulView PersonaCard inline style to scoped class"
```

---

### Task 5: Migrate SessionSidebar.vue — pin Icon margin

**Files:**
- Modify: `web/src/components/SessionSidebar.vue` (template line 29; style block contains `.session-id` at line ~661)

- [ ] **Step 1: Migrate the pin Icon margin (line 29)**

Before:
```html
              <Icon name="pin" :size="12" style="margin-right: 3px; flex-shrink: 0;" />
```

After:
```html
              <Icon name="pin" :size="12" class="pin-icon" />
```

- [ ] **Step 2: Add the scoped CSS rule**

`Icon` is a child component whose root is a `<span class="icon">`. The parent's scoped attribute lands on that root, so a scoped `.pin-icon` rule matches it. Insert the rule inside the `<style scoped>` block, immediately after the existing `.session-id { ... }` rule (around line 661). Find the closing brace of `.session-id` and append:

```css
.pin-icon {
  margin-right: 3px;
  flex-shrink: 0;
}
```

- [ ] **Step 3: Run tests + type check**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: no failures.

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit SessionSidebar changes**

```bash
cd d:\Maxma\MaxmaHere
git add web/src/components/SessionSidebar.vue
git commit -m "refactor(web): migrate SessionSidebar pin Icon inline style to scoped class"
```

---

## Phase 3: Document Remaining Inline Styles (no migration — record only)

This section inventories the remaining inline styles in `web/src/` so future work can plan their migration. **Do not migrate any of these in this plan.**

### Static inline `style="..."` in v-html / JS template strings (NOT migratable via scoped CSS)

| File | Line | Snippet | Difficulty | Notes |
|------|------|---------|------------|-------|
| `components/RenderMarkdown.vue` | 52 | `return \`<p style="color:var(--status-error)">⚠ Markdown 渲染错误: ${msg}</p>\`` | Hard | Generated HTML rendered via `v-html`; scoped attributes are not injected. Would need a global (non-scoped) CSS class or `:deep()` on the v-html container, plus a class on the container. |

### Dynamic `:style="..."` bindings (out of scope — need refactoring)

These bind to reactive values (percentages, positions, computed colors). Migrating them to classes requires either CSS custom properties (`--var`) + a class, or `v-bind()` in `<style>`, and is deferred.

| File | Line(s) | What it drives | Difficulty |
|------|---------|----------------|------------|
| `App.vue` | 42 | settings popup `top/left/maxHeight` | Medium (CSS var + class) |
| `components/BarChartMini.vue` | 2, 16 | chart height, bar width % | Medium |
| `components/AutocompletePanel.vue` | 4 | `panelStyle` (position) | Medium |
| `components/ChatInput.vue` | 20, 209 | `containerStyle`, `quoteFloatStyle` | Medium |
| `components/ContextMenu.vue` | 13 | `left/top` px | Medium |
| `components/StickerContextMenu.vue` | 5 | `left/top` px | Medium |
| `components/StickerPicker.vue` | 5 | `pickerStyle` | Medium |
| `components/SessionSidebar.vue` | 123, 165 | hover card style | Medium |
| `components/MediaViewer.vue` | 23 | `transform` / `transition` | Medium |
| `components/HtmlSandbox.vue` | 14 | sandbox style object | Medium |
| `components/MarkdownEditor.vue` | 21 | `height: '100%'` | Easy (fixed value — candidate for next pass) |
| `components/Icon.vue` | 2 | `width/height` from `size` prop | Medium (could use CSS var `--icon-size`) |
| `views/AppearanceView.vue` | 20, 21, 22 | theme preview bg/accent/text | Hard (data-driven colors from config) |
| `components/ThemePicker.vue` | 15, 16, 17 | theme preview bg/accent/text | Hard (data-driven) |
| `views/NewsView.vue` | 20, 26 | timeline bounds, node `top` px | Medium |
| `views/OnboardingView.vue` | 18 | theme swatch `background` | Hard (data-driven) |
| `components/ui/DsModal.vue` | 9 | `width: maxWidth` | Medium |
| `components/ui/DsOverlay.vue` | 10 | `zIndex` | Medium |
| `components/ui/DsTooltip.vue` | 10 | `tooltipStyle` | Medium |
| `components/TaskTrackerBar.vue` | 19 | progress `width %` | Medium |
| `components/ContextUsageBadge.vue` | 6 | bar `width %` | Medium |
| `components/tools/AskUserBubble.vue` | 110 | countdown `width %` | Medium |
| `components/tools/TaskTrackerBubble.vue` | 19 | progress `width %` | Medium |
| `components/tools/WeatherBubble.vue` | 69 | `pBarWidth %` | Medium |
| `components/tools/TarotBubble.vue` | 30, 37, 59 | `suitColor()`-driven border/background/color | Hard (function-driven colors) |
| `views/SoulView.vue` | 35 | Codemirror `height: '100%'` | Easy (fixed value — candidate for next pass) |

### Recommended next-pass candidates (easy fixed-value `:style`)

Two dynamic bindings hold fixed values and could be converted to scoped classes in a follow-up:
- `components/MarkdownEditor.vue:21` — `:style="{ height: '100%' }"` → `.markdown-editor-host { height: 100%; }`
- `views/SoulView.vue:35` — Codemirror `:style="{ height: '100%' }"` → already inside `.editor-wrapper` which sets height via `:deep(.cm-editor) { height: 100% }`; the inline style is redundant and could likely just be removed.

---

## Self-Review

- **Spec coverage:** Phase 1 (investigate Report-Only) — covered, concluded skip. Phase 2 (migrate 5–10 simple static inline styles) — 8 migrations across Tasks 2–5. Phase 3 (document remaining) — inventory tables above. ✓
- **Placeholder scan:** No TBD/TODO. All steps contain exact code or exact commands. ✓
- **Type/name consistency:** Class names (`retry-row`, `omp-section`, `section-title`, `server-card`, `auto-tag`, `tool-tag`, `persona-card-spacing`, `pin-icon`) are consistent between template edits and CSS rules. ✓
- **Scope discipline:** Only the 3 allowed files are modified. No `tauri.conf.json` change. No dynamic `:style=` touched. ✓
