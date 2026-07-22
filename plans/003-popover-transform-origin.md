# 003 — Add origin-aware `transform-origin` to popovers/dropdowns

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Physicality & origin
- **Estimated scope**: 6 files, ~15 lines added

## Problem

8 popover/dropdown/menu components scale from default `transform-origin: center` instead of from their trigger. The codebase already has `web/src/utils/floatingPosition.ts` that computes dynamic origin, but only `ChatInput.vue` uses it.

Missing `transform-origin`:
```css
/* web/src/components/ui/DsTooltip.vue:109-143 — scale(0.97) enter, no transform-origin */
/* web/src/components/ui/DsSelect.vue:547-570 — translateY(-4px) enter, no transform-origin */
/* web/src/components/StickerPicker.vue — display: flex/none toggle, no animation */
/* web/src/components/AutocompletePanel.vue — v-if, no transition, no transform-origin */
/* web/src/views/ChatView.vue:671-690 — .session-actions-menu v-if, no transition */
/* web/src/components/StickerContextMenu.vue:161-180 — v-if, no transition */
/* web/src/components/SessionSidebar.vue:903 — .constify-pop translateX(-6px) scale(0.96), no transform-origin */
```

## Target

Popovers should scale from their trigger. For fixed-anchor popovers, set static `transform-origin` matching the anchor position. For dynamic-position popovers, use `floatingPosition.ts`.

```css
/* target for DsTooltip (anchored below trigger, centered) */
.ds-tooltip {
  transform-origin: top center;
  /* existing transition/transform rules unchanged */
}

/* target for DsSelect (anchored below trigger) */
.ds-select-panel {
  transform-origin: top center;
}

/* target for ChatView .session-actions-menu (anchored below-right of trigger) */
.session-actions-menu {
  transform-origin: top right;
}
```

## Repo conventions to follow

- `floatingPosition.ts` at `web/src/utils/floatingPosition.ts:42-63` computes origin dynamically — used by `ChatInput.vue:299`.
- Static origins already used: `AppSettingsMenu.vue:455` (`top right`), `ContextMenu.vue:171` (`top left`).
- Modals are exempt — `DsModal.vue` correctly keeps default center.

## Steps

1. **DsTooltip.vue** — Add `transform-origin: top center;` to `.ds-tooltip` (around line 109). Tooltip appears below trigger by default.

2. **DsSelect.vue** — Add `transform-origin: top center;` to the dropdown panel element (around line 547). Select dropdown appears below trigger.

3. **ChatView.vue** — Add to `.session-actions-menu` (around line 671):
   ```css
   transform-origin: top right;
   ```
   This menu opens below-right of the "..." button.

4. **StickerContextMenu.vue** — Add to `.sticker-context-menu` (around line 161):
   ```css
   transform-origin: top left;
   ```
   Context menu opens at cursor position — top left is the closest static approximation.

5. **SessionSidebar.vue** — Add to the `.constify-pop` transition element (around line 903):
   ```css
   transform-origin: left center;
   ```
   The constify card slides from the left side of the session item.

6. **StickerPicker.vue + AutocompletePanel.vue** — These have no enter animation at all. Add a minimal transition:
   ```css
   /* StickerPicker panel */
   .sticker-picker-panel {
     transform-origin: bottom center;
     transition: opacity var(--duration-fast) var(--ease-out),
                 transform var(--duration-fast) var(--ease-out);
   }
   ```
   (StickerPicker opens above the input; AutocompletePanel opens below — use `top center` for AutocompletePanel.)
   NOTE: These require adding a Vue `<Transition>` wrapper in the template. If the template change is too invasive, skip and leave as v-if (lower priority than the others).

## Boundaries

- Do NOT touch `AppSettingsMenu.vue` or `ContextMenu.vue` — they already have correct static origins.
- Do NOT touch `DsModal.vue` — modals are exempt (center is correct).
- Do NOT touch `MediaViewer.vue` — `transform-origin: center center` is correct for image zoom.
- Do NOT modify `floatingPosition.ts` itself.
- If adding a `<Transition>` wrapper to StickerPicker/AutocompletePanel requires significant template restructuring, skip those two and note in the PR.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Open DsTooltip — confirm it scales from the top (trigger side), not from center.
  - Open DsSelect — confirm dropdown scales from top center.
  - Open ChatView session-actions-menu — confirm it scales from top right (where the "..." button is).
  - Open StickerContextMenu — confirm it scales from top left (cursor position).
  - In DevTools Animations panel, slow to 10% and confirm origin direction.
- **Done when**: All 6 components scale from their trigger anchor, not from center.
