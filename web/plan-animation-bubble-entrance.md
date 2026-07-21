# Animation Fix: Replace High-Frequency Message Bubble Entrance with Interruptible Lightweight Transition

> **Goal:** Stop the bouncy, non-interruptible 300ms keyframe entrance on chat bubbles. High-frequency UI should not bounce, but should retain a subtle directional cue so new messages don't feel like they teleport in.

**Original verdict (overly aggressive):** Delete the animation entirely.
**Revised verdict:** Keep a lightweight, interruptible entrance — 150ms, `ease-out`, no bounce, transition-based instead of keyframe-based. This preserves spatial orientation (user from right, assistant from left) without the "jumps in" feel of the spring curve.

**Reasoning:**
- `emil-design-eng` frequency table: chat messages are seen dozens/hundreds of times per session. The bouncy `cubic-bezier(0.34, 1.56, 0.64, 1)` at 300ms is too much.
- But complete removal causes messages to teleport in with no spatial story — a subtle directional entrance (12px slide + fade, 150ms) is the right tradeoff.
- `apple-design` interruptibility: keyframes can't be retargeted mid-flight. CSS transitions can. This matters for rapid message sequences.

---

## Files

- Modify: `src/components/MessageBubble.vue` (lines 130-157)

---

## Steps

### Step 1: Replace ~keyframes + animation~ with transition + @starting-style

In `src/components/MessageBubble.vue`, replace the current entrance animation block:

```css
/* ── DELETE ── */
.message-row.user {
  justify-content: flex-end;
  animation: userBubbleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.message-row.assistant {
  justify-content: flex-start;
  animation: assistantBubbleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes userBubbleIn {
  from { opacity: 0; transform: translateX(16px) scale(0.96); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
@keyframes assistantBubbleIn {
  from { opacity: 0; transform: translateX(-16px) scale(0.96); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
```

with:

```css
/* ── Lightweight, interruptible entrance via transition + @starting-style ── */
.message-row.user {
  justify-content: flex-end;
  --row-slide-x: 12px;
}
.message-row.assistant {
  justify-content: flex-start;
  --row-slide-x: -12px;
}
.message-row {
  opacity: 1;
  transform: translateX(0);
  transition: opacity 0.15s var(--ease-out),
              transform 0.15s var(--ease-out);
  @starting-style {
    opacity: 0;
    transform: translateX(var(--row-slide-x, 12px));
  }
}
```

Note: `@starting-style` browser support is ~88% globally (Chrome 117+, Firefox 129+, Safari 17.4+). For older browsers, the transition will simply not play — elements appear instantly, which is acceptable.

### Step 2: Remove scale from entrance

The original animation included `scale(0.96) → scale(1)`. The transition above drops the scale component entirely (only opacity + translateX). This keeps the entrance feeling gentle without the "pops in" sensation.

**Why drop scale:** With a 150ms duration, combining opacity + translateX + scale creates a visually busy entrance for a high-frequency element. Two properties (opacity + X) are enough.

### Step 3: Verify no references remain to the old keyframes

```bash
cd d:\Maxma\MaxmaHere\web
grep -rn "userBubbleIn\|assistantBubbleIn" src/ --include="*.css" --include="*.vue"
```

Expected: no output.

### Step 4: Check reduced-motion compatibility

The existing `@media (prefers-reduced-motion: reduce)` block in this file should already handle this via the global `animation: none !important` rule. But verify that the new `transition` is also suppressed — add if missing:

```css
@media (prefers-reduced-motion: reduce) {
  .message-row {
    transition: none;
    opacity: 1;
    transform: none;
  }
}
```

### Step 5: Feel-check

Open the app, send several messages quickly:
- Each bubble should appear with a gentle directional fade (barely noticeable if you're not looking for it)
- No bounce, no pop
- Rapid messages should feel smooth — no animation queuing or jumping
- The existing hover lift on `.bubble:hover` should remain untouched

If the 150ms still feels too present for daily use, reduce to 100ms or keep only opacity.

### Step 6: Commit

```bash
cd d:\Maxma\MaxmaHere\web
git add src/components/MessageBubble.vue
git commit -m "fix(animations): replace bouncy message entrance with lightweight interruptible transition"
```
