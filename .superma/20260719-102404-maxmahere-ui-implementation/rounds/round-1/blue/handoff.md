# Handoff: "Warm Precision" Implementation

## State

- **Branch**: `design/blue-warm`
- **Build**: PASS
- **Files changed**: 10
- **Theme status**: Warm Precision is the DEFAULT theme (`useTheme.ts` → `DEFAULT_THEME = 'warm-precision'`)
- **Theme file**: `web/src/themes/warm-precision.css` — complete with all CSS custom properties

## What Was Done

### Theme Activation
The warm-precision.css file existed but was never imported in `App.vue`. Added the import. Together with the existing `DEFAULT_THEME = 'warm-precision'` in `useTheme.ts`, the theme is now fully active as the default.

### Design Token Consistency

| Token | Previous Value | New Value |
|-------|---------------|-----------|
| `--font-body` | `var(--font-serif)` | `var(--font-ui)` |
| Sidebar width | 220px | 240px |
| Nav active bg | `var(--bg-card)` | `var(--accent-soft)` |
| Chat window bg | `var(--bg-card)` | `var(--bg-primary)` |
| Typing dot | `var(--accent-pink)` | `var(--accent)` |
| Input focus border | `var(--accent-pink)` | `var(--border-accent)` |
| Send btn hover | `var(--accent-pink)` | `var(--accent-hover)` |

### Hardcoded Colors Replaced
- `#9ca3af` → `var(--text-tertiary)` (placeholder text)
- `#c97a7a` → `var(--status-error)` (cancel button hover)
- `#f59e0b` → `var(--status-warn)` (user error banner)
- `#f97316` → `var(--status-warn)` (tool error banner)
- `#3b82f6` → `var(--status-info)` (rate limit banner)
- `#22c55e` → `var(--status-ok)` (memory check, copy success)
- `#b91c1c` → `var(--status-error)` (memory cross, error state)

### Serif Display Typography Applied
- Providers view title ("提供商管理 PROVIDERS")
- Form section headers ("基础设置", "模型参数", "高级设置")
- Sidebar section header ("会话 Sessions")
- Sidebar section labels ("已保存", "临时会话")

## Key Technical Notes

1. **Body font fix**: `--font-body` now correctly defaults to system sans-serif (`var(--font-ui)`) instead of serif. If any component relied on the serif body default, it will now render in sans-serif. This is the intended behavior per the Serif-Only-For-Display rule.

2. **Paper texture**: The sidebar paper texture is controlled by the existing `usePaperTexture` composable (enabled by default) and `paper-texture.css`. No changes were needed.

3. **Compatibility variables**: `--accent-pink`, `--accent-pink-light`, `--accent-pink-soft` are still defined in warm-precision.css (mapped to terracotta values) for backward compatibility with other themes.

4. **Shadow fallbacks**: `tokens.css` now uses warm-tinted shadow defaults (`rgba(120, 100, 80, ...)`) as the system-wide fallback. Individual themes can still override via `--shadow-color`.

## Files Modified

| File | Changes |
|------|---------|
| `web/src/App.vue` | +warm-precision import, sidebar width 240px, nav active accent-soft, shadow-pink fallback |
| `web/src/assets/styles/tokens.css` | font-body → font-ui, warm shadow defaults |
| `web/src/assets/styles/design-system.css` | accent-hover for primary btn, border-accent for card hover |
| `web/src/components/ChatInput.vue` | border-accent focus, accent-hover send, removed pink refs, replaced hardcoded colors |
| `web/src/components/ChatWindow.vue` | bg-primary canvas, accent dots, desaturated status colors |
| `web/src/components/SessionSidebar.vue` | serif font-display for section labels |
| `web/src/views/ProvidersView.vue` | serif font-display for title and form headers |
| `./DESIGN.md` | Added missing tokens (bg-raised, accent-active, border-accent) |

## For the Next Team

- Verify the paper texture overlay appears correctly on the sidebar (check `body.paper-texture` class is applied)
- Consider migrating remaining hardcoded color values in other components (e.g., `AppearanceView.vue`, `SkillsView.vue`)
- The `--font-body` change may affect any specialized views that expected serif body text
