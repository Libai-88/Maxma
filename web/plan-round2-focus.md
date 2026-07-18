# Plan: Round 2 — :focus-visible 焦点样式补充

## 目标

为多个可交互元素补充 `:focus-visible` 样式，提升键盘导航与 accessibility。遵循现有代码风格（项目中已有多处 `:focus-visible` 使用 `outline: 2px solid var(--accent); outline-offset: 2px;` 模式）。

## 修改清单

### 1. App.vue — `.nav-item:focus-visible`

- **文件**: `D:/Maxma/MaxmaHere/web/src/App.vue`
- **位置**: 全局 `<style>` 中，在 `.nav-item:hover` 之后（约第 317 行）追加：
  ```css
  .nav-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ```

### 2. ChatView.vue — 切换按钮 (`:focus-visible`)

- **文件**: `D:/Maxma/MaxmaHere/web/src/views/ChatView.vue`
- **目标元素**:
  - `.private-toggle`
  - `.auto-approve-toggle`
  - `.workbench-toggle-btn`
- **位置**: 在 scoped `<style>` 中，各按钮的 `:hover` 规则附近追加对应 `:focus-visible` 规则。
- **样式**:
  ```css
  .private-toggle:focus-visible,
  .auto-approve-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .workbench-toggle-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ```

### 3. AppSettingsMenu.vue — 设置菜单按钮

- **文件**: `D:/Maxma/MaxmaHere/web/src/components/AppSettingsMenu.vue`
- **目标元素**: `.settings-btn`（使用 `.nav-item` class 的 button）
- **位置**: scoped `<style>` 中 `.settings-btn:hover` 后追加。
- **样式**:
  ```css
  .settings-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ```

### 4. SessionItem.vue — 会话列表项

- **文件**: `D:/Maxma/MaxmaHere/web/src/components/SessionItem.vue`
- **目标元素**: `.session-item`（可点击的 div，模拟按钮行为）
- **位置**: scoped `<style>` 中 `.session-item:hover` 后追加。
- **样式**:
  ```css
  .session-item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ```
- **注意**: `.session-item` 是 `<div>` 而非 `<button>`，本身不可 focus。需要添加 `tabindex="0"` 或 `role="button"` 使其可获得焦点。建议给 `SessionItem.vue` 模板中的 `div.session-item` 添加 `tabindex="0"`（因为已有点击事件 `@click`），并在需要时配合 `@keydown.enter` / `@keydown.space` 触发 `switch`。目前已有 `@click` 但无键盘事件，需补充键盘支持。

  **但注意**: `SessionItem` 在 `SessionSidebar.vue` 中通过 `v-for` 循环渲染，其 `@click="$emit('switch', session.session_id)"` 已有，但缺少键盘事件。补充 `tabindex="0"` + `@keydown.enter` + `@keydown.space` 是合适的。

### 5. 全局 `:focus-visible` 兜底

- **文件**: `D:/Maxma/MaxmaHere/web/src/App.vue`
- **位置**: 全局 `<style>` 中，在所有具体规则之前或之后，添加：
  ```css
  /* 全局 :focus-visible 兜底（排除原生表单控件） */
  :focus-visible:not(input):not(textarea):not(select):not([contenteditable]) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ```
- **注意**: 此兜底不能替代上述具体元素样式，因为具体样式作用域更精确；但兜底可以覆盖遗漏的可交互元素。

## 注意事项

- 使用 `outline` 而非 `box-shadow`，确保高对比度模式下兼容。
- 颜色变量使用 `var(--accent)`（所有主题均有定义）。
- 不改变现有布局和尺寸。
- 遵循项目中已有 `:focus-visible` 模式（参考 `PulsePanel.vue`、`ThinkPathChooser.vue`、`PermissionModeControl.vue` 等）。

## 验证

修改完成后，运行：

```bash
npx vue-tsc --noEmit
```

确保 TypeScript 编译通过。
