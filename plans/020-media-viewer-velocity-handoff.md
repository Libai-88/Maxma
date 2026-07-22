# 020 — Add velocity handoff + spring inertia to MediaViewer drag

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Gestures
- **Estimated scope**: 1 file, ~80 lines changed

## Problem

Apple: "When a gesture ends, the animation must continue at the finger's exact velocity. Pass the pointer's release velocity as the spring's initial velocity."

`web/src/composables/useMediaTransform.ts` handles image drag in MediaViewer. Current behavior:
- `onPointerDown` (line 63-72): records start position, sets `isDragging = true`, calls `setPointerCapture` (good).
- `onPointerMove` (line 74-83): sets transform directly from delta-since-down. **No velocity history tracked.**
- `onPointerUp` (line 85-88): sets `isDragging = false`, releases capture. **No velocity handoff, no spring, no inertia.** The image freezes at the last position — a hard stop.

`MediaViewer.vue:63`: `transition: transform 0.1s ease-out` is active when not dragging, but since the transform value doesn't change on release, nothing animates.

A user flicking the image expects it to carry momentum and decelerate naturally. Instead, it stops dead.

## Target

1. Track velocity history during `pointermove` (last ~5 events with timestamps).
2. On `pointerup`, compute release velocity.
3. Hand off to a decaying animation (spring or exponential decay) that moves the image in the release direction, decelerating to zero.
4. Optionally: if the image is dragged past a threshold with sufficient velocity, dismiss the viewer (flick-to-dismiss).

### Velocity tracking

```typescript
interface VelocitySample {
  x: number;
  y: number;
  t: number; // timestamp (ms)
}

const velocityHistory: VelocitySample[] = [];
const MAX_SAMPLES = 5;

function onPointerMove(e: PointerEvent) {
  // ... existing transform update ...
  velocityHistory.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  if (velocityHistory.length > MAX_SAMPLES) velocityHistory.shift();
}

function computeReleaseVelocity(): { vx: number; vy: number } {
  if (velocityHistory.length < 2) return { vx: 0, vy: 0 };
  const first = velocityHistory[0];
  const last = velocityHistory[velocityHistory.length - 1];
  const dt = last.t - first.t;
  if (dt === 0) return { vx: 0, vy: 0 };
  return {
    vx: (last.x - first.x) / dt * 1000, // px/s
    vy: (last.y - first.y) / dt * 1000,
  };
}
```

### Spring/decay animation on release

Use `requestAnimationFrame` to animate the transform from the release position + velocity, decaying to rest:

```typescript
function onPointerUp(e: PointerEvent) {
  const { vx, vy } = computeReleaseVelocity();
  velocityHistory.length = 0;
  isDragging = false;
  releasePointerCapture(e.pointerId);

  if (Math.abs(vx) > 10 || Math.abs(vy) > 10) {
    // Hand off to inertia animation
    animateInertia(vx, vy);
  }
}

function animateInertia(vx: number, vy: number) {
  const deceleration = 0.95; // per-frame multiplier (adjust for 60fps)
  const threshold = 5; // px/s — stop when velocity drops below this

  let currentVx = vx / 60; // convert px/s to px/frame
  let currentVy = vy / 60;
  let lastTime = performance.now();

  function frame(now: number) {
    const dt = (now - lastTime) / 16.67; // normalize to 60fps frames
    lastTime = now;

    currentVx *= Math.pow(deceleration, dt);
    currentVy *= Math.pow(deceleration, dt);

    transform.value.x += currentVx * dt;
    transform.value.y += currentVy * dt;

    if (Math.abs(currentVx) > threshold / 60 || Math.abs(currentVy) > threshold / 60) {
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = null;
    }
  }

  rafId = requestAnimationFrame(frame);
}
```

### Optional: Flick-to-dismiss

If the image is dragged beyond a threshold with sufficient velocity, dismiss the viewer:

```typescript
const DISMISS_THRESHOLD = 0.11; // velocity threshold (px/ms)
const DISMISS_DISTANCE = 200; // px — if dragged this far with velocity, dismiss

function onPointerUp(e: PointerEvent) {
  const { vx, vy } = computeReleaseVelocity();
  const speed = Math.sqrt(vx * vx + vy * vy);
  const distance = Math.sqrt(
    (transform.value.x - dragStartTx) ** 2 +
    (transform.value.y - dragStartTy) ** 2
  );

  if (speed / 1000 > DISMISS_THRESHOLD || distance > DISMISS_DISTANCE) {
    emit('dismiss');
    return;
  }

  // Otherwise, animate inertia
  if (speed > 10) {
    animateInertia(vx, vy);
  }
}
```

## Repo conventions to follow

- Composable: `web/src/composables/useMediaTransform.ts`.
- MediaViewer component: `web/src/components/MediaViewer.vue`.
- The composable already uses `setPointerCapture` — keep this.
- The composable exposes `transform` as a reactive ref — the inertia animation updates this ref.
- Clean up `requestAnimationFrame` on component unmount (add a `cancelAnimationFrame` in a cleanup function).
- Respect `prefers-reduced-motion: reduce` — skip the inertia animation and just snap to rest.

## Steps

1. **Add velocity tracking** to `useMediaTransform.ts`:
   - Add `velocityHistory: VelocitySample[]` array.
   - In `onPointerMove`, push `{ x, y, t: performance.now() }` to the array. Cap at 5 samples.
   - Add `computeReleaseVelocity()` function.

2. **Add inertia animation**:
   - Add `animateInertia(vx, vy)` function using `requestAnimationFrame`.
   - Use exponential decay (0.95 per frame at 60fps) — this is the web equivalent of Apple's `decelerationRate: 0.998`.
   - Add `rafId` variable to track the animation frame. Cancel it on new pointer-down or unmount.

3. **Wire up `onPointerUp`**:
   - Compute release velocity.
   - Cancel any existing inertia animation.
   - If velocity > threshold (10 px/s), start inertia animation.
   - If velocity > dismiss threshold AND image is dragged far enough, emit dismiss.

4. **Add cleanup**:
   - In the composable's cleanup/onUnmounted, cancel any active `requestAnimationFrame`.
   - On `onPointerDown`, cancel any active inertia (user grabbed the moving image — interrupt it).

5. **Reduced-motion support**:
   ```typescript
   const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
   if (prefersReducedMotion) {
     // Skip inertia, snap to rest
     return;
   }
   ```

6. **Optional: Flick-to-dismiss** — If implementing, add an `emit('dismiss')` or call the close handler when velocity + distance thresholds are met. Coordinate with `MediaViewer.vue` to handle the dismiss.

## Boundaries

- Do NOT change the zoom/wheel behavior — only the drag release.
- Do NOT add a physics library — use plain `requestAnimationFrame` + exponential decay. It's sufficient for inertia.
- Do NOT make the inertia too long — 300-500ms total decay is the sweet spot. If it takes 2s to stop, `deceleration` is too high.
- Do NOT forget to cancel `requestAnimationFrame` on unmount — memory leak.
- Test with both mouse and touch — pointer events should handle both.
- If the image is zoomed in (scale > 1), inertia should still work but maybe with more friction (the user is panning within a zoomed image, not flicking it away). Consider scaling deceleration by zoom level.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Open MediaViewer, drag the image and release while moving — confirm it carries momentum and decelerates naturally (not a hard stop).
  - Drag and release slowly — confirm it stays roughly where you released (low velocity = minimal inertia).
  - Flick quickly — confirm it moves further before stopping.
  - Grab the image mid-inertia — confirm it stops and follows your new drag (interruptible).
  - Toggle `prefers-reduced-motion: reduce` — confirm no inertia (snaps to rest).
  - If flick-to-dismiss is implemented: flick hard — confirm the viewer closes.
- **Done when**: Image drag release carries momentum with exponential decay; animation is interruptible; reduced-motion disables inertia; no memory leaks.
