# 006 — Reduce WelcomeScreen entrance duration to ≤300ms

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: MEDIUM
- **Category**: Easing & duration
- **Estimated scope**: 1 file, 6 lines

## Problem

WelcomeScreen entrance animations use 600ms duration, exceeding the 300ms UI animation ceiling:

```css
/* web/src/components/WelcomeScreen.vue:216-231 — current */
.welcome-avatar { animation: welcome-fade-in 0.6s ease-out both; }
.welcome-name { animation: welcome-fade-in 0.6s ease-out 0.15s both; }
.welcome-scene { animation: welcome-fade-in 0.6s ease-out 0.3s both; }
.welcome-desc { animation: welcome-fade-in 0.6s ease-out 0.45s both; }
.welcome-examples { animation: welcome-fade-in 0.6s ease-out 0.6s both; }
.welcome-action { animation: welcome-fade-in 0.6s ease-out 0.75s both; }
```

The welcome screen is a UI surface (not a modal/drawer), so 300ms applies. 600ms makes the empty state feel sluggish — the user is waiting for content to appear.

Also: `ease-out` here is the built-in keyword, not the token `var(--ease-out)`.

## Target

Reduce duration to 300ms. Keep the stagger delays (they create the sequential reveal effect). Replace `ease-out` with `var(--ease-out)`:

```css
/* target */
.welcome-avatar { animation: welcome-fade-in 0.3s var(--ease-out) both; }
.welcome-name { animation: welcome-fade-in 0.3s var(--ease-out) 0.1s both; }
.welcome-scene { animation: welcome-fade-in 0.3s var(--ease-out) 0.2s both; }
.welcome-desc { animation: welcome-fade-in 0.3s var(--ease-out) 0.3s both; }
.welcome-examples { animation: welcome-fade-in 0.3s var(--ease-out) 0.4s both; }
.welcome-action { animation: welcome-fade-in 0.3s var(--ease-out) 0.5s both; }
```

Adjust stagger from 150ms to 100ms (within the 30-80ms spec range when accounting for the reduced total duration).

## Repo conventions to follow

- Tokens: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--duration-fast: 0.15s`, `--duration-slow: 0.25s`.
- Use `var(--ease-out)` not bare `ease-out`.
- The `@media (prefers-reduced-motion: no-preference)` gating at line ~213 is correct — keep it.

## Steps

1. Open `web/src/components/WelcomeScreen.vue`.
2. Replace lines 216-231 with the target code above.
3. Keep the `@keyframes welcome-fade-in` definition unchanged (it just defines opacity 0→1 + transform).
4. Keep the `@media (prefers-reduced-motion: no-preference)` wrapper.

## Boundaries

- Do NOT change the `@keyframes welcome-fade-in` definition.
- Do NOT change the stagger pattern (sequential reveal is the desired effect).
- Do NOT remove the `prefers-reduced-motion: no-preference` gate.
- Do NOT touch other animations in the file (e.g. `welcome-spin`).

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Open the app with no sessions — confirm the welcome screen elements appear within ~800ms total (was ~1350ms).
  - Confirm the staggered reveal is still visible (not all-at-once).
  - In DevTools Animations panel, confirm each animation is 300ms.
- **Done when**: All 6 entrance animations use `0.3s var(--ease-out)`; total reveal time feels snappy.
