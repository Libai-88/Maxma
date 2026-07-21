# Animation Fix: Gate Hover Motion and Tone Down Aggressive Scale

> **Goal:** Ensure hover animations only run on pointer devices and avoid oversized scale jumps. Touch devices fire false hover on tap, causing unexpected motion.

**Verdict:** Several hover effects are gated only by `prefers-reduced-motion: no-preference` but not by `@media (hover: hover) and (pointer: fine)`. This includes the design-system button lift, logo hover in App.vue, and many tool-bubble buttons. Also, some hover scales exceed the recommended subtle range (0.95–0.98 for press, 1.02–1.05 for hover).

---

## Files

- Modify: `src/assets/styles/design-system.css` — `.ds-btn:hover` lift, `.ds-card:hover`
- Modify: `src/components/ChatInput.vue` — `.btn-send:hover`
- Modify: `src/App.vue` — logo hover scales
- Modify: `src/components/tools/_shared/shared.css` — `.tool-btn:hover`
- Modify: `src/components/tools/_shared/BubbleChrome.vue` — bubble-level hover
- Modify: `src/components/tools/AskUserBubble.vue` — button hovers
- Modify: `src/components/tools/FilesBubble.vue` — file-item hovers
- Modify: `src/components/tools/PythonBubble.vue` — action button hovers

---

## Steps

### Step 0: Global recon — find all un-gated hover transforms

Run this to catalog all hover effects that need gating:

```bash
cd d:\Maxma\MaxmaHere\web
grep -rn "transform:\|scale(" src/components/ --include="*.css" --include="*.vue" | grep ":hover"
```

Review the output and apply the media query pattern from the steps below to each file found. The steps below cover the most important ones; add more as needed.

### Step 1: Tone down send button hover scale

In `src/components/ChatInput.vue`, find the `.btn-send:hover` block and change:

```css
@media (pointer: fine) {
  .btn-send:hover:not(:disabled) {
    background: var(--accent-hover, var(--accent));
    transform: scale(1.08);
    box-shadow: var(--shadow-md);
  }
}
```

to:

```css
@media (hover: hover) and (pointer: fine) {
  .btn-send:hover:not(:disabled) {
    background: var(--accent-hover, var(--accent));
    transform: scale(1.04);
    box-shadow: var(--shadow-md);
  }
}
```

The scale reduction from 1.08 → 1.04 is important: `1.08` makes the button feel like it's "jumping" at you; `1.04` is a subtle acknowledgment.

### Step 2: Gate design-system button hover lift

In `src/assets/styles/design-system.css`, wrap the `.ds-btn:hover` transform in the full pointer media query.

Current:

```css
@media (prefers-reduced-motion: no-preference) {
  .ds-btn:hover {
    transform: translateY(-2px);
    box-shadow:
      0 4px 16px var(--shadow-color),
      0 2px 4px var(--shadow-color);
  }
  .ds-btn:active {
    transform: scale(0.96);
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px var(--shadow-color);
    transition-duration: 80ms;
  }
}
```

Change to:

```css
@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
  .ds-btn:hover {
    transform: translateY(-2px);
    box-shadow:
      0 4px 16px var(--shadow-color),
      0 2px 4px var(--shadow-color);
  }
}
/* Keep :active OUTSIDE the hover gate — active feedback should always fire,
   but gate it behind reduced-motion separately */
@media (prefers-reduced-motion: no-preference) {
  .ds-btn:active {
    transform: scale(0.96);
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px var(--shadow-color);
    transition-duration: 80ms;
  }
}
```

Also gate `.ds-card:hover` — add a hover+pointer media query wrapper around it:

```css
@media (hover: hover) and (pointer: fine) {
  .ds-card:hover {
    border-color: var(--border-strong, color-mix(in srgb, var(--accent) 25%, var(--border)));
    box-shadow: var(--shadow-md);
    background: var(--surface-raised);
  }
}
```

### Step 3: Gate App.vue logo hover scales

In `src/App.vue`, find the logo hover blocks and add the hover/pointer gate:

```css
/* Current (around line 342-368) */
@media (prefers-reduced-motion: no-preference) {
  .logo:hover .logo-img { transform: scale(1.06); box-shadow: ...; }
  .logo:hover .logo-text { opacity: 0.8; }
  .sidebar.collapsed .logo-favicon:hover { transform: scale(1.1); }
}

/* Replace with: */
@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
  .logo:hover .logo-img { transform: scale(1.06); box-shadow: ...; }
  .logo:hover .logo-text { opacity: 0.8; }
}
@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
  .sidebar.collapsed .logo-favicon:hover { transform: scale(1.1); }
}
```

### Step 4: Gate tool-bubble hovers

In `src/components/tools/_shared/shared.css`, find `.tool-btn:hover` style and gate it:

```css
/* Before */
.tool-btn:hover:not(:disabled) {
  background: var(--bg-card);
  border-color: var(--border-strong, color-mix(in srgb, var(--accent) 30%, var(--border)));
}

/* After */
@media (hover: hover) and (pointer: fine) {
  .tool-btn:hover:not(:disabled) {
    background: var(--bg-card);
    border-color: var(--border-strong, color-mix(in srgb, var(--accent) 30%, var(--border)));
  }
}
```

Similarly for `BubbleChrome.vue`:

In `src/components/tools/_shared/BubbleChrome.vue`, find all `:hover` blocks on interactive elements (`.bubble-chrome__action`, `.bubble-chrome__header-btn`) and wrap them:

```css
@media (hover: hover) and (pointer: fine) {
  .bubble-chrome__action:hover { ... }
  .bubble-chrome__header-btn:hover { ... }
}
```

### Step 5: Gate AskUserBubble button hovers

In `src/components/tools/AskUserBubble.vue`, find the hover blocks (around lines 394, 507, 521).

This file has multiple `transition: background 0.15s` + hover rules. Wrap each hover in:

```css
@media (hover: hover) and (pointer: fine) {
  .ask-user-btn:hover:not(:disabled) {
    /* existing hover styles */
  }
}
```

### Step 6: Gate FilesBubble and PythonBubble hovers

Same pattern for `src/components/tools/FilesBubble.vue` and `src/components/tools/PythonBubble.vue` — wrap all `:hover` style blocks on interactive elements in `@media (hover: hover) and (pointer: fine)`.

### Step 7: Verify

```bash
cd d:\Maxma\MaxmaHere\web
npm run build
```

### Step 8: Feel-check

- On desktop: hover the send button — lift should be subtle (1.04). Hover a `.ds-btn` — it still lifts 2px. Hover tool-bubble buttons — they should highlight but not trigger on touch.
- On touch device (or DevTools mobile emulation): tap buttons — no hover motion should fire, only `:active` scale feedback.
- Open the browser DevTools console, set `emulate touch`, and verify that tapping `.ds-card` doesn't leave it stuck in a hover state.

### Step 9: Commit

```bash
cd d:\Maxma\MaxmaHere\web
git add src/components/ChatInput.vue src/assets/styles/design-system.css src/App.vue src/components/tools/_shared/shared.css src/components/tools/_shared/BubbleChrome.vue src/components/tools/AskUserBubble.vue src/components/tools/FilesBubble.vue src/components/tools/PythonBubble.vue
git commit -m "fix(animations): gate hover motion behind pointer media across all components"
```
