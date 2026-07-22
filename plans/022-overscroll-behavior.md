# 022 — Add `overscroll-behavior: contain` to all scroll containers

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: MEDIUM
- **Category**: Scroll
- **Estimated scope**: ~10 files, ~15 lines added

## Problem

Apple: "At an edge, resist progressively instead of stopping hard."

`overscroll-behavior` is only set on 5 elements (all modals/overlays): `AppSettingsMenu.vue:454`, `DsOverlay.vue:186`, `DsModal.vue:66,82`, `DsSelect.vue:501`. All use `contain` — correct.

But the main scroll containers have NO `overscroll-behavior`:

| Container | File:Line | Issue |
|---|---|---|
| Chat messages list | `ChatWindow.vue:682-691` (`.messages-list`) | No `overscroll-behavior` — scrolling to top/bottom propagates to the page |
| Session list | `SessionSidebar.vue` (scroll area) | Not set |
| Settings scroll area | Various views (`McpView`, `SkillsView`, `ProvidersView`, etc.) | Not set |
| Markdown editor preview | `MarkdownEditor.vue` | Not set |
| HtmlSandbox iframe container | `HtmlSandbox.vue` | Not set |

Without `overscroll-behavior: contain`, scrolling to the edge of a container propagates to the parent, causing the whole page to scroll/bounce on macOS.

## Target

Add `overscroll-behavior: contain` to all scroll containers. This traps scroll within the container — when the user reaches the edge, the scroll stops and doesn't propagate.

```css
.scroll-container {
  overflow-y: auto;
  overscroll-behavior: contain;
}
```

## Repo conventions to follow

- The 5 existing usages all use `overscroll-behavior: contain` — follow this pattern.
- Apply to any element with `overflow: auto` or `overflow-y: auto` that is a scroll container.
- Do NOT use `overscroll-behavior: none` — `contain` is better (it still allows the scroll to work, just doesn't propagate).

## Steps

1. **ChatWindow.vue** — Add to `.messages-list` (line ~682-691):
   ```css
   .messages-list {
     /* existing styles */
     overscroll-behavior: contain;
   }
   ```

2. **SessionSidebar.vue** — Find the scroll container (the element with `overflow-y: auto` in the session list). Add `overscroll-behavior: contain`.

3. **All settings views** — For each view with a scrollable content area, add `overscroll-behavior: contain`:
   - `McpView.vue` — main scroll area
   - `SkillsView.vue` — main scroll area
   - `ProvidersView.vue` — main scroll area
   - `MemoryView.vue` — main scroll area
   - `PrivacyView.vue` — main scroll area
   - `PathWhitelistView.vue` — main scroll area
   - `MetricsView.vue` — main scroll area
   - `KbView.vue` — main scroll area
   - `HooksView.vue` — main scroll area
   - `MaxmaBlockerView.vue` — main scroll area

4. **MarkdownEditor.vue** — Add to the preview pane scroll container.

5. **QuickChatApp.vue** — If it has a scroll container, add `overscroll-behavior: contain`.

6. **StickerPicker.vue** — The sticker grid scroll area should also get `overscroll-behavior: contain`.

## Boundaries

- Do NOT add `overscroll-behavior` to non-scroll elements (elements without `overflow: auto/scroll`).
- Do NOT use `overscroll-behavior: none` — `contain` is the correct value (allows scrolling, prevents propagation).
- Do NOT add it to `body` or `html` — the root scroller should use the default behavior.
- If a container already has `overscroll-behavior: contain`, skip it.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Scroll the chat to the very top and keep scrolling up — confirm the page doesn't bounce/scroll (on macOS, the whole window shouldn't rubber-band).
  - Scroll a settings view to the bottom and keep scrolling — confirm same.
  - Scroll the sticker picker to the edge — confirm same.
- **Done when**: All scroll containers have `overscroll-behavior: contain`; no scroll propagation to the page at container edges.
