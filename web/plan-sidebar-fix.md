# Plan: Fix Sidebar matchMedia Responsive Collapsing Reactivity Bug

## 1. Diagnosis

### Root Cause: Pinia reactive auto-unwrap + premature destructuring

**Bug location**: `D:/Maxma/MaxmaHere/web/src/composables/useSidebar.ts`

The composable destructures properties directly from the store:

```ts
return {
  effectiveCollapsed: store.effectiveCollapsed,  // BUG: reactive() auto-unwraps → plain boolean
  userCollapsed: store.userCollapsed,              // BUG: reactive() auto-unwraps → plain boolean
  toggleSidebar: store.toggleSidebar,
  setUserCollapsed: store.setUserCollapsed,
}
```

Pinia's `defineStore` wraps the returned object with Vue `reactive()`. When a `ref` or `computed` (which is a `ComputedRef`) is accessed through a `reactive()` proxy, Vue 3 **auto-unwraps** it — you get the **raw value** instead of the reactive wrapper.

So `store.effectiveCollapsed` at access time produces a **plain boolean** (initially `false`), not a `ComputedRef<boolean>`. The same applies to `store.userCollapsed`.

When App.vue does:
```ts
const { effectiveCollapsed, toggleSidebar } = useSidebar()
```

`effectiveCollapsed` is already a frozen `false` value. Later, when `init()` (called in `onMounted`) sets `forcedCollapsed.value = true`, the store's `effectiveCollapsed` computed does update internally, but the **already-extracted plain boolean in App.vue never changes** — reactivity is broken.

### Confirmation

- `stores/sidebar.ts`: `effectiveCollapsed` is a `computed()` — correct.
- `useSidebar.ts`: destructures without `storeToRefs` — **bug**.
- `App.vue`: uses `effectiveCollapsed` from `useSidebar()` — receives a dead value.

The Playwright test `tests/playwright/smoke.mjs` (line 68-75) sets viewport to 900px, navigates, and checks `.sidebar.collapsed`. Because `effectiveCollapsed` never becomes `true` after mount, the CSS class is never applied, and the test fails.

## 2. Proposed Fix

**File to modify**: `D:/Maxma/MaxmaHere/web/src/composables/useSidebar.ts`

Use Pinia's `storeToRefs` to extract reactive refs from the store before reactive auto-unwrap destroys them.

### Change

```diff
- import { onMounted, onUnmounted } from 'vue'
+ import { onMounted, onUnmounted } from 'vue';
+ import { storeToRefs } from 'pinia';
  import { useSidebarStore } from '@/stores/sidebar'

  export function useSidebar() {
    const store = useSidebarStore()

    onMounted(() => { store.init() })
    onUnmounted(() => { store.destroy() })

+   const { effectiveCollapsed, userCollapsed } = storeToRefs(store)

    return {
-     effectiveCollapsed: store.effectiveCollapsed,
-     userCollapsed: store.userCollapsed,
+     effectiveCollapsed,
+     userCollapsed,
      toggleSidebar: store.toggleSidebar,
      setUserCollapsed: store.setUserCollapsed,
    }
  }
```

`storeToRefs` extracts the raw `Ref` / `ComputedRef` from the Pinia store **before** the `reactive()` proxy can auto-unwrap them. This preserves reactivity.

### Why not change App.vue instead?

- The composable (`useSidebar`) is the abstraction boundary. Fixing it there fixes the issue for all callers.
- App.vue is already using the composable correctly; the composable was just returning dead values.

### No changes needed to:
- `D:/Maxma/MaxmaHere/web/src/stores/sidebar.ts` — store logic is correct.
- `D:/Maxma/MaxmaHere/web/src/App.vue` — usage is correct, only the return values were broken.

## 3. Verification

After implementing:
```bash
npx vue-tsc --noEmit
```

No errors expected.

## 4. Risk Assessment

- **Low risk**: This is a one-line import addition + two-line return value change.
- The store's `init()`, `destroy()`, and methods (`toggleSidebar`, `setUserCollapsed`) are unchanged.
- The template binding in App.vue receives the same API surface shape.
- No CSS or template changes needed.

