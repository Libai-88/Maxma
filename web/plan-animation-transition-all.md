# Animation Fix: Replace `transition: all` with Exact Properties

> **Goal:** Remove unbounded `transition: all` declarations that animate unintended properties off-GPU and produce unexpected motion when unrelated styles change.

**Verdict:** `transition: all` is flagged by `review-animations` as an escalation trigger. It causes the browser to interpolate every property — including off-GPU ones like `width`, `height`, `margin` — and creates invisible performance cost and potential visual bugs.

**Original scope:** 4 files.
**Revised scope:** Cover all 15+ `transition: all` locations found in the codebase, prioritized by impact.

---

## Files (complete list)

### HIGH priority — multi-property animation with long duration

| # | File | Lines | Current | Issue |
|---|------|-------|---------|-------|
| 1 | `src/components/ThinkingBlock.vue` | 77, 109, 127 | `transition: all 0.4s ease` (×3) | 400ms exceeds UI budget + `ease` weak curve + `all` |
| 2 | `src/components/StickerPicker.vue` | 599, 652, 777 | `transition: all 0.15s` (×2), `transition: all 0.2s ease` | `all` + uses `ease` instead of custom curve on 777 |
| 3 | `src/components/ChatInput.vue` | 1777 | `transition: all 0.2s cubic-bezier(...)` | Send button — frequently interacted with |
| 4 | `src/components/MessageBubble.vue` | 245 | `transition: all 0.2s` | Bubble hover — seen hundreds of times |

### MEDIUM priority — shorter duration or less frequent interaction

| # | File | Lines | Current |
|---|------|-------|---------|
| 5 | `src/components/ThemePicker.vue` | 104, 173 | `transition: all var(--duration-fast) var(--ease-out)` (×2) |
| 6 | `src/views/AppearanceView.vue` | 140, 213 | `transition: all var(--duration-fast) var(--ease-out)` (×2) |
| 7 | `src/components/ErrorCard.vue` | 150 | `transition: all 0.15s` |
| 8 | `src/components/PlanCard.vue` | 386 | `transition: all 0.15s` |
| 9 | `src/components/workbench/PinButton.vue` | 42 | `transition: all 0.15s` |
| 10 | `src/components/workbench/WorkbenchPanel.vue` | 215 | `transition: all 0.15s` |

### LOW priority — tool bubbles (short duration, low frequency)

| # | File | Lines | Current |
|---|------|-------|---------|
| 11 | `src/components/tools/AskUserBubble.vue` | 360 | `transition: all 0.12s` |
| 12 | `src/components/tools/PythonBubble.vue` | 213, 351 | `transition: all 0.12s`, `transition: all 0.15s` |
| 13 | `src/components/tools/TavilyExtractBubble.vue` | 157 | `transition: all .15s` |

---

## Step-by-step

### Step 1: ThinkingBlock.vue (HIGH — triple problem)

In `src/components/ThinkingBlock.vue`, replace all 3 occurrences:

```css
/* Line 77 — thinking block collapse */
.thinking-block {
  transition: all 0.4s ease;
}

/* Line 109 — content area */
.thinking-content {
  transition: all 0.4s ease;
}

/* Line 127 — status indicator */
.thinking-status {
  transition: all 0.4s ease;
}
```

Replace with:

```css
.thinking-block {
  transition: opacity 0.25s var(--ease-out),
              transform 0.25s var(--ease-out);
}
.thinking-content {
  transition: opacity 0.25s var(--ease-out);
}
.thinking-status {
  transition: opacity 0.25s var(--ease-out),
              color 0.25s var(--ease-out);
}
```

Changes: `all 0.4s ease` → specific properties, 250ms (within the 300ms UI budget), `var(--ease-out)` instead of weak `ease`.

### Step 2: StickerPicker.vue (HIGH — 3 locations)

In `src/components/StickerPicker.vue`, find and replace:

```css
/* Line 599 — sticker card hover */
.sticker-card {
  transition: all 0.15s;
}

/* Line 652 — category tab hover */
.category-tab {
  transition: all 0.2s;
}

/* Line 777 — option hover */
.sticker-option {
  transition: all 0.15s ease;
}
```

Replace with:

```css
.sticker-card {
  transition: border-color 0.15s var(--ease-out),
              transform 0.15s var(--ease-out),
              box-shadow 0.15s var(--ease-out);
}
.category-tab {
  transition: border-color 0.2s var(--ease-out),
              background-color 0.2s var(--ease-out),
              color 0.2s var(--ease-out);
}
.sticker-option {
  transition: border-color 0.15s var(--ease-out),
              background-color 0.15s var(--ease-out),
              transform 0.15s var(--ease-out);
}
```

### Step 3: ChatInput.vue (HIGH — send/stop buttons)

In `src/components/ChatInput.vue` ~line 1777:

```css
/* Before */
.btn-send,
.btn-stop {
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* After */
.btn-send,
.btn-stop {
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
              background-color 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

Keep the spring curve here — it's intentional for the send button's press feedback. Just remove `all`.

### Step 4: MessageBubble.vue (MEDIUM — bubble hover)

In `src/components/MessageBubble.vue` ~line 245:

```css
/* Before */
.bubble {
  transition: all 0.2s;
}

/* After — merge with existing explicit transitions nearby */
.bubble {
  transition: transform 0.15s var(--ease-out),
              box-shadow 0.15s var(--ease-out);
}
```

Note: `MessageBubble.vue` already has explicit `transition: transform 0.15s ..., box-shadow 0.15s ...` elsewhere. The `transition: all 0.2s` may be a duplicate. After this fix, ensure there's only one `transition` declaration on `.bubble`.

### Step 5: ThemePicker.vue (MEDIUM)

In `src/components/ThemePicker.vue`:

```css
/* Lines 104, 173 — theme-card and toggle-btn */
/* Before */
.theme-card { transition: all var(--duration-fast) var(--ease-out); }
.toggle-btn { transition: all var(--duration-fast) var(--ease-out); }

/* After */
.theme-card { transition: border-color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
.toggle-btn { transition: border-color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
```

### Step 6: AppearanceView.vue (MEDIUM)

```css
/* Lines 140, 213 — theme-card and toggle-btn */
/* Before */
.theme-card { transition: all var(--duration-fast) var(--ease-out); }
.toggle-btn { transition: all var(--duration-fast) var(--ease-out); }

/* After */
.theme-card { transition: border-color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
.toggle-btn { transition: border-color var(--duration-fast) var(--ease-out), background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out); }
```

### Step 7: ErrorCard.vue (MEDIUM)

```css
/* Line 150 */
/* Before */
.error-card__btn { transition: all 0.15s; }

/* After */
.error-card__btn { transition: border-color 0.15s var(--ease-out), background-color 0.15s var(--ease-out), color 0.15s var(--ease-out), transform 0.15s var(--ease-out); }
```

Also add `:active` press feedback if missing:

```css
.error-card__btn:active { transform: scale(0.97); }
```

### Step 8: PlanCard.vue, PinButton.vue, WorkbenchPanel.vue (MEDIUM)

Same pattern — identify which properties actually change on interaction and list them explicitly:

```css
/* PlanCard.vue ~line 386 */
.plan-card { transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out); }

/* PinButton.vue ~line 42 */
.pin-btn { transition: color 0.15s var(--ease-out), transform 0.15s var(--ease-out); }

/* WorkbenchPanel.vue ~line 215 */
.workbench-panel { transition: transform 0.15s var(--ease-out), opacity 0.15s var(--ease-out); }
```

### Step 9: Tool bubbles (LOW — AskUserBubble, PythonBubble, TavilyExtractBubble)

For these, the `all` is short (0.12–0.15s) and on infrequent elements. Still worth fixing:

```css
/* AskUserBubble.vue ~line 360 */
/* Before: */ transition: all 0.12s;
/* After: */  transition: background-color 0.12s var(--ease-out), border-color 0.12s var(--ease-out), color 0.12s var(--ease-out);

/* PythonBubble.vue ~line 213 */
/* Before: */ transition: all 0.12s;
/* After: */  transition: background-color 0.12s var(--ease-out), border-color 0.12s var(--ease-out);

/* PythonBubble.vue ~line 351 */
/* Before: */ transition: all 0.15s;
/* After: */  transition: background-color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);

/* TavilyExtractBubble.vue ~line 157 */
/* Before: */ transition: all .15s;
/* After: */  transition: background-color 0.15s var(--ease-out), border-color 0.15s var(--ease-out), color 0.15s var(--ease-out);
```

### Step 10: Global verification

```bash
cd d:\Maxma\MaxmaHere\web
grep -rn "transition: all" src/ --include="*.vue" --include="*.css"
```

Expected: **zero** `transition: all` declarations remain. If any survive, evaluate whether they are intentional and document why.

### Step 11: Build + feel-check

```bash
cd d:\Maxma\MaxmaHere\web
npm run build
```

Then manually test:
- Thinking block expand/collapse — should be snappier (250ms vs 400ms)
- Hover theme cards — only border/background/transform animate
- Toggle serif/texture — only relevant colors animate
- Send/stop buttons — press feedback still works
- Error card buttons — hover + press feel correct
- Sticker picker cards — hover highlight works without jank

### Step 12: Commit

```bash
cd d:\Maxma\MaxmaHere\web
git add src/components/ThinkingBlock.vue src/components/StickerPicker.vue src/components/ChatInput.vue src/components/MessageBubble.vue src/components/ThemePicker.vue src/views/AppearanceView.vue src/components/ErrorCard.vue src/components/PlanCard.vue src/components/workbench/PinButton.vue src/components/workbench/WorkbenchPanel.vue src/components/tools/AskUserBubble.vue src/components/tools/PythonBubble.vue src/components/tools/TavilyExtractBubble.vue
git commit -m "fix(animations): replace all transition: all with exact properties"
```
