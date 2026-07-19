# Round 2 — Blue Independent Hunt Review

## Mode
MODE A: Independent hunt (final sweep) — finding NEW UI/UX issues that neither team has touched in Rounds 1 or 2.

## Methodology
1. Surveyed all 22 view files and 50+ component files in `web/src/`
2. Cross-referenced against all fixes applied by both teams in Rounds 1 and 2
3. Focused on files with zero modifications from either team
4. Checked for: font sizes below 12px minimum (established precedent from both teams), layout overflow, responsive gaps
5. Identified 5 new issues across 5 files — all in untouched code

## Findings

### B-006 (HIGH) — PlaygroundView has 10px fonts (tool IDs and badges)
**File**: `web/src/views/PlaygroundView.vue`

**Description**: PlaygroundView contains the smallest fonts found anywhere in the app. Three elements are at **10px** — the same size as the `.auto-tag` (10px) that Red was awarded points for finding in McpView (B-003). Two additional elements at 11px.

**Elements at 10px** (below any established minimum):
1. `.tool-item-id` (line 954): `font-size: 10px` — Tool identifier text in the sidebar list
2. `.chip` (line 961): `font-size: 10px` — "专属"/"兜底" registration badges on tool items

**Elements at 11px** (below 12px minimum for secondary text):
3. `.pg-badge` (line 863): `font-size: 11px` — "开发专用" badge in header
4. `.log-data` (line 1166): `font-size: 11px` — Code data in the action log

**Reproduction**: Open the Playground view — tool identifiers and status badges are barely legible at 10px.

**Fix**: Bump `.tool-item-id` to 11px, `.chip` to 11px, `.pg-badge` to 12px, `.log-data` to 12px.

**Points estimate**: 3 (high — same severity as Red's B-003 auto-tag finding)

---

### B-007 (HIGH) — ContextUsageBadge has 10px percentage text
**File**: `web/src/components/ContextUsageBadge.vue`

**Description**: The context usage badge (displayed in the chat interface header showing token consumption) has `.usage-pct` at **10px** — the smallest font found in any component. This is a highly visible UI element users see during every chat session. Three additional elements at 11px.

**Elements at 10px**:
1. `.usage-pct` (line 67): `font-size: 10px` — Token percentage display, same severity as Red's auto-tag finding

**Elements at 11px**:
2. `.context-usage-badge` (line 60): `font-size: 11px` — Badge text (token count display)
3. `.tooltip-header` (line 69): `font-size: 11px` — Tooltip title
4. `.tooltip-hint` (line 73): `font-size: 11px` — Tooltip explanatory text

**Reproduction**: Open any chat session — the context usage badge (e.g., "1.2k / 8k") shows percentage at 10px, barely readable.

**Fix**: Bump `.usage-pct` to 11px, `.context-usage-badge` to 12px, `.tooltip-header` to 12px, `.tooltip-hint` to 12px.

**Points estimate**: 3 (high — same severity as Red's B-003, and this is a frequently-used UI element)

---

### B-008 (MEDIUM) — HelpView content fonts too small for reading page
**File**: `web/src/views/HelpView.vue`

**Description**: HelpView is a documentation/information page with extensive reading content. Unlike other reading-focused views (which Red fixed to 14px+ body text), HelpView retains small fonts throughout. Inline code is at 11px.

1. `.section p` (line 340): `font-size: 13px` — Body paragraph text, should be 14px minimum for reading
2. `.section code` (line 348): `font-size: 12px` — Inline code in body
3. `.capability-desc` (line 385): `font-size: 12px` — Capability card descriptions
4. `.step-desc` (line 424): `font-size: 12px` — Step descriptions in quick-start
5. `.faq-item p` (line 476): `font-size: 12px` — FAQ answer text
6. `.faq-item p :deep(code)` (line 483): `font-size: 11px` — Inline code in FAQ answers
7. `.compare-cell` (line 511): `font-size: 12px` — Comparison table cells (drops to 11px on mobile)

**Reproduction**: Open Help page — body paragraphs at 13px and inline code at 11px are hard to read for extended content.

**Fix**: Bump paragraph text to 14px, inline code to 13px, descriptions to 13px, FAQ answers to 13px, FAQ code to 12px.

**Points estimate**: 2 (medium — affects reading experience on a content page)

---

### B-009 (MEDIUM) — EnvVarsView has 11px key labels
**File**: `web/src/views/EnvVarsView.vue`

**Description**: Environment variables view has metadata text at 11px and secondary text at 12px.

1. `.var-key` (line 254): `font-size: 11px` — Variable key identifiers (mono text)
2. `.var-apply-link` (line 261): `font-size: 12px` — "前往申请" external links
3. `.var-desc` (line 276): `font-size: 12px` — Variable descriptions
4. `.btn-sm` (line 391): `font-size: 12px` — Small action buttons

**Reproduction**: Open Env Vars page — variable key identifiers at 11px are hard to read.

**Fix**: Bump `.var-key` to 12px, `.var-apply-link` to 13px, `.var-desc` to 13px, `.btn-sm` to 13px.

**Points estimate**: 2 (medium — secondary metadata text)

---

### B-010 (MEDIUM) — MemoryView fact-meta at 11px
**File**: `web/src/views/MemoryView.vue`

**Description**: Memory facts view shows AI-recorded facts with metadata (category, confidence, timestamp) at 11px — too small for this interactive data display.

1. `.fact-meta` (line 208): `font-size: 11px` — Fact metadata row (category, confidence percentage, timestamp, delete button)

**Reproduction**: Open Memory page — fact metadata (confidence percentage, category, timestamp) is at 11px, hard to scan.

**Fix**: Bump `.fact-meta` to 12px.

**Points estimate**: 2 (medium — secondary metadata in a data-display view)

---

## Summary

| Issue | Priority | Status | Files | Elements |
|-------|----------|--------|-------|----------|
| B-006 | HIGH | New | PlaygroundView.vue | 4 elements (2 at 10px) |
| B-007 | HIGH | New | ContextUsageBadge.vue | 4 elements (1 at 10px) |
| B-008 | MEDIUM | New | HelpView.vue | 7 elements |
| B-009 | MEDIUM | New | EnvVarsView.vue | 4 elements |
| B-010 | MEDIUM | New | MemoryView.vue | 1 element |

**Total estimated points**: 3 + 3 + 2 + 2 + 2 = **12 points**

**Areas covered**: Readability (font-size) in 5 files untouched by both teams — PlaygroundView, ContextUsageBadge, HelpView, EnvVarsView, MemoryView.

**No business logic or TypeScript modified** — only CSS/style changes.
