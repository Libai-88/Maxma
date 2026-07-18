# Plan: ChatInput Focus Animation & Visual Enhancement

## Current State

File: `D:\Maxma\MaxmaHere\web\src\components\ChatInput.vue` (1751 lines)

### Task 1: Textarea `.input-area` Focus Effect

**Current CSS (lines 1622-1637):**
```css
.input-area {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 1em;
  line-height: 1.6;
  color: var(--text-primary);
  resize: none;
  font-family: inherit;
  min-height: 24px;
  max-height: 160px;
  overflow-y: auto;
  padding: 4px 2px 4px 10px;
}
```

The textarea (`class="input-area"`) currently has `border: none` and `outline: none` with no focus visual feedback. The parent `.chat-input` container already has `:focus-within` styling using `var(--accent-pink)`, but the textarea itself has no direct focus indicator.

**Planned changes:**

1. Add `.input-area:focus` rule with box-shadow glow (since `border: none`, we use box-shadow to create a "border-like" glow):
   ```css
   .input-area:focus {
     box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent);
     outline: none;
   }
   ```

2. Add `.input-area:focus-visible` rule for keyboard accessibility (overrides `outline: none` when browser determines focus should be visible):
   ```css
   .input-area:focus-visible {
     outline: 2px solid var(--accent);
     outline-offset: 2px;
   }
   ```

3. Keep the existing `outline: none` in `.input-area` base rule unchanged, but `:focus-visible` will override it for keyboard users.

### Task 2: Resize Handle Enhancement

**Current CSS (lines 1471-1494):**
```css
.resize-handle {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 12px;
  cursor: ns-resize;
  user-select: none;
  touch-action: none;
  flex-shrink: 0;
  margin-top: -2px;
}
.resize-handle-grip {
  width: 32px;
  height: 3px;
  border-radius: 2px;
  background: var(--border);
  transition: background 0.15s, width 0.2s;
  opacity: 0.5;
}
.resize-handle:hover .resize-handle-grip {
  background: var(--accent);
  width: 56px;
  opacity: 1;
}
```

The handle is minimally visible (just a short grey bar). On hover it widens and turns accent-colored.

**Planned changes:**

1. Add `::before` and `::after` pseudo-elements to `.resize-handle-grip` to create a 3-line grip pattern (classic drag handle):
   ```css
   .resize-handle-grip {
     position: relative;
     /* existing styles stay */
   }
   .resize-handle-grip::before,
   .resize-handle-grip::after {
     content: '';
     position: absolute;
     left: 50%;
     transform: translateX(-50%);
     width: 20px;
     height: 2px;
     border-radius: 1px;
     background: inherit;
     opacity: inherit;
     transition: inherit;
   }
   .resize-handle-grip::before {
     top: -4px;
   }
   .resize-handle-grip::after {
     top: 4px;
   }
   ```

   This creates three horizontal lines (the original grip + two pseudo-elements) that all change color together on hover — a familiar "grip" pattern.

**OR simpler alternative** — just add a subtle background to `.resize-handle:hover`:
   ```css
   .resize-handle:hover {
     background: color-mix(in srgb, var(--accent) 6%, transparent);
     border-radius: 4px;
   }
   ```
   This makes the hit area visually apparent without adding extra DOM elements.

**Recommendation:** Go with Option A (pseudo-elements) for a more recognizable grip visual, plus the hover background.

### Constraints Check
- Only CSS modifications — no template or script changes.
- Uses theme CSS variables (`var(--accent)`, `var(--border)`, etc.).
- Existing `transition` properties preserved.
- `prefers-reduced-motion` already handled at bottom of file.

### Verification
After changes, run:
```
cd D:\Maxma\MaxmaHere\web
npx vue-tsc --noEmit
```
