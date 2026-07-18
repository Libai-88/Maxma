# Plan: Fix ContextMenu.vue ARIA Accessibility

**File:** `src/components/ContextMenu.vue`

## Changes Overview

Three targeted changes to add ARIA roles and keyboard navigation without breaking existing functionality.

---

### 1. Add ARIA Roles (Template)

**Container (line 10-15, the `.context-menu` div):**
- Add `role="menu"`
- Add `aria-orientation="vertical"` (typical for context menus)

**Menu items (line 17-25, each button):**
- Add `role="menuitem"`

---

### 2. Enhance Keyboard Navigation (Script)

**Current state:** Only `Escape` is handled in `onKeydown`.

**Extend `onKeydown` to handle:**

| Key | Action |
|---|---|
| `ArrowDown` | Focus next `[role="menuitem"]`. Wrap to first if at end. |
| `ArrowUp` | Focus previous `[role="menuitem"]`. Wrap to last if at start. |
| `Home` | Focus first `[role="menuitem"]`. |
| `End` | Focus last `[role="menuitem"]`. |
| `Enter` / ` ` (Space) | Programmatically click the currently focused menuitem. |
| `Escape` | Close menu (already implemented). |

**Implementation details:**
- Query items via `menuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]')`
- Use `.focus()` to move focus
- For Enter/Space: call `.click()` on the focused element (which triggers the existing `select` emit)

---

### 3. Auto-focus on Open (Script)

Add a `watch` on `props.visible` (or `watchEffect`) to auto-focus the first menu item when the menu becomes visible, using `nextTick` to wait for DOM render.

---

### 4. No Regressions

All existing features remain unchanged:
- Right-click positioning via `position.x` / `position.y`
- Click-outside-to-close via `.context-backdrop`
- Each item's `@click="select(item.action)"`
- Transition animation
- CSP-safe CSSOM styling

---

### 5. Verification

Run `npx vue-tsc --noEmit` to confirm no TypeScript errors.
