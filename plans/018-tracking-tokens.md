# 018 — Define `--tracking-*` tokens and unify letter-spacing units

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: MEDIUM
- **Category**: Typography
- **Estimated scope**: ~30 files, ~60 letter-spacing declarations

## Problem

Apple: "Tracking (letter-spacing) is size-specific — never one value for all sizes. Large display text wants negative tracking; small text wants slightly positive tracking."

The codebase has ~30 files with `letter-spacing` declarations, but:
1. **No token system** — `tokens.css:51-56` has a *comment* describing the Apple principle but defines zero `--tracking-*` variables.
2. **Unit inconsistency** — mix of `px` (`-0.3px`, `0.5px`, `-0.5px`, `-1px`, `-2px`) and `em` (`0.05em`, `-0.02em`, `0.08em`). `px` values don't scale with font size, so `-0.5px` is too tight at 16px and too loose at 48px. `em` is correct (size-relative).

Current state (sample):
```css
/* px values (wrong — don't scale): */
App.vue:329 → letter-spacing: -0.3px
ChatWindow.vue:771 → letter-spacing: -0.5px
markdown.css:25 → letter-spacing: -0.5px (h1)
markdown.css:26 → letter-spacing: -0.3px (h2)
NotFoundView.vue:69 → letter-spacing: -1px
WeatherBubble.vue:408 → letter-spacing: -2px

/* em values (correct — scale with size): */
ChatHeader.vue:38 → letter-spacing: -0.02em
ProvidersView.vue:979 → letter-spacing: 0.05em
AppSettingsMenu.vue:611 → letter-spacing: 0.08em

/* Small text positive tracking (correct intent, mixed units): */
ToolPanel.vue:57 → letter-spacing: 0.5px (should be em)
ToolPanel.vue:64 → letter-spacing: 0.5px
SessionDrawer.vue:217 → letter-spacing: 0.05em
```

## Target

### 1. Define tracking tokens in `tokens.css`

```css
:root {
  /* Tracking tokens — size-specific, em-based */
  --tracking-display: -0.02em;    /* Large display headings (h1, hero numbers) */
  --tracking-heading: -0.01em;    /* Section headings (h2, h3) */
  --tracking-body: 0;              /* Body text — normal */
  --tracking-caption: 0.01em;     /* Small text, captions — slight positive */
  --tracking-label: 0.05em;       /* Uppercase labels, eyebrows — positive */
  --tracking-mono: -0.02em;       /* Monospace — tighten slightly */
}
```

### 2. Replace all `letter-spacing` declarations with tokens

| Current | Token | Reason |
|---|---|---|
| `-0.3px`, `-0.5px`, `-1px`, `-2px` (large headings) | `var(--tracking-display)` | Large display → negative tracking |
| `-0.3px` (h2) | `var(--tracking-heading)` | Section heading → slight negative |
| `-0.02em` (ChatHeader title) | `var(--tracking-heading)` | Section heading |
| `0` / `normal` (body) | `var(--tracking-body)` | Body → zero |
| `0.5px`, `0.01em`, `0.02em` (small text) | `var(--tracking-caption)` | Small text → slight positive |
| `0.05em`, `0.08em` (uppercase labels) | `var(--tracking-label)` | Uppercase → positive |
| Any on monospace | `var(--tracking-mono)` | Mono → tighten |

## Repo conventions to follow

- Tokens live in `web/src/assets/styles/tokens.css`.
- The comment block at `tokens.css:51-56` already documents the principle — replace the comment with actual token definitions.
- `em` units are correct (size-relative). `px` units are wrong for letter-spacing.
- Apple's spec: large display `-0.02em` to `-0.03em`, body `0`, small text `+0.01em` to `+0.03em`, uppercase labels `+0.05em` minimum.

## Steps

1. **Define tokens** — In `web/src/assets/styles/tokens.css`, replace the comment block at lines 51-56 with the token definitions above.

2. **Replace px-based letter-spacing** — For each file with `px`-based `letter-spacing`, convert to the appropriate token:
   - `App.vue:329` — `-0.3px` → `var(--tracking-display)` (large title)
   - `ChatWindow.vue:771` — `-0.5px` → `var(--tracking-heading)` (header title)
   - `markdown.css:25` — `-0.5px` (h1) → `var(--tracking-display)`
   - `markdown.css:26` — `-0.3px` (h2) → `var(--tracking-heading)`
   - `NotFoundView.vue:69` — `-1px` → `var(--tracking-display)` (large 404)
   - `WeatherBubble.vue:408` — `-2px` → `var(--tracking-display)` (large temperature)
   - `ToolPanel.vue:57,64,70` — `0.5px` → `var(--tracking-label)` (uppercase labels)
   - `TaskListBubble.vue:89` — `0.5px` → `var(--tracking-label)`
   - `TaskDetailBubble.vue:116` — `0.5px` → `var(--tracking-label)`
   - `OnboardingView.vue:98` — `0.5px` → `var(--tracking-label)`
   - All other `px`-based values — find and convert

3. **Replace em-based letter-spacing** — Convert existing `em` values to tokens where they match:
   - `ChatHeader.vue:38` — `-0.02em` → `var(--tracking-heading)`
   - `ProvidersView.vue:979` — `0.05em` → `var(--tracking-label)`
   - `AppSettingsMenu.vue:611,631` — `0.08em` → `var(--tracking-label)`
   - `SessionDrawer.vue:217` — `0.05em` → `var(--tracking-label)`
   - All other `em`-based values — find and convert

4. **Leave body text alone** — If `letter-spacing` is `normal` or `0` on body text, you can optionally replace with `var(--tracking-body)` for explicitness, but this is low priority.

## Boundaries

- Do NOT change `letter-spacing` values that are intentionally custom (e.g., a specific design override). If a value doesn't match any token, leave it.
- Do NOT change `line-height` or `font-weight` — this plan is letter-spacing only.
- Do NOT touch `font-family` or `font-size`.
- Work file-by-file to keep changes organized.
- Prioritize `px` → `em` conversion first (correctness fix), token adoption second (consistency).

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Spot check**: Grep for `letter-spacing.*px` — count should drop to near 0 (only intentional exceptions remain).
- **Feel check**:
  - Compare a large heading before and after — tracking should look similar (tokens use the same -0.02em value that some `em`-based declarations already use).
  - Compare uppercase labels — tracking should be consistent across all labels.
  - The change should be subtle — if there's a dramatic visual shift, a wrong token was applied.
- **Done when**: `--tracking-*` tokens defined in `tokens.css`; all `px`-based letter-spacing converted to tokens; `em`-based values converted where they match tokens; build passes.
