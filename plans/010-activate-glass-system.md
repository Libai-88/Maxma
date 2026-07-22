# 010 — Activate the dormant `glass.css` material system

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: CRITICAL
- **Category**: Materials
- **Estimated scope**: 4 files, ~20 lines changed

## Problem

`web/src/assets/styles/glass.css` contains a complete Apple-style glass material system — weight hierarchy (`.glass-subtle` 8px, `.glass-panel` 24px, `.glass-drawer` 28px, `.glass-strong` 32px), materialize animation (`maxma-glass-materialize`), vibrancy tokens, and `prefers-reduced-transparency` support.

**It is never imported.** Grep for `glass.css` in imports returns zero matches outside the file itself. All 4 glass classes (`.glass-panel`, `.glass-strong`, `.glass-subtle`, `.glass-drawer`) appear only inside `glass.css`. The entire file is dead code.

The live application uses opaque surfaces everywhere:
- `ChatHeader.vue:28` — `background: color-mix(... 86%, transparent)` but NO `backdrop-filter`
- `IconRail.vue:92` — `background: var(--bg-secondary)` (fully opaque)
- `SessionDrawer.vue:198` — `background: color-mix(... 92%, ...)` (opaque blend, no blur)
- Content does NOT scroll under chrome — `ChatView.vue:48-118` uses flex column layout where header occupies its own space.

## Target

1. Import `glass.css` globally.
2. Apply glass classes to the three main chrome surfaces, making content scroll *under* translucent bars.

### Layout change required

Currently `ChatView.vue` is a flex column: `ChatHeader` (static) → `ChatWindow` (scroll) → `ChatInput` (static). To make content scroll under the header, the header must become `position: sticky` or `position: absolute` overlaying the scroll container.

**Recommended approach (least disruptive):**
- Make `.chat-header` `position: sticky; top: 0; z-index: 10` within the `.chat-view` flex column.
- Apply `.glass-panel` class to `.chat-header` — gives it `backdrop-filter: blur(24px)` + semi-transparent background.
- The `ChatWindow` scroll container already sits below the header in flex flow; with `sticky`, the header stays pinned while messages scroll under it.
- Apply `.glass-strong` to `IconRail` (structural sidebar — heaviest material).
- Apply `.glass-drawer` to `SessionDrawer` (drawer — medium-heavy).

## Repo conventions to follow

- `glass.css` is at `web/src/assets/styles/glass.css`.
- Global CSS imports live in `web/src/App.vue` `<style>` block (lines 156-172) — add the import there.
- Token system: `glass.css` uses `--glass-blur`, `--glass-bg`, `--glass-border`, `--glass-text-primary`, `--glass-text-secondary` — all defined with fallbacks inside `glass.css` itself.
- Theme overrides: each theme file in `web/src/themes/*.css` can override `--glass-blur` / `--glass-bg` per-theme.
- `prefers-reduced-transparency: reduce` is already handled in `glass.css:97-109` — glass classes fall back to solid `var(--bg-primary)`.

## Steps

1. **Import glass.css** — In `web/src/App.vue`, add to the `<style>` block import list (around line 156-172):
   ```css
   @import '@/assets/styles/glass.css';
   ```

2. **ChatHeader.vue** — Apply glass material:
   - Add `class="chat-header glass-panel"` to the header element (or add `.glass-panel` to existing class list).
   - Change `position` to `sticky; top: 0; z-index: 10`.
   - Remove the existing `background: color-mix(...)` and `border-bottom: 1px solid ...` — `.glass-panel` provides the background. The border-bottom is replaced by Plan 011's scroll-fade mask.
   - Keep `box-shadow: var(--shadow-xs)` if desired for subtle depth.

3. **IconRail.vue** — Apply glass material:
   - Add `class="icon-rail glass-strong"` to the rail element.
   - Remove existing `background: var(--bg-secondary)` and `border-right: 1px solid var(--border)`.
   - `.glass-strong` provides 32px blur + 88% fill — appropriate for structural sidebar.

4. **SessionDrawer.vue** — Apply glass material:
   - Add `class="session-drawer glass-drawer"` to the drawer element.
   - Remove existing `background: color-mix(...)` and `border-right: 1px solid var(--border)`.
   - `.glass-drawer` provides 28px blur + 82% fill.

5. **Verify content scrolls under header** — In `ChatView.vue`, ensure `.chat-view` has `overflow: hidden` (it already does) and `.chat-window` / `.messages-list` is the scroll container. With `position: sticky` on the header, messages will visually scroll under the translucent header.

## Boundaries

- Do NOT modify `glass.css` itself — it's already correctly designed.
- Do NOT apply glass classes to `ChatInput` — it should remain an opaque card (it's a functional input area, not chrome).
- Do NOT apply glass to `DsModal` — modals are exempt (centered, opaque surface with scrim).
- Do NOT change the flex layout structure of `ChatView.vue` — only make the header `sticky`.
- If making the header `sticky` causes layout issues (e.g., the header disappears on scroll), fall back to `position: absolute; top: 0; left: 0; right: 0` with the scroll container getting `padding-top` equal to header height.
- Test with multiple themes — each theme should look correct with glass surfaces.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Open the chat view — confirm the header is translucent and messages scroll *under* it (you can see message text faintly behind the header blur).
  - Confirm the IconRail (left icon strip) is translucent — desktop wallpaper or app background should show through faintly.
  - Confirm the SessionDrawer is translucent.
  - Switch themes — confirm glass surfaces look correct in all themes.
  - In DevTools Rendering panel, toggle `prefers-reduced-transparency: reduce` — confirm glass surfaces become solid (no blur).
  - Confirm no legibility issues — text on glass surfaces should be clearly readable (Plan 019 handles vibrancy if needed).
- **Done when**: glass.css is imported; ChatHeader/IconRail/SessionDrawer use glass classes; content scrolls under translucent header; reduced-transparency fallback works.
