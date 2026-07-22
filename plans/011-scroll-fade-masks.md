# 011 — Replace hard 1px dividers with scroll-fade masks

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: CRITICAL
- **Category**: Materials & depth
- **Estimated scope**: 3-4 files, ~30 lines changed

## Problem

Apple: "Instead of a 1px border under a sticky header, fade a small blur/gradient mask where content meets floating chrome — only where floating UI actually overlaps content."

The codebase has 80+ hard `1px solid var(--border)` dividers. The most visible violations are on chrome that should float over scrolling content:

```css
/* web/src/components/ChatHeader.vue:28 — hard border under header */
border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);

/* web/src/components/IconRail.vue:93 — hard border on right edge */
border-right: 1px solid var(--border);

/* web/src/components/SessionDrawer.vue:196 — hard border on right edge */
border-right: 1px solid var(--border);

/* web/src/components/SessionDrawer.vue:209 — hard border under drawer header */
border-bottom: 1px solid var(--border);
```

Zero `mask-image` usage anywhere in the codebase.

## Target

Replace hard dividers on floating chrome with **scroll-fade gradient masks** — a subtle gradient that fades content out as it approaches the chrome edge, creating a soft boundary instead of a hard line.

For the **ChatHeader bottom edge** (content scrolls under it):
```css
.chat-header {
  /* Remove: border-bottom: 1px solid ... */
  /* Add: mask on the scroll container, OR a gradient overlay on the header */
}

/* Option A: Gradient overlay on header bottom edge */
.chat-header::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 0;
  right: 0;
  height: 8px;
  background: linear-gradient(to bottom, var(--bg-primary) 0%, transparent 100%);
  pointer-events: none;
  z-index: 9;
}

/* Option B: mask-image on the scroll container top edge */
.messages-list {
  mask-image: linear-gradient(to bottom,
    transparent 0px,
    black 8px,
    black calc(100% - 8px),
    transparent 100%
  );
}
```

For **IconRail and SessionDrawer right edges** (structural dividers between panels):
- These are between two non-scrolling panels, so a scroll-fade mask doesn't apply.
- Instead, use a **subtle gradient shadow** instead of a hard border:
```css
.icon-rail {
  /* Remove: border-right: 1px solid var(--border) */
  box-shadow: 1px 0 0 0 color-mix(in srgb, var(--border) 50%, transparent);
  /* OR a softer gradient: */
  box-shadow: inset -1px 0 2px color-mix(in srgb, var(--shadow-color, rgba(0,0,0,0.08)) 40%, transparent);
}
```

## Repo conventions to follow

- This plan pairs with Plan 010 (glass system). If glass surfaces are active, the header/drawer are translucent — the fade mask should use `var(--bg-primary)` or a semi-transparent variant.
- If Plan 010 is NOT done yet, use `var(--bg-primary)` for the gradient color. If Plan 010 IS done, use `color-mix(in srgb, var(--bg-primary) 60%, transparent)` so the fade works over glass.
- `mask-image` requires `-webkit-mask-image` prefix for Safari/WebKit (Tauri uses WebView2 on Windows, but the codebase supports browser access too).

## Steps

1. **ChatHeader.vue** — Replace `border-bottom` with a gradient fade:
   - Remove `border-bottom: 1px solid color-mix(...)` from `.chat-header` (line ~28).
   - Add a `::after` pseudo-element (or a dedicated div) that creates an 8px gradient fade at the bottom of the header.
   - The gradient goes from `var(--bg-primary)` (opaque, at the top of the fade) to `transparent` (at the bottom).
   - `pointer-events: none` so it doesn't block clicks.
   - If the header is `position: sticky` (from Plan 010), the `::after` should be `position: absolute; bottom: -8px`.

2. **IconRail.vue** — Replace `border-right` with a soft shadow:
   - Remove `border-right: 1px solid var(--border)` from `.icon-rail` (line ~93).
   - Add `box-shadow: inset -1px 0 0 color-mix(in srgb, var(--border) 50%, transparent)` — a softer, 50%-opacity inset shadow that reads as a gentle boundary.
   - If Plan 010 is done (glass surface), this shadow may not be needed at all — the blur difference between glass and opaque content creates a natural boundary. Test and remove if unnecessary.

3. **SessionDrawer.vue** — Same treatment as IconRail:
   - Remove `border-right: 1px solid var(--border)` from `.session-drawer` (line ~196).
   - Add the same inset shadow OR remove entirely if glass surface provides enough separation.
   - For `.session-drawer__header` `border-bottom` (line ~209) — replace with the same gradient fade approach as ChatHeader.

4. **ChatWindow.vue messages-list** — Optionally add a `mask-image` to the scroll container for top/bottom fade:
   ```css
   .messages-list {
     -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 12px, black calc(100% - 12px), transparent 100%);
     mask-image: linear-gradient(to bottom, transparent 0, black 12px, black calc(100% - 12px), transparent 100%);
   }
   ```
   This fades messages at the top and bottom edges of the scroll area. Skip if it causes performance issues or visual artifacts with virtual scrolling.

## Boundaries

- Do NOT remove borders that are NOT on floating chrome (e.g., card borders, input borders, modal borders) — only chrome edges where content scrolls past.
- Do NOT remove the `border-bottom` on `.session-drawer__header` if it's not adjacent to scrolling content — only replace if content scrolls under it.
- Test with `vue-virtual-scroller` — `mask-image` on the scroll container can sometimes interfere with virtual scroll rendering. If so, use the `::after` gradient approach on the header instead.
- Do NOT use `mask-image` on non-scroll containers.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Scroll the chat — confirm messages fade softly at the header edge instead of hitting a hard line.
  - Confirm the IconRail/SessionDrawer boundaries look soft, not hard.
  - In slow scroll, confirm no content is clipped by the fade — the fade should only affect the very edge (8-12px).
  - Test with multiple themes — the fade color should adapt.
- **Done when**: ChatHeader has no hard border-bottom; IconRail/SessionDrawer have no hard border-right; content fades softly at chrome boundaries.
