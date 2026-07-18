# Plan: Add `aria-pressed` to toggle buttons in ChatView.vue

## Goal
Add `:aria-pressed` attribute to two `<button>` elements in `D:/Maxma/MaxmaHere/web/src/views/ChatView.vue` so that assistive technologies can announce the current toggle state.

## Changes

### 1. `.private-toggle` button (line 31)
- **Current**:
  ```html
  <button
    class="private-toggle"
    :class="{ active: privateMode }"
    @click="setPrivateMode(!privateMode)"
  >
  ```
- **After**:
  ```html
  <button
    class="private-toggle"
    :class="{ active: privateMode }"
    :aria-pressed="privateMode"
    @click="setPrivateMode(!privateMode)"
  >
  ```

### 2. `.auto-approve-toggle` button (line 53)
- **Current**:
  ```html
  <button
    class="auto-approve-toggle"
    :class="{ active: autoApprove }"
    @click="setAutoApprove(!autoApprove)"
  >
  ```
- **After**:
  ```html
  <button
    class="auto-approve-toggle"
    :class="{ active: autoApprove }"
    :aria-pressed="autoApprove"
    @click="setAutoApprove(!autoApprove)"
  >
  ```

## Verification
- Run `npx vue-tsc --noEmit` (or the project's type-check script) to confirm no TypeScript errors.
- The bindings use existing reactive refs (`privateMode`, `autoApprove`) from `useChat()` — no new imports or state needed.

## Files affected
- `D:/Maxma/MaxmaHere/web/src/views/ChatView.vue` (two attribute additions, zero structural changes)
