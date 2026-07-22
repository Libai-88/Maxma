# 019 — Add vibrancy treatment to text on glass surfaces

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: MEDIUM
- **Category**: Materials & typography
- **Estimated scope**: 3-4 files, ~15 lines changed
- **Depends on**: Plan 010 (glass system must be active)

## Problem

Apple: "Over blurred/translucent surfaces, don't use flat gray text — use higher-contrast, slightly heavier weight, and a small letter-spacing bump. Put color on a solid layer, not the translucent foreground."

`glass.css:111-118` already defines vibrancy tokens:
```css
--glass-text-primary:   color-mix(in srgb, var(--text-primary) 95%, var(--bg-primary));
--glass-text-secondary: color-mix(in srgb, var(--text-secondary) 90%, var(--bg-primary));
```

But these are never applied (dead code until Plan 010 activates glass.css).

Live text on backdrop-filter containers has no vibrancy treatment:

| Surface | Text | Issue |
|---|---|---|
| `ContextMenu.vue:183-198` `.context-menu-item` | `font-size: 13px`, no `font-weight` (defaults 400), `color: var(--text-primary)` | Flat text over blur — no weight bump, no tracking bump |
| `MediaViewer.vue:175-206` `.mv-btn`, `.mv-counter` | No `font-weight` declared | Plain text over blur |
| `StickerPreviewOverlay.vue:185-210` | `color: #fff` / `rgba(255,255,255,0.78)` | Reasonable contrast, but no weight/tracking bump |
| `DsButton.vue` `.ds-btn--glass` | No `font-weight` override | Inherits base weight |

## Target

Apply vibrancy treatment to text on all glass surfaces:
1. Use `--glass-text-primary` / `--glass-text-secondary` colors (slightly boosted contrast)
2. Add `font-weight: 500` (one step up from default 400)
3. Add `letter-spacing: var(--tracking-caption)` (slight positive tracking for legibility)

## Repo conventions to follow

- Vibrancy tokens defined in `glass.css:111-118`.
- Tracking tokens from Plan 018: `--tracking-caption: 0.01em`.
- Apple's principle: "higher-contrast, slightly heavier weight, and a small letter-spacing bump."

## Steps

### After Plan 010 is done (glass.css imported):

1. **ContextMenu.vue** — Update `.context-menu-item` text:
   ```css
   .context-menu-item {
     /* existing styles */
     color: var(--glass-text-primary, var(--text-primary));
     font-weight: 500;  /* was default 400 */
     letter-spacing: var(--tracking-caption, 0.01em);
   }
   .context-menu-item .shortcut,
   .context-menu-item .label-secondary {
     color: var(--glass-text-secondary, var(--text-secondary));
   }
   ```

2. **MediaViewer.vue** — Update `.mv-btn` and `.mv-counter`:
   ```css
   .mv-btn, .mv-counter {
     color: var(--glass-text-primary, #fff);
     font-weight: 500;
     letter-spacing: var(--tracking-caption, 0.01em);
   }
   ```

3. **StickerPreviewOverlay.vue** — Update text on the blur surface:
   ```css
   .sticker-preview-overlay .nav-btn,
   .sticker-preview-overlay .counter {
     color: var(--glass-text-primary, rgba(255,255,255,0.95));
     font-weight: 500;
     letter-spacing: var(--tracking-caption, 0.01em);
   }
   ```

4. **DsButton.vue** — Update `.ds-btn--glass`:
   ```css
   .ds-btn--glass {
     color: var(--glass-text-primary, var(--text-primary));
     font-weight: 500;
     letter-spacing: var(--tracking-caption, 0.01em);
   }
   ```

5. **ChatHeader.vue** (if Plan 010 applied glass-panel to it) — Update header text:
   ```css
   .chat-header {
     /* text elements inside */
   }
   .chat-header .header-title {
     color: var(--glass-text-primary, var(--text-primary));
     font-weight: 600;  /* keep existing weight if already 600+ */
   }
   ```

## Boundaries

- Do NOT change text on opaque surfaces — vibrancy is only for text over `backdrop-filter`.
- Do NOT set `font-weight: 700` or higher — 500 is the "slight bump" Apple recommends.
- Do NOT change font-size — only color, weight, and tracking.
- If a text element already has `font-weight: 600` or higher, leave it — don't reduce to 500.
- Use fallback values in `var()` so the treatment degrades gracefully if glass tokens aren't loaded.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Open ContextMenu over a busy background (e.g., a message with images) — confirm text is clearly legible, slightly bolder than before.
  - Open MediaViewer — confirm control bar text is crisp over the image.
  - Toggle `prefers-reduced-transparency: reduce` — confirm text remains legible on the now-solid surface (the `--glass-text-*` tokens fall back to `--text-*` via `color-mix`).
- **Done when**: All text on glass surfaces uses vibrancy color tokens, `font-weight: 500`, and `--tracking-caption`; text is legible over blur.
