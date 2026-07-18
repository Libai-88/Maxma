# Plan: ThemePicker UX Enhancement

## Files to modify
- `D:\Maxma\MaxmaHere\web\src\components\ThemePicker.vue`

## Investigation results

### Task 1 -- Active state visual feedback
Current `.theme-card.active` has:
- `border-color: var(--accent)`
- `background: var(--overlay-light, rgba(0,0,0,0.05))`

Enhance with: inset box-shadow using accent color, or a thicker border + ring. This will make the selected theme pop more.

### Task 2 -- Hover scale effect
No hover scale currently exists. Add:
- `.theme-card:hover { transform: scale(1.08); box-shadow: 0 4px 12px var(--shadow-color); }`
- Ensure `.theme-card` already has `transition: all var(--duration-fast) var(--ease-out)` so no new transition rule needed.
- Wrap in `@media (prefers-reduced-motion: no-preference)` for accessibility.

### Task 3 -- Theme name label
**Already done.** Line 28 shows `<div class="theme-name">{{ t.name }}</div>`. No changes needed.

### Task 4 -- Sidebar shortcut
**Skip.** `AppSettingsMenu.vue` already has a "外观 APPEARANCE" router-link to `/appearance` under the "系统 SYSTEM" section (line 29). This is the designated entry point for theme settings.

## Steps
1. Edit `ThemePicker.vue`:
   - Enhance `.theme-card.active` styles with stronger visual (e.g. `box-shadow: inset 0 0 0 2px var(--accent)` or additional ring)
   - Add hover scale effect guarded by `@media (prefers-reduced-motion: no-preference)`
2. Run `npx vue-tsc --noEmit` to verify type correctness
3. Report summary

## Rejected approaches
- Adding theme shortcut directly in sidebar popup: redundant, `/appearance` already exists.
- JavaScript-based preview on hover: CSS-only is sufficient and simpler.
