# Plan: Fix Unhandled Promise Rejections

## Status: Finding — code already has `.catch()` handlers

After reading all three files, the `.catch()` handlers are **already present** in every location specified. No change is needed.

### 1. `src/components/ChatInput.vue` ~L850
```typescript
api.checkPathBlocked(path).then(result => {
  // ...
}).catch(err => {
  console.warn('[ChatInput] checkPathBlocked failed:', err)
})
```
`.catch()` already present at line 859.

### 2. `src/components/StickerContextMenu.vue` ~L111
```typescript
navigator.clipboard.writeText(path).then(() => {
  emit('close')
}).catch(err => {
  console.error('复制失败:', err)
})
```
`.catch()` already present at line 113.

### 3. `src/composables/useChat.ts` ~L520-521
```typescript
fetch(getStickerUrl(emotion))
  .then(r => r.json())
  .then(data => {
    // ...
  })
  .catch((err) => console.warn('[useChat] sticker fetch failed:', err))
```
`.catch()` already present at line 526.

## Verification

If you still want me to proceed, I can:
- Run `npx vue-tsc --noEmit` to verify type correctness
- But no source changes are necessary

Please confirm how you would like to proceed.
