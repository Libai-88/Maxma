# 005 — Consolidate bare `ease` to motion tokens

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Easing & cohesion
- **Estimated scope**: ~27 files, ~69 transition declarations

## Problem

69 transition declarations across 27 files use the bare `ease` keyword instead of the project's motion tokens. The built-in `ease` (equivalent to `cubic-bezier(0.25, 0.1, 0.25, 1)`) is too weak for UI animations — it lacks the deceleration curve that makes interfaces feel responsive.

Top offenders:
```css
/* web/src/App.vue:316 — sidebar collapse enter/exit */
transition: opacity 0.2s ease 0.05s, transform 0.25s ease 0.05s;

/* web/src/App.vue:340 — logo hover */
transition: transform 0.3s ease, box-shadow 0.3s ease;

/* web/src/components/SessionSidebar.vue:541 — sidebar section header */
transition: opacity 0.2s ease 0.05s, transform 0.25s ease 0.05s;

/* web/src/components/ToolCallCard.vue:383 — tool card hover */
transition: transform 0.15s ease, box-shadow 0.15s ease;

/* web/src/components/MediaViewer.vue:167 — controls show/hide */
transition: opacity 0.3s ease, transform 0.3s ease;

/* web/src/components/workbench/WorkbenchPanel.vue:294 — panel transition */
transition: transform 0.24s ease;
```

App.vue alone has 14 occurrences.

## Target

Replace bare `ease` with the appropriate token based on animation purpose:

| Purpose | Current | Target token | Value |
|---|---|---|---|
| Enter/exit (opacity + transform) | `ease` | `var(--ease-out)` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Viewport movement (panels sliding) | `ease` | `var(--ease-standard)` | `cubic-bezier(0.77, 0, 0.175, 1)` |
| Hover/color/box-shadow | `ease` | `var(--ease-smooth)` or keep `ease` | `cubic-bezier(0.22, 0.68, 0, 1)` |
| Drawer/bottom-sheet | `ease` | `var(--ease-drawer)` | `cubic-bezier(0.32, 0.72, 0, 1)` |

Also replace hardcoded durations with tokens where applicable:
- `0.15s` → `var(--duration-fast)`
- `0.2s`/`0.25s` → `var(--duration-fast)` or `var(--duration-slow)` (0.25s)
- `0.3s` → `var(--duration-slow)` (0.25s) or keep 0.3s if modal/large block

## Repo conventions to follow

- Tokens defined in `web/src/assets/styles/tokens.css:32-49`.
- `Ds*` components already follow tokens correctly — they're the exemplar.
- `design-system.css:37-41` uses `var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1))` with fallback.

## Steps

Work file-by-file. For each file:

1. Grep for `ease` (not inside `var(--ease-`, not `ease-in`, not `ease-out` as standalone token, not `ease-in-out` on infinite loops).
2. Classify each match:
   - **Enter/exit** (opacity + transform together, or v-show/v-if transitions) → `var(--ease-out)`
   - **Panel/sidebar movement** (transform only, large blocks) → `var(--ease-standard)`
   - **Hover/color/box-shadow** → `var(--ease-smooth)` (or keep `ease` — acceptable per standard)
   - **Drawer/sheet** → `var(--ease-drawer)`
3. Replace the easing function. Keep duration as-is unless it's a bare `0.15s`/`0.2s`/`0.25s` that matches a token exactly.

Priority files (by count):
1. `App.vue` (14 occurrences)
2. `SessionSidebar.vue` (6)
3. `SessionItem.vue` (4)
4. `ToolCallCard.vue` (4)
5. `MediaViewer.vue` (3)
6. `StickerPicker.vue` (2-3)
7. `McpView.vue` (2-3)
8. `ProvidersView.vue` (2-3)
9. `IconRail.vue` (2-3)
10. `WorkbenchPanel.vue` (2-3)
11. All remaining files with 1-2 occurrences

## Boundaries

- Do NOT replace `ease` on hover/color-only transitions — `ease` is acceptable there per standard. Only replace when the transition includes `transform` or `opacity`.
- Do NOT touch `ease-in-out` on infinite-loop animations (skeletons, ambient) — those are correct.
- Do NOT touch `linear` on spinners/progress bars — those are correct.
- Do NOT touch `--ease-in` token definition in `tokens.css`.
- Do NOT change durations unless they exactly match a token value (avoid introducing regressions).
- Do NOT touch `Ds*` components — they already use tokens.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Spot check**: Grep for bare `ease` (excluding `var(--ease`, `ease-in`, `ease-out`, `ease-in-out`) — count should drop from 69 to <10 (only hover/color transitions remaining).
- **Feel check**:
  - Collapse/expand the sidebar — confirm the collapse animation has a stronger deceleration curve.
  - Hover the logo — confirm the transform feels snappier.
  - Open MediaViewer controls — confirm fade feels smoother.
- **Done when**: All `transform`/`opacity` transitions use `var(--ease-*)` tokens; only hover/color transitions retain bare `ease`.
