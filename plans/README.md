# Frontend Motion & Design Improvement Plans

Based on audit against Emil Kowalski's design engineering philosophy and Apple's fluid interface principles. Commit stamp: `bf78e8d`.

## Phase 1 — Motion Fundamentals (DONE)

| # | Title | Severity | Status | Category |
|---|---|---|---|---|
| 001 | Fix global `prefers-reduced-motion` one-size-fits-all override | HIGH | DONE | Accessibility |
| 002 | Adopt `DsButton` to replace native `<button>` elements | HIGH | DONE | Physicality |
| 003 | Add origin-aware `transform-origin` to popovers/dropdowns | HIGH | DONE | Physicality & origin |
| 004 | Convert rapid-trigger `@keyframes` to interruptible CSS transitions | HIGH | DONE | Interruptibility |
| 005 | Consolidate bare `ease` to motion tokens | HIGH | DONE | Easing & cohesion |
| 006 | Reduce WelcomeScreen entrance duration to ≤300ms | MEDIUM | DONE | Easing & duration |
| 007 | Gate hover transform animations for touch devices | MEDIUM | DONE | Accessibility |
| 008 | Deduplicate spin/fade keyframes to canonical `maxma-*` set | LOW | DONE | Cohesion & tokens |
| 009 | Add stagger to SessionItem list entrance | LOW | DONE | Cohesion & missed opportunity |

## Phase 2 — Apple Materials & Depth

| # | Title | Severity | Status | Category |
|---|---|---|---|---|
| 010 | Activate the dormant `glass.css` material system | CRITICAL | TODO | Materials |
| 011 | Replace hard 1px dividers with scroll-fade masks | CRITICAL | TODO | Materials & depth |
| 012 | Add materialize animation (blur + scale) to glass surfaces | HIGH | TODO | Materials |
| 013 | Honor `prefers-reduced-transparency` on all backdrop-filter surfaces | HIGH | TODO | Accessibility |
| 014 | Fix ContextMenu `-webkit-` vs standard `backdrop-filter` blur mismatch | MEDIUM | TODO | Materials |
| 015 | Consolidate ad-hoc shadows to `--shadow-*` tokens | LOW | TODO | Cohesion & tokens |
| 016 | Remove dead `.sidebar` CSS block in App.vue | LOW | TODO | Cleanup |

## Phase 3 — Apple Typography

| # | Title | Severity | Status | Category |
|---|---|---|---|---|
| 017 | Enable `font-optical-sizing: auto` globally | HIGH | TODO | Typography |
| 018 | Define `--tracking-*` tokens and unify letter-spacing units | MEDIUM | TODO | Typography |
| 019 | Add vibrancy treatment to text on glass surfaces | MEDIUM | TODO | Materials & typography |

## Phase 4 — Apple Gestures & Momentum

| # | Title | Severity | Status | Category |
|---|---|---|---|---|
| 020 | Add velocity handoff + spring inertia to MediaViewer drag | HIGH | TODO | Gestures |
| 021 | Add rubber-band resistance + spring snap to ChatInput resize | HIGH | TODO | Gestures |
| 022 | Add `overscroll-behavior: contain` to all scroll containers | MEDIUM | TODO | Scroll |
| 023 | Add floating "scroll to bottom" button to chat | MEDIUM | TODO | UX |

## Execution Order

```
Phase 2 (materials — highest impact, glass.css already exists):
  010  ← import glass.css + apply classes (unblocks 012, 013, 019)
  011  ← scroll-fade masks (independent)
  014  ← quick fix (independent)
  012  ← depends on 010
  013  ← depends on 010
  015, 016  ← independent cleanup

Phase 3 (typography — independent of Phase 2):
  017  ← global, no dependencies
  018  ← independent
  019  ← depends on 010 (glass surfaces must exist)

Phase 4 (gestures — independent):
  020, 021, 022, 023  ← all independent
```

## Out of Scope (explicitly excluded)

- Replacing the custom serif font stack with `system-ui` — this is a deliberate brand identity choice, not a defect.
- Full spring-library migration for all animations — Phase 4 targets only the two gesture surfaces that hard-stop.
- Theme switch color transition — low priority, separate effort.
