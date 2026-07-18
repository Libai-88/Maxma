# Plan: Optimize Settings Menu Shortcut Panel Visuals

**File:** `D:\Maxma\MaxmaHere\web\src\components\AppSettingsMenu.vue`

## Current State

The shortcuts section (lines 356-383) defines styles for:
- `.shortcuts-section` — container
- `.shortcuts-title` — "快捷键" heading
- `.shortcut-item` — each shortcut row
- `kbd` — the keyboard key badge

All three `kbd` tags already use `var(--font-mono)` (requirement #1 is already met).

Missing: **kbd hover effect** (requirement #2). There is no `:hover` rule on the `kbd` element.

## Changes

### 1. Add kbd hover effect (lines 372-383)

Add a hover pseudo-class to the existing `kbd` rule:

| Property | Value | Rationale |
|---|---|---|
| `transition` | `background var(--duration-instant) var(--ease-out), border-color var(--duration-instant) var(--ease-out), box-shadow var(--duration-instant) var(--ease-out)` | Smooth hover transition using theme tokens |
| `&:hover` background | `var(--accent)` at low opacity, e.g., `color-mix(in srgb, var(--accent) 12%, transparent)` | Subtle accent tint on hover |
| `&:hover` border-color | `var(--accent)` at ~40% opacity, e.g., `color-mix(in srgb, var(--accent) 40%, transparent)` | Border highlights to match background |
| `&:hover` box-shadow | `0 1px 4px var(--shadow-color)` | Slight lift on hover for depth |

### 2. Ensure consistency (requirement #3)

All three `<kbd>` instances are identical; no changes needed.

### 3. No functional changes

Only CSS within `<style scoped>` is touched. The template and script remain unchanged.

## Verification

Run `tsc --noEmit` (or `vue-tsc --noEmit`) to confirm no TypeScript breakage.

---

**Ready to implement after approval.**
