# Plan: Theme Switch Smooth Transition + Font Loading Strategy

## Current State Assessment

### Theme Switching Mechanism
- **Source**: `src/composables/useTheme.ts` — sets `document.documentElement.setAttribute('data-theme', theme)` via a Vue watcher on `activeTheme`
- **Theme files**: 11 `.css` files in `src/themes/`, each scoped to `[data-theme="xxx"]` (plus `:root:not([data-theme])` for default warm-paper)
- **Problem**: When `data-theme` changes, all CSS custom properties (`--bg-primary`, `--text-primary`, `--border`, etc.) update instantly — no transition on the consuming properties (`background-color`, `color`, `border-color`)

### Existing Animation Infrastructure
- `src/assets/styles/animations.css` already has a `prefers-reduced-motion: reduce` block (line 129-160) that sets `transition-duration: 0.01ms !important` on all elements — this is good, we must stay compatible
- Some elements already have their own transitions (e.g., `.sidebar` width transition, `.nav-item` hover transition) — we must not interfere

### Font Loading (index.html)
- Google Fonts URL includes `&display=swap` (confirmed on line 12 of index.html)
- `<link rel="preconnect" href="https://fonts.googleapis.com" />` is present
- `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />` is present
- CSP allows `fonts.googleapis.com` (style-src) and `fonts.gstatic.com` (font-src)
- **Verdict**: Already optimal — no changes needed for font loading

---

## Proposed Changes

### 1. Add Theme Transition CSS to `App.vue`

**File**: `src/App.vue` — `<style>` block (global, un-scoped)

**What**: Insert a `@media (prefers-reduced-motion: no-preference)` block with transitions on layout-level elements only (not all `*`). This ensures:
- Theme switching animates smoothly (background, text, border colors)
- `prefers-reduced-motion: reduce` users get instant switch (no motion)
- Performance is not impacted (no universal `*` selector transitions)

**CSS to add** (insert before the `* { scrollbar-width: thin; ... }` block, around line 202):

```css
/* ── Theme switch transition (respects prefers-reduced-motion) ── */
@media (prefers-reduced-motion: no-preference) {
  html {
    transition: background-color 0.3s ease;
  }
  body,
  .app-layout,
  .sidebar,
  .main,
  .theme-picker,
  .theme-card {
    transition: background-color 0.25s ease,
                color 0.25s ease,
                border-color 0.25s ease;
  }
}
```

**Rationale for element selection**:
- `html` — root bg color, occasional flash prevention
- `body` — inherits bg/text from html, ensures global coverage
- `.app-layout` — flex container, main layout structure
- `.sidebar` — sidebar panel with bg/border
- `.main` — main content area with bg
- `.theme-picker`, `.theme-card` — theme selector UI in settings (so its preview updates smoothly too)

**Why NOT all `*`**: The user's original suggestion of `html *` would cause every single element to transition `background-color`, `color`, `border-color`, which would:
- Significantly degrade performance (thousands of elements)
- Cause unwanted hover/focus transition side effects
- Conflict with existing intentional transitions (e.g., `.sidebar` width, `.nav-item` hover)

**Compatibility with `animations.css`**: The existing `prefers-reduced-motion: reduce` block in `animations.css` already sets `transition-duration: 0.01ms !important`, which will override our transitions for users who prefer reduced motion — no conflict.

### 2. Font Loading Strategy — No Changes Needed (Verification Only)

| Check | Status |
|---|---|
| `&display=swap` in Google Fonts URL | Present (index.html line 12) |
| `preconnect` to `fonts.googleapis.com` | Present (index.html line 10) |
| `preconnect` to `fonts.gstatic.com` with `crossorigin` | Present (index.html line 11) |
| CSP allows font sources | Confirmed (line 8) |

No changes required. The font-display strategy is already `swap` and connection optimizations are in place.

---

## Verification Steps

1. Run `npx vue-tsc --noEmit` in the project root — must pass with no errors
2. Run `npx vite build` — must succeed
3. Manual test: switch themes in the UI, observe smooth 0.25s transition on bg/text/border
4. Manual test: enable `prefers-reduced-motion: reduce` in devtools, switch themes — no transition animation
5. Manual test: sidebar collapse/expand — existing width transition should still work normally

---

## Files to Modify

| File | Change |
|---|---|
| `src/App.vue` | Add theme transition CSS block (approx. 15 lines) |
| `index.html` | **No changes** (already optimized) |

## Files Read for Context (no changes needed)

- `src/composables/useTheme.ts` — theme switching logic, `data-theme` attribute
- `src/components/ThemePicker.vue` — theme picker UI
- `src/assets/styles/tokens.css` — structural tokens, `--duration-*` variables
- `src/assets/styles/animations.css` — existing `prefers-reduced-motion` handling
- `src/themes/warm-paper.css`, `src/themes/midnight.css` — theme CSS variable definitions
