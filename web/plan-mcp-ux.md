# Plan: MCP Server Management Page UX Enhancement

## Analysis Summary

After reading `McpView.vue`, `ProvidersView.vue`, design tokens (`tokens.css`, `design-system.css`), and MCP types (`mcp.ts`), I identified the following UX improvement areas:

---

### 1. Form Field Grouping (like Provider form)

**Current state:** The add/edit form uses flat `form-section` divs with no visual grouping. All fields appear in a single unbroken column.

**Proposed change:** Wrap related fields into `form-group` sections with `form-group-title` headers (matching the Provider form pattern):

| Group | Fields |
|-------|--------|
| 基本信息 | server_id, transport, description |
| 连接配置 (stdio) | command, args, env vars, cwd |
| 连接配置 (network) | URL, TLS, headers, timeout, SSE timeout |
| 工具控制 | allowlist, blocklist |

---

### 2. Card: Tool List Visual Presentation

**Current state:** The card only shows a plain text line: `"N 个工具"`. It's minimal but lacks visual impact.

**Proposed change (styles only, no data fetching change):**
- Add a subtle progress-bar-style indicator that shows tool count as a filled segment (visual metaphor, not functional progress)
- Use `--accent` color with low-opacity for the track and accent color for the fill
- Only applies CSS — no JS/functionality changes

---

### 3. Server Connection Status Indicator

**Current state:** Cards have no connection/status indicator. Only the toggle button and a `disabled-tag` hint at server state. No visual cue beyond that.

**Proposed change (styles only, no backend calls):**
- Add a `status-dot` in the card header that reflects `enabled` state: green dot when enabled, gray dot when disabled
- Add a subtle left border accent on the card when enabled (like the Provider diagnostic section uses left-border)
- This is purely CSS — no new API calls, no functional change

---

### 4. General CSS Polish

- Use design tokens consistently (`--space-*`, `--radius-*`, `--shadow-*`, `--fs-*`)
- Add card hover effects (border color change, subtle shadow lift)
- Improve form `kv-list` visual alignment
- Better `--transition` usage for interactive elements
- Fix inconsistent spacing to use theme variables

---

## Files to Modify

Only one file will be modified:

```
D:/Maxma/MaxmaHere/web/src/views/McpView.vue
```

Changes are **CSS-only** — the `<template>` and `<script>` sections remain untouched. No functional logic changes.

## Verification

After changes, run:

```bash
npx vue-tsc --noEmit
```

to verify no TypeScript errors.
