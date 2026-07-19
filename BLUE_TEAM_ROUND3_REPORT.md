# Blue Team Round 3 Review — Final Round

**Review time**: 2026-07-19
**Score**: Red 44 | Blue 25 (pre-round)
**Round 3 Mode**: MODE A (Final independent sweep) + MODE B (Challenge Red's R3 fixes)

---

## Overview

Red claimed Round 3 with 5 issues (R-010 through R-014) targeting hardcoded colors, CSS cruft, and theme incompatibility. While Red's fixes in the 4 files they touched (MaxmaBlockerView, PathWhitelistView, DsToast, SoulView) are correct, **they missed 8+ additional files with identical hardcoded color problems** — many using the exact same color values they claimed to fix (`#fee2e2`, `#991b1b`, `#eff6ff`, `#d97706`).

---

## Section A: Challenge Red's R3 Fixes (MODE B)

### R-010 (HIGH) — Hardcoded light-theme colors
**Verdict**: PARTIAL. The 4 claimed files are fixed correctly, but Red missed **5 additional files** with identical hardcoded colors:

| Red Fixed | Red Missed (same pattern) |
|-----------|--------------------------|
| MaxmaBlockerView `.msg.error`: `#fee2e2`/`#991b1b` | **FileDiffView.vue** `.stat.deletions`: `#fee2e2`/`#991b1b` |
| MaxmaBlockerView `.msg.error`: `#fee2e2`/`#991b1b` | **GitDiffBubble.vue** `.stat-item.deletions`: `#fee2e2`/`#991b1b` |
| MaxmaBlockerView `.rule-note`: `#f0f5ff`/`#1a4a8a` | **GitStatusBubble.vue** `.file-status-badge.deleted`: `#fee2e2`/`#991b1b` |
| — | **FileDiffView.vue** `.diff-line.hunk-header`: `#eff6ff`/`#1d4ed8` |
| — | **GitDiffBubble.vue** `.diff-line.hunk-header`: `#eff6ff`/`#1d4ed8` |
| — | **ToolCallCard.vue** `.diff-hunk`/`.diff-add`/`.diff-del`: `#6366f1`/`#16a34a`/`#dc2626` |
| — | **PlanCard.vue** `.plan-card.modified`/`.running`: `#93c5fd`/`#eff6ff` |
| — | **MaxmaBlockerError.vue** `.blocker-label`/`.blocker-notice`: `#e67e22` |
| — | **HolidayBubble.vue** `.badge-workday`: `#fff3e0`/`#e65100` |

### R-013 (MEDIUM) — DsToast warning `#d97706`
**Verdict**: PARTIAL. Red fixed DsToast.vue correctly but missed the **exact same `#d97706`** in:
- **OnboardingView.vue**: `.health-note.attention { border-color: #d97706; }` (line 100)

### R-011 (MEDIUM) — CSS cruft
**Verdict**: ACCURATE. Red correctly removed duplicate `background` declarations in the 6 files they checked. No remaining duplicates found.

### R-012 (MEDIUM) — Toggle switch hardcoded gray
**Verdict**: ACCURATE. PathWhitelistView toggle-slider fixed correctly.

### R-014 (LOW) — Hardcoded box-shadow
**Verdict**: ACCURATE. SoulView create-dialog shadow fixed correctly.

---

## Section B: New Issues Found (MODE A)

### B-009 (HIGH) — Hardcoded diff/git colors in 5 tool bubble components

**Affected files**:
1. `web/src/components/tools/FileDiffView.vue` — 12 hardcoded hex colors for diff stats, file headers, hunk headers, additions, deletions
2. `web/src/components/tools/GitDiffBubble.vue` — 12 hardcoded hex colors (identical pattern to FileDiffView)
3. `web/src/components/tools/GitStatusBubble.vue` — 14 hardcoded hex colors for status badges (staged/unstaged/untracked/added/modified/deleted/renamed)
4. `web/src/components/ToolCallCard.vue` — 6 hardcoded hex/rgba colors for diff hunk/add/del

**Same pattern as R-010**: These files use the exact same hardcoded light-theme colors (`#fee2e2`, `#991b1b`, `#dcfce7`, `#166534`, `#eff6ff`, `#1d4ed8`, `#f0f4f8`) that Red fixed in MaxmaBlockerView and PathWhitelistView but missed in these tool bubble components.

**Impact**: In dark themes (midnight, deep-think, warm-precision), git diff and status displays show mismatched light-theme backgrounds with poor contrast — identical to the R-010 bug.

**Fix applied**: All hardcoded colors replaced with `color-mix()` + CSS variables using the same approach as R-010:
- `#dcfce7`/`#166534` (green additions) → `color-mix(in srgb, var(--status-ok) 12%, var(--bg-card))` / `var(--status-ok)`
- `#fee2e2`/`#991b1b` (red deletions) → `color-mix(in srgb, var(--status-error) 12%, var(--bg-card))` / `var(--status-error)`
- `#eff6ff`/`#1d4ed8` (blue hunk headers) → `color-mix(in srgb, var(--status-info) 12%, var(--bg-card))` / `var(--status-info)`
- `#f0f4f8` (neutral file headers) → `var(--bg-secondary)`
- `#fef3c7`/`#92400e` (yellow modified) → `color-mix(in srgb, var(--status-warn) 12%, var(--bg-card))` / `var(--status-warn)`
- `#e0e7ff`/`#3730a3` (indigo renamed/untracked) → `color-mix(in srgb, var(--status-info) 12%, var(--bg-card))` / `var(--status-info)`

**Points estimate**: 4 (high — same severity as R-010, affects dark mode usability of git features)

---

### B-010 (MEDIUM) — PlanCard.vue inconsistent theming

**File**: `web/src/components/PlanCard.vue`

**Issue**: `.plan-card.modified` and `.plan-card.running` use hardcoded `#93c5fd`/`#eff6ff` while `.approved`/`.rejected`/`.failed` already use proper `color-mix()` theme variables. This inconsistency means plan cards in "modified" or "running" status break in dark themes while other statuses display correctly.

**Fix applied**: Replaced hardcoded `#93c5fd`/`#eff6ff` with `color-mix(in srgb, var(--status-info) 40%/12%, var(--border/bg-card))` to match the pattern established by `.approved` and `.rejected`.

**Points estimate**: 2 (medium — visual inconsistency, halfway themed)

---

### B-011 (MEDIUM) — ChatWindow.vue hardcoded white gradients and text-shadows

**File**: `web/src/components/ChatWindow.vue`

**Issue**: The empty-state overlay uses `rgba(255, 255, 255, 0.55)` gradient, and empty title/description/quick-hints use white text-shadows (`rgba(255, 255, 255, 0.6)`). These are designed for light backgrounds but create visual artifacts in dark themes where the background is dark — the white glow stands out unnaturally against dark surfaces.

**Fix applied**:
- Overlay gradient: `rgba(255, 255, 255, 0.55)` → `color-mix(in srgb, var(--bg-primary) 55%, transparent)`
- Text shadows: `rgba(255, 255, 255, X)` → `color-mix(in srgb, var(--accent) X%, transparent)` (subtle accent-colored glow)

**Points estimate**: 2 (medium — visible dark-mode rendering issue on empty chat state)

---

### B-012 (MEDIUM) — MaxmaBlockerError.vue hardcoded orange/red blocker colors

**File**: `web/src/components/tools/_shared/MaxmaBlockerError.vue`

**Issue**: 6 hardcoded colors for blocker security UI — `#e67e22` (orange labels/notices), `#c0392b` (red path text), `rgba(231, 76, 60, *)` backgrounds/borders. These break in dark themes.

**Fix applied**: All converted to `var(--status-warn)`/`var(--status-error)` with `color-mix()` backgrounds.

**Points estimate**: 2 (medium — affects all blocker error displays in dark themes)

---

### B-013 (MEDIUM) — OnboardingView.vue hardcoded `#d97706`

**File**: `web/src/views/OnboardingView.vue` (line 100)

**Issue**: `.health-note.attention { border-color: #d97706; }` — same exact color Red fixed in DsToast R-013 but missed here.

**Fix applied**: `#d97706` → `var(--status-warn)`

**Points estimate**: 2 (medium — same severity as R-013, Red missed this)

---

### B-014 (LOW) — HolidayBubble.vue hardcoded badge color

**File**: `web/src/components/tools/HolidayBubble.vue`

**Issue**: Workday badge uses `#fff3e0`/`#e65100` hardcoded.

**Fix applied**: `color-mix(in srgb, var(--status-warn) 12%, var(--bg-card))` / `var(--status-warn)`

**Points estimate**: 1 (low — minor component, rare edge case)

---

### B-015 (LOW) — MessageBubble.vue hardcoded rgba

**File**: `web/src/components/MessageBubble.vue`

**Issues**:
1. User bubble border: `rgba(0, 0, 0, 0.2)` → `var(--border)`
2. Read-status dot: `#3b82f6` / `rgba(59, 130, 246, 0.12)` → `var(--status-info)` / `color-mix(...)`

**Points estimate**: 1 (low — subtle cosmetic issues)

---

## Summary

| # | Issue | Priority | Files | Elements | Status |
|---|-------|----------|-------|----------|--------|
| Red R-010 | Hardcoded colors | HIGH | 4 files | 7 colors | **FIXED** (4 files correct, 5+ missed) |
| Red R-011 | CSS cruft | MEDIUM | 6 files | 15+ decls | **ACCURATE** |
| Red R-012 | Toggle color | MEDIUM | 1 file | 1 color | **ACCURATE** |
| Red R-013 | Warning color | MEDIUM | 1 file | 2 colors | **PARTIAL** (OnboardingView missed) |
| Red R-014 | Box-shadow | LOW | 1 file | 1 shadow | **ACCURATE** |
| **B-009** | Hardcoded diff/git colors | **HIGH** | 5 files | 44+ colors | **FIXED** |
| **B-010** | PlanCard inconsistent theming | MEDIUM | 1 file | 2 states | **FIXED** |
| **B-011** | ChatWindow white gradients | MEDIUM | 1 file | 4 elements | **FIXED** |
| **B-012** | MaxmaBlockerError colors | MEDIUM | 1 file | 6 colors | **FIXED** |
| **B-013** | OnboardingView #d97706 | MEDIUM | 1 file | 1 color | **FIXED** |
| **B-014** | HolidayBubble badge | LOW | 1 file | 2 colors | **FIXED** |
| **B-015** | MessageBubble rgba | LOW | 1 file | 2 elements | **FIXED** |

**Blue Team new fixes**: 7 issues across 8 files, all CSS-only changes, no business logic or TypeScript modified.

---

## Build Verification

```
npx vite build
✓ built in 7.33s — 0 errors
```

All changes compile successfully. No new warnings introduced.

---

## Files Modified

| File | Changes |
|------|---------|
| `web/src/components/tools/FileDiffView.vue` | 10 hardcoded colors → theme variables (diff stats, headers, additions, deletions) |
| `web/src/components/tools/GitDiffBubble.vue` | 10 hardcoded colors → theme variables (identical pattern) |
| `web/src/components/tools/GitStatusBubble.vue` | 14 hardcoded colors → theme variables (status badges) |
| `web/src/components/ToolCallCard.vue` | 6 hardcoded colors → theme variables (diff hunk/add/del) |
| `web/src/components/PlanCard.vue` | 2 hardcoded states → color-mix() theming |
| `web/src/components/ChatWindow.vue` | 4 white gradients/shadows → theme-aware |
| `web/src/components/MessageBubble.vue` | 2 hardcoded rgba → theme variables |
| `web/src/components/tools/_shared/MaxmaBlockerError.vue` | 6 hardcoded colors → theme variables |
| `web/src/components/tools/HolidayBubble.vue` | 2 hardcoded colors → theme variables |
| `web/src/views/OnboardingView.vue` | `#d97706` → `var(--status-warn)` |
