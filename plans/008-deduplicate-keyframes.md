# 008 — Deduplicate spin/fade keyframes to canonical `maxma-*` set

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 6 files, 6 keyframe definitions removed

## Problem

6 components define their own spin keyframes that duplicate the canonical `maxma-spin` in `animations.css`. 3 components define fade keyframes that duplicate `maxma-fade-in`.

Spin duplicates:
```css
/* web/src/components/ui/DsButton.vue:152 — @keyframes ds-btn-spin (duplicates maxma-spin) */
/* web/src/components/tools/_shared/BubbleChrome.vue:147 — @keyframes tool-spin (duplicates maxma-spin) */
/* web/src/components/HtmlSandbox.vue:409 — @keyframes sandbox-spin (duplicates maxma-spin) */
/* web/src/components/ChatWindow.vue:1053 — @keyframes memory-spin (duplicates maxma-spin) */
/* web/src/components/WelcomeScreen.vue:114 — @keyframes welcome-spin (duplicates maxma-spin) */
/* web/src/components/tools/_shared/shared.css:49 — @keyframes bubble-spin (duplicates maxma-spin, also not prefixed) */
```

Fade duplicates:
```css
/* web/src/components/StickerPreviewOverlay.vue:276 — @keyframes previewFadeIn (duplicates maxma-fade-in) */
/* web/src/components/WelcomeScreen.vue:234 — @keyframes welcome-fade-in (duplicates maxma-fade-in) */
```

## Target

Replace all local spin keyframe references with `maxma-spin`. Remove local `@keyframes` definitions. Replace fade duplicates with `maxma-fade-in` where the animation is a simple opacity 0→1.

## Repo conventions to follow

- Canonical keyframes in `web/src/assets/styles/animations.css` (25 keyframes, all `maxma-` prefixed).
- Naming convention: all keyframes must use `maxma-` prefix.
- `maxma-spin` is a standard 360° rotation: `@keyframes maxma-spin { to { transform: rotate(360deg); } }`.

## Steps

### Spin deduplication

For each of the 6 files:
1. Find the local `@keyframes <name>-spin` definition.
2. Verify it's identical to `maxma-spin` (360° rotation). If it has custom steps, keep it.
3. Find all `animation: <name>-spin ...` references in the same file.
4. Replace with `animation: maxma-spin ...`.
5. Remove the `@keyframes <name>-spin` definition.

Files:
1. `DsButton.vue` — `ds-btn-spin` → `maxma-spin`
2. `BubbleChrome.vue` — `tool-spin` → `maxma-spin`
3. `HtmlSandbox.vue` — `sandbox-spin` → `maxma-spin`
4. `ChatWindow.vue` — `memory-spin` → `maxma-spin`
5. `WelcomeScreen.vue` — `welcome-spin` → `maxma-spin`
6. `shared.css` — `bubble-spin` → `maxma-spin`

### Fade deduplication

For `previewFadeIn` and `welcome-fade-in`:
1. Check if the keyframe is a simple `opacity: 0 → 1` (possibly with transform).
2. If it matches `maxma-fade-in`, replace references and remove the local definition.
3. If it has custom transform steps (e.g. `welcome-fade-in` might include `translateY`), keep it — `maxma-fade-in` is opacity-only.

**IMPORTANT**: Verify each keyframe's content before removing. Only remove if the animation behavior is truly identical. If there's any difference (different transform, different timing function baked in), keep the local definition.

## Boundaries

- Do NOT remove keyframes that have custom animation steps different from the canonical version.
- Do NOT touch non-spin/non-fade keyframes.
- Do NOT change animation durations or timing functions in the `animation:` shorthand — only the keyframe name.
- Do NOT touch `animations.css` itself.
- If a keyframe is used by `animation:` with a specific duration that differs from typical usage, keep the duration — only swap the name.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Spot check**: Grep for `ds-btn-spin|tool-spin|sandbox-spin|memory-spin|welcome-spin|bubble-spin` — should return 0 matches.
- **Feel check**:
  - Trigger a spinner in DsButton, BubbleChrome, ChatWindow, WelcomeScreen — confirm spin animation still works.
  - Confirm no visual change (the spin should be identical).
- **Done when**: All 6 spin duplicates removed; all references use `maxma-spin`; no visual regression.
