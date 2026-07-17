# Maxma 前端可访问性（a11y）增强 — 实施计划

- **日期**：2026-07-17
- **工作目录**：`d:\Maxma\MaxmaHere\web`
- **角色**：独立高级前端 a11y 工程师
- **依据**：Vercel Web Interface Guidelines（通过 `web-design-guidelines` skill 拉取）+ WAI-ARIA 1.2 Authoring Practices

## 1. 背景与目标

当前 7 个 UI 原语在可访问性上存在系统性缺口：DsModal 缺 dialog 语义、DsOverlay 焦点陷阱只是 tab 边界 wrap 没有处理焦点逃逸（focusin）、DsButton 缺 loading/icon-only/submit、Icon.vue 全部 `aria-hidden` 缺失、缺 DsSelect 与 DsToast。

本次增强目标是：**让 UI 原语层符合 WAI-ARIA 1.2 与 Vercel Web Interface Guidelines**，不破坏现有调用方（design-system.css 的 `.ds-btn` 全局样式仍由 DsButton 渲染产生，类名兼容）。

## 2. web-design-guidelines 关键指导原则（摘录）

> 摘自 https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

- **Accessibility**
  - Icon-only buttons need `aria-label`
  - Form controls need `<label>` or `aria-label`
  - Interactive elements need keyboard handlers (`onKeyDown`/`onKeyUp`)
  - `<button>` for actions, `<a>`/`<Link>` for navigation（not `<div onClick>`）
  - Decorative icons need `aria-hidden="true"`
  - Async updates (toasts, validation) need `aria-live="polite"`
  - Use semantic HTML before ARIA
- **Focus States**
  - Interactive elements need visible focus: `focus-visible:ring-*` or equivalent
  - Never `outline-none` / `outline: none` without focus replacement
  - Use `:focus-visible` over `:focus`
- **Touch & Interaction**
  - `overscroll-behavior: contain` in modals/drawers/sheets
  - `autoFocus` sparingly—desktop only, single primary input; avoid on mobile
- **Anti-patterns**
  - `outline-none` without focus-visible replacement
  - `<div>` or `<span>` with click handlers (should be `<button>`)
  - Icon buttons without `aria-label`

## 3. 独占文件范围

- `web/src/components/ui/DsModal.vue`
- `web/src/components/ui/DsOverlay.vue`
- `web/src/components/ui/DsButton.vue`
- `web/src/components/Icon.vue`（注：实际路径，任务文档写为 `ui/Icon.vue` 但项目中 Icon.vue 在 `components/` 根，是唯一 Icon 文件）
- 新增：`web/src/components/ui/DsSelect.vue`
- 新增：`web/src/components/ui/DsToast.vue`

**严格不修改其他文件**。

## 4. 任务分解（按提交粒度）

### Task 1：DsOverlay 实现真正的焦点陷阱

**问题**：
- 行 54-69 `trapFocus` 仅监听 `keydown` Tab，靠 `document.activeElement` 判断边界；
- 没有处理 shadow DOM、没有处理 `focusin` 焦点逃逸（点击非 focusable 区域会让焦点跑到 body）；
- focusable 选择器未包含 `[contenteditable]`、`audio[controls]`、`video[controls]`、`summary`；
- 没有 `aria-hidden="true"` 隐藏模态背后的内容（"inert backdrop" 模式部分实现）。

**改动**：
- 抽取 `getFocusable()` 工具函数，统一选择器：`a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"], summary, audio[controls], video[controls]`，并过滤 `display:none`/`visibility:hidden`。
- 保留 `keydown` Tab 处理（shift+tab on first → last，tab on last → first）。
- 新增 `focusin` 监听：如果 `e.target` 不在 rootRef 内（焦点逃逸），把焦点拉回 last focusable 或 first focusable。
- 打开时 focus 首个 focusable；若没有则 focus rootRef 自身（设 `tabindex="-1"`）。
- 关闭时还原焦点到 `savedFocus`。
- 模态背景内容：用 `aria-hidden` 设置 `body > *:not([data-ds-overlay-portal])` 的兄弟节点为 `aria-hidden="true"`，离开时还原。（保持简单：仅对本 overlay 的 Teleport 容器做标记，由于 Teleport 到 body，对 body 直接子元素中除 overlay 外的设 aria-hidden；这是常见实践但可能干扰其他 teleports，故仅做最简化版本：不操作 sibling aria-hidden，仅做 focus trap 与 body scroll lock，因为 sibling aria-hidden 与多 overlay 共存会冲突。）

**ARIA**：DsOverlay 自身不设 role（由 DsModal/dialog 等 slot 内容决定）。

**验收**：
- Tab 在模态内循环不逃逸。
- 点击模态空白区域后按 Tab，焦点不会跑到 body。
- 打开模态时焦点自动进入首个 focusable；关闭后焦点回到触发元素。

---

### Task 2：DsModal 补 dialog 语义 + aria-labelledby + 焦点还原

**问题**：
- 行 9-17 `<div class="ds-modal">` 缺 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`；
- 标题在 `<h3>` 但与 dialog 未关联；
- 没有给标题生成稳定 id；
- 没有 `aria-describedby` 透传。

**改动**：
- 用 `useId()` 风格生成稳定 `dialogId`（不用 Vue 3.5 useId，因为项目是 vue ^3.4，自己用 `Math.random().toString(36)` 生成）。
- `<div class="ds-modal" ref="dialogRef" role="dialog" aria-modal="true" :aria-labelledby="title ? titleId : undefined" :aria-describedby="describedby" tabindex="-1">`。
- `<h3 :id="titleId" class="ds-modal__title">`。
- 新增 prop：`describedby?: string`（透传 aria-describedby）。
- 焦点：依赖 DsOverlay 的 focus trap，但 modal 自身 `tabindex="-1"` 让 overlay 找不到 focusable 时也能落到 dialog。

**ARIA**：
- `role="dialog"`
- `aria-modal="true"`
- `aria-labelledby`（指向 `<h3 id>`）
- `aria-describedby`（可选）

**验收**：screen reader 读出 "对话框，<标题>"；Tab 焦点在模态内循环；Esc 关闭。

---

### Task 3：DsButton 增强（loading / iconOnly / type / 新 variant）

**问题**：
- 仅 20 行，无 loading、无 icon-only、无 submit、无 ghost/subtle/success variant；
- 现有 variant 通过 design-system.css 的 `.ds-btn--*` 全局类渲染，需要保持类名兼容（用 `<button :class>`）。

**改动**：
- 新增 props：
  - `variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'subtle' | 'success'`（默认 `'default'`）
  - `size?: 'sm' | 'md'`（默认 `'md'`）
  - `disabled?: boolean`
  - `loading?: boolean`（true 时显示 spinner，按钮禁用，`aria-busy="true"`）
  - `iconOnly?: boolean`（方形按钮，渲染 `.ds-btn--icon-only` 类；强制要求 `ariaLabel`）
  - `type?: 'button' | 'submit' | 'reset'`（默认 `'button'`）
  - `ariaLabel?: string`（icon-only 模式必填）
- 模板：
  - `<button :type="type" :disabled="disabled || loading" :aria-label="ariaLabel" :aria-busy="loading ? 'true' : undefined" :class="[...]">`
  - loading 时插入 `<span class="ds-btn__spinner" aria-hidden="true"></span>`，并隐藏 slot 内容（仍渲染但 `aria-hidden`，避免布局抖动）；改为渲染 spinner + slot 但 spinner 仅在 loading 时显示。
- 新 variant 样式（写入 DsButton.vue `<style scoped>`）：
  - `ghost`：透明背景、无边框、hover 显示淡背景
  - `subtle`：淡灰背景、无边框、hover 加深
  - `success`：绿色背景（`var(--status-success)`，若主题没有则用 `#16a34a`）
  - `icon-only`：方形 `width=height=32px`（sm: 28px），padding 0
  - spinner：`width: 1em; height: 1em; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: ds-btn-spin 0.6s linear infinite;`
  - `prefers-reduced-motion: reduce` 时禁用 spinner 动画
- `:focus-visible` 复用 design-system.css 的 `outline: 2px solid var(--accent)`（DsButton 不重复定义，避免冲突；但 scoped 中加一条 `:focus-visible` 兜底以防 design-system.css 未加载）。

**ARIA**：
- `aria-label`（icon-only 必填）
- `aria-busy="true"`（loading 时）
- `disabled`（loading 时）

**验收**：
- icon-only 渲染为方形、有 aria-label；
- loading 时显示 spinner、按钮禁用、aria-busy=true；
- type="submit" 可用于表单；
- 新 variant 样式正确；
- focus-visible 有可见 outline。

---

### Task 4：Icon.vue 支持 aria-* props

**问题**：
- 行 2 `<span class="icon" v-html="svgContent">` 无 `aria-hidden`；
- 装饰性图标应默认 `aria-hidden="true"`（项目里所有现有 `<Icon>` 都和文字标签并列，应默认装饰性）；
- 缺 `aria-label`（信息性图标）和 `<title>`（tooltip）。

**改动**：
- 新增 props：
  - `decorative?: boolean`（默认 `true`，设 `aria-hidden="true"`）
  - `ariaLabel?: string`（decorative=false 时使用；若未提供，则不设 aria-label，让父元素控制）
  - `title?: string`（生成 `<title>` 元素插入 svg 内）
- 模板：
  - `<span class="icon" :class="`icon--${size}`" :aria-hidden="decorative ? 'true' : undefined" :aria-label="!decorative ? ariaLabel : undefined" v-html="svgContent"></span>`
  - 对于 `title`：在 `svgContent` computed 中，若有 `title` prop，在 `<svg>` 标签后注入 `<title>${escapeHtml(title)}</title>` 作为第一个子元素。
- 兼容性：现有调用 `<Icon name="chat" :size="18" />` 不传 decorative，默认 `decorative=true`，渲染 `aria-hidden="true"`，无破坏。

**ARIA**：
- `aria-hidden="true"`（decorative=true 时，默认）
- `aria-label`（decorative=false + ariaLabel 提供时）
- `<title>` 子元素（title 提供时）

**验收**：
- 现有调用不变，新加 `aria-hidden="true"`；
- `<Icon name="send" :decorative="false" aria-label="发送" />` 提供 aria-label；
- `<Icon name="chat" title="对话" />` 在 svg 内注入 `<title>对话</title>`。

---

### Task 5：新增 DsSelect.vue（combobox 模式）

**问题**：UI 原语缺 combobox，后续要替换 ModelSelector/ChatInput 中的自定义 dropdown。

**设计**：遵循 WAI-ARIA Combobox Pattern（https://www.w3.org/WAI/ARIA/apg/patterns/combobox/），具体采用 "Combobox with Listbox Popup" 模式（input + popup listbox，不用 contenteditable）。

**Props**：
- `modelValue?: string | number | null`（v-model，选中值）
- `options: Array<{ value: string | number; label: string; disabled?: boolean }>`
- `placeholder?: string`
- `disabled?: boolean`
- `id?: string`（input id，用于 label htmlFor）
- `ariaLabel?: string`（无 label 时使用）
- `size?: 'sm' | 'md'`（默认 md）

**Emits**：
- `update:modelValue`（value）
- `open` / `close`（可选）

**模板**：
```
<div class="ds-select" :class="`ds-select--${size}`">
  <input
    ref="inputRef"
    role="combobox"
    :id="id"
    :aria-label="ariaLabel"
    aria-autocomplete="list"
    :aria-expanded="open ? 'true' : 'false'"
    aria-controls="<listboxId>"
    :aria-activedescendant="activeOptionId"
    :aria-disabled="disabled ? 'true' : undefined"
    :placeholder="placeholder"
    :value="selectedLabel"
    :disabled="disabled"
    autocomplete="off"
    spellcheck="false"
    @click="openList"
    @keydown="onKeyDown"
    @focus="onFocus"
    @blur="onBlur"
  />
  <button
    type="button"
    class="ds-select__caret"
    :aria-label="open ? '关闭' : '展开'"
    aria-haspopup="listbox"
    :aria-expanded="open ? 'true' : 'false'"
    tabindex="-1"
    @click="toggle"
    :disabled="disabled"
  >
    <svg ...>▼</svg>
  </button>
  <Teleport to="body">
    <Transition name="ds-select">
      <ul
        v-if="open"
        ref="listboxRef"
        :id="listboxId"
        role="listbox"
        class="ds-select__listbox"
        :style="popupStyle"
        @mousedown.prevent="onListMouseDown"
      >
        <li
          v-for="(opt, i) in options"
          :key="opt.value"
          :id="`${listboxId}-opt-${i}`"
          role="option"
          :aria-selected="opt.value === modelValue ? 'true' : 'false'"
          :aria-disabled="opt.disabled ? 'true' : undefined"
          :class="['ds-select__option', { 'is-active': i === activeIndex, 'is-selected': opt.value === modelValue, 'is-disabled': opt.disabled }]"
          @click="select(opt)"
          @mousemove="activeIndex = i"
        >{{ opt.label }}</li>
      </ul>
    </Transition>
  </Teleport>
</div>
```

**键盘行为表**（WAI-ARIA APG）：

| 键 | 行为 |
|---|---|
| `Arrow Down`（list 关闭） | 打开 list，激活选中项或第一项 |
| `Arrow Down`（list 打开） | 激活下一项（跳过 disabled），到末尾不回环 |
| `Arrow Up`（list 关闭） | 打开 list，激活选中项或最后一项 |
| `Arrow Up`（list 打开） | 激活上一项（跳过 disabled），到开头不回环 |
| `Home` | 激活第一项（跳过 disabled） |
| `End` | 激活最后一项（跳过 disabled） |
| `Enter`（list 打开） | 选择激活项，关闭 list，焦点保持在 input |
| `Escape`（list 打开） | 关闭 list，不改变选择，焦点保持 input |
| `Tab`（list 打开） | 关闭 list，焦点转移到下一 focusable（默认行为，不 preventDefault） |
| `Printable chars` | type-ahead：跳到首个以输入字符开头的 option（1.5s 内累积） |
| `Backspace`/`Delete` | 清空 type-ahead 缓冲 |

**Popup 定位**：用 `getBoundingClientRect()` 计算 input 位置（仅在 open 时读，不在 render 中读），通过 CSS variables 注入 popupStyle。`mousedown.prevent` 防止点 option 时 input blur。

**ARIA 清单**：
- input: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-label`/`id`
- caret button: `aria-haspopup="listbox"`, `aria-expanded`, `aria-label`
- listbox: `role="listbox"`, `id`
- option: `role="option"`, `aria-selected`, `aria-disabled`

**样式**：
- 复用 `var(--bg-primary)`, `var(--border)`, `var(--text-primary)`, `var(--accent)`, `var(--radius-input)`, `var(--shadow-md)`
- `:focus-visible` 用 `outline: 2px solid var(--accent)`
- listbox: `position: fixed`, `z-index: 1001`（高于 overlay 1000）
- active option: `background: var(--bg-secondary)`
- selected option: `color: var(--accent)` + `font-weight: 600`
- `prefers-reduced-motion: reduce` 禁用 transition

**验收**：
- 键盘导航按上表工作；
- 点击 input 或 caret 展开；
- 点击 option 选中并关闭；
- screen reader 读出 "组合框，<标签>，展开，<选中项>"。

---

### Task 6：新增 DsToast.vue

**设计**：通知组件，role=status（非紧急）/ role=alert（紧急），aria-live 配合。

**Props**：
- `message: string`
- `type?: 'info' | 'success' | 'error' | 'warning'`（默认 info）
- `duration?: number`（毫秒，0 = 不自动消失，默认 4000）
- `dismissible?: boolean`（默认 true）
- `role?: 'status' | 'alert'`（默认根据 type：error/warning → alert，info/success → status）

**Emits**：
- `dismiss`

**模板**：
```
<Teleport to="body">
  <Transition name="ds-toast">
    <div
      v-if="visible"
      ref="toastRef"
      class="ds-toast"
      :class="`ds-toast--${type}`"
      :role="resolvedRole"
      aria-live="polite"
      aria-atomic="true"
    >
      <Icon v-if="iconName" :name="iconName" :size="16" :decorative="true" class="ds-toast__icon" />
      <span class="ds-toast__msg">{{ message }}</span>
      <button
        v-if="dismissible"
        type="button"
        class="ds-toast__close"
        aria-label="关闭通知"
        @click="dismiss"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">...</svg>
      </button>
    </div>
  </Transition>
</Teleport>
```

**说明**：
- `aria-live="polite"`：error 也用 polite（不抢屏）；真正紧急用 `role="alert"`（屏幕阅读器会立即读出）。
- `aria-atomic="true"`：保证整条消息被读。
- 自动消失：`duration > 0` 时 setTimeout；hover/focus 暂停计时（避免用户没读完就消失）。
- 关闭按钮：`aria-label="关闭通知"`，icon-only 按钮合规。
- **不引入 Icon.vue 依赖**：因为 Icon.vue 的图标是写死映射的，没有 close 图标。直接在 DsToast 内联 SVG（`aria-hidden="true"`）。
- type 配色：
  - info: `var(--accent)` accent
  - success: `#16a34a`
  - error: `var(--status-error)`
  - warning: `#d97706`

**ARIA 清单**：
- `role="status"`（info/success）或 `role="alert"`（warning/error）
- `aria-live="polite"`
- `aria-atomic="true"`
- close button: `aria-label="关闭通知"`

**验收**：
- 出现时被屏幕阅读器读出；
- duration 到自动消失；
- hover 暂停；
- 关闭按钮可点。

---

## 5. 验证

- `cd d:\Maxma\MaxmaHere\web && npx vitest run`：确保 47 个测试通过（不新增测试，因为本次是 UI 原语层增强，没有引入对现有逻辑的回归；DsSelect/DsToast 等新组件不在测试覆盖范围内）。
- `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`：确保类型检查通过。

## 6. 提交策略

每完成一个 Task 提交一次。提交信息使用 conventional commit 风格：

- `fix(ui): DsOverlay implements real focus trap with focusin guard`
- `fix(ui): DsModal adds dialog role + aria-labelledby + focus restore`
- `feat(ui): DsButton adds loading/iconOnly/type and new variants`
- `feat(ui): Icon adds decorative/ariaLabel/title props for a11y`
- `feat(ui): add DsSelect combobox with ARIA + keyboard nav`
- `feat(ui): add DsToast with role=status/alert + aria-live`

## 7. 约束与风险

- **不修改独占范围外的文件**（包括 design-system.css、tokens.css）。
- **DsButton 类名兼容**：design-system.css 全局 `.ds-btn`/`.ds-btn--*` 样式由 DsButton 渲染产生；DsButton.vue 的 scoped 样式只补充新 variant 与 spinner，不覆盖现有 default/primary/danger。
- **Icon.vue 路径偏差**：任务文档写 `web/src/components/ui/Icon.vue`，实际是 `web/src/components/Icon.vue`，按实际路径修改。
- **不写测试**：任务约束为只修改独占文件，测试文件不在范围内；现有 47 个测试不应回归。
- **不替换 ModelSelector/ChatInput**：Task 5 只创建 DsSelect 组件，不替换任何调用方。
- **ARIA 不过度使用**：优先语义化 HTML（`<button>`、`<input>`），ARIA 仅在语义不足时补充。
