# 016 — Remove dead `.sidebar` CSS block in App.vue

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: LOW
- **Category**: Cleanup
- **Estimated scope**: 1 file, ~200 lines removed

## Problem

`web/src/App.vue:300-547` contains ~200 lines of `.sidebar` CSS (including `.sidebar::before` blurred background image at lines 520-532 and `.sidebar::after` color wash at 534-541).

**No component uses the `class="sidebar"` selector.** Grep for `class="sidebar"` / `class="…sidebar…"` returns only:
- `pg-sidebar` in `PlaygroundView.vue:17` (different class)
- `session-sidebar` in `SessionSidebar.vue:2` (different class)

The current layout is `IconRail` + `SessionDrawer` + `main` — there is no `.sidebar` element. This entire CSS block is dead code from a previous layout.

Additionally, `web/src/themes/dawn.css:93-96` has a `.sidebar` rule with `backdrop-filter: blur(12px)` that is also dead.

## Target

Remove the dead `.sidebar` CSS block entirely from `App.vue` and the dead rule from `dawn.css`.

## Steps

1. **App.vue** — Delete lines 300-547 (the entire `.sidebar` and `.sidebar::*` block). Read the file first to confirm exact line ranges — the block may have shifted due to Phase 1 edits.

   Verify before deleting:
   - Grep `App.vue` for `class="sidebar"` — should return 0 matches in `<template>`.
   - Grep all `.vue` files for `class="[^"]*sidebar[^"]*"` — confirm no element uses the bare `sidebar` class (only `pg-sidebar`, `session-sidebar`).

2. **dawn.css** — Find the `[data-theme="dawn"] .sidebar` rule (line ~93-96). Delete it.

3. **Check for other references** — Grep all `.css` and `.vue` files for `.sidebar` (as a CSS selector, not `session-sidebar` or `pg-sidebar`). If any other file references `.sidebar`, evaluate whether it's also dead.

## Boundaries

- Do NOT delete `.session-sidebar`, `.pg-sidebar`, or any other `*-sidebar` class — only the bare `.sidebar`.
- Do NOT delete `.sidebar` rules that are inside `SessionSidebar.vue` or `PlaygroundView.vue` — those are scoped to their components and are live.
- If any `.sidebar` selector is used in JavaScript (e.g., `document.querySelector('.sidebar')`), do NOT delete — but grep suggests there are none.
- Read the file before deleting to confirm the exact line range — Phase 1 edits may have shifted line numbers.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Visual**: Open the app — confirm no visual change (the CSS was dead code, so nothing should change).
- **Grep**: `grep -r "\.sidebar[^-]" web/src/` — should return 0 matches (excluding `session-sidebar`, `pg-sidebar`).
- **Done when**: Dead `.sidebar` CSS removed from App.vue and dawn.css; no visual regression; build passes.
