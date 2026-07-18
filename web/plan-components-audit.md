# 核心 Vue 组件缺陷审计计划

## 审计摘要

对 `ChatInput.vue`、`ChatWindow.vue`、`ContextMenu.vue` 以及全量组件目录进行了事件监听器清理、定时器清理和生命周期配对检查。

---

## 发现的问题

### P0: ChatInput.vue 缺少 `onUnmounted` 生命周期钩子

**文件**: `D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue`

当前问题:
1. **无 `onUnmounted` 钩子** — 组件完全没有卸载清理逻辑
2. **`_connectionErrorTimer` (setTimeout) 泄漏** — 第 264 行声明 `let _connectionErrorTimer`，第 980 行在 `handleSend` 中 `setTimeout(() => { connectionError.value = null }, 5000)`。组件卸载后该 timer 仍在运行，会尝试设置已销毁的 reactive ref
3. **`pickImage()` 创建的 DOM 元素残留** — 第 887-900 行创建 `<input>` 元素并设置 `onchange` 回调，组件卸载后如果用户尚未选择文件，回调引用仍存在

修复方案:
- 添加 `onUnmounted` 钩子
- `_connectionErrorTimer` 在 `onUnmounted` 中 `clearTimeout`
- `pickImage()` 中追踪 input 元素引用，在 `onUnmounted` 中清理

---

### P1: HtmlSandbox.vue 的 iframe 脚本中 `addEventListener` 未配对清理

**文件**: `D:/Maxma/MaxmaHere/web/src/components/HtmlSandbox.vue`

发现:
- 第 236、254、310 行在 iframe `srcdoc` 内嵌脚本中添加了 `window.addEventListener('error', ...)`、`window.addEventListener('unhandledrejection', ...)`、`window.addEventListener('load', reportHeight)`
- 这些监听器位于 iframe 沙箱内部，当 iframe 被销毁时浏览器会自动清理
- `ResizeObserver` 同样在 iframe 内部，会随 iframe 回收

结论: **无需修复** — iframe 销毁时浏览器自动回收。

---

### 已验证为正确的组件

| 组件 | 事件清理 | 定时器清理 | 状态 |
|------|----------|------------|------|
| ContextMenu.vue | `keydown` 在 onMounted 注册、onUnmounted 移除 | 无定时器 | **OK** |
| ChatWindow.vue | `keydown` 在 onMounted 注册、onUnmounted 移除 | `typeTimer`/`typingTimer` 在 onUnmounted 清理 | **OK** |
| AppSettingsMenu.vue | `click` 在 onMounted 注册、onUnmounted 移除 | `restartPollTimer` 在 onUnmounted 清理 | **OK** |
| MediaViewer.vue | `keydown` 在 onMounted 注册、onUnmounted 移除 | `idleTimer` 在 onUnmounted 清理 | **OK** |
| StickerPicker.vue | `click`/`resize` 在 onMounted 注册、onUnmounted 移除 | `recommendationTimer` 在 onUnmounted 清理 | **OK** |
| StickerPreviewOverlay.vue | `keydown` 在 onMounted 注册、onUnmounted 移除 | 无定时器 | **OK** |
| HtmlSandbox.vue (组件级) | `message` 在 onMounted 注册、onUnmounted 移除 | `iframeErrorTimer` 在 onUnmounted 清理 | **OK** |
| AskUserBubble.vue | 无直接 DOM 事件 | `setInterval` 在 onUnmounted 清理 | **OK** |
| DsOverlay.vue | `keydown`/`focusin` 在 onMounted 注册、onUnmounted 移除 | 无定时器 | **OK** |
| DsSelect.vue | `scroll`/`resize`/`mousedown` 在 onMounted 注册、onUnmounted 移除 | `typeAheadTimer` 在 onUnmounted 清理 | **OK** |
| DsTooltip.vue | `scroll`/`resize` 在 onMounted 注册、onUnmounted 移除 | `showTimer` 在 onUnmounted 清理 | **OK** |
| DsToast.vue | 无直接 DOM 事件 | timer 在 onUnmounted 清理 | **OK** |
| SessionSidebar.vue | 使用 `{ once: true }` 自清理 | `hoverLeaveTimer` 在 onUnmounted 清理 | **OK** |
| WorkflowCard.vue | 无直接 DOM 事件 | `pollTimer` 在 onUnmounted 清理 | **OK** |
| SubAgentCard.vue | 无直接 DOM 事件 | `pollTimer` 在 onUnmounted 清理 | **OK** |

---

## 修复计划

### Step 1: 修复 ChatInput.vue

修改 `D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue`:

a) 在 script 顶部导入 `onUnmounted` (当前只导入了 `onMounted`)
b) 添加 `onUnmounted` 钩子:
   - 清理 `_connectionErrorTimer` (setTimeout)
   - 清理 `pickImage()` 创建的 input 元素引用
c) 可选: 拖拽 resize 的 `addEventListener` 已在 `onResizeEnd` 中通过 `releasePointerCapture` + `removeEventListener` 配对，**无需额外处理**

### Step 2: 运行 `npx vue-tsc --noEmit` 验证类型

### Step 3: 输出审计报告

---

## 不修改的发现

- HtmlSandbox.vue iframe 内 `addEventListener` — iframe 回收时自动清理
- ChatInput.vue resize handle 的 `addEventListener` — 使用 `setPointerCapture` 确保 `pointerup`/`pointercancel` 必触发，且 handle 元素随组件 DOM 销毁
- 全量搜索未发现未配对的 `setInterval` — AskUserBubble.vue 的 `setInterval` 已在 `onUnmounted` 中 `clearInterval`
- `ContextMenu.vue` ARIA 角色 (`role="menu"` / `role="menuitem"`) 和键盘导航 (`ArrowDown`/`ArrowUp`/`Home`/`End`/`Enter`/`Space`) 正确

---

请审阅此计划，确认后我将执行修改。
