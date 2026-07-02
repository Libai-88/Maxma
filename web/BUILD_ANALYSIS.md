# Vite Build Chunk Size Analysis

## Executive Summary

Two large JS chunks identified:
- **index-0Oywvm6a.js**: 655 KB (entry chunk)
- **MarkdownEditor-jt2HVyiJ.js**: 599 KB (CodeMirror chunk, already lazy-loaded)

**Root cause**: ChatView and MemoryView are statically imported in router, pulling markdown-it + KaTeX (~280 KB minified) into the entry chunk.

---

## Detailed Analysis

### 1. Entry Chunk (655 KB) Breakdown

**Import chain:**
```
main.ts
  ├─> App.vue
  ├─> router/index.ts
  │   ├─> ChatView.vue (STATIC IMPORT)
  │   │   └─> ChatWindow -> MessageBubble -> RenderMarkdown
  │   │       └─> utils/markdown.ts
  │   │           ├─> markdown-it (745 KB raw)
  │   │           ├─> markdown-it-texmath
  │   │           └─> katex (1895 KB raw)
  │   └─> MemoryView.vue (STATIC IMPORT)
  │       └─> MemoryPanel
  ├─> katex/dist/katex.min.css (23 KB)
  └─> vue (2428 KB raw), vue-router (400 KB raw)
```

**Estimated contributions (minified):**
| Dependency | Raw Size | Est. Minified |
|---|---|---|
| Vue 3 | 2428 KB | ~230 KB |
| KaTeX | 1895 KB | ~180 KB |
| markdown-it + plugins | 783 KB | ~100 KB |
| vue-router | 400 KB | ~40 KB |
| App + ChatView + components | ~200 KB | ~60 KB |
| Composables, api, utils | ~100 KB | ~30 KB |
| **Total** | | **~640 KB** |

### 2. MarkdownEditor Chunk (599 KB) Breakdown

**Import chain:**
```
SoulView.vue (lazy-loaded ✓)
  └─> MarkdownEditor.vue
      ├─> vue-codemirror
      └─> @codemirror/lang-markdown
          └─> @codemirror/lang-html
              ├─> @codemirror/lang-css
              └─> @codemirror/lang-javascript
          └─> @codemirror/view (477 KB)
          └─> @codemirror/state (142 KB)
          └─> @codemirror/language (100 KB)
          └─> @codemirror/autocomplete (88 KB)
          └─> @lezer/* (parsers)
```

**Total raw**: ~1100 KB → **599 KB minified**

This chunk is **already correctly code-split** (lazy-loaded via dynamic import).

### 3. Route Lazy Loading Status

| Route | Component | Loading | Status |
|---|---|---|---|
| `/` | ChatView | **Static** | ❌ MUST FIX |
| `/memory` | MemoryView | **Static** | ❌ MUST FIX |
| `/playground` | NewsView | Dynamic | ✅ OK |
| `/providers` | ProvidersView | Dynamic | ✅ OK |
| `/soul` | SoulView | Dynamic | ✅ OK |
| `/user` | UserView | Dynamic | ✅ OK |
| Others | - | Dynamic | ✅ OK |

**File**: `src/router/index.ts` (lines 2-3)
```typescript
import ChatView from '@/views/ChatView.vue'   // ❌ Static
import MemoryView from '@/views/MemoryView.vue' // ❌ Static
```

---

## Recommendations (Priority Order)

### ✅ P0: Convert ChatView & MemoryView to Lazy Loading

**File**: `src/router/index.ts`

**Change:**
```typescript
// Before
import ChatView from '@/views/ChatView.vue'
import MemoryView from '@/views/MemoryView.vue'

// After
const ChatView = () => import('@/views/ChatView.vue')
const MemoryView = () => import('@/views/MemoryView.vue')
```

**Impact**: Entry chunk drops from 655 KB → ~350 KB (removes markdown-it + KaTeX)

### ✅ P1: Add manualChunks to Vite Config

**File**: `vite.config.ts`

**Add:**
```typescript
export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router'],
          'vendor-markdown': [
            'markdown-it',
            'markdown-it-texmath',
            'markdown-it-task-lists',
            'katex'
          ],
          'vendor-codemirror': [
            'codemirror',
            'vue-codemirror',
            '@codemirror/lang-markdown',
            '@codemirror/view',
            '@codemirror/state',
            '@codemirror/language'
          ]
        }
      }
    }
  }
})
```

**Impact**: Vendor libraries cached separately, entry chunk ~200 KB

### ✅ P2: Move KaTeX CSS Import

**File**: `src/main.ts` (line 4)

**Move** `import 'katex/dist/katex.min.css'` from `main.ts` to `utils/markdown.ts`

**Impact**: KaTeX CSS (23 KB) + fonts only load when markdown is rendered

### ⚠️ P3: CodeMirror Optimization (Optional)

The MarkdownEditor chunk (599 KB) is already lazy-loaded. Options:
- **Accept it**: Only loads when user visits `/soul` or `/user`
- **Replace**: Use lighter markdown editor if basic editing suffices
- **Split**: Further manual chunking (limited benefit)

---

## Expected Results

| Chunk | Before | After P0 | After P0+P1 |
|---|---|---|---|
| Entry (index) | 655 KB | ~350 KB | ~200 KB |
| Chat view | (in entry) | ~300 KB | ~200 KB + vendor-markdown |
| vendor-vue | (in entry) | (in entry) | ~270 KB (cached) |
| vendor-markdown | (in entry) | ~280 KB | ~280 KB (cached) |
| vendor-codemirror | 599 KB | 599 KB | ~400 KB (cached) |

**First-load improvement**: 655 KB → 200 KB (70% reduction)

---

## Files Analyzed

- `D:\Maxma\MaxmaHere\web\vite.config.ts`
- `D:\Maxma\MaxmaHere\web\src\router\index.ts`
- `D:\Maxma\MaxmaHere\web\src\main.ts`
- `D:\Maxma\MaxmaHere\web\src\App.vue`
- `D:\Maxma\MaxmaHere\web\src\views\ChatView.vue`
- `D:\Maxma\MaxmaHere\web\src\views\MemoryView.vue`
- `D:\Maxma\MaxmaHere\web\src\components\MarkdownEditor.vue`
- `D:\Maxma\MaxmaHere\web\src\components\RenderMarkdown.vue`
- `D:\Maxma\MaxmaHere\web\src\utils\markdown.ts`
- `D:\Maxma\MaxmaHere\web\package.json`
