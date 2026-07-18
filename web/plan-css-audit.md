# CSS/Style System Consistency Audit Plan

**Owner:** ZCode Agent
**Scope:** Only `.vue` and `.css` files — style-only changes, no JS/TS logic.
**Validation:** `npx vue-tsc --noEmit`

---

## 1. border-radius Values — Token Substitution

### Token reference
| Token            | Value |
|------------------|-------|
| `--radius-sm`    | 5px   |
| `--radius-md`    | 8px   |
| `--radius-lg`   | 12px  |
| `--radius-input` | 6px   |
| `--radius-card`  | 8px   |

### Audit results

| Hardcoded | Occurrences | Action |
|-----------|-------------|--------|
| `6px`     | 112         | Replace with `--radius-input` where semantically appropriate (input-like elements). For generic uses, use `--radius-md`. |
| `8px`     | 53          | Replace with `--radius-md` or `--radius-card` depending on context (card vs generic). |
| `12px`    | 8           | Replace with `--radius-lg`. |
| `5px`     | 4           | Replace with `--radius-sm`. |
| `10px`    | 17          | **No token match.** Leave as-is (closest is `--radius-md` at 8px, visually distinct). |
| `4px`     | 67          | **No token match.** Most are in markdown.css (code blocks), leave as-is. |
| `3px`     | 32          | **No token match.** Used for subtle inner corners; leave as-is. |
| `100px` / `999px` / `50%` / `0` | — | **Intentional** (pill/circle/none shapes), leave as-is. |
| `14px`, `11px`, `2px`, `1px`, `24px`, `20px`, `16px` | ~1-3 each | Minor usage, leave as-is. |

**Proposed replacements (conservative subset to avoid visual drift):**
- `border-radius: 6px` -> `border-radius: var(--radius-input)` (exact match at 6px)
- `border-radius: 8px` -> `border-radius: var(--radius-md)` (exact match at 8px), `--radius-card` where card-specific
- `border-radius: 12px` -> `border-radius: var(--radius-lg)` (exact match at 12px)
- `border-radius: 5px` -> `border-radius: var(--radius-sm)` (exact match at 5px)

---

## 2. font-size Values — Audit Only (No Changes)

### Token reference
| Token           | Value        |
|-----------------|--------------|
| `--fs-title`    | 1.05rem      |
| `--fs-body`     | 0.9rem       |
| `--fs-ui`       | 0.82rem      |
| `--fs-caption`  | 0.78rem      |
| `--fs-hint`     | 0.7rem       |

### Audit results
- **69 unique files** with hardcoded `font-size` values
- Most are `em`-based, which are relative to parent context and **not suited** for token replacement
- Pixel values like `13px`, `12px`, `11px` are close but **not exact** matches to tokens (e.g., `--fs-caption` is 0.78rem ~ 12.48px)
- `markdown.css` font sizes (`1.5em`, `1.3em`, etc.) are semantically correct for headings

**Recommendation: No changes.** Hardcoded font sizes are mostly context-relative (`em`) and replacing them would risk visual drift without clear benefit. This is best revisited when the design system evolves to include more granular font tokens.

---

## 3. CSS Variable Fallback Cleanup

### Findings

All 11 themes define these core variables, making fallbacks redundant:

**REDUNDANT — can remove fallback (12 files affected):**
`--accent` · `--bg-card` · `--bg-primary` · `--bg-secondary` · `--border` · `--status-error` · `--status-warn` · `--text-primary` · `--text-secondary` · `--text-tertiary`

**Must KEEP fallback (not defined in themes):**
`--accent-bg` · `--accent-color` · `--bg-hover` · `--border-color` · `--error-color` · `--status-success` · `--success-color` · `--text-muted` · `--warning-bg` · `--warning-color`

### Proposed changes
Remove redundant `, #hardcoded` fallback from these patterns. Examples:

| File | Before | After |
|------|--------|-------|
| `ModelSelector.vue` | `var(--border, #e5e7eb)` | `var(--border)` |
| `PersonaCard.vue` | `var(--border, #e5e7eb)` | `var(--border)` |
| `WelcomeScreen.vue` | `var(--text-primary, #1f2937)` | `var(--text-primary)` |
| `SkillsView.vue` | `var(--bg-card, #fff)` | `var(--bg-card)` |
| ... and similar across ~12 files | | |

**Note:** Workbench components (`workbench/cards/*`) use `--border-color`, `--accent-color`, etc. — these are NOT theme vars and should KEEP their fallbacks.

### Known inconsistency (noted, no change)
- `--status-success` is used in `DsButton.vue`, `DsToast.vue`, `WorkflowCard.vue` but themes define `--status-ok` instead. The fallback saves it, but this is a naming mismatch that should be fixed separately (beyond this audit).

---

## 4. @keyframes Conflicts

### Problem: `@keyframes spin` defined 12 times
All these components define their own `@keyframes spin` with identical or near-identical content:

| File | Line |
|------|------|
| `ChatInput.vue` | 1575 |
| `PlanCard.vue` | 288 |
| `ThinkingBlock.vue` | 116 |
| `ToolCallCard.vue` | 247 |
| `FilesBubble.vue` | 603 |
| `GitDiffBubble.vue` | 248 |
| `GitStatusBubble.vue` | 566 |
| `HolidayBubble.vue` | 253 |
| `MapBubble.vue` | 344 |
| `MemoryBubble.vue` | 155 |
| `TarotBubble.vue` | 165 |
| `ReasoningTimeline.vue` | 142 |

Additionally, `@keyframes pulse` is defined in **2 files**:
- `SessionItem.vue:244`
- `PlaygroundView.vue:1049`

### Root cause
These are likely in `<style scoped>` blocks, but **Vue's scoped CSS does NOT scope @keyframes names** — they are globally visible. Multiple definitions of the same `@keyframes spin` will cause unpredictable behavior (browser picks one definition, which may not be the intended one).

### Background: centralized animations
The project already has `D:/Maxma/MaxmaHere/web/src/assets/styles/animations.css` which defines `@keyframes maxma-spin` (prefixed to avoid conflicts). However, components aren't using it.

### Proposed changes
1. Replace `@keyframes spin` in each component with `animation-name: maxma-spin` (importing animations.css)
2. Replace `@keyframes pulse` with `animation-name: maxma-pulse`

Since some `spin` definitions differ (e.g., `FilesBubble.vue` has `to { transform: rotate(360deg); }` which matches `maxma-spin`), we need to verify each one matches before replacing.

---

## Execution Plan

### Phase 1 — border-radius token substitution (safe replacements only)
Replace exact-match hardcoded values with tokens:
1. `6px` -> `var(--radius-input)` (input-like) or `var(--radius-md)` (generic)
2. `8px` -> `var(--radius-md)` / `var(--radius-card)`
3. `12px` -> `var(--radius-lg)`
4. `5px` -> `var(--radius-sm)`

### Phase 2 — CSS fallback cleanup
Remove redundant fallback values from `var(--x, #hardcoded)` where `--x` is guaranteed by all 11 themes.

### Phase 3 — @keyframes deduplication
- Replace `@keyframes spin` with centralized `maxma-spin` from `animations.css`
- Replace `@keyframes pulse` with centralized `maxma-pulse`

### Phase 4 — Validation
Run `npx vue-tsc --noEmit` to verify no TypeScript breaks (style changes shouldn't affect TS, but confirms we didn't accidentally touch non-style code).

### Scope excluded (phase 5+/future)
- font-size token replacement (deferred)
- `--status-success` / `--status-ok` naming inconsistency
- Workbench component variables (`--border-color`, `--accent-color`, etc.) — not part of the theme system

---

## Confirmation

Please review this plan and confirm before I proceed with execution.
