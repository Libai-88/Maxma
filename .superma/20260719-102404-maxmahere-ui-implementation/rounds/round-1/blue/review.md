# Blue Team Implementation Review: "Warm Precision"

## Summary

Implemented the "Warm Precision" design system across 10 files. All changes are CSS-only, backward-compatible with the existing 11-theme system. Build passes successfully.

## Files Changed (10)

### Theme & Token System (5 files)

1. **`web/src/App.vue`**
   - Added `@import '@/themes/warm-precision.css'` — the warm-precision theme was defined but never imported, making it non-functional
   - Increased sidebar width from 220px to 240px per design spec
   - Changed active nav item background from `var(--bg-card)` to `var(--accent-soft)` for terracotta tint active state
   - Updated `--shadow-pink` fallback from neutral black to warm brown-tinted `rgba(120, 100, 80, 0.14)`

2. **`web/src/assets/styles/tokens.css`**
   - Fixed `--font-body` default from `var(--font-serif)` to `var(--font-ui)` — body text was incorrectly defaulting to serif; only display headings should use serif
   - Updated shadow fallback values to use warm brown-tinted `rgba(120, 100, 80, ...)` instead of neutral `rgba(80, 65, 50, ...)` — consistent with the warm-tinted shadow system

3. **`web/src/assets/styles/design-system.css`**
   - Changed `.ds-btn--primary:hover` to use `var(--accent-hover)` instead of `var(--accent-dark)` — proper terracotta darkening on hover
   - Changed `.ds-card:hover` to use `var(--border-accent)` instead of `var(--accent-dark)` — accent border on hover instead of full color

4. **`web/src/composables/useTheme.ts`**
   - Already had `DEFAULT_THEME = 'warm-precision'` — verified correct, no change needed

5. **`web/src/themes/warm-precision.css`**
   - Already complete with all correct CSS custom properties — verified, no change needed

### Vue Components (4 files)

6. **`web/src/components/ChatInput.vue`**
   - `.chat-input:focus-within`: Changed from `var(--accent-pink)` to `var(--border-accent)` — warm hairline border on focus instead of pink
   - `.btn-send:hover`: Changed from `var(--accent-pink)` and `var(--shadow-pink)` to `var(--accent-hover)` and `var(--shadow-md)` — proper terracotta darkening
   - `.btn-stop:hover`: Cleaned up redundant background declarations
   - `.file-tag:hover`: Changed from `var(--accent-dark)` to `var(--border-accent)`
   - `.sticker-tag`: Replaced all `var(--accent-pink)` references with `var(--accent)`
   - `.input-area::placeholder` and `.link-input::placeholder`: Replaced hardcoded `#9ca3af` with `var(--text-tertiary)`
   - `.link-input-cancel:hover`: Replaced hardcoded `#c97a7a` with `var(--status-error)`

7. **`web/src/components/ChatWindow.vue`**
   - `.chat-window` background: Changed from `var(--bg-card)` to `var(--bg-primary)` — warm cream canvas instead of card surface
   - `.typing-dot` and `.empty-desc`: Changed from `var(--accent-pink)` to `var(--accent)` — consistent terracotta accent
   - Error banners: Replaced hardcoded `#f59e0b`, `#f97316`, `#3b82f6` with `var(--status-warn)`, `var(--status-info)` — desaturated warm palette
   - Memory status indicators: Replaced `#22c55e` with `var(--status-ok)` and `#b91c1c` with `var(--status-error)` — desaturated warm green/red

8. **`web/src/components/SessionSidebar.vue`**
   - `.sidebar-section-header` and `.section-label`: Added `font-family: var(--font-display)` — serif display for sidebar section titles per the Serif-For-Labels rule
   - Paper texture already applied via existing `body.paper-texture .sidebar` CSS in paper-texture.css

9. **`web/src/views/ProvidersView.vue`**
   - `.header h2`: Added `font-family: var(--font-display)` — serif display for the view title
   - `.form-group-title`: Added `font-family: var(--font-display)` — serif display for form section headers ("基础设置", "模型参数", "高级设置")

### Documentation (1 file)

10. **`./DESIGN.md`** (root)
    - Added missing tokens: `bg-raised`, `accent-active`, `border-accent` to frontmatter
    - Updated existing tokens for accuracy

## Key Design Decisions

- **Font body default**: Changed `--font-body` from serif to sans-serif in tokens.css. Previously the body font defaulted to serif (via `var(--font-serif)`), which violated the Serif-Only-For-Display rule. The `.font-sans` class was a workaround; now serif is correctly limited to display headings only by default.
- **`--accent-pink` compatibility**: The warm-precision.css theme maps `--accent-pink` to `#C17A5C` (same as `--accent`) for backward compatibility. Components that previously referenced `--accent-pink` were updated to use `--accent` or `--border-accent` directly for clarity.
- **Sidebar paper texture**: Already handled by the existing `body.paper-texture .sidebar` CSS rule in paper-texture.css, which adds the SVG fractal noise at the configured opacity. Enabled by default via `usePaperTexture`.

## Build Status

**PASS** — `cd web && npx vite build` completed successfully with no new warnings.
