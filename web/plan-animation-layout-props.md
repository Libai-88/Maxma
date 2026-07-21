# Animation Fix: Replace Layout-Property Transitions with GPU-Friendly Alternatives

> **Goal:** Replace high-impact `width`/`max-height` transitions with GPU-friendly `clip-path`/`transform` alternatives where feasible, and add `will-change` hints where full replacement is too risky.

**Original scope (overly broad):** 4 simultaneous changes — sidebar width, BarChart width, ChatInput resize-handle, MessageBubble max-height.
**Revised scope:** Focus on two changes with real performance impact and acceptable risk. Drop BarChartMini (not on critical path) and resize-handle (negligible perf impact).

**Reasoning:**
- `review-animations` standard #7: animate `transform` and `opacity` only. Layout properties trigger all three rendering steps.
- Sidebar collapse/expand is a frequent UI transition — worth optimizing.
- MessageBubble collapse is less frequent but the `max-height` approach is a common pain point (can't animate `auto` height, pixel values are fragile).

---

## Files

- Modify: `src/App.vue:454` — sidebar width transition
- Modify: `src/components/MessageBubble.vue:216` — bubble-content max-height transition

---

## Steps

### Step 1: Sidebar — add will-change + gate, don't refactor to transform

The sidebar's collapse logic likely depends on `width` for layout purposes. Refactoring to `transform: translateX()` would require changing how sibling content reflows, which is high risk and out of scope.

**Minimal safe fix:**

In `src/App.vue`, find the sidebar transition rule:

```css
.sidebar {
  position: relative;
  transition: width 0.25s ease;
}
```

Replace with:

```css
.sidebar {
  position: relative;
  will-change: width;
}
@media (prefers-reduced-motion: no-preference) {
  .sidebar {
    transition: width 0.25s var(--ease-out);
  }
}
```

Changes:
1. Added `will-change: width` — hints the browser to promote this element to a compositor layer, avoiding layout thrashing during the transition.
2. Gated the transition behind `prefers-reduced-motion: no-preference` — for reduced-motion users, width snaps instantly (which is better than a slow 250ms width animation).
3. Swapped `ease` → `var(--ease-out)` — uses the project's own easing token instead of the weak built-in.

This is a safe change. The sidebar's `width` still drives layout, but the compositor hint and motion gate minimize the performance cost.

### Step 2: MessageBubble collapse — use clip-path instead of max-height

In `src/components/MessageBubble.vue`, find:

```css
.bubble-content {
  overflow: hidden;
  transition: max-height 0.35s cubic-bezier(0, 0.3, 0, 1);
}
```

`max-height` transitions are a well-known anti-pattern:
- They require a hardcoded max value (brittle with dynamic content)
- The browser can't optimize them on the GPU
- 350ms exceeds the 300ms UI animation budget
- The `cubic-bezier(0, 0.3, 0, 1)` curve has a long tail that makes the collapse feel slow

**Replace with clip-path (GPU-composited property):**

```css
.bubble-content {
  overflow: hidden;
  clip-path: inset(0);
  transition: clip-path 0.25s var(--ease-out);
}
.bubble-content.collapsed {
  clip-path: inset(0 0 100% 0);
}
```

How this works:
- `clip-path: inset(0)` = fully visible (clips nothing)
- `clip-path: inset(0 0 100% 0)` = clips from the bottom upward (100% eaten from bottom)
- The content still takes up full height in the layout flow — if you need the collapsed state to also free up layout space, add `max-height: 0` on collapsed (but don't animate it — let clip-path handle the visual reveal/hide)

If layout-space freeing is required (so collapsed bubbles don't take up blank vertical space), combine both:

```css
.bubble-content {
  overflow: hidden;
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 0.25s var(--ease-out),
              clip-path 0.25s var(--ease-out);
}
.bubble-content.collapsed {
  grid-template-rows: 0fr;
  clip-path: inset(0 0 100% 0);
}
.bubble-content > * {
  min-height: 0;
}
```

This is the ideal solution — `grid-template-rows` handles the layout collapse (freeing space) while `clip-path` provides the visual effect. Both are GPU-friendly. Test this carefully, as grid-based collapse depends on the internal DOM structure.

### Step 3: Remove unused max-height values

After implementing the clip-path change, find and remove any explicit `max-height` or `height` values that were controlling the collapsed state:

```css
/* DELETE if present */
.bubble-content.collapsed {
  max-height: 0;
  opacity: 0.5;
}
```

Replace with the clip-path approach from Step 2. Keep `opacity` changes if they aid readability of the collapsed state — opacity is GPU-composited.

### Step 4: Verify

```bash
cd d:\Maxma\MaxmaHere\web
npm run build
```

### Step 5: Feel-check

- Collapse a long assistant message: the fold should animate smoothly in ~250ms with a gentle ease-out.
- Expand it: the content should reveal from top to bottom (or fade in, depending on chosen approach).
- Toggle sidebar collapse: no jank, width transition feels smooth.
- Open Chrome DevTools > Performance > paint flashing. Verify no green rectangles flash during the bubble collapse (green = paint, which means layout-triggering properties are being animated).

### Step 6: Commit

```bash
cd d:\Maxma\MaxmaHere\web
git add src/App.vue src/components/MessageBubble.vue
git commit -m "fix(animations): replace layout-property transitions with GPU-friendly alternatives"
```
