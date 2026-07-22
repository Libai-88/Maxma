# 013 — Honor `prefers-reduced-transparency` on all backdrop-filter surfaces

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 6 files, ~30 lines added

## Problem

Apple: "Under `prefers-reduced-transparency: reduce`, make translucent surfaces frostier/solid: raise background opacity, drop the blur."

`prefers-reduced-transparency` is handled in exactly ONE place: `glass.css:97-109` (which is dead code — see Plan 010). All 6 live `backdrop-filter` surfaces ignore this preference:

| File:Line | Element | backdrop-filter |
|---|---|---|
| `ContextMenu.vue:163` | `.context-menu` | `blur(12px) saturate(1.2)` |
| `DsOverlay.vue:198` | `.ds-overlay--blur` | `blur(8px)` |
| `DsButton.vue:98` | `.ds-btn--glass` | `blur(12px) saturate(1.3)` |
| `MediaViewer.vue:166` | `.mv-controls` | `blur(12px)` |
| `StickerPreviewOverlay.vue:156,245` | overlay + nav | `blur(10px)`, `blur(8px)` |
| `LeavesOverlay.vue:143` | `.leaves-toggle` | `blur(4px)` |

Users who set `prefers-reduced-transparency: reduce` (common on macOS Accessibility) see translucent surfaces that should be solid.

## Target

Add a global `@media (prefers-reduced-transparency: reduce)` block that disables all `backdrop-filter` and raises background opacity to solid:

```css
/* In a globally-imported CSS file (e.g., animations.css or a new a11y.css) */
@media (prefers-reduced-transparency: reduce) {
  *, *::before, *::after {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  /* Surfaces that relied on translucency need solid backgrounds */
  .context-menu,
  .ds-overlay--blur,
  .ds-btn--glass,
  .mv-controls,
  .sticker-preview-overlay,
  .leaves-toggle {
    background: var(--bg-primary) !important;
  }
}
```

## Repo conventions to follow

- Global accessibility overrides live in `web/src/assets/styles/animations.css` (where `prefers-reduced-motion` is handled).
- The `glass.css:97-109` block already demonstrates the pattern — replicate it for live surfaces.
- Use `!important` sparingly — this is an accessibility override, so it's justified.

## Steps

1. **Add global override** — In `web/src/assets/styles/animations.css`, add a new block at the end:
   ```css
   /* prefers-reduced-transparency: make all translucent surfaces solid */
   @media (prefers-reduced-transparency: reduce) {
     *,
     *::before,
     *::after {
       backdrop-filter: none !important;
       -webkit-backdrop-filter: none !important;
     }
   }
   ```

2. **Add solid background fallbacks** — For each surface that relied on `backdrop-filter` for its background, ensure it has a solid fallback. Most already have a semi-transparent `background` that becomes hard to read without blur. Add explicit overrides:
   ```css
   @media (prefers-reduced-transparency: reduce) {
     .context-menu { background: var(--bg-card) !important; }
     .mv-controls { background: var(--bg-card) !important; }
     .sticker-preview-overlay { background: var(--bg-overlay, rgba(0,0,0,0.8)) !important; }
     .leaves-toggle { background: var(--bg-card) !important; }
     /* DsOverlay--blur and DsButton--glass already have fallback backgrounds in their styles */
   }
   ```

3. **If Plan 010 is done** (glass.css activated) — the `.glass-*` classes already handle this in `glass.css:97-109`. Just verify it works after import.

4. **Test each surface** — Toggle `prefers-reduced-transparency: reduce` in DevTools and verify each surface becomes solid and legible.

## Boundaries

- Do NOT remove `backdrop-filter` from the base styles — only override under the media query.
- Do NOT change the visual appearance under normal (no-preference) conditions.
- Do NOT forget `-webkit-backdrop-filter` — Tauri on some platforms uses WebKit.
- If a surface already has a solid `background` fallback that's legible without blur, no extra override is needed for that surface.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - In DevTools Rendering panel, toggle `prefers-reduced-transparency: reduce`.
  - Open ContextMenu — confirm it has a solid background (no blur).
  - Open MediaViewer controls — confirm solid.
  - Open StickerPreviewOverlay — confirm solid backdrop.
  - Confirm all text is legible on the now-solid surfaces.
  - Toggle back to normal — confirm translucency returns.
- **Done when**: All 6 backdrop-filter surfaces become solid under `prefers-reduced-transparency: reduce`; text remains legible.
