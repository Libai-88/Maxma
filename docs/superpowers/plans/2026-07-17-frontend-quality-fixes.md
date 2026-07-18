# Frontend Quality Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix frontend memory leaks (3 event listener/timer cleanup) and silent error handling (8 .catch(() => {})).

**Architecture:** Add proper cleanup in Vue lifecycle hooks and replace silent catches with console.warn logging.

**Tech Stack:** Vue 3, TypeScript, Vitest, Pinia

---

## File Structure

**Modified files (only these):**
- `web/src/components/ModelSelector.vue` — global click listener cleanup (Part A.1)
- `web/src/composables/useTheme.ts` — matchMedia listener cleanup function (Part A.2)
- `web/src/App.vue` — restart poll setTimeout cleanup (Part A.3) + silent catch (Part B)
- `web/src/composables/useChat.ts` — 2 silent catches (Part B)
- `web/src/stores/session.ts` — 5 silent catches (Part B)

**Test files created:**
- `web/tests/modelSelector.spec.ts` — TDD for ModelSelector listener cleanup
- `web/tests/useTheme.spec.ts` — TDD for useTheme cleanup function
- `web/tests/sessionStore.spec.ts` — TDD for session store silent catch

**Baseline:** `cd web && npx vitest run` → 14 files / 44 tests pass.

---

### Task 1: ModelSelector.vue — cleanup global click listener on unmount (TDD)

**Files:**
- Modify: `web/src/components/ModelSelector.vue:32,57`
- Test: `web/tests/modelSelector.spec.ts`

**Bug:** Line 57 registers `document.addEventListener('click', () => { isOpen.value = false })` at `<script setup>` top level (runs per instance) with an anonymous handler that is never removed. Each mount leaks a global listener. Reference pattern: `ChatInput.vue:752-753` and `ContextMenu.vue:72-78` use `onMounted`+`onUnmounted` pairs.

- [ ] **Step 1: Write the failing test**

Create `web/tests/modelSelector.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    availableModels: [{ id: 'm1', name: 'Model 1', provider: 'p', contextWindow: 8000 }],
    currentModel: 'm1',
    setModel: vi.fn(),
    fetchAvailableModels: vi.fn(),
  }),
}))

import ModelSelector from '@/components/ModelSelector.vue'

describe('ModelSelector', () => {
  it('removes the global click listener on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mount(ModelSelector)

    const clickRegistrations = addSpy.mock.calls.filter(([type]) => type === 'click')
    expect(clickRegistrations.length).toBeGreaterThan(0)

    wrapper.unmount()

    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function))

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/modelSelector.spec.ts`
Expected: FAIL — `removeSpy` was never called with `'click'` (current code never removes the listener).

- [ ] **Step 3: Write minimal implementation**

Edit `web/src/components/ModelSelector.vue`:

Line 32 import — add `onUnmounted`:
```typescript
import { ref, computed, onMounted, onUnmounted } from 'vue'
```

Replace line 57:
```typescript
if (typeof document !== 'undefined') document.addEventListener('click', () => { isOpen.value = false })
```
with a named handler + lifecycle pair:
```typescript
function onDocumentClick() { isOpen.value = false }
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/modelSelector.spec.ts`
Expected: PASS

- [ ] **Step 5: Run full suite to verify no regressions**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd web && git add src/components/ModelSelector.vue tests/modelSelector.spec.ts
git commit -m "fix: cleanup ModelSelector global click listener on unmount"
```

---

### Task 2: useTheme.ts — provide cleanup for matchMedia listener (TDD)

**Files:**
- Modify: `web/src/composables/useTheme.ts:128-135`
- Test: `web/tests/useTheme.spec.ts`

**Bug:** Lines 128-135 call `window.matchMedia(...)` at module top level (twice) and register an anonymous `'change'` listener that is never removed. The handler is an anonymous arrow with no stored reference, so it cannot be removed even if desired.

**Fix:** Store the `MediaQueryList` instance and use a named handler; export a `cleanupThemeListener()` function that removes it. This satisfies "提供清理函数" and makes the listener removable (e.g., for HMR/tests) — it was previously impossible to remove.

- [ ] **Step 1: Write the failing test**

Create `web/tests/useTheme.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'

const mqlAddEventListener = vi.fn()
const mqlRemoveEventListener = vi.fn()
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: mqlAddEventListener,
  removeEventListener: mqlRemoveEventListener,
})))

const { cleanupThemeListener } = await import('@/composables/useTheme')

describe('useTheme', () => {
  it('registers and removes the matchMedia change listener', () => {
    expect(mqlAddEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(mqlRemoveEventListener).not.toHaveBeenCalled()

    cleanupThemeListener()

    expect(mqlRemoveEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/useTheme.spec.ts`
Expected: FAIL / ERROR — `cleanupThemeListener` is undefined (not exported), calling it throws TypeError.

- [ ] **Step 3: Write minimal implementation**

Edit `web/src/composables/useTheme.ts`. Replace lines 127-135:

```typescript
/** 系统是否暗色 */
const systemIsDark = ref(
  window.matchMedia('(prefers-color-scheme: dark)').matches
)

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  systemIsDark.value = e.matches
})
```

with:

```typescript
/** 系统是否暗色 */
const systemMql = window.matchMedia('(prefers-color-scheme: dark)')
const systemIsDark = ref(systemMql.matches)

// 监听系统主题变化
function onSystemThemeChange(e: MediaQueryListEvent) {
  systemIsDark.value = e.matches
}
systemMql.addEventListener('change', onSystemThemeChange)

/** 移除系统主题变化监听器（用于清理 / HMR / 测试） */
export function cleanupThemeListener() {
  systemMql.removeEventListener('change', onSystemThemeChange)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/useTheme.spec.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd web && git add src/composables/useTheme.ts tests/useTheme.spec.ts
git commit -m "fix: provide cleanup function for useTheme matchMedia listener"
```

---

### Task 3: App.vue — cleanup restart poll setTimeout on unmount

**Files:**
- Modify: `web/src/App.vue:196-213`

**Bug:** `handleRestart` starts a `poll()` loop that calls `await new Promise(r => setTimeout(r, 2000))` up to 60 times. The timer id is never stored, so it cannot be cleared. If the component unmounts mid-wait, the callback still fires and polling continues.

**Note on TDD:** App.vue is the root component and imports Tauri APIs (`@tauri-apps/api/core`), router, and many stores; mounting it in jsdom is impractical and would require heavy mocking that does not exist in this codebase. Per the task ("对于可测试的部分"), this fix is applied directly without a TDD test.

- [ ] **Step 1: Write minimal implementation**

Edit `web/src/App.vue`. Declare a timer variable and track/clear it. Replace the `handleRestart` function (lines 196-213):

```typescript
async function handleRestart() {
  if (restarting.value) return
  if (!window.confirm('确定要重启 Maxma 吗？正在进行的对话可能会中断。')) return
  restarting.value = true
  closeSettingsMenu()
  api.restart()
  const poll = async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => { restartPollTimer = setTimeout(r, 2000) })
      restartPollTimer = null
      try {
        await api.health()
        location.reload(); return
      } catch { /* still down */ }
    }
    restarting.value = false
  }
  poll()
}
```

Add the timer declaration immediately above `handleRestart`:

```typescript
let restartPollTimer: ReturnType<typeof setTimeout> | null = null
```

Add an `onUnmounted` hook (Vue allows multiple) immediately after `handleRestart`:

```typescript
onUnmounted(() => {
  if (restartPollTimer) {
    clearTimeout(restartPollTimer)
    restartPollTimer = null
  }
})
```

- [ ] **Step 2: Run type check**

Run: `cd web && npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run full suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd web && git add src/App.vue
git commit -m "fix: clear restart poll setTimeout on App unmount"
```

---

### Task 4: session.ts — replace 5 silent catches with console.warn (TDD)

**Files:**
- Modify: `web/src/stores/session.ts:66,78,85,91,96`
- Test: `web/tests/sessionStore.spec.ts`

**Bug:** Five `await refreshSessions().catch(() => {})` calls swallow all errors (network, auth, 500) with no logging, making failures invisible.

**TDD scope:** One representative test for `createSession` (line 66) verifies `console.warn` is called when `refreshSessions` fails. The identical fix applies to the other 4 sites (deleteSession ×2, constifySession, unconstifySession).

- [ ] **Step 1: Write the failing test**

Create `web/tests/sessionStore.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api', () => ({
  api: {
    createSession: vi.fn().mockResolvedValue({ session_id: 'test-sid-123' }),
    listSessions: vi.fn().mockRejectedValue(new Error('network down')),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    constifySession: vi.fn().mockResolvedValue(undefined),
    unconstifySession: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(undefined),
    generateSessionTitle: vi.fn().mockResolvedValue({ title: 't' }),
  },
}))

vi.mock('@/stores/chat', () => ({
  removeTurnsFromStorage: vi.fn(),
  TURNS_KEY_PREFIX: 'maxma_turns_',
}))

import { useSessionStore } from '@/stores/session'

describe('session store', () => {
  it('logs a warning when refreshSessions fails after createSession', async () => {
    setActivePinia(createPinia())
    const store = useSessionStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await store.createSession()

    expect(warnSpy).toHaveBeenCalled()
    const [msg] = warnSpy.mock.calls[0]
    expect(String(msg)).toMatch(/refreshSessions/)
    warnSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run tests/sessionStore.spec.ts`
Expected: FAIL — `warnSpy` was never called (current `.catch(() => {})` swallows silently).

- [ ] **Step 3: Write minimal implementation**

Edit `web/src/stores/session.ts`, replacing each of the 5 `.catch(() => {})`:

Line 66 (`createSession`):
```typescript
    await refreshSessions().catch((err) => console.warn('[session] refreshSessions after create failed:', err))
```

Line 78 (`deleteSession`, active-deleted branch):
```typescript
      await refreshSessions().catch((err) => console.warn('[session] refreshSessions after delete failed:', err))
```

Line 85 (`deleteSession`, other-deleted branch):
```typescript
      await refreshSessions().catch((err) => console.warn('[session] refreshSessions after delete failed:', err))
```

Line 91 (`constifySession`):
```typescript
    await refreshSessions().catch((err) => console.warn('[session] refreshSessions after constify failed:', err))
```

Line 96 (`unconstifySession`):
```typescript
    await refreshSessions().catch((err) => console.warn('[session] refreshSessions after unconstify failed:', err))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run tests/sessionStore.spec.ts`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `cd web && npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd web && git add src/stores/session.ts tests/sessionStore.spec.ts
git commit -m "fix: log warning instead of swallowing refreshSessions errors in session store"
```

---

### Task 5: useChat.ts — replace 2 silent catches with console.warn

**Files:**
- Modify: `web/src/composables/useChat.ts:138,522`

**Bug:** Two `.catch(() => {})` swallow errors silently.
- Line 138: `refreshSessions` helper — silent fail.
- Line 522: sticker `fetch(...)` — silent fail.

**Note on TDD:** `useChat` requires live WebSocket, Pinia stores, and token/port loading; isolating these two catches in a test would require heavy mocking disproportionate to the one-line change. Applied directly per task scope.

- [ ] **Step 1: Write minimal implementation**

Edit `web/src/composables/useChat.ts`.

Line 138, replace:
```typescript
const refreshSessions = () => getSessionStore().refreshSessions().catch(() => {/* 保留现有列表，静默失败 */})
```
with:
```typescript
const refreshSessions = () => getSessionStore().refreshSessions().catch((err) => console.warn('[useChat] refreshSessions failed:', err))
```

Line 522, replace:
```typescript
            .catch(() => {})
```
with:
```typescript
            .catch((err) => console.warn('[useChat] sticker fetch failed:', err))
```

- [ ] **Step 2: Run type check + full suite**

Run: `cd web && npx vue-tsc --noEmit`
Run: `cd web && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 3: Commit**

```bash
cd web && git add src/composables/useChat.ts
git commit -m "fix: log warning instead of swallowing errors in useChat catches"
```

---

### Task 6: App.vue — replace silent catch with console.warn

**Files:**
- Modify: `web/src/App.vue:322`

**Bug:** `sessionStore.refreshSessions().catch(() => {})` in the health-recovery `watch` swallows refresh failures silently.

**Note on TDD:** App.vue not mountable in jsdom (see Task 3 note). Applied directly.

- [ ] **Step 1: Write minimal implementation**

Edit `web/src/App.vue` line 322, replace:
```typescript
    sessionStore.refreshSessions().catch(() => {})
```
with:
```typescript
    sessionStore.refreshSessions().catch((err) => console.warn('[App] refreshSessions failed:', err))
```

- [ ] **Step 2: Run type check + full suite**

Run: `cd web && npx vue-tsc --noEmit`
Run: `cd web && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 3: Commit**

```bash
cd web && git add src/App.vue
git commit -m "fix: log warning instead of swallowing refreshSessions error in App health watch"
```

---

## Self-Review

**Spec coverage:**
- Part A.1 (ModelSelector listener) → Task 1 ✓
- Part A.2 (useTheme matchMedia) → Task 2 ✓
- Part A.3 (App setTimeout) → Task 3 ✓
- Part B (8 silent catches): App.vue:322 → Task 6 ✓; useChat.ts:138,522 → Task 5 ✓; session.ts:66,78,85,91,96 → Task 4 ✓ (8 total ✓)

**Placeholder scan:** None. All steps contain actual code/commands.

**Type consistency:** `cleanupThemeListener` (Task 2) used consistently. `onDocumentClick` (Task 1) consistent. `restartPollTimer` (Task 3) consistent.
