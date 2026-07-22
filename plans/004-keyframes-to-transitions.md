# 004 — Convert rapid-trigger `@keyframes` to interruptible CSS transitions

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Interruptibility
- **Estimated scope**: 5 files, ~8 animation sites

## Problem

8 rapid-trigger UI animations use `@keyframes`, which restart from zero on interruption. For UI triggered rapidly (quoting different messages, opening sticker previews, toggling sidebar), this causes janky restarts instead of smooth retargeting.

```css
/* web/src/components/ChatInput.vue:1848 — quote-pop-in, re-triggered per quote selection */
animation: quote-pop-in 0.15s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));

/* web/src/components/StickerInline.vue:142 — stickerAppear, per sticker render */
animation: stickerAppear 0.2s ease-out;

/* web/src/components/StickerPreviewOverlay.vue:154,165 — per preview open */
animation: previewFadeIn 0.16s ease;
animation: previewScaleIn 0.2s ease;

/* web/src/components/FloatSidebar.vue:54,57 — per hover enter/leave */
animation: fs-slide-in 0.25s var(--ease-out, ...);
animation: fs-slide-out 0.2s var(--ease-out, ...);

/* web/src/components/SessionItem.vue:113 — per session list render */
animation: session-slide-in 0.25s ease-out both;

/* web/src/components/ChatInput.vue:1122,1167 — error banner appears */
animation: chat-error-in 0.2s ease-out;
```

## Target

Replace `@keyframes`-based `animation:` with Vue `<Transition>` + CSS `transition` for interruptible behavior:

```css
/* target pattern (DsToast.vue:226-238 is the exemplar) */
.foo-enter-active, .foo-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}
.foo-enter-from, .foo-leave-to {
  opacity: 0;
  transform: scale(0.95);  /* or translateY(8px) depending on direction */
}
```

## Repo conventions to follow

- Vue `<Transition>` / `<TransitionGroup>` wrappers already used in 14 files (16 sites).
- Transition names: `popup`, `ref-tag`, `quote-pop`, `menu-pop`, `mv-fade`, `fade`, `session-drawer`, `card`, `constify-pop`, `workbench`, `ds-select`, `ds-overlay`, `ds-modal`, `ds-toast`, `ds-tooltip`.
- Exemplar: `web/src/components/ui/DsToast.vue:226-238` — correct pattern using `transition` (not `animation`).
- Tokens: `--duration-fast` (0.15s), `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)`.

## Steps

1. **ChatInput.vue — quote-pop-in** (line ~1848):
   - Wrap `.quote-pop` element in `<Transition name="quote-pop">`.
   - Replace `animation: quote-pop-in 0.15s ...` with:
     ```css
     .quote-pop-enter-active, .quote-pop-leave-active {
       transition: opacity var(--duration-instant) var(--ease-out),
                   transform var(--duration-instant) var(--ease-out);
     }
     .quote-pop-enter-from, .quote-pop-leave-to {
       opacity: 0; transform: scale(0.8);
     }
     ```
   - Remove the `@keyframes quote-pop-in` definition (line ~1853).
   - Remove the `animation: quote-pop-in 0.1s reverse` exit (line ~1851).

2. **StickerInline.vue — stickerAppear** (line ~142):
   - Wrap sticker image in `<Transition name="sticker-appear">`.
   - Replace `animation: stickerAppear 0.2s ease-out` with:
     ```css
     .sticker-appear-enter-active { transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
     .sticker-appear-enter-from { opacity: 0; transform: scale(0.8); }
     ```
   - Remove `@keyframes stickerAppear` (line ~168).

3. **StickerPreviewOverlay.vue — previewFadeIn + previewScaleIn** (lines ~154, 165):
   - Wrap `.sticker-preview-overlay` in `<Transition name="preview-fade">` and `.preview-card` in `<Transition name="preview-scale">`.
   - Replace both `animation:` declarations with `transition`-based enter/leave.
   - Remove `@keyframes previewFadeIn` and `@keyframes previewScaleIn` (lines ~276, 281).

4. **FloatSidebar.vue — fs-slide-in/out** (lines ~54, 57):
   - Wrap sidebar in `<Transition name="fs-slide">`.
   - Replace both `animation:` declarations with:
     ```css
     .fs-slide-enter-active, .fs-slide-leave-active {
       transition: transform var(--duration-slow) var(--ease-drawer),
                   opacity var(--duration-slow) var(--ease-out);
     }
     .fs-slide-enter-from, .fs-slide-leave-to {
       transform: translateX(-100%); opacity: 0;
     }
     ```
   - Remove `@keyframes fs-slide-in` and `@keyframes fs-slide-out` (lines ~60, 64).

5. **SessionItem.vue — session-slide-in** (line ~113):
   - This is a list entrance. If using `<TransitionGroup>`, add `name="session-slide"`.
   - Replace `animation: session-slide-in 0.25s ease-out both` with:
     ```css
     .session-slide-enter-active { transition: opacity var(--duration-slow) var(--ease-out), transform var(--duration-slow) var(--ease-out); }
     .session-slide-enter-from { opacity: 0; transform: translateY(8px); }
     ```
   - Remove `@keyframes session-slide-in` (line ~116).
   - NOTE: This interacts with Plan 009 (stagger). Apply stagger AFTER this conversion.

6. **ChatInput.vue — chat-error-in** (lines ~1122, 1167):
   - Wrap error banners in `<Transition name="chat-error">`.
   - Replace `animation: chat-error-in 0.2s ease-out` with:
     ```css
     .chat-error-enter-active { transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
     .chat-error-enter-from { opacity: 0; transform: translateY(-8px); }
     ```
   - Remove `@keyframes chat-error-in` (line ~1148).

## Boundaries

- Do NOT touch infinite-loop `@keyframes` (spinners, pulses, ambient animations) — those are correct uses of keyframes.
- Do NOT touch `@keyframes` used for one-shot decorative animations that aren't rapidly re-triggered.
- Do NOT change the visual end state (opacity: 1, transform: none) — only the animation mechanism.
- Preserve the `prefers-reduced-motion: no-preference` gating where it exists.
- If a component's template structure makes wrapping `<Transition>` difficult (e.g., the animated element is deep in a v-for), use `@starting-style` CSS as a fallback instead.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Quote a message, then immediately quote a different one — confirm the quote chip transitions smoothly without restarting from zero.
  - Open sticker preview, immediately open a different sticker — confirm smooth retarget.
  - Hover the float sidebar in/out rapidly — confirm no janky restart.
  - Create multiple sessions quickly — confirm items slide in without restarting.
  - In DevTools Animations panel, confirm transitions (not animations) are registered.
- **Done when**: All 8 sites use CSS transitions via `<Transition>`; no `@keyframes` remain for rapid-trigger UI; rapid re-triggering produces smooth retargeting.
