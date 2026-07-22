# 014 — Fix ContextMenu `-webkit-` vs standard `backdrop-filter` blur mismatch

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: MEDIUM
- **Category**: Materials
- **Estimated scope**: 1 file, 1 line changed

## Problem

`web/src/components/ContextMenu.vue:163-164` has a vendor prefix mismatch:

```css
/* Current — line 163-164 */
backdrop-filter: blur(12px) saturate(1.2);
-webkit-backdrop-filter: blur(16px) saturate(1.2);  /* 16px ≠ 12px */
```

Safari/WebKit users see 16px blur; Chrome/Edge/Firefox users see 12px blur. This is a bug — the vendor prefix should match the standard property exactly.

## Target

```css
backdrop-filter: blur(12px) saturate(1.2);
-webkit-backdrop-filter: blur(12px) saturate(1.2);
```

## Steps

1. Open `web/src/components/ContextMenu.vue`.
2. Find line 164: `-webkit-backdrop-filter: blur(16px) saturate(1.2);`
3. Change `blur(16px)` to `blur(12px)`.
4. Save.

## Boundaries

- Do NOT change any other property in this file.
- Do NOT change the standard `backdrop-filter` value (12px is correct).

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**: Open ContextMenu in both Chrome and Safari (if available) — confirm the blur radius is identical.
- **Done when**: Both `backdrop-filter` and `-webkit-backdrop-filter` use `blur(12px)`.
