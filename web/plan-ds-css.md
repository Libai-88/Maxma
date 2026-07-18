# Plan: Fix hardcoded values in design-system.css

## Pre-check summary

**File:** `D:\Maxma\MaxmaHere\web\src\assets\styles\design-system.css`
**Tokens available in:** `D:\Maxma\MaxmaHere\web\src\assets\styles\tokens.css`

### Status of each category

| # | Category | Status | Action |
|---|----------|--------|--------|
| 1 | `border-radius: 6px` | **2 occurrences** (`.ds-btn` L30, `.ds-input` L79) | Replace with `var(--radius-input)` (exact 6px match) |
| 2 | `border-radius: 12px` | **1 occurrence** (`.ds-modal` L156) | Replace with `var(--radius-lg)` (exact 12px match) |
| 3 | `rgba(0, 0, 0, 0.4)` | **1 occurrence** (`.ds-modal-overlay` L147) | **Need decision** — see below |
| 4 | `box-shadow` hardcoded | **Already done** — L108 uses `var(--shadow-sm)`, L160 uses `var(--shadow-xl)` | No change needed |
| 5 | `font-size: 13px` etc. | **Already done** — all font-sizes already use `var(--fs-*)` | No change needed |

### Detail on category 3 (modal overlay)

The `.ds-modal-overlay` uses `background: rgba(0, 0, 0, 0.4)`.

Available overlay tokens in `tokens.css` (and all theme files):
- `--overlay-subtle`: rgba(0,0,0,0.03)
- `--overlay-light`:  rgba(0,0,0,0.05)
- `--overlay-medium`: rgba(0,0,0,0.08)
- `--overlay-strong`: rgba(0,0,0,0.15)

None match 0.4 opacity. `--overlay-strong` (0.15) is the strongest but much lighter — using it would make the modal backdrop barely visible. **I recommend keeping the hardcoded `rgba(0, 0, 0, 0.4)`** and optionally adding a `--overlay-modal` token in a future task. Alternative: use `--overlay-strong` and accept the lighter backdrop.

## Proposed changes

### Change 1 — `.ds-btn` border-radius (L30)
```
-  border-radius: 6px;
+  border-radius: var(--radius-input);
```

### Change 2 — `.ds-input` border-radius (L79)
```
-  border-radius: 6px;
+  border-radius: var(--radius-input);
```

### Change 3 — `.ds-modal` border-radius (L156)
```
-  border-radius: 12px;
+  border-radius: var(--radius-lg);
```

### Change 4 — `.ds-modal-overlay` (L147)
Option A: Keep `rgba(0, 0, 0, 0.4)` as-is (recommended).
Option B: Replace with `var(--overlay-strong)` (lighter backdrop, 0.15 vs 0.4).

## Verification
After changes, run:
```
cd D:/Maxma/MaxmaHere/web && npx vue-tsc --noEmit
```

---

**Please confirm so I can proceed with the edits.**
