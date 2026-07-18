# 前端模块优化计划 - Round 1

## 问题 1：`TURNS_KEY_PREFIX` 重复定义

### 现状
- `stores/chat.ts:6` — `export const TURNS_KEY_PREFIX = 'maxma_turns_'` (单一起源)
- `composables/useChat.ts:16` — `export const TURNS_KEY_PREFIX = 'maxma_turns_'` (重复定义)

### 修改方案
1. `composables/useChat.ts`:
   - 删除第 16 行 `export const TURNS_KEY_PREFIX = 'maxma_turns_'`
   - 第 4 行 `import { useChatStore } from '@/stores/chat'` 改为 `import { useChatStore, TURNS_KEY_PREFIX } from '@/stores/chat'`
   - 保留 `useChat.ts` 中所有使用 `TURNS_KEY_PREFIX` 的代码不变（它们继续引用模块级常量，现在从 `@/stores/chat` 导入）

---

## 问题 2：`removeTurnsFromStorage` 重复定义

### 现状
- `stores/chat.ts:77-79` — store 内部方法 `removeTurnsFromStorage(sid)` (保留)
- `stores/chat.ts:153-155` — 模块级导出函数 `removeTurnsFromStorage(sid)` (重复，待删除)
- `stores/session.ts:4` — `import { removeTurnsFromStorage, TURNS_KEY_PREFIX } from '@/stores/chat'` (引用了模块级函数)
- `stores/session.ts:76` — `removeTurnsFromStorage(id)` (调用该函数)

### 修改方案
1. `stores/chat.ts`:
   - 删除第 152-155 行（模块级导出的重复函数）

2. `stores/session.ts`:
   - 第 4 行：`import { removeTurnsFromStorage, TURNS_KEY_PREFIX } from '@/stores/chat'`
     改为 `import { TURNS_KEY_PREFIX, useChatStore } from '@/stores/chat'`
   - 第 76 行：`removeTurnsFromStorage(id)` 改为 `useChatStore().removeTurnsFromStorage(id)`

---

## 问题 3：动态导入 api 方式不统一

### 现状
- `stores/chat.ts:115` — 使用动态 `const { getToken } = await import('../api/index')` 获取 token
- `composables/useChat.ts:8` — 使用模块顶层 `import { getToken, ensureTokenLoaded, resetToken, api } from '@/api'`

### 修改方案
1. `stores/chat.ts`:
   - 在第 4 行（类型导入之后）添加 `import { getToken } from '@/api'`
   - 第 115 行 `const { getToken } = await import('../api/index')` 改为直接使用 `getToken()`（因为已通过静态导入获得）

---

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `composables/useChat.ts` | 编辑 | 替换 `TURNS_KEY_PREFIX` 定义 为 import |
| `stores/chat.ts` | 编辑 | 删除模块级 `removeTurnsFromStorage`；替换动态 import 为静态 import |
| `stores/session.ts` | 编辑 | 改用 `useChatStore().removeTurnsFromStorage()` |

## 验证检查
- [ ] `grep -rn "TURNS_KEY_PREFIX\|removeTurnsFromStorage"` 确认不再有重复定义
- [ ] 确认 `stores/session.ts` 中没有再使用模块级的 `removeTurnsFromStorage`
- [ ] 确认 `stores/chat.ts` 不再有 `await import('../api/index')`
