# 017 — Enable `font-optical-sizing: auto` globally

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Typography
- **Estimated scope**: 1 file, 1 line added

## Problem

Apple (WWDC 2020 "The Details of UI Typography"): "Use `font-optical-sizing: auto` so the font's optical size variants activate automatically at different sizes."

The codebase uses variable fonts that ship optical sizes:
- `Fraunces` (display art) — has optical sizing
- `EB Garamond` (serif) — has optical sizing

`font-optical-sizing` has **zero usages** across all `.vue` and `.css` files. The fonts' optical size features are dormant — large headings and small captions use the same glyph shapes instead of the optimized variants.

## Target

Add `font-optical-sizing: auto` to the global root selector:

```css
/* In web/src/assets/styles/tokens.css or App.vue global style */
:root {
  font-optical-sizing: auto;
}
```

Or add to the existing `html` / `body` rule:
```css
html {
  font-optical-sizing: auto;
}
```

## Repo conventions to follow

- Global font properties are set in `web/src/assets/styles/tokens.css:59-64` (font family tokens) and applied in `App.vue` or `design-system.css`.
- `font-optical-sizing` is inherited, so setting it on `:root` or `html` applies everywhere.
- The browser default is actually `auto` per spec, but **explicitly setting it ensures consistency** across all browsers and prevents any future reset from overriding it.

## Steps

1. Open `web/src/assets/styles/tokens.css`.
2. Find the `:root` block (starts around line 1).
3. Add `font-optical-sizing: auto;` to the `:root` block.
4. Save.

Alternatively, if `tokens.css` doesn't have a `:root` block that's appropriate, add it to `web/src/App.vue`'s global `<style>` block on the `html` selector.

## Boundaries

- Do NOT set `font-optical-sizing` on individual elements — it's inherited, one global declaration is enough.
- Do NOT change font-family, font-weight, or any other typography property.
- Do NOT set `font-optical-sizing: none` anywhere (unless a specific use case requires disabling optical sizing — none found in audit).

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Compare a large heading (e.g., WelcomeScreen name, NotFound 404) before and after — optical sizing should make the glyphs slightly more refined at large sizes (tighter strokes, better contrast).
  - Compare small text (e.g., captions, labels) — optical sizing should make glyphs slightly more open/legible at small sizes.
  - The change is subtle — if you can't see a difference, the font may not have dramatic optical size variants, but the setting is still correct.
- **Done when**: `font-optical-sizing: auto` is set globally; build passes.
