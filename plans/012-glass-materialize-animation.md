# 012 — Add materialize animation (blur + scale) to glass surfaces

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Materials
- **Estimated scope**: 3-4 files, ~40 lines changed

## Problem

Apple: "For glass/blur surfaces, animate blur radius and scale together on enter/exit, so the surface reads as a real material arriving rather than a plain opacity fade."

`glass.css:20-33` already defines the correct keyframe:
```css
@keyframes maxma-glass-materialize {
  from {
    opacity: 0;
    transform: scale(0.98);
    backdrop-filter: blur(0px) saturate(1);
  }
  to {
    opacity: 1;
    transform: scale(1);
    backdrop-filter: var(--glass-blur, blur(24px) saturate(1.25));
  }
}
```

But it's bound only to the unused `.glass-*` classes. Live translucent surfaces pop in with only opacity fade:

| Component | Current enter animation | Problem |
|---|---|---|
| `ContextMenu.vue:212-225` | `transition: opacity 0.06s, transform 0.06s` + `scale(0.92)` | Blur snaps instantly — no materialize |
| `StickerPreviewOverlay.vue` | fade only | Blur snaps |
| `MediaViewer.vue` controls | fade only | Blur snaps |
| `DsOverlay.vue:198-206` | `@starting-style { backdrop-filter: blur(0px) }` | **Correct** — the only one doing it right |

## Target

All translucent surfaces should animate `backdrop-filter` (blur radius) alongside `opacity` + `transform` on enter/exit. Use the `@starting-style` approach (like `DsOverlay`) for elements that appear via `v-if`, and the `maxma-glass-materialize` keyframe for elements that appear via class toggling.

### Pattern A: `@starting-style` (for v-if elements)
```css
.glass-surface {
  opacity: 1;
  transform: scale(1);
  backdrop-filter: blur(24px) saturate(1.25);
  transition: opacity 200ms var(--ease-out),
              transform 200ms var(--ease-out),
              backdrop-filter 200ms var(--ease-out);

  @starting-style {
    opacity: 0;
    transform: scale(0.96);
    backdrop-filter: blur(0px) saturate(1);
  }
}
```

### Pattern B: Vue `<Transition>` (for components using transition wrappers)
```css
.glass-enter-active {
  transition: opacity var(--duration-slow) var(--ease-out),
              transform var(--duration-slow) var(--ease-out),
              backdrop-filter var(--duration-slow) var(--ease-out);
}
.glass-enter-from {
  opacity: 0;
  transform: scale(0.96);
  backdrop-filter: blur(0px) saturate(1);
}
```

## Repo conventions to follow

- `glass.css` already defines `maxma-glass-materialize` — reuse it where possible.
- `DsOverlay.vue:198-206` is the exemplar — uses `@starting-style` correctly.
- Tokens: `--duration-slow` (0.25s), `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)`.
- `prefers-reduced-motion: reduce` — under reduced motion, skip the blur animation and just fade opacity (blur animation can cause jank).

## Steps

1. **ContextMenu.vue** — Replace the enter transition (lines ~212-225):
   - Current: `transition: opacity 0.06s, transform 0.06s` + `scale(0.92)`
   - Change to: add `backdrop-filter` to the transition, start from `blur(0px)`:
   ```css
   .context-menu {
     /* ... existing styles ... */
     opacity: 1;
     transform: scale(1);
     backdrop-filter: blur(12px) saturate(1.2);
     transition: opacity 150ms var(--ease-out),
                 transform 150ms var(--ease-out),
                 backdrop-filter 150ms var(--ease-out);
     @starting-style {
       opacity: 0;
       transform: scale(0.92);
       backdrop-filter: blur(0px) saturate(1);
     }
   }
   ```
   - Also fix the `-webkit-backdrop-filter: blur(16px)` → `blur(12px)` mismatch (Plan 014).

2. **StickerPreviewOverlay.vue** — Add materialize to the overlay enter:
   - The overlay uses `<Transition>` (from Plan 004). Add `backdrop-filter` to the transition:
   ```css
   .preview-fade-enter-active {
     transition: opacity var(--duration-slow) var(--ease-out),
                 backdrop-filter var(--duration-slow) var(--ease-out);
   }
   .preview-fade-enter-from {
     opacity: 0;
     backdrop-filter: blur(0px);
   }
   ```

3. **MediaViewer.vue controls** — Add materialize to `.mv-controls`:
   - The controls bar fades in/out. Add blur animation:
   ```css
   .mv-controls {
     backdrop-filter: blur(12px) saturate(1.2);
     transition: opacity 200ms var(--ease-out),
                 backdrop-filter 200ms var(--ease-out);
   }
   .mv-controls.hidden {
     opacity: 0;
     backdrop-filter: blur(0px);
     pointer-events: none;
   }
   ```

4. **ChatHeader / IconRail / SessionDrawer** (if Plan 010 is done) — These are persistent chrome, not enter/exit surfaces. They don't need materialize animation. Skip.

5. **Add reduced-motion fallback** — In `animations.css` or component-scoped:
   ```css
   @media (prefers-reduced-motion: reduce) {
     .context-menu, .mv-controls {
       transition: opacity 200ms ease;
       /* Skip backdrop-filter animation under reduced motion */
     }
   }
   ```

## Boundaries

- Do NOT animate `backdrop-filter` on persistent chrome (header, sidebar) — they don't enter/exit.
- Do NOT add materialize to `DsOverlay` — it already does it correctly.
- Do NOT use `@starting-style` on elements that use Vue `<Transition>` — use the transition class approach instead.
- Test performance — `backdrop-filter` animation can be expensive on low-end hardware. If jank is observed, reduce the animation duration or fall back to opacity-only.
- `-webkit-backdrop-filter` must be animated alongside standard `backdrop-filter` for Safari compatibility.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Right-click to open ContextMenu — confirm the blur "materializes" (starts sharp, blurs in) rather than snapping.
  - Open StickerPreviewOverlay — confirm the backdrop blur animates in.
  - Open MediaViewer, hover to show controls — confirm the controls bar blur animates.
  - Toggle `prefers-reduced-motion: reduce` — confirm blur animation is skipped, opacity-only fade remains.
- **Done when**: ContextMenu, StickerPreviewOverlay, and MediaViewer controls all animate blur radius on enter; reduced-motion falls back to opacity-only.
