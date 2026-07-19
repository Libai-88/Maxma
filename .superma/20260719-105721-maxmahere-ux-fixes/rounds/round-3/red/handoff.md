# Round 3 — Red Handoff

## Mode
MODE A: Independent hunt (final sweep) — finding NEW categories of UI/UX issues beyond font-size.

## What was done
Surveyed all 22 view files and 50+ component files. Identified 5 issues across 7 files targeting theme compatibility, CSS cruft, and hardcoded values — categories untouched by either team in prior rounds.

### R-010 (HIGH) — Hardcoded light-theme colors break dark mode
- MaxmaBlockerView `.rule-note`: `#f0f5ff`/`#1a4a8a` → `color-mix()` + `var(--text-secondary)`
- MaxmaBlockerView `.msg.error`: `#fee2e2`/`#991b1b` → `color-mix()` + `var(--status-error)`
- PathWhitelistView `.rule-note` + code: same hardcoded blues → theme variables
- DsToast `--warning`: `#d97706` → `var(--status-warn)`
- SoulView `.create-dialog`: hardcoded shadow → `var(--shadow-xl)`

### R-011 (MEDIUM) — CSS cruft: 15+ duplicate background declarations
Removed dead `background: var(--bg-card)` declarations immediately overridden by `background: color-mix(...)`:
- App.vue (::selection, .sidebar::after)
- MetricsView.vue (.metrics-guide)
- MaxmaBlockerView.vue (.intro-card, .empty-state)
- PathWhitelistView.vue (.intro-card, .empty-state, .msg.error)
- DsButton.vue (.ds-btn--ghost:hover, .ds-btn--subtle:hover) — 4 decl → 1
- NewsCard.vue (4 type-badge hover states)

### R-012 (MEDIUM) — Toggle slider hardcoded gray
- PathWhitelistView `.toggle-slider`: `#d1d5db` → `var(--border-strong, #d1d5db)`

### R-013 (MEDIUM) — Hardcoded warning color in DsToast
- DsToast `--warning` variant: `#d97706` → `var(--status-warn)` (for both border-left-color and icon)

### R-014 (LOW) — Hardcoded box-shadow in SoulView
- SoulView `.create-dialog`: `0 8px 32px rgba(0,0,0,0.15)` → `var(--shadow-xl)`

## Files modified (7)
1. `web/src/App.vue` — 2 duplicate background fixes
2. `web/src/views/MaxmaBlockerView.vue` — 3 hardcoded color fixes + 2 duplicate background fixes
3. `web/src/views/PathWhitelistView.vue` — 3 hardcoded color fixes + 3 duplicate background fixes
4. `web/src/views/MetricsView.vue` — 1 duplicate background fix
5. `web/src/views/SoulView.vue` — 1 hardcoded shadow fix
6. `web/src/components/NewsCard.vue` — 4 duplicate background fixes
7. `web/src/components/ui/DsToast.vue` — 2 hardcoded color fixes
8. `web/src/components/ui/DsButton.vue` — 2 duplicate background fixes (cleaned from 4→1 decls)

## Patches
See `patches/all-fixes.patch` (comprehensive diff of all changes).

## Build status
`npx vite build` — PASS (verified successfully, 580 modules transformed, 0 errors).

## Notes for Blue/Arbiter
- All changes are CSS/style-only — no business logic or TypeScript modified
- This round targets DIFFERENT categories than font-size: theme compatibility (dark mode), CSS code quality, and hardcoded color values
- R-010 is the highest impact: users switching to dark themes (midnight, deep-think, etc.) would see broken UI in MaxmaBlocker, PathWhitelist, and inconsistent toast warning colors
- R-011 cleans up code quality debt: 15+ dead CSS declarations removed
- Several views (HooksView, KbView, MaxmaBlockerView, PathWhitelistView, UserView, SoulView, NotFoundView) were completely untouched by any previous round's font-size fixes
