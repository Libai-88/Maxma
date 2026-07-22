# 001 — Fix global `prefers-reduced-motion` one-size-fits-all override

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 1 file, ~35 lines changed

## Problem

The global reduced-motion override at `web/src/assets/styles/animations.css:135-167` zeros out ALL `transition-duration` and `animation-duration` to `0.01ms` for every element:

```css
/* web/src/assets/styles/animations.css:135-167 — current */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .maxma-fade-up, .maxma-fade-down, .maxma-slide-in-left, .maxma-slide-out-left,
  .maxma-slide-in-top, .maxma-slide-out-top, .maxma-card-slide-down {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .maxma-spin, .maxma-globe-spin, .maxma-pulse { animation: none !important; }
  .typewriter-cursor { display: none; }
}
```

This violates the standard: "Reduced motion means fewer and gentler animations, **not zero** — keep transitions that aid comprehension, remove movement and position changes." The current rule kills opacity/color feedback too, leaving reduced-motion users with no visual feedback at all.

## Target

Keep `opacity`/`color`/`background`/`border-color` transitions at their normal durations. Only disable `transform`-based movement and infinite-loop animations:

```css
/* target */
@media (prefers-reduced-motion: reduce) {
  /* Disable transform-based movement only */
  *, *::before, *::after {
    scroll-behavior: auto !important;
  }
  /* Element-level: drop transform animations, keep opacity/color */
  .maxma-fade-up, .maxma-fade-down,
  .maxma-slide-in-left, .maxma-slide-out-left,
  .maxma-slide-in-top, .maxma-slide-out-top,
  .maxma-card-slide-down {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  /* Infinite loops: stop entirely */
  .maxma-spin, .maxma-globe-spin, .maxma-pulse,
  .maxma-gradient-shift, .maxma-typewriter-dots, .maxma-cycling-dots {
    animation: none !important;
  }
  .typewriter-cursor { display: none; }
}
```

## Repo conventions to follow

- Motion tokens live in `web/src/assets/styles/tokens.css`.
- The `design-system.css` pattern uses `@media (prefers-reduced-motion: no-preference)` to gate transforms — the inverse of this approach. Both coexist.
- Exemplar: `web/src/assets/styles/design-system.css:45` gates hover transforms behind `no-preference`, leaving color transitions ungated.

## Steps

1. Open `web/src/assets/styles/animations.css`.
2. Replace the block at lines 135-167 with the target code above.
3. Remove the `*, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }` rule entirely — this was the blanket kill.
4. Keep the element-specific overrides for displacement animations (`.maxma-fade-up`, `.maxma-slide-*`, etc.) and infinite loops (`.maxma-spin`, `.maxma-pulse`, etc.).
5. Add `.maxma-gradient-shift` to the infinite-loop stop list (currently runs 90s ambient background, should stop under reduced-motion).

## Boundaries

- Do NOT touch any other file.
- Do NOT change non-reduced-motion styles.
- Do NOT add new keyframes or tokens.
- Do NOT remove the `scroll-behavior: auto !important` rule.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - In DevTools Rendering panel, toggle `prefers-reduced-motion: reduce`.
  - Hover a `DsButton` — confirm background/color still transitions (not instant).
  - Trigger a toast — confirm opacity fade still plays, but no `translateY` slide.
  - Confirm spinners stop entirely (no subtle rotation).
  - Confirm the ambient gradient background (`--bg-aura-duration: 90s`) stops.
- **Done when**: Under reduced-motion, opacity/color transitions are preserved; only transform movement and infinite loops are disabled.
