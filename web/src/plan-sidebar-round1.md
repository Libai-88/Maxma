# Plan: Refactor Module-Level Mutable State in useSidebar to Pinia Store

## Background

Current `composables/useSidebar.ts` has three problems:

1. **Module-level mutable state** (lines 6-7): `userCollapsed` and `forcedCollapsed` are defined as module-level `ref`s, shared across all `useSidebar()` calls. This is not tree-shakeable and can cause cross-component pollution.

2. **Unmanaged side effects**: `mql.addEventListener('change', onMqlChange)` is registered at module load time and **never removed**. No `onUnmounted` cleanup exists.

3. **Module-level `watch`**: The `watch(userCollapsed, ...)` on line 25-27 runs for the entire lifetime of the module, never cleaned up.

In test environments, these issues cause memory leaks and state pollution across test cases.

## Steps

### Step 1: Create `stores/sidebar.ts`

Create a Pinia store using the **setup function syntax** (matching the project's existing pattern, e.g. `stores/session.ts`).

The store will contain:

- **State**: `userCollapsed` (ref), `forcedCollapsed` (ref), `mql` (let, non-reactive)
- **Computed**: `effectiveCollapsed` = `userCollapsed || forcedCollapsed`
- **Actions**:
  - `loadFromStorage()` — restore user preference from localStorage
  - `init()` — call `loadFromStorage()`, create `matchMedia` listener, set `forcedCollapsed` initially
  - `destroy()` — remove `matchMedia` listener, nullify `mql`
  - `toggleSidebar()` — toggle `userCollapsed` and persist
  - `setUserCollapsed(v)` — set and persist
  - `persist()` — write `userCollapsed` to localStorage

Key differences from current code:

| Current (module-level) | New (Pinia store) |
|---|---|
| `watch(userCollapsed, ...)` for persistence | Explicit `persist()` called in `toggleSidebar` / `setUserCollapsed` |
| `mql.addEventListener` at module load | `init()` called in `onMounted` |
| No cleanup | `destroy()` called in `onUnmounted` |

### Step 2: Rewrite `composables/useSidebar.ts`

Replace the module-level implementation with a thin wrapper that:

- Calls `useSidebarStore()` to get the store
- Calls `store.init()` in `onMounted`
- Calls `store.destroy()` in `onUnmounted`
- Returns the same public API: `{ effectiveCollapsed, userCollapsed, toggleSidebar, setUserCollapsed }`

### Step 3: No changes to `App.vue`

`App.vue` (line 94) only uses `useSidebar()` and destructures `{ effectiveCollapsed, toggleSidebar }`. Since the public API surface of `useSidebar()` remains identical, **no modifications to App.vue are needed**.

## Files Modified

| File | Action |
|---|---|
| `src/stores/sidebar.ts` | **Create** — Pinia store |
| `src/composables/useSidebar.ts` | **Rewrite** — thin wrapper around store |
| `src/App.vue` | **No change** |

## Verification

- Run `npx vue-tsc --noEmit` to verify no type errors.
- Confirm that `App.vue` still compiles and works (API surface unchanged).
