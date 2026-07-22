# 015 — Consolidate ad-hoc shadows to `--shadow-*` tokens

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 4 files, 4 lines changed

## Problem

The codebase has a well-designed shadow token system (`tokens.css:77-81`: `--shadow-xs` through `--shadow-xl`), but ~6 components use hardcoded shadow values that bypass the tokens:

| File:Line | Current value | Should be |
|---|---|---|
| `McpView.vue:1431` | `0 2px 12px rgba(0,0,0,0.15)` | `var(--shadow-md)` |
| `SkillsView.vue:825` | `0 2px 12px rgba(0,0,0,0.15)` | `var(--shadow-md)` |
| `SkillsView.vue:874` | `0 8px 32px rgba(0,0,0,0.2)` | `var(--shadow-xl)` |
| `StickerPreviewOverlay.vue:166` | `0 30px 80px rgba(0,0,0,0.38)` | Keep (special case — fullscreen viewer needs deeper shadow than token scale provides) |

## Target

Replace hardcoded shadows with the matching token. The token system is theme-aware (each theme overrides `--shadow-color`), so using tokens ensures shadows adapt to light/dark themes.

| Hardcoded | Token equivalent | Geometry match |
|---|---|---|
| `0 2px 12px rgba(0,0,0,0.15)` | `var(--shadow-md)` | `0 2px 8px` — close enough; token is slightly tighter |
| `0 8px 32px rgba(0,0,0,0.2)` | `var(--shadow-xl)` | `0 8px 32px` — exact match |
| `0 30px 80px rgba(0,0,0,0.38)` | Keep | No token matches; fullscreen viewer is a special case |

## Repo conventions to follow

- Shadow tokens at `tokens.css:77-81`:
  - `--shadow-xs: 0 1px 3px var(--shadow-color, rgba(120, 100, 80, 0.06))`
  - `--shadow-sm: 0 1px 4px var(--shadow-color, rgba(120, 100, 80, 0.08))`
  - `--shadow-md: 0 2px 8px var(--shadow-color, rgba(120, 100, 80, 0.10))`
  - `--shadow-lg: 0 4px 16px var(--shadow-color, rgba(120, 100, 80, 0.14))`
  - `--shadow-xl: 0 8px 32px var(--shadow-color, rgba(120, 100, 80, 0.20))`
- Theme files override `--shadow-color` per-theme.

## Steps

1. **McpView.vue** — Find `box-shadow: 0 2px 12px rgba(0,0,0,0.15)` (line ~1431). Replace with `box-shadow: var(--shadow-md)`.

2. **SkillsView.vue** — Two replacements:
   - Line ~825: `0 2px 12px rgba(0,0,0,0.15)` → `var(--shadow-md)`
   - Line ~874: `0 8px 32px rgba(0,0,0,0.2)` → `var(--shadow-xl)`

3. **StickerPreviewOverlay.vue** — Keep the `0 30px 80px rgba(0,0,0,0.38)` as-is. It's a fullscreen image viewer that needs a deeper shadow than the token scale provides. This is an acceptable exception.

4. **dawn.css** — Find `0 2px 12px var(--shadow-color)` (line ~110). This already uses the token color but has ad-hoc geometry. Change to `var(--shadow-md)` for consistency. If this is a theme-specific override meant to be different from the default, leave it.

## Boundaries

- Do NOT touch `StickerPreviewOverlay.vue:166` — the 30px/80px shadow is intentional for fullscreen depth.
- Do NOT change `box-shadow: 0 1px 0 var(--border)` faux-border shadows (e.g., `ChatWindow.vue:831`) — these are borders, not depth shadows.
- Do NOT change shadows inside `tokens.css` itself.
- Verify visually — the token shadows use warm-tinted `rgba(120, 100, 80, ...)` by default, which is slightly different from the hardcoded `rgba(0,0,0,...)`. If this causes a visible regression in dark themes, the theme's `--shadow-color` override should handle it.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Open McpView — confirm cards still have appropriate shadow depth.
  - Open SkillsView — confirm same.
  - Switch to a dark theme — confirm shadows adapt (they should, since `--shadow-color` is theme-overridden).
- **Done when**: 3 hardcoded shadows replaced with tokens; StickerPreviewOverlay exception documented.
