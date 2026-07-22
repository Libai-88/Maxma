# 007 — Gate hover transform animations for touch devices

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 5 files, ~9 hover rules

## Problem

5 hover animations using `transform` are not gated by `@media (hover: hover) and (pointer: fine)`, causing false hover triggers on touch devices (tap fires hover state that sticks).

```css
/* web/src/components/StickerPicker.vue:784-787 — ungated */
.sticker-item:hover { background: var(--bg-hover); transform: scale(1.05); }

/* web/src/components/StickerPicker.vue:718 — ungated */
.recommended-item:hover { transform: translateY(-2px); }

/* web/src/components/StickerInline.vue:145 — ungated */
.sticker-inline:hover .sticker-img { transform: scale(1.15); }

/* web/src/components/ThemePicker.vue:111 — gated by no-preference but NOT hover:hover */
@media (prefers-reduced-motion: no-preference) { /* hover transform scale(1.06) */ }

/* web/src/components/ToolCallCard.vue:385 — gated by no-preference but NOT hover:hover */
@media (prefers-reduced-motion: no-preference) { /* hover transform: translateY(-1px) */ }

/* web/src/components/MessageBubble.vue:185 — gated by pointer:fine but NOT hover:hover */
@media (pointer: fine) { /* hover transform: translateY(-1px) */ }
```

## Target

All hover `transform` animations must be gated by the full triple media query:

```css
/* target pattern (from design-system.css:45 — gold standard) */
@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
  .foo:hover { transform: scale(1.05); }
}
```

Non-transform hovers (background/color only) do NOT need gating — those are acceptable on touch.

## Repo conventions to follow

- Gold standard: `web/src/assets/styles/design-system.css:45` — full triple gate.
- Also correct: `web/src/components/ChatInput.vue:1790` — `(hover: hover) and (pointer: fine)`.
- `web/src/App.vue:342,364` — full triple gate on logo hover.

## Steps

1. **StickerPicker.vue** — Wrap both hover rules in the triple gate:
   ```css
   @media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
     .sticker-item:hover { background: var(--bg-hover); transform: scale(1.05); }
     .recommended-item:hover { transform: translateY(-2px); }
   }
   ```
   NOTE: The `background` change can stay ungated (it's non-transform). Split if needed:
   ```css
   .sticker-item:hover { background: var(--bg-hover); }
   @media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
     .sticker-item:hover { transform: scale(1.05); }
   }
   ```

2. **StickerInline.vue** — Wrap the hover transform:
   ```css
   @media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
     .sticker-inline:hover .sticker-img { transform: scale(1.15); }
   }
   ```

3. **ThemePicker.vue** — Add `hover: hover` and `pointer: fine` to the existing gate:
   ```css
   /* current: @media (prefers-reduced-motion: no-preference) */
   /* target:  @media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) */
   ```

4. **ToolCallCard.vue** — Add `hover: hover` and `pointer: fine` to the existing gate (same as ThemePicker).

5. **MessageBubble.vue** — Add `hover: hover` to the existing `pointer: fine` gate:
   ```css
   /* current: @media (pointer: fine) */
   /* target:  @media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) */
   ```

## Boundaries

- Do NOT gate non-transform hovers (background/color/border-color only) — those are fine on touch.
- Do NOT remove the `prefers-reduced-motion: no-preference` part — it must stay.
- Do NOT change the transform values themselves.
- Do NOT touch already-correct gates in `App.vue`, `design-system.css`, `ChatInput.vue`.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - On desktop: hover each component — confirm transform still works.
  - In DevTools, toggle to touch emulation — confirm hover transforms do NOT fire on tap.
  - Toggle `prefers-reduced-motion: reduce` — confirm hover transforms disabled.
- **Done when**: All 5 components' hover transforms are triple-gated; non-transform hovers remain ungated.
