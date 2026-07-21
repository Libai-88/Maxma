# Animation Fix: Replace `scaleY(0)` Entrance in Toolbar Animation

> **Goal:** Prevent the toolbar entrance from appearing "out of nothing."

**Verdict:** `animations.css:50-53` defines `maxma-tool-bar-in` starting from `transform: scaleY(0)`. Per `emil-design-eng` and `review-animations`, nothing in the real world appears from zero scale. Start from `scaleY(0.95)` combined with opacity.

Also sweep the codebase for any other `scaleY(0)`, `scaleX(0)`, or `scale(0)` usage in animation contexts.

---

## Files

- Modify: `src/assets/styles/animations.css:50-53` — `maxma-tool-bar-in` keyframe
- Potentially modify: other files found by the global sweep in Step 0

---

## Steps

### Step 0: Global sweep for zero-scale animations

Run this to find any other zero-scale patterns:

```bash
cd d:\Maxma\MaxmaHere\web
grep -rn "scale[XY]\?(0)" src/ --include="*.css" --include="*.vue"
```

Expected patterns to catch:
- `scale(0)` — absolute zero scale (worst)
- `scaleX(0)` / `scaleY(0)` — zero on one axis (what this plan targets)
- `scale(0.5)` or lower — near-zero, also debatable

For each hit that is part of an animation or transition context (not a static hidden state like `display: none`'s cousin), add it to the list of changes.

Common false positives:
- `transform: scale(0)` on a hidden element that's never animated in/out (static state — acceptable)
- Transforms applied via JS for internal calculations (not visual — acceptable)

### Step 1: Update the maxma-tool-bar-in keyframe

In `src/assets/styles/animations.css`, change:

```css
@keyframes maxma-tool-bar-in {
  from { opacity: 0; transform: scaleY(0); }
  to   { opacity: 1; transform: scaleY(1); }
}
```

to:

```css
@keyframes maxma-tool-bar-in {
  from { opacity: 0; transform: scaleY(0.95); }
  to   { opacity: 1; transform: scaleY(1); }
}
```

The difference between 0.95 and 1 is 5% — barely visible as a starting point but enough to eliminate the "appears from nothing" feeling. The element always has an almost-full shape; only opacity fades it in.

### Step 2: Apply same pattern to any other zero-scale keyframes found in Step 0

For each animation-related `scale(0)`, `scaleX(0)`, or `scaleY(0)` found, apply:

- `scale(0)` → `scale(0.95)` (with `opacity: 0` on `from`)
- `scaleX(0)` → `scaleX(0.95)` (if used for horizontal reveals)
- `scaleY(0)` → `scaleY(0.95)` (if used for vertical reveals)

**Do not change** static hidden states that are not animated (e.g., `.el.hidden { transform: scale(0); }` without a `transition` or `animation` on it).

### Step 3: Check reduced-motion override

Ensure the reduced-motion media query later in `animations.css` still handles this keyframe. It should either set `animation: none` or keep only opacity. No change needed if it already covers `.maxma-*` classes.

### Step 4: Find and verify usage of maxma-tool-bar-in

```bash
cd d:\Maxma\MaxmaHere\web
grep -rn "maxma-tool-bar-in" src/ --include="*.vue" --include="*.css"
```

Open the component(s) that use it and visually confirm the toolbar appears with a subtle scale rather than a grow-from-zero effect.

### Step 5: Feel-check

Trigger the toolbar that uses `maxma-tool-bar-in`. It should feel like it unrolls from slightly compressed (already has a visible presence from frame 1) rather than expanding from nothing.

### Step 6: Commit

```bash
cd d:\Maxma\MaxmaHere\web
git add src/assets/styles/animations.css
# Add any other files modified in Step 2
git commit -m "fix(animations): avoid scale(0) — replace zero-scale keyframes with scale(0.95)+opacity"
```
