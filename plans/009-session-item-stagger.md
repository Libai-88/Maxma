# 009 — Add stagger to SessionItem list entrance

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: LOW
- **Category**: Cohesion & missed opportunity
- **Estimated scope**: 1 file, ~5 lines added

## Problem

When the session list renders, all items appear simultaneously with the same `session-slide-in` animation. There's no stagger — the list pops in as a block rather than cascading.

```css
/* web/src/components/SessionItem.vue:113 — current */
animation: session-slide-in 0.25s ease-out both;
/* Applied to every item with no per-index delay */
```

## Target

Add a staggered `animation-delay` based on item index, capped at 8 items (so long lists don't wait too long):

```css
/* target */
/* Base animation (from Plan 004, after keyframes→transition conversion) */
.session-slide-enter-active {
  transition: opacity var(--duration-slow) var(--ease-out),
              transform var(--duration-slow) var(--ease-out);
}
.session-slide-enter-from { opacity: 0; transform: translateY(8px); }

/* Stagger: 50ms per item, capped at 8 items (400ms max delay) */
.session-item:nth-child(1) { transition-delay: 0ms; }
.session-item:nth-child(2) { transition-delay: 50ms; }
.session-item:nth-child(3) { transition-delay: 100ms; }
.session-item:nth-child(4) { transition-delay: 150ms; }
.session-item:nth-child(5) { transition-delay: 200ms; }
.session-item:nth-child(6) { transition-delay: 250ms; }
.session-item:nth-child(7) { transition-delay: 300ms; }
.session-item:nth-child(8) { transition-delay: 350ms; }
/* Items 9+ have no delay (appear immediately) */
```

If Plan 004 has not been executed yet (animation still uses `@keyframes`), use `animation-delay` instead of `transition-delay`.

## Repo conventions to follow

- Stagger spec: 30-80ms between items. 50ms is the midpoint.
- Exemplar: `WelcomeScreen.vue:216-231` uses staggered `animation-delay` (though at 150ms, which is above spec — Plan 006 fixes that).
- Tokens: `--duration-slow: 0.25s`, `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`.

## Steps

1. Open `web/src/components/SessionItem.vue`.
2. If Plan 004 is done (transition-based): add `transition-delay` per `nth-child`.
3. If Plan 004 is NOT done (keyframe-based): add `animation-delay` per `nth-child`.
4. Cap at 8 items — items 9+ get no delay.
5. Wrap in `@media (prefers-reduced-motion: no-preference)` — reduced-motion users should see items appear instantly (no stagger, no movement).

```css
@media (prefers-reduced-motion: no-preference) {
  .session-item:nth-child(1) { transition-delay: 0ms; }
  .session-item:nth-child(2) { transition-delay: 50ms; }
  /* ... through nth-child(8) */
}
```

## Boundaries

- Do NOT stagger beyond 8 items — long lists would take too long to reveal.
- Do NOT change the animation itself (Plan 004 handles keyframes→transition).
- Do NOT apply stagger to leave animations — only enter.
- Do NOT touch other list components (ref-tags, etc.) — this plan is SessionItem only.
- If the session list uses `<TransitionGroup>`, the stagger goes on the `.session-slide-enter-active` rule with `nth-child` on the item element.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Open the session sidebar with 5+ sessions — confirm items cascade in with 50ms stagger.
  - Confirm the stagger is subtle (not slow) — total reveal should be under 500ms.
  - Toggle `prefers-reduced-motion: reduce` — confirm all items appear instantly with no stagger.
- **Done when**: Session items enter with 50ms stagger (capped at 8); reduced-motion shows instant appearance.
