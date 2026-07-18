# Plan: Component Interaction Transition Effects

## Overview

Add/verify hover transitions and modal enter/leave animations across three components, following existing conventions from `tokens.css` (duration/easing CSS variables) and matching the style of `WelcomeScreen` / `MessageBubble`.

---

## Task 1 — ModelSelector: option hover transition

**File:** `D:/Maxma/MaxmaHere/web/src/components/ModelSelector.vue`

**Current state:**
- Input trigger has `transition` on `background` and `border-color`.
- Dropdown options (`.ds-select__option`, rendered via DsSelect) have no transition on `is-active` background change — it snaps instantly.

**Planned changes:**
Add two deep-selector rules inside the existing `<style scoped>` block:

```css
.model-selector :deep(.ds-select__option) {
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}
.model-selector :deep(.ds-select__option:hover) {
  background: var(--overlay-subtle);
}
```

**Why:**
- `var(--duration-fast)` (0.15s) and `var(--ease-out)` match the project design token convention.
- `var(--overlay-subtle)` is already defined in `tokens.css`.
- Using `:deep()` scopes the rule to ModelSelector only, not affecting other DsSelect usages.
- The existing `is-active` class from DsSelect already provides `background: var(--bg-secondary)`; the transition makes it smooth when keyboard-navigating.

**`prefers-reduced-motion`:** The transition is short (0.15s) and conventional — no special handling needed per project patterns.

---

## Task 2 — DsModal: Transition verification

**File:** `D:/Maxma/MaxmaHere/web/src/components/ui/DsModal.vue`

**Current state:**
- Already has `<Transition name="ds-modal">` wrapping the dialog content.
- CSS defines `ds-modal-enter-active`/`ds-modal-leave-active` with opacity + scale transition.
- DsOverlay (parent) also has its own `ds-overlay` fade transition.
- `prefers-reduced-motion: reduce` media query already present.

**Assessment: Already complete.** No changes needed.

Verification checklist:
| Requirement | Status |
|---|---|
| Vue `<Transition>` wrapper | Done — wraps `div.ds-modal` |
| Enter: fade + scale | Done — `opacity 0 → 1`, `scale(0.95) translateY(8px)` |
| Leave: fade + scale | Done — `opacity 1 → 0`, `scale(0.98)` |
| Uses CSS var tokens | Done — `var(--duration-fast)`, `var(--duration-instant)`, `var(--ease-out/in)` |
| `prefers-reduced-motion` | Done — disables transform, uses linear opacity |

---

## Task 3 — ToolCallCard: hover lift effect

**File:** `D:/Maxma/MaxmaHere/web/src/components/ToolCallCard.vue`

**Current state:**
- `.tool-card` has `box-shadow: var(--shadow);` but no `transition` property.
- No hover interaction beyond cursor default.

**Planned changes:**
Add to `.tool-card` rule block (append after existing properties):

```css
.tool-card {
  /* ... existing ... */
  transition: transform var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
.tool-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
```

And add a `prefers-reduced-motion` section:

```css
@media (prefers-reduced-motion: reduce) {
  .tool-card {
    transition: none;
  }
  .tool-card:hover {
    transform: none;
  }
}
```

**Why:**
- `var(--shadow-md)` is `0 2px 8px var(--shadow-color, rgba(0,0,0,0.08))` — subtle elevation.
- `translateY(-1px)` matches the pattern used in `WelcomeScreen` `.action-btn:hover`.
- The `transition` uses project tokens for consistency.
- The reduce-motion block respects accessibility.

---

## Verification

After all edits, run:

```bash
cd D:/Maxma/MaxmaHere/web && npx vue-tsc --noEmit
```

No template or script blocks are touched in any file — only CSS within `<style scoped>`.
