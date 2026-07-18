# Plan: Enhance Maxma Brand Logo Text Styles

## Objective
Enhance the visual treatment of the brand logo in the sidebar (`D:\Maxma\MaxmaHere\web\src\App.vue`) with CSS-only improvements — hover effects, transitions, and brand color consistency. No template changes.

## Current State (summary of relevant selectors)

| Selector | Location (lines) | Key properties |
|---|---|---|
| `.logo` | 284-294 | `display:flex; gap:10px; font-size:18px; font-weight:700; font-family:var(--font-display); color:var(--accent); letter-spacing:-0.3px;` |
| `.logo-img` | 296-302 | `width:36px; height:36px; border-radius:50%; object-fit:cover; flex-shrink:0;` |
| `.logo-text` | 304-306 | `white-space:nowrap;` |
| `.logo-favicon` | 308-313 | `width:28px; height:28px; border-radius:50%; object-fit:cover;` |

## Changes to Make

### 1. `.logo` — Add cursor + transition
- Add `cursor: pointer;`
- Add `transition: opacity 0.2s ease;`
- Remove redundant `font-size: 18px` (keep only in `.logo-text` per spec)
- Update `letter-spacing` from `-0.3px` to `-0.5px` (slightly tighter)

### 2. `.logo-text` — Typography enhancement
- Add `font-size: 20px;`
- Add `font-weight: 700;`
- Add `font-family: var(--font-display);`
- Add `color: var(--accent);`
- Add `letter-spacing: -0.5px;`
- Add `transition: opacity 0.2s ease;`

### 3. `.logo-img` — Hover transform
- Add `transition: transform 0.3s ease, box-shadow 0.3s ease;`
- Add `.logo:hover .logo-img { transform: scale(1.05); box-shadow: 0 0 0 2px var(--accent); }`

### 4. `.logo:hover .logo-text` — Hover dim
- Add `.logo:hover .logo-text { opacity: 0.8; }`

### 5. `.sidebar.collapsed .logo-favicon` — Collapsed hover scale
- Add `transition: transform 0.2s ease;`
- Add `.sidebar.collapsed .logo-favicon:hover { transform: scale(1.1); }`

### 6. Respect `prefers-reduced-motion`
- All motion-sensitive transitions will be wrapped in `@media (prefers-reduced-motion: no-preference)` block.

## Files Modified
- `D:\Maxma\MaxmaHere\web\src\App.vue` — CSS `<style>` section only

## Verification
- Run `npx vue-tsc --noEmit` to confirm no type errors
- Manual visual check (not automated)
