# Plan: Move KaTeX CSS from Global Import to Lazy Load

## Background
Currently `main.ts` line 5 does `import 'katex/dist/katex.min.css'`, which loads KaTeX CSS eagerly for every page load. Since KaTeX is only needed when rendering mathematical formulas, we can defer this CSS load.

## Files to Modify

1. **`D:/Maxma/MaxmaHere/web/src/main.ts`** (line 5)
   - Remove `import 'katex/dist/katex.min.css'`
   - Add a comment explaining why

2. **`D:/Maxma/MaxmaHere/web/src/components/RenderMarkdown.vue`**
   - Add dynamic `import('katex/dist/katex.min.css')` in the `<script setup>` section
   - Place it before the component logic, so CSS is loaded as early as possible when this component is first used

## Approach (方案 1 — Recommended)
- RenderMarkdown.vue is the only component that triggers KaTeX rendering (via `renderMarkdown()` from `@/utils/markdown`)
- Adding the dynamic import there ensures the KaTeX CSS is only fetched when a page actually renders markdown content
- Vite automatically handles dynamic CSS imports by injecting a `<link>` into `<head>`

## No Changes Needed
- `D:/Maxma/MaxmaHere/web/src/utils/markdown.ts` — already imports `katex` JS; no CSS changes needed here

## Verification
- Run `npx vue-tsc --noEmit` (or the project's type-check script) to ensure no TypeScript errors
- Run `npx vite build` to ensure the build succeeds
