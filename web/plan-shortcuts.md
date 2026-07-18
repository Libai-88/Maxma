# 快捷键导航提示 —— 执行计划

## 前提：已阅读文件

- `src/App.vue` — 已有 `useGlobalShortcut`、`useSidebar` 导入；已注册 `Ctrl+N`
- `src/components/AppSettingsMenu.vue` — 设置菜单弹窗，底部可添加快捷键指南区域
- `src/composables/useGlobalShortcut.ts` — 快捷键注册工具
- `src/composables/useSidebar.ts` — 侧边栏状态管理
- `src/views/ChatView.vue` — 拥有 `privateMode`/`setPrivateMode`（来自 `useChat`），但未导入 `useSidebar` 或 `useGlobalShortcut`

---

## 修改项

### 1. AppSettingsMenu.vue —— 添加快捷键指南

在弹窗底部（"日志管理"与"重启服务"之间，或最后）插入一个只读的快捷键列表区域：

- 使用与现有 `.popup-section` 一致的样式
- 内容仅展示（不涉及任何新逻辑）
- 显示的快捷键：
  - `Ctrl + N` 新建会话（已有功能）
  - `Ctrl + Escape` 切换侧边栏（待添加）
  - `Ctrl + K` 切换私密模式（待添加）

```html
<div class="popup-section">
  <div class="popup-section-header">⌨ 快捷键 SHORTCUTS</div>
  <div class="shortcut-row"><kbd>Ctrl</kbd> + <kbd>N</kbd> 新建会话</div>
  <div class="shortcut-row"><kbd>Ctrl</kbd> + <kbd>Escape</kbd> 切换侧边栏</div>
  <div class="shortcut-row"><kbd>Ctrl</kbd> + <kbd>K</kbd> 切换私密模式</div>
</div>
```

同时添加配套 scoped 样式。

### 2. App.vue —— 添加 Ctrl+Escape 侧边栏切换

App.vue 已导入 `useSidebar` 和 `useGlobalShortcut`，只需在 `Ctrl+N` 注册行附近追加：

```typescript
useGlobalShortcut({ key: 'Escape', mod: true }, () => { toggleSidebar() })
```

### 3. 关于 Ctrl+K （私密模式切换）

**当前架构限制**：`setPrivateMode` 定义在 `useChat` composable 内，返回给 `ChatView.vue` 使用，属于会话级别的功能。App.vue 没有直接访问 `useChat` 返回的 `setPrivateMode`。

**可选方案**（计划中暂不实现，需要讨论）：
- 方案 A：在 App.vue 中 `useChatStore` 直接操作 `channels` 中当前活跃 session 的 `privateMode` 字段
- 方案 B：通过事件总线 / provide-inject 将 `setPrivateMode` 从 ChatView 向上暴露
- 方案 C：只在指南中显示此项，实际注册使用快捷键等到后续再实现

**建议**：方案 A 最直接，只需在 App.vue 中导入 chat store 并切换活跃 channel 的 `privateMode`。如果同意，可以一并完成。

---

## 执行步骤

1. 编辑 `src/components/AppSettingsMenu.vue` — 插入快捷键展示区域和样式
2. 编辑 `src/App.vue` — 添加 `Ctrl+Escape` 快捷键注册
3. （可选）编辑 `src/App.vue` — 添加 `Ctrl+K` 私密切换（需导入 `useChatStore`）
4. 运行 `npx vue-tsc --noEmit` 验证无类型错误

---

## 未修改的文件

- `ChatView.vue` — 无需改动
- `useGlobalShortcut.ts` — 无需改动
- `useSidebar.ts` — 无需改动
