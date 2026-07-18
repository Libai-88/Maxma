# Plan: 修复 ParsedRef 类型缺失 SelectionRef + 消除 as any 断言

## 背景

`utils/references.ts` 中 `ParsedRef` 联合类型不包含 `SelectionRef`，但 `views/ChatView.vue` 第 284 行创建的选区引用使用 `type: 'selection' as any` 绕过类型检查。

## 步骤

### Step 1 — 在 references.ts 中添加 SelectionRef 接口

在 `ImageRef`（第 63 行）之后、`ParsedRef`（第 65 行）之前插入：

```typescript
/** 选区引用（引用对话中已发送消息的文本片段） */
export interface SelectionRef {
  type: 'selection'
  label: string
  preview: string
}
```

### Step 2 — 更新 ParsedRef 联合类型

将第 65 行改为：

```typescript
export type ParsedRef = FileRef | FolderRef | CiteRef | WebLinkRef | SkillRef | ToolRef | MacroRef | ImageRef | SelectionRef
```

### Step 3 — 添加 REF_CHIP_CONFIG 条目

在 `REF_CHIP_CONFIG` 对象中（image 条目之后，第 108 行之前）添加：

```typescript
  selection: {
    icon: 'cite',
    tooltip: (r: ParsedRef) => (r as SelectionRef).preview,
  },
```

### Step 4 — 修复 ChatView.vue 的 as any

修改第 284-288 行：

```typescript
const quoteRefs: SelectionRef[] = quotedSelections.value.map(q => ({
  type: 'selection',
  label: q.source,
  preview: q.text,
}))
```

并修改第 167 行导入语句：

```typescript
import type { ParsedRef, SelectionRef } from '@/utils/references'
```

### Step 5 — 验证

运行 `npx vue-tsc --noEmit` 确认编译通过。
