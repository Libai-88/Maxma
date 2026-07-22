# 023 — Add floating "scroll to bottom" button to chat

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: MEDIUM
- **Category**: UX
- **Estimated scope**: 1 file, ~60 lines added

## Problem

`web/src/components/ChatWindow.vue` auto-scrolls to the bottom when new messages arrive, but ONLY when `isNearBottom()` returns true (threshold: 100px from bottom). If the user has scrolled up to read older messages, new messages arrive silently with no indication.

There is no "scroll to bottom" button. Grep for `scroll-button|scrollBtn|jumpToBottom|toBottom|bottom-button` returns zero matches.

Apple Messages shows a floating button when the user has scrolled up, allowing them to jump back to the latest message. This is the expected UX pattern.

## Target

Add a floating "scroll to bottom" button that:
1. Appears when the user has scrolled up (more than ~150px from bottom).
2. Disappears when the user is near the bottom.
3. On click, smoothly scrolls to the bottom.
4. Optionally shows a badge with the count of new messages since the user scrolled up.

### Visual design

```vue
<Transition name="scroll-bottom-btn">
  <button
    v-if="showScrollBottomBtn"
    class="scroll-bottom-btn"
    @click="scrollToBottomSmooth"
    aria-label="滚动到底部"
  >
    <Icon name="arrow-down" :size="18" />
    <span v-if="newMessageCount > 0" class="new-count">{{ newMessageCount }}</span>
  </button>
</Transition>
```

```css
.scroll-bottom-btn {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 5;
  transition: transform var(--duration-fast) var(--ease-out),
              opacity var(--duration-fast) var(--ease-out);
}

.scroll-bottom-btn:hover {
  transform: scale(1.05); /* gated by hover:hover — see Plan 007 pattern */
}

.scroll-bottom-btn:active {
  transform: scale(0.96);
}

.scroll-bottom-btn .new-count {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: var(--accent);
  color: white;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

/* Enter/leave transition */
.scroll-bottom-btn-enter-active,
.scroll-bottom-btn-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}
.scroll-bottom-btn-enter-from,
.scroll-bottom-btn-leave-to {
  opacity: 0;
  transform: scale(0.8) translateY(8px);
}
```

### Behavior

```typescript
const showScrollBottomBtn = ref(false);
const newMessageCount = ref(0);

// In the scroll handler (onScrollerScroll):
function onScrollerScroll() {
  const nearBottom = isNearBottom();
  isNearBottomRef.value = nearBottom;
  showScrollBottomBtn.value = !nearBottom;
  if (nearBottom) {
    newMessageCount.value = 0; // reset count when user reaches bottom
  }
}

// When new messages arrive and user is NOT near bottom:
watch(() => messages.value.length, (newLen, oldLen) => {
  if (!isNearBottomRef.value) {
    newMessageCount.value += (newLen - (oldLen || 0));
  }
});

// Smooth scroll to bottom:
function scrollToBottomSmooth() {
  scrollerRef.value?.scrollToBottom();
  newMessageCount.value = 0;
}
```

## Repo conventions to follow

- `ChatWindow.vue` already has `isNearBottom()` (line ~370, threshold 100px), `isNearBottomRef`, `onScrollerScroll` (line 391-397), `scrollToBottom()` (line 461).
- The scroll button threshold should be slightly larger than auto-scroll threshold (150px vs 100px) so the button appears before auto-scroll disengages.
- Use `<Transition>` for enter/exit (consistent with Plan 004 pattern).
- Use `Icon` component for the arrow icon (consistent with the rest of the app).
- `DsButton` is not ideal here — this is a circular floating action button with a custom shape.

## Steps

1. **Add reactive state** — In `ChatWindow.vue` `<script setup>`:
   - `const showScrollBottomBtn = ref(false)`
   - `const newMessageCount = ref(0)`
   - `const SCROLL_BOTTOM_BTN_THRESHOLD = 150` (slightly larger than auto-scroll's 100px)

2. **Update `onScrollerScroll`** — Add logic:
   - Set `showScrollBottomBtn.value = !isNearBottomRef.value` (or use the larger threshold).
   - If near bottom, reset `newMessageCount` to 0.

3. **Track new messages** — Add a watcher on `messages.value.length`:
   - If not near bottom, increment `newMessageCount` by the delta.
   - If near bottom, reset to 0.

4. **Add `scrollToBottomSmooth`** function:
   - Call `scrollerRef.value?.scrollToBottom()`.
   - Reset `newMessageCount` to 0.
   - If the library's `scrollToBottom` doesn't smooth-scroll, use `scrollToItem(messages.value.length - 1, { smooth: true })` instead.

5. **Add the button to the template** — Inside the `.chat-window` container, after the scroller:
   ```vue
   <div class="chat-window">
     <DynamicScroller ref="scrollerRef" ... />
     <Transition name="scroll-bottom-btn">
       <button v-if="showScrollBottomBtn" class="scroll-bottom-btn" @click="scrollToBottomSmooth">
         <Icon name="arrow-down" :size="18" />
         <span v-if="newMessageCount > 0" class="new-count">{{ newMessageCount }}</span>
       </button>
     </Transition>
   </div>
   ```

6. **Add CSS** — Style the floating button (position, size, shadow, transition). Apply Plan 007 hover gating pattern.

7. **Position correctly** — The button should be `position: absolute` within `.chat-window` (which should be `position: relative`). Bottom-right corner, 16px inset.

## Boundaries

- Do NOT auto-scroll when the button is clicked AND the user has scrolled up — only scroll when the button is clicked or when `isNearBottom()` is true.
- Do NOT show the button when there are no messages or when the chat is empty.
- Do NOT block interaction with messages behind the button — `pointer-events: auto` on the button only.
- The button should not appear during initial load (when messages are first rendered) — only when the user actively scrolls up.
- If `vue-virtual-scroller` doesn't support smooth `scrollToBottom`, use `scrollToItem` with `smooth: true` as a fallback.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Send a few messages — confirm the button doesn't appear (auto-scroll is working).
  - Scroll up — confirm the button appears at bottom-right with a smooth transition.
  - Have new messages arrive while scrolled up — confirm the badge count increments.
  - Click the button — confirm it smooth-scrolls to the bottom and the badge resets.
  - Scroll to bottom manually — confirm the button disappears.
  - Hover the button — confirm scale(1.05) on desktop (gated by hover:hover).
  - Press the button — confirm scale(0.96) active feedback.
- **Done when**: Floating scroll-to-bottom button appears when scrolled up; shows new message count badge; smooth-scrolls on click; transitions in/out smoothly.
