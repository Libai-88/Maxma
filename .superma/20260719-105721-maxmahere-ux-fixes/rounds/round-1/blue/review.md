# Round 1 — Blue review

## Scope
Red focused exclusively on font-size bumps across 12 files. Blue team takes MODE A: Independent hunt — finding UI/UX issues Red missed entirely, plus completing the font-size pass on components they explicitly skipped.

## Methodology
1. Surveyed all 23 view files and 50+ component files in `web/src/`
2. Cross-referenced Red's review to identify gaps and skipped components
3. Checked for: missing body line-height, views Red skipped (SkillsView, McpView), remaining tiny fonts in views Red partially fixed, and card-grid overflow on narrow viewports

## Findings

### B-001 (high) — Body element missing line-height, harming readability
**File**: `web/src/App.vue:265-272`

**Description**: The `html, body` CSS block sets `font-size: clamp(16px, 15px + 0.2vw, 18px)` but defines **no `line-height`**. Browsers default to ~1.2 for body text, making paragraphs feel cramped and hard to scan — especially for the dense information layout this app presents.

**Reproduction**: View any page with multiple lines of text — paragraphs read tighter than standard UI practice (1.5-1.6).

**Expected**: Body text should have `line-height: 1.6` for comfortable reading, consistent with what the design-system.css guides use.

**Actual**: No line-height on body; default ~1.2 from browser.

**Evidence**: 
- `App.vue:269`: `font-size: clamp(16px, 15px + 0.2vw, 18px)` — no line-height companion

**Fix**: Add `line-height: 1.6` to the `html, body` block.

**Points estimate**: 3 (high)

---

### B-002 (high) — SkillsView font sizes still too small (Red skipped entirely)
**File**: `web/src/views/SkillsView.vue`

**Description**: Red's handoff explicitly says "SkillsView, McpView have similar small-font patterns but were not prioritized." SkillsView has numerous undersized text elements:

- Tab buttons: `13px` (`.tab-btn:570`)
- Card description: `13px` (`.card-desc:675`)
- Card ID: `12px` (`.card-id:691`) 
- Action buttons: `12px` (`.action-btn:709`)
- Guide card paragraph: `12px` (`.guide-card p:972`)
- Role guidance text: `12px` (`.role-card:1005`)
- Role badge: `10px` (`.role-badge:1009`)
- Form label: `13px` (`.form-label:743`)
- Form hint: `12px` (`.form-hint:749`)

These are well below the readability standards applied to other views by Red.

**Reproduction**: Open Skills view — tabs, card descriptions, and action buttons all appear notably smaller than comparable elements in ProvidersView or ChatHeader.

**Fix**: Bump tab buttons to 14px, card-desc to 14px, card-id to 13px, action-btn to 13px, guide-card p to 13px, role-card to 13px, role-badge to 11px.

**Points estimate**: 3 (high)

---

### B-003 (high) — McpView font sizes still too small (Red skipped entirely)
**File**: `web/src/views/McpView.vue`

**Description**: Like SkillsView, McpView was skipped by Red. Multiple text elements are undersized:

- Card connection mono text: `12px` (`.card-connection .mono:1251`)
- Action buttons: `12px` (`.action-btn:1289`)
- Section title (OMP): `11px` (`.section-title:1532`)
- Tool tags: `11px` (`.tool-tag:1554`)
- Disabled tag: `11px` (`.disabled-tag:1271`)
- Auto tag: `10px` (`.auto-tag:1545`)
- Card description: `13px` (`.card-desc:1239`)
- Transport badge: `11px` (`.transport-badge:1195`)

**Reproduction**: Open MCP view — mono connection text, action buttons, and status tags appear tiny compared to other UI surfaces.

**Fix**: Bump mono to 13px, action-btn to 13px, section-title to 12px, tool-tag to 12px, disabled-tag to 12px.

**Points estimate**: 3 (high)

---

### B-004 (medium) — Card grids lack responsive breakpoints, causing horizontal overflow
**Files**: 
- `web/src/views/SkillsView.vue:627`
- `web/src/views/McpView.vue:1140`
- `web/src/views/AuditLogView.vue:214`

**Description**: Several views use `repeat(auto-fill, minmax(300px, 1fr))` (or similar) for card grids without a responsive fallback. At viewport widths below ~640px, the `minmax` floor of 300px exceeds the available viewport width, causing the grid to overflow horizontally and the page to gain an unwanted horizontal scrollbar.

SkillsView: `minmax(300px, 1fr)` at line 627
McpView: `minmax(320px, 1fr)` at line 1140
AuditLogView: `minmax(260px, 1fr)` at line 214

**Reproduction**: Shrink browser window to ~500px wide and navigate to Skills view — cards overflow the viewport.

**Expected**: Grids should collapse to single column below a reasonable breakpoint.

**Fix**: Add `@media (max-width: 640px) { grid-template-columns: 1fr; }` for each affected grid.

**Points estimate**: 2 (medium)

---

### B-005 (medium) — AppearanceView has leftover tiny font elements (Red's R-009 incomplete)
**File**: `web/src/views/AppearanceView.vue`

**Description**: Red's R-009 increased the section h3 to 1rem and section-desc to 0.85rem, but left several other font elements at very small sizes:

- Theme name label: `0.72rem` (~11.5px) at line 167
- Toggle description: `0.72rem` (~11.5px) at line 195
- Toggle button text: `0.75rem` (~12px) at line 206

These are inconsistent with the readability improvements applied to the section-desc and remain below comfortable reading threshold for secondary UI text.

**Reproduction**: Open Appearance settings — theme names under the preview swatches, and toggle descriptions appear markedly smaller than section descriptions.

**Fix**: Bump theme-name to 0.78rem, toggle-desc to 0.78rem, toggle-btn to 0.8rem.

**Points estimate**: 2 (medium)

---

## Summary
- Filed: 5 issues
  - High: 3 (B-001, B-002, B-003)
  - Medium: 2 (B-004, B-005)
- Estimated points (before arbiter): 3*3 + 2*2 = 13
- Areas covered: Readability (line-height), font-size (2 skipped views + 1 incomplete fix), responsive layout (card grid overflow)
- No business logic or TypeScript was modified — only CSS/style changes
