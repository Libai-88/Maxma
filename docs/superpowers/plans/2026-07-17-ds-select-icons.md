# DsSelect Slot 增强 + Icon.vue 图标注册 实施计划

> **执行者**：独立 sub-agent（独占 `DsSelect.vue` + `Icon.vue`）
> **日期**：2026-07-17
> **技术栈**：Vue 3 + TypeScript + Vite + Vitest

## 目标

1. **Part A**：增强 `DsSelect.vue` 添加 `option` / `trigger` slot 与 `groupKey` 分组能力，**保持完全向后兼容**，使前一轮 Agent 36 丢失的 ModelSelector 三项能力（provider 分组、ctx 显示、trigger 中的 model.svg icon）可在后续 agent 不破坏现有调用方的前提下补回。
2. **Part B**：在 `Icon.vue` 中注册 35 个已就绪但未注册的新 SVG 图标（来自 `web/src/assets/icons/`，由前一轮 Agent 39 创建）。

---

## Context Findings（执行前已确认的事实）

### DsSelect 当前 API（`web/src/components/ui/DsSelect.vue`，490 行）

**Props**（`withDefaults`）：
- `modelValue?: string | number | null`
- `options: DsSelectOption[]`，`DsSelectOption = { value: string|number; label: string; disabled?: boolean }`
- `placeholder?: string`
- `disabled?: boolean`（默认 false）
- `id?: string`
- `ariaLabel?: string`
- `size?: 'sm' | 'md'`（默认 'md'）

**Emits**：`update:modelValue`、`open`、`close`

**Expose**：`openList()`、`closeList()`、`toggle()`

**关键限制**：
- listbox `<li>` 内容是纯文本 `{{ opt.label }}`，无 slot
- options 是平铺数组，无 group 概念
- trigger 是 `<input readonly>` + caret `<button>`，整体表单风格

### 现有调用方（仅供理解，**不修改**）

- `ModelSelector.vue`（Agent 41 独占）：用默认渲染（无 slot）
- `ChatInput.vue`（Agent 41 独占）：provider-select + model-select 两个 DsSelect，都用默认渲染

### Icon.vue 当前注册机制（`web/src/components/Icon.vue`，120 行）

- 模式：`import xxxRaw from '@/assets/icons/<sub>/<name>.svg?raw'` + `svgContents: Record<string, string>` map
- 部分 icon（`settings`/`sticker`/`image`）用内联 SVG 字符串
- `svgContent` computed：从 map 取 raw，剥 XML 声明，按需注入 `<title>`
- 已注册：`chat, memory, model, pin, settings, cite-speech, copy, undo-arrow, attach, file, menu-file, menu-folder, link, sparkles, tool, send, stop, sticker, image`

### 待注册图标清单（来自 `ICONS.md` 第 97-114 行，共 35 个）

**sidebar/**（1）
- `playground` → `sidebar/playground.svg`

**chat-input/**（2）
- `cite` → `chat-input/cite.svg`
- `close` → `chat-input/close.svg`

**tools/**（25，命名去子目录前缀，与文件名一致）
- `arrow-right, bike, bus, calendar, checkmark, chevron-down, chevron-right, circle-outline, code-quality, cookie, doc-reader, error, file-page, folder, map-pin, pdf-reader, python, scraper, search, syntax-error, syntax-ok, todo-due, todo-project, walk, warning`

**weather/**（7，加 `weather-` 前缀避免冲突）
- `weather-thunder, weather-snow, weather-rain, weather-fog, weather-sunny, weather-cloudy, weather-partly-cloudy`

### 命名冲突检查

- 35 个新名与现有 19 个名无冲突
- `tools/warning.svg` → 注册为 `warning`（ICONS.md 第 109 行明确指定）
- `welcome/search.svg` 不在 35 个清单内，不注册
- `status/gear.svg`、`status/warning.svg`、`welcome/chat-bubble.svg`、`logo.svg` 均不在 35 个清单内，不注册

### 测试基线命令
- `cd d:\Maxma\MaxmaHere\web && npx vitest run`
- `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`

---

## Part A：DsSelect Slot 增强

### 设计原则

1. **完全向后兼容**：所有新增能力都是可选的，不提供 slot / 不传 `groupKey` 时行为与原版完全一致。
2. **作用域 slot 参数最小且稳定**：`option` slot 给 `{ option, active, selected }`；`trigger` slot 给 `{ open, toggle }`。
3. **分组渲染**：`groupKey` 指定 option 上某字段名，按该字段值分组；同组顺序保持 options 数组顺序；分组标题渲染为不可选的 `<li role="presentation">`。
4. **键盘导航与 type-ahead 仍基于扁平 `options` 索引**：分组只影响视觉，不影响 activeIndex 语义，避免破坏现有键盘逻辑。

### 任务 A.1：扩展 DsSelectOption 类型与 props

`DsSelectOption` 扩展为允许任意附加字段（用于 `groupKey` 取值）：

```ts
interface DsSelectOption {
  value: string | number
  label: string
  disabled?: boolean
  [key: string]: unknown  // 允许 groupKey 取值
}
```

新增 prop：
```ts
groupKey?: string  // 可选，按此字段分组渲染；不传则平铺
```

### 任务 A.2：添加 `trigger` slot

模板中 trigger 区域（`<input>` + caret `<button>`）用 `<slot name="trigger" :open="open" :toggle="toggle">` 包裹默认内容：

```html
<slot name="trigger" :open="open" :toggle="toggle">
  <!-- 默认 input + caret，保持原样 -->
</slot>
```

> ⚠️ 注意：trigger slot 替换了 input + caret。调用方若用 trigger slot，需自行处理 ARIA/键盘。但默认 fallback 完整保留原 input + caret，确保向后兼容。

### 任务 A.3：添加 `option` slot + 分组渲染

listbox 内部渲染逻辑改为：

```html
<template v-if="groupKey">
  <!-- 分组模式 -->
  <template v-for="(group, gi) in groupedOptions" :key="gi">
    <li role="presentation" class="ds-select__group-header">{{ group.key }}</li>
    <li
      v-for="item in group.items"
      :key="item.opt.value"
      ... 原有 attrs/classes（用 item.index 替代 i）
    >
      <slot name="option" :option="item.opt" :active="item.index === activeIndex" :selected="item.opt.value === modelValue">
        {{ item.opt.label }}
      </slot>
    </li>
  </template>
</template>
<template v-else>
  <!-- 平铺模式（原逻辑） -->
  <li v-for="(opt, i) in options" ...>
    <slot name="option" :option="opt" :active="i === activeIndex" :selected="opt.value === modelValue">
      {{ opt.label }}
    </slot>
  </li>
</template>
```

`groupedOptions` 是 computed：遍历 options，按 `option[groupKey]` 聚合，保留首次出现顺序。每项含 `{ key: string, items: { opt, index }[] }`，`index` 是 opt 在原 options 数组中的下标（供 activeIndex/aria 用）。

### 任务 A.4：分组样式

新增 scoped 样式：
```css
.ds-select__group-header {
  padding: 6px 12px 4px;
  font-size: 0.7em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  font-weight: 600;
  user-select: none;
  cursor: default;
}
.ds-select__group-header:first-child {
  padding-top: 2px;
}
```

### 任务 A.5：验证

- `npx vitest run`：现有 DsSelect 测试（若有）应全过
- `npx vue-tsc --noEmit`：类型无错

### 任务 A.6：提交

commit message：`feat(ui): enhance DsSelect with option/trigger slots and groupKey support`

---

## Part B：Icon.vue 注册 35 个新图标

### 任务 B.1：添加 35 个 `?raw` import

按现有模式，在 `Icon.vue` script 顶部 import 区域追加 35 行：

```ts
// sidebar
import playgroundRaw from '@/assets/icons/sidebar/playground.svg?raw'
// chat-input
import citeRaw from '@/assets/icons/chat-input/cite.svg?raw'
import closeRaw from '@/assets/icons/chat-input/close.svg?raw'
// tools
import arrowRightRaw from '@/assets/icons/tools/arrow-right.svg?raw'
import bikeRaw from '@/assets/icons/tools/bike.svg?raw'
// ... (25 个)
// weather
import weatherThunderRaw from '@/assets/icons/weather/thunder.svg?raw'
// ... (7 个)
```

### 任务 B.2：在 `svgContents` map 追加 35 个条目

按 ICONS.md 命名规范：

```ts
const svgContents: Record<string, string> = {
  // ... 现有 19 个保持不变 ...
  playground: playgroundRaw,
  cite: citeRaw,
  close: closeRaw,
  'arrow-right': arrowRightRaw,
  bike: bikeRaw,
  bus: busRaw,
  calendar: calendarRaw,
  checkmark: checkmarkRaw,
  'chevron-down': chevronDownRaw,
  'chevron-right': chevronRightRaw,
  'circle-outline': circleOutlineRaw,
  'code-quality': codeQualityRaw,
  cookie: cookieRaw,
  'doc-reader': docReaderRaw,
  error: errorRaw,
  'file-page': filePageRaw,
  folder: folderRaw,
  'map-pin': mapPinRaw,
  'pdf-reader': pdfReaderRaw,
  python: pythonRaw,
  scraper: scraperRaw,
  search: searchRaw,
  'syntax-error': syntaxErrorRaw,
  'syntax-ok': syntaxOkRaw,
  'todo-due': todoDueRaw,
  'todo-project': todoProjectRaw,
  walk: walkRaw,
  warning: warningRaw,
  'weather-thunder': weatherThunderRaw,
  'weather-snow': weatherSnowRaw,
  'weather-rain': weatherRainRaw,
  'weather-fog': weatherFogRaw,
  'weather-sunny': weatherSunnyRaw,
  'weather-cloudy': weatherCloudyRaw,
  'weather-partly-cloudy': weatherPartlyCloudyRaw,
}
```

### 任务 B.3：验证

- `npx vitest run`：现有 Icon 测试应全过
- `npx vue-tsc --noEmit`：类型无错
- 验证 35 个文件路径与 import 一致（已用 Glob 确认全部存在）

### 任务 B.4：提交

commit message：`feat(icons): register 35 new SVG icons in Icon.vue`

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| DsSelect trigger slot 替换 input 后 ARIA 失效 | 默认 fallback 完整保留原 input+caret；slot 仅在调用方显式提供时生效 |
| groupKey 取值时 option 上字段不存在 | computed 中用 `option[groupKey] ?? '其他'` 兜底 |
| 分组后 activeIndex 与 DOM li 顺序不一致 | 分组 `<li role="presentation">` 不计入 activeIndex；键盘导航仍基于扁平 options 索引，aria-activedescendant 用 `index` 拼接 ID |
| Icon import 路径拼写错误 | 已用 Glob 列出全部 35 个文件路径，逐字对照 |
| 与 Agent 41/43 并发修改冲突 | 严格只改独占文件（DsSelect.vue + Icon.vue） |

## 验收标准

- [ ] DsSelect 无 slot 调用时行为与原版一致（现有 ModelSelector/ChatInput 不需修改）
- [ ] DsSelect 支持 `#option`、`#trigger` slot 和 `groupKey` prop
- [ ] Icon.vue 注册 35 个新图标，现有 19 个图标不变
- [ ] `npx vitest run` 全过
- [ ] `npx vue-tsc --noEmit` 无错
- [ ] Part A、Part B 分别提交
