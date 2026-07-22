# 021 — Add rubber-band resistance + spring snap to ChatInput resize

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Gestures
- **Estimated scope**: 1 file, ~50 lines changed

## Problem

Apple: "At an edge, resist progressively instead of stopping hard. A hard stop reads as frozen; continuous resistance reads as responsive."

`web/src/components/ChatInput.vue:1062-1105` resize handle:
- `startResize` (line 1062-1082): uses `setPointerCapture` (good), records start Y + height.
- `onResizeMove` (line 1084-1090): `customHeight.value = Math.max(initialHeight, Math.min(600, resizeStartHeight + delta))` — **hard clamps at `[initialHeight, 600]`**. Hitting the boundary is an instant stop.
- `onResizeEnd` (line 1092-1105): releases capture, removes listeners. **No spring-back, no snap, no momentum.** Height stays exactly where the pointer left it.

Problems:
1. Hard clamp at min/max — no progressive resistance (rubber-band).
2. No snap to preferred heights on release — the height stays at an arbitrary pixel value.
3. No velocity tracking or momentum.

## Target

1. **Rubber-band at boundaries** — When dragging past min/max, apply progressive resistance (the further past the boundary, the less the height changes).
2. **Spring snap on release** — If released near a preset height, snap to it with a spring animation.
3. **Optional: velocity-based snap** — If the user flicks, snap to the nearest boundary in the flick direction.

### Rubber-band function

```typescript
function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function onResizeMove(e: PointerEvent) {
  const delta = e.clientY - resizeStartY;
  let targetHeight = resizeStartHeight + delta;

  const MIN = initialHeight;
  const MAX = 600;

  if (targetHeight < MIN) {
    const overshoot = MIN - targetHeight;
    targetHeight = MIN - rubberband(overshoot, MIN, 0.55);
  } else if (targetHeight > MAX) {
    const overshoot = targetHeight - MAX;
    targetHeight = MAX + rubberband(overshoot, MAX, 0.55);
  }

  customHeight.value = targetHeight;
}
```

### Spring snap on release

```typescript
const SNAP_HEIGHTS = [initialHeight, 200, 300, 400, 500, 600]; // preset heights
const SNAP_THRESHOLD = 40; // px — snap if within this distance of a preset

function onResizeEnd(e: PointerEvent) {
  // Clamp to valid range first
  let finalHeight = Math.max(initialHeight, Math.min(600, customHeight.value));

  // Find nearest snap point
  const nearest = SNAP_HEIGHTS.reduce((prev, curr) =>
    Math.abs(curr - finalHeight) < Math.abs(prev - finalHeight) ? curr : prev
  );

  if (Math.abs(nearest - finalHeight) < SNAP_THRESHOLD) {
    // Snap with spring animation
    animateSnap(customHeight.value, nearest);
  } else {
    // Just clamp to valid range
    customHeight.value = finalHeight;
  }

  // ... cleanup (remove listeners, release capture) ...
}

function animateSnap(from: number, to: number) {
  const duration = 250; // ms
  const startTime = performance.now();

  function frame(now: number) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    // Ease-out spring approximation
    const eased = 1 - Math.pow(1 - t, 3);
    customHeight.value = from + (to - from) * eased;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      customHeight.value = to;
    }
  }

  requestAnimationFrame(frame);
}
```

## Repo conventions to follow

- Resize handle code in `web/src/components/ChatInput.vue:1062-1105`.
- The handle uses `setPointerCapture` — keep this.
- `customHeight` is a reactive ref — the snap animation updates this ref.
- Respect `prefers-reduced-motion: reduce` — skip the spring animation and snap instantly.

## Steps

1. **Add rubber-band to `onResizeMove`** (line 1084-1090):
   - Replace the hard `Math.max/Math.min` clamp with the rubber-band function.
   - When below `initialHeight`, apply progressive resistance instead of hard stop.
   - When above `600`, apply progressive resistance instead of hard stop.
   - The visual effect: the input resists at boundaries but doesn't freeze.

2. **Add snap presets and threshold**:
   - Define `SNAP_HEIGHTS` array with preset heights (e.g., `[initialHeight, 200, 300, 400, 500, 600]`).
   - Define `SNAP_THRESHOLD = 40` (px).

3. **Add `animateSnap` function**:
   - Uses `requestAnimationFrame` to animate `customHeight` from current to target.
   - Duration: 250ms with ease-out cubic.
   - Cancel any existing snap animation on new pointer-down.

4. **Update `onResizeEnd`** (line 1092-1105):
   - After releasing, find nearest snap point.
   - If within `SNAP_THRESHOLD`, animate to it.
   - Otherwise, clamp to `[initialHeight, 600]` range.
   - Keep existing cleanup (remove listeners, release capture).

5. **Add reduced-motion support**:
   ```typescript
   const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
   if (prefersReducedMotion) {
     customHeight.value = nearest; // instant snap, no animation
   } else {
     animateSnap(customHeight.value, nearest);
   }
   ```

6. **Cancel snap on new drag** — In `startResize`, cancel any active snap animation (if the user grabs the handle while it's snapping, interrupt it).

## Boundaries

- Do NOT change the resize handle's visual appearance or position.
- Do NOT change `initialHeight` or the max (600px) — these are the valid range.
- Do NOT add velocity-based snapping in this plan — just rubber-band + position-based snap. Velocity can be added later if needed.
- Keep the rubber-band subtle — `constant = 0.55` gives moderate resistance. If it feels too loose or too tight, adjust.
- The snap animation should be quick (250ms) — don't make the user wait.
- Test with both mouse and touch.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Drag the resize handle to the min height and keep dragging down — confirm progressive resistance (input shrinks slower and slower, doesn't freeze).
  - Drag to the max height and keep dragging up — same progressive resistance.
  - Release near a preset height (e.g., 300px) — confirm it snaps to 300 with a smooth animation.
  - Release far from any preset — confirm it clamps to the nearest boundary.
  - Grab the handle mid-snap — confirm the snap is interrupted and follows the new drag.
  - Toggle `prefers-reduced-motion: reduce` — confirm instant snap (no animation).
- **Done when**: Resize has rubber-band resistance at boundaries; spring snap on release; interruptible; reduced-motion respected.
