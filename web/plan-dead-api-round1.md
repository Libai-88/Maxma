# Plan: Fix Disconnected Frontend Pages (Round 1)

## Background

Three backend routes are confirmed dead (return 503/404), but their frontend pages still carry full interactive UI logic that will never work. OMP has replaced these features.

## Files to Modify

| File | What |
|------|------|
| `src/views/KbView.vue` | Simplify to static OMP notice, remove all API calls |
| `src/views/HooksView.vue` | Simplify to static OMP notice, remove all API calls |
| `src/api/index.ts` | Remove KB & Event Hook API methods + dead type imports |
| `src/stores/kb.ts` | Delete (dead code — only imported by KbView.vue) |
| `src/types/kb.ts` | Delete (types only used by removed KB code) |

## Files NOT to Modify

- **`src/App.vue`** — No KB/Event Hooks nav entries exist. No change needed.
- **`src/router/index.ts`** — Routes `/kb` and `/event-hooks` preserved per constraint.
- **`src/types/event-hooks.ts`** — Could be deleted, but types are cleanly separated; edge case risk if some future feature imports them. Skip to minimize scope.

---

## Step-by-step Changes

### Step 1: Simplify `src/views/KbView.vue`

**Goal**: Replace full interactive KB page with a static message: "知识库功能已由 OMP 内置管理".

- Remove `import { useKbStore } from '@/stores/kb'`
- Remove `import type { KbDocument } from '@/types'`
- Remove the entire `<script setup>` block (all refs, computed, methods, lifecycle hooks)
- Replace `<template>` content with a simple centered message card
- Keep the `<style scoped>` block (minimal styles for the new layout)

New template structure:
```html
<div class="kb-view">
  <div class="omp-notice-card">
    <div class="omp-notice-icon">📚</div>
    <h2>知识库功能已由 OMP 内置管理</h2>
    <p class="omp-notice-detail">
      知识库（Knowledge Base）功能已迁移至 OMP（oh-my-pi）架构中内置实现。
      如需管理知识库，请通过 OMP 控制台操作。
    </p>
    <p class="omp-notice-hint">
      此页面仅作路由入口保留，后续 OMP RPC 接口就绪后将直接对接。
    </p>
  </div>
</div>
```

### Step 2: Simplify `src/views/HooksView.vue`

**Goal**: Replace full interactive Event Hooks page with a static message: "事件钩子功能已由 OMP 内置管理".

- Remove `import { api } from '@/api'`
- Remove entire `<script setup>` block (all interfaces, refs, methods, lifecycle hooks)
- Replace `<template>` content with a simple centered message card
- Remove all CSS related to card-grid, wizard-form, history-section (keep only minimal layout)

New template structure:
```html
<div class="hooks-view">
  <div class="omp-notice-card">
    <div class="omp-notice-icon">🔗</div>
    <h2>事件钩子功能已由 OMP 内置管理</h2>
    <p class="omp-notice-detail">
      事件钩子（Event Hooks）功能已迁移至 OMP（oh-my-pi）架构中内置实现。
      原钩子类型（文件变更、定时执行、Webhook）均可通过 OMP 控制台配置。
    </p>
    <p class="omp-notice-hint">
      此页面仅作路由入口保留，后续 OMP RPC 接口就绪后将直接对接。
    </p>
  </div>
</div>
```

### Step 3: Remove KB API methods from `src/api/index.ts`

**Remove these imports** (lines 38-39):
```ts
KbDocument,
KbSearchResult,
```

**Remove these API methods** (lines ~606-642):
- `listKbDocuments`
- `getKbDocument`
- `deleteKbDocument`
- `uploadKbDocument`
- `indexKbText`
- `importKbUrl`
- `searchKb`

### Step 4: Remove Event Hook API methods from `src/api/index.ts`

**Remove these imports** (lines 55-62):
```ts
import type {
  EventHook,
  EventHookCreateBody,
  EventHookHistoryResponse,
  EventHookMutationResponse,
  EventHookUpdateBody,
  ListEventHooksResponse,
} from '@/types/event-hooks'
```

**Remove these API methods** (lines ~557-580):
- `listHooks`
- `getHook`
- `createHook`
- `updateHook`
- `deleteHook`
- `getHookHistory`

### Step 5: Delete `src/stores/kb.ts`

This store is only imported by KbView.vue (which we've simplified to not use it). Delete the file.

### Step 6: Delete `src/types/kb.ts`

The types `KbDocument` and `KbSearchResult` are only used by:
- `api/index.ts` (we removed the usages in Step 3)
- `stores/kb.ts` (we delete in Step 5)
- `views/KbView.vue` (we removed the import in Step 1)
- `types/index.ts` (re-export — remove the re-export line)

Also remove the re-export line in `src/types/index.ts` (line 615):
```ts
export * from './kb'
```

---

## Verification

After all changes, run:
```
npx vue-tsc --noEmit
```

Verify no TypeScript errors related to removed code.

---

## Summary of Deletions

| Component | Lines removed (approx.) |
|-----------|------------------------|
| KbView.vue template | ~200 lines |
| KbView.vue script | ~200 lines |
| HooksView.vue template | ~140 lines |
| HooksView.vue script | ~210 lines |
| api/index.ts KB methods | ~35 lines |
| api/index.ts Hook methods | ~25 lines |
| api/index.ts imports | ~12 lines |
| stores/kb.ts | ~150 lines (file deleted) |
| types/kb.ts | ~25 lines (file deleted) |
| types/index.ts re-export | 1 line |
