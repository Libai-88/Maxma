# Blue Team Handoff

## Summary

Blue team (Warm Precision) design proposal complete.

## Files Created

1. **`review.md`** — Design proposal document with vision, inspirations, key changes, before/after comparison, and UX improvement analysis.
2. **`DESIGN.md`** — Complete updated design system document for the Warm Precision system.

## Files Modified (Project)

3. **`web/src/themes/warm-precision.css`** (NEW) — Warm Precision theme file. Warm cream canvas, terracotta accent, warm sand sidebar, warm-tinted shadows.
4. **`web/src/composables/useTheme.ts`** (MODIFIED) — Added `warm-precision` to `ThemeId` type and `THEMES` array. Changed `DEFAULT_THEME` from `warm-paper` to `warm-precision`.
5. **`DESIGN.md`** (REPLACED) — Root project DESIGN.md fully rewritten to describe the Warm Precision design system.

## Design Inspirations Used

- **Claude** (warm cream canvas, terracotta accent, scarce-accent principle)
- **Notion** (serif display headings, warm minimalism, tinted surface hierarchy)
- **Linear** (four-step surface ladder, precision hairline borders, compact component spec)
- **Ollama** (monochrome discipline, pill badges, spare use of color)

## Key Design Changes

- Warm cream (`#fcf9f5`) replaces pure white (`#ffffff`) as the main background
- Terracotta (`#c17a5c`) replaces black (`#000000`) as the accent color
- Serif display headings (EB Garamond / Noto Serif SC) for view headers and section labels
- Four-step surface ladder (cream → sand → card → raised) for depth hierarchy
- Warm-tinted shadows (brown-black falloff) replacing pure black shadows
- Warm-tinted status colors (desaturated to match the palette)
- Paper texture overlay on sidebar

## Technical Notes

- All changes are CSS-only — no component restructuring needed
- The existing 11-theme system is fully preserved; only the default theme changes
- Serif fonts (EB Garamond, Noto Serif SC) were already loaded in index.html but not used in DESIGN.md — the proposal activates them correctly
- The `--font-serif` and `--font-display` variables already existed in `tokens.css` — no tokens.css changes were needed
- The `warm-precision` theme is now registered as the new default in `useTheme.ts`

## To apply this design

The theme is live as soon as the app is rebuilt — `:root` without `[data-theme]` now picks up `warm-precision` defaults. Users can still switch back to any existing theme via the ThemePicker.
