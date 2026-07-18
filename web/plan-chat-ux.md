# Plan: Enhance Chat Input UX

## Overview

Two independent enhancements to the chat input experience:

---

## Task 1: Shift+Enter Newline Hint

**File:** `D:\Maxma\MaxmaHere\web\src\components\ChatInput.vue`

### Template change
Add a `.shortcut-hint` `<span>` inside the `.chat-input` container, **after** the `.input-bottom-bar` div (line 177), as a sibling element:

```html
<span class="shortcut-hint">Enter 发送 · Shift+Enter 换行</span>
```

### Style change
Append a new CSS rule inside the `<style scoped>` block (after line 1775, before `</style>`):

```css
.shortcut-hint {
  font-size: 0.7em;
  color: var(--text-tertiary);
  opacity: 0.6;
  user-select: none;
  text-align: center;
  padding: 2px 0 0;
}
```

**Rationale:** Placed after `.input-bottom-bar` so it appears as a centered subtle line below the bottom bar, visually separate from the action buttons. `text-align: center` centers it neatly under the input area.

---

## Task 2: Ctrl+K Global Shortcut for Private Mode Toggle

**File:** `D:\Maxma\MaxmaHere\web\src\views\ChatView.vue`

### Import change
Add `useGlobalShortcut` to the existing import (line 170):

```typescript
import { computed, onMounted, ref } from 'vue'
```
→
```typescript
import { computed, onMounted, ref } from 'vue'
import { useGlobalShortcut } from '@/composables/useGlobalShortcut'
```

### Registration (place after line 244, after `onMounted`)
Add the following after the `onMounted` call:

```typescript
useGlobalShortcut({ key: 'k', mod: true }, () => {
  setPrivateMode(!privateMode.value)
})
```

**Rationale:** `privateMode` is a `Ref<boolean>` from `useChat()`, so `privateMode.value` is needed. `setPrivateMode` is already available in scope (line 178). The `useGlobalShortcut` composable handles `onMounted`/`onUnmounted` lifecycle, so no manual listener management needed. This follows the exact same pattern as `Ctrl+N` in `App.vue` (line 138).

---

## Verification

Run:
```bash
npx vue-tsc --noEmit
```

No type errors expected:
- `useGlobalShortcut` is already exported from `@/composables/useGlobalShortcut`
- `setPrivateMode` and `privateMode` are already in scope
- CSS uses existing CSS custom properties (`--text-tertiary`)
