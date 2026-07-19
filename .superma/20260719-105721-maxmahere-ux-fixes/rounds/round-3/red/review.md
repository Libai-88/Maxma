# Round 3 — Red Independent Hunt Review

## Mode
MODE A: Independent hunt (final sweep) — finding NEW categories of UI/UX issues beyond font-size.

## Methodology
1. Surveyed all 22 view files and 50+ component files in `web/src/`
2. Cross-referenced against all fixes applied by both teams in Rounds 1 and 2
3. Focused on NON-font-size issues: color/theme compatibility, CSS cruft, hardcoded values, spacing inconsistency
4. Verified against both light and dark theme contexts

## Findings

### R-010 (HIGH) — Hardcoded light-theme colors break dark mode in 2 views + 2 components
**Files**: `web/src/views/MaxmaBlockerView.vue`, `web/src/views/PathWhitelistView.vue`, `web/src/components/ui/DsToast.vue`, `web/src/views/SoulView.vue`

**Description**: Four files contain hardcoded light-theme colors that will not adapt when users switch to dark themes (midnight, deep-think, etc.):

1. **MaxmaBlockerView.vue lines 319-327**: `.rule-note` uses `background: #f0f5ff; color: #1a4a8a;` — hardcoded light blue on light blue. In dark mode (e.g. midnight theme with `--bg-card: #445560`), this light blue background renders as a jarring mismatch, and `#1a4a8a` text has poor contrast against dark backgrounds.

2. **MaxmaBlockerView.vue line 419**: `.msg.error` uses `background: #fee2e2; color: #991b1b;` — hardcoded light red. In dark mode, this becomes unreadable.

3. **PathWhitelistView.vue lines 449-463**: Identical hardcoded `#f0f5ff` / `#1a4a8a` + `#dbeafe` for `.rule-note` and `.rule-note code`.

4. **DsToast.vue lines 190-191**: `.ds-toast--warning` uses `border-left-color: #d97706` instead of `var(--status-warn)`. In custom themes that define their own warning color (e.g. warm-precision uses `--status-warn: #C99A6A`), the toast warning indicator will show the wrong amber.

5. **SoulView.vue line 556**: `.create-dialog` uses hardcoded `box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15)` instead of `var(--shadow-xl)`. The theme already defines `--shadow-xl` with proper shadow color per theme.

**Reproduction**: Switch to midnight theme and navigate to MaxmaBlocker or PathWhitelist pages — the rule-note box appears with mismatched light-blue background and navy text that looks broken against dark surfaces.

**Fix**: Replace all hardcoded colors with theme-aware CSS variable equivalents:
- `#f0f5ff` / `#dbeafe` -> `color-mix(in srgb, var(--status-info) 12% / 20%, var(--bg-card) / var(--bg-secondary))`
- `#1a4a8a` -> `var(--text-secondary)`
- `#fee2e2` / `#991b1b` -> `color-mix(in srgb, var(--status-error) 12%, var(--bg-card))` / `var(--status-error)`
- `#d97706` -> `var(--status-warn)`
- `0 8px 32px rgba(0, 0, 0, 0.15)` -> `var(--shadow-xl)`

**Points estimate**: 4 (high — affects dark mode usability across multiple pages)

---

### R-011 (MEDIUM) — CSS cruft: 15+ duplicate `background` declarations across the codebase
**Files**: `web/src/App.vue`, `web/src/views/MaxmaBlockerView.vue`, `web/src/views/PathWhitelistView.vue`, `web/src/views/MetricsView.vue`, `web/src/components/NewsCard.vue`, `web/src/components/ui/DsButton.vue`

**Description**: A widespread pattern of dead CSS where `background: var(--bg-card)` is immediately overridden by `background: color-mix(in srgb, ...)` on the next line. The first declaration has no effect and serves only as dead code that clutters stylesheets:

1. `App.vue` — `::selection` (2 declarations → 1)
2. `App.vue` — `.sidebar::after` (2 declarations → 1)
3. `MetricsView.vue` — `.metrics-guide` (2 declarations → 1)
4. `MaxmaBlockerView.vue` — `.intro-card` (2 declarations → 1)
5. `MaxmaBlockerView.vue` — `.empty-state` (2 declarations → 1)
6. `PathWhitelistView.vue` — `.intro-card` (2 declarations → 1)
7. `PathWhitelistView.vue` — `.empty-state` (2 declarations → 1)
8. `PathWhitelistView.vue` — `.msg.error` (2 declarations → 1)
9. `DsButton.vue` — `.ds-btn--ghost:hover:not(:disabled)` (4 declarations → 1)
10. `DsButton.vue` — `.ds-btn--subtle:hover:not(:disabled)` (4 declarations → 1)
11. `NewsCard.vue` — 4 type-badge hover states (2 declarations each → 1)

**Reproduction**: Inspect any of these elements in DevTools — the first `background` declaration is greyed out as overridden, indicating dead code.

**Fix**: Remove the superseded `background` declaration in each case, keeping only the `color-mix()` version.

**Points estimate**: 2 (medium — code quality, no visual impact)

---

### R-012 (MEDIUM) — Toggle switch slider uses hardcoded gray color
**File**: `web/src/views/PathWhitelistView.vue`

**Description**: The custom toggle switch's `.toggle-slider` uses `background: #d1d5db` — a hardcoded light gray that doesn't adapt to dark themes. In midnight theme, this gray (#d1d5db = 83% lightness) appears as a bright, jarring element against the dark teal surface (#3B4A54).

**Reproduction**: Open PathWhitelist in add/edit mode in midnight theme — the toggle slider background appears as an incongruous light gray.

**Fix**: Replace `#d1d5db` with `var(--border-strong, #d1d5db)` to use the theme's border color as fallback.

**Points estimate**: 2 (medium — affects all themes with non-light gray borders)

---

### R-013 (MEDIUM) — Hardcoded warning color in DsToast 
**File**: `web/src/components/ui/DsToast.vue`

**Description**: `.ds-toast--warning` uses `#d97706` (amber) instead of `var(--status-warn)`. While `--status-warn` defaults to `#d97706` in tokens.css, several themes override it (e.g. warm-precision uses `#C99A6A`, midnight uses `#D4A574`). The toast warning indicator will show the wrong color in these themes.

**Fix**: Replace `#d97706` with `var(--status-warn)`.

**Points estimate**: 2 (medium — breaks theme consistency for warning toasts)

---

### R-014 (LOW) — Hardcoded box-shadow in SoulView create dialog
**File**: `web/src/views/SoulView.vue`

**Description**: `.create-dialog` uses `box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15)` instead of `var(--shadow-xl)`. The theme system already defines `--shadow-xl` with appropriate per-theme shadow colors. This means the dialog shadow won't match other modals in the app.

**Fix**: Replace with `var(--shadow-xl)`.

**Points estimate**: 1 (low — subtle visual inconsistency)

---

## Summary

| Issue | Priority | Category | Files | Elements |
|-------|----------|----------|-------|----------|
| R-010 | HIGH | Theme/Color | 4 files | 7 hardcoded colors |
| R-011 | MEDIUM | CSS cruft | 6 files | 15+ duplicate declarations |
| R-012 | MEDIUM | Theme/Color | 1 file | 1 hardcoded color |
| R-013 | MEDIUM | Theme/Color | 1 file | 2 hardcoded colors |
| R-014 | LOW | Theme/Color | 1 file | 1 hardcoded shadow |

**Total estimated points**: 4 + 2 + 2 + 2 + 1 = **11 points**

**Areas covered**: Theme compatibility (dark mode), CSS quality, color consistency — all beyond the font-size issues covered in prior rounds.

**No business logic or TypeScript modified** — only CSS/style changes.
