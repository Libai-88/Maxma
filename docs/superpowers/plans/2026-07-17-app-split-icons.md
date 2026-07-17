# App.vue 拆分 + useChatInput 完善 + ICONS 补齐 实施计划

> **For agentic workers:** 本计划由当前 agent 直接执行，分 Part A/B/C 三次提交。Steps 使用 checkbox (`- [ ]`) 语法跟踪。

**Goal:** 在不破坏 App.vue 核心 logic（keep-alive、路由、健康轮询、paper-texture init）的前提下，保守拆分 App.vue 中可分离的样式与设置弹窗；同步完善 useChatInput 骨架的可独立内部实现；补齐 ICONS.md 中列出的缺失 SVG 图标。

**Architecture:**
- Part A：将 App.vue 中无 template/script 依赖的全局 CSS（markdown / paper-texture）抽到 `assets/styles/`；将设置弹窗抽到独立组件 `AppSettingsMenu.vue`，通过 props/emits 解耦。保留侧栏布局、keep-alive、健康轮询等核心 logic 在 App.vue。
- Part B：由于 ChatView.vue（不在范围）与 ChatInput.vue（Agent 36 范围）才能完成接线，本 agent 不强行接入；仅完善 useChatInput 可独立使用的内部方法（`clearText`、`appendText`、`setText`），不动现有对外接口。
- Part C：在 `assets/icons/` 下新增 ICONS.md 列出的全部缺失 SVG（playground / cite / close / 工具气泡 25 个 / 天气 7 个），统一风格（viewBox 0 0 24 24、stroke-width 1.5、currentColor）。Icon.vue 不在本 agent 范围，仅记录需注册清单。

**Tech Stack:** Vue 3 SFC + TypeScript + Vite + Vitest + vue-tsc

---

## 独占文件范围

可修改：
- `web/src/App.vue`
- `web/src/components/SessionSidebar.vue`（本次不需要修改）
- `web/src/composables/useChatInput.ts`
- `web/src/assets/icons/**`（新增 SVG）
- `web/src/assets/icons/ICONS.md`
- `web/src/assets/styles/markdown.css`（新增）
- `web/src/assets/styles/paper-texture.css`（新增）
- `web/src/components/AppSettingsMenu.vue`（新增）

不修改：
- `web/src/components/Icon.vue`（其他 agent 负责）
- `web/src/components/ChatInput.vue`（Agent 36）
- `web/src/views/ChatView.vue`（Agent 37）
- 其他 .vue 文件

## 基线

- `npx vue-tsc --noEmit`：0 错误
- `npx vitest run`：47 测试全通过

---

## Part A: App.vue 拆分

### Task A1: 抽出 markdown 全局样式到 `assets/styles/markdown.css`

**Files:**
- Create: `web/src/assets/styles/markdown.css`
- Modify: `web/src/App.vue`（删除 `.markdown-body` 相关样式 810-927 行，新增 `@import`）

**理由：** `.markdown-body` 全局样式（约 117 行 CSS）与 App.vue 的 template/script 完全无耦合，是纯展示样式，抽到独立 CSS 文件风险极低。

- [ ] **Step 1: 创建 `web/src/assets/styles/markdown.css`**

内容为 App.vue 第 810-927 行的所有 `.markdown-body*` 选择器，原样搬迁，不做修改。

- [ ] **Step 2: 修改 `web/src/App.vue`**

在 `<style>` 块顶部 `@import` 区追加：
```css
@import '@/assets/styles/markdown.css';
```
然后删除 810-927 行的 `.markdown-body*` 规则（保留前面的 `/* ── Shared markdown rendered content ── */` 注释也可一并删除，由 markdown.css 自带文件头注释替代）。

- [ ] **Step 3: 运行类型检查 + 测试**

```bash
cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit
cd d:\Maxma\MaxmaHere\web && npx vitest run
```
预期：vue-tsc 0 错误；vitest 47 测试通过（无回归）。

### Task A2: 抽出纸纹系统 CSS 到 `assets/styles/paper-texture.css`

**Files:**
- Create: `web/src/assets/styles/paper-texture.css`
- Modify: `web/src/App.vue`（删除 401-431 行纸纹 CSS，新增 `@import`）

**理由：** 纸纹系统（三层叠加，约 30 行）是纯 CSS，依赖 CSS 变量 `--paper-texture-url/size/opacity/card-blend-mode`，无 template/script 耦合。抽出便于后续主题管理。

- [ ] **Step 1: 创建 `web/src/assets/styles/paper-texture.css`**

内容为 App.vue 第 401-431 行的所有 `body.paper-texture*` 与 `html:not([data-theme=...])body.paper-texture::before` 规则，原样搬迁。

- [ ] **Step 2: 修改 `web/src/App.vue`**

在 `<style>` 块 `@import` 区追加：
```css
@import '@/assets/styles/paper-texture.css';
```
删除 401-431 行原纸纹 CSS。

- [ ] **Step 3: 运行类型检查 + 测试**

```bash
cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit
cd d:\Maxma\MaxmaHere\web && npx vitest run
```
预期：无回归。

### Task A3: 抽出设置弹窗到 `AppSettingsMenu.vue`

**Files:**
- Create: `web/src/components/AppSettingsMenu.vue`
- Modify: `web/src/App.vue`（删除设置弹窗 template 40-79、相关 script 149-276、相关 style 596-703，改用 `<AppSettingsMenu>`）

**理由：** 设置弹窗是相对独立的 UI 单元，包含 Teleport + document click outside + popup positioning + 4 个动作（导出错误日志 / 日志管理 / 重启服务 / 重新开始引导）。抽出后 App.vue 减少约 280 行，且弹窗内部状态自管理，与 App.vue 仅通过 props（onboardingEnabled）+ emits（restart-onboarding 等可不必，弹窗内部直接调 onboarding store 也可，但为减少耦合仍走 emits）解耦。

**风险评估：**
- ✅ 不涉及 keep-alive / router-view
- ✅ 不涉及健康轮询
- ✅ 不涉及 paper texture init
- ⚠️ 弹窗内 `closeSettingsMenu()` 在导出/管理/重启流程中被调用 — 抽出后由组件内部管理 `showSettingsMenu` 状态
- ⚠️ 弹窗内 `restartOnboarding()` 调用 `onboarding.restart()` — 通过 emits('restart-onboarding') 上抛，App.vue 处理
- ⚠️ `handleRestart` 中 `restartPollTimer` + `onUnmounted` 清理 — 一并迁移到组件内
- ✅ Teleport to body 不受父组件影响

**接口设计：**
```ts
// AppSettingsMenu.vue props
defineProps<{
  onboardingEnabled: boolean
}>()

// emits
defineEmits<{
  'restart-onboarding': []
}>()
```

弹窗内部自管理：
- `showSettingsMenu`、`restarting`、`exportingErrorLog`、`managingLogs` 状态
- `handleExportErrorLog`、`handleManageLogs`、`handleRestart` 方法
- `toggleSettingsMenu`、`closeSettingsMenu`、`updatePopupPosition`、`onDocumentClick` 方法
- `settingsTriggerRef`、`settingsPopupRef` refs
- `restartPollTimer` + `onMounted/onUnmounted` document listener
- `router-link` 直接使用（vue-router 自动注入）

App.vue 仅保留：
```vue
<AppSettingsMenu :onboarding-enabled="onboardingEnabled" @restart-onboarding="restartOnboarding" />
```
其中 `onboardingEnabled` 是 `stores/onboarding.ts` 导出的 `onboardingEnabled` 常量；`restartOnboarding` 改为：
```ts
function restartOnboarding() {
  onboarding.restart()
}
```

- [ ] **Step 1: 创建 `web/src/components/AppSettingsMenu.vue`**

完整组件，包含：
- `<template>`：trigger button + Teleport popup（原 App.vue 34-79）
- `<script setup lang="ts">`：所有设置弹窗状态/方法（原 149-276 中弹窗相关部分）
- `<style scoped>`：所有 `.settings-popup*` / `.popup-*` 样式（原 596-703）

注意：
- `defineProps<{ onboardingEnabled: boolean }>()`
- `defineEmits<{ 'restart-onboarding': [] }>()`
- 内部 `restartOnboarding` 改为 `emit('restart-onboarding')` + `closeSettingsMenu()`
- 引入 `Icon`、`api`、`invoke`、`onMounted`、`onUnmounted`、`nextTick`、`ref`
- `router-link` 直接使用（无需显式 import useRouter）

- [ ] **Step 2: 修改 `web/src/App.vue`**

- 删除 template 34-79（settings-area + Teleport popup），替换为 `<AppSettingsMenu :onboarding-enabled="onboardingEnabled" @restart-onboarding="restartOnboarding" />`
- 删除 script 中：`showSettingsMenu`、`settingsTriggerRef`、`settingsPopupRef`、`restarting`、`exportingErrorLog`、`managingLogs` refs；`handleExportErrorLog`、`handleManageLogs`、`handleRestart`、`toggleSettingsMenu`、`closeSettingsMenu`、`updatePopupPosition`、`onDocumentClick` 函数；`restartPollTimer` 变量；相关 `onMounted`/`onUnmounted`（document click listener、restartPollTimer cleanup）；`import { invoke } from '@tauri-apps/api/core'`（如不再使用）
- 保留：`onboardingEnabled` import、`onboarding` store、`restartOnboarding` 函数（简化为只调 `onboarding.restart()`）
- 新增 `import AppSettingsMenu from '@/components/AppSettingsMenu.vue'`
- 删除 style 596-703（所有 `.settings-popup*` / `.popup-*` 规则）
- 保留 `.settings-area` 和 `.settings-btn` 样式？— 这些是 trigger button 样式，应迁移到 AppSettingsMenu.vue 的 scoped style。一并删除 App.vue 中 571-594（settings trigger）样式。

- [ ] **Step 3: 运行类型检查 + 测试**

```bash
cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit
cd d:\Maxma\MaxmaHere\web && npx vitest run
```
预期：无回归。

### Task A4: 提交 Part A

- [ ] **Step 1: git add + commit**

```bash
cd d:\Maxma\MaxmaHere
git add web/src/assets/styles/markdown.css web/src/assets/styles/paper-texture.css web/src/components/AppSettingsMenu.vue web/src/App.vue
git commit -m "refactor(app): extract markdown/paper-texture CSS and AppSettingsMenu from App.vue

- Move .markdown-body global styles to assets/styles/markdown.css
- Move paper-texture system CSS to assets/styles/paper-texture.css
- Extract settings popup (template/script/style) to AppSettingsMenu.vue
- App.vue reduced from 927 to ~340 lines"
```

---

## Part B: useChatInput 完善

### Task B1: 评估接入可行性

**结论：不接入 ChatView/ChatInput。**

原因：
- ChatView.vue 当前直接向 ChatInput.vue 传 8 个 props + 5 个 emits（`is-streaming`、`disabled`、`can-send`、`initial-provider-id`、`initial-model-name`、`think-path-enabled`、`quoted-selections`、`quote-candidate` + `send`、`stop`、`model-change`、`commit-quote`、`remove-quote`）
- 接入需要同时修改 ChatView.vue（不在范围）和 ChatInput.vue（Agent 36 范围）
- 强行接入会与 Agent 36 产生冲突

### Task B2: 完善 useChatInput 可独立内部实现

**Files:**
- Modify: `web/src/composables/useChatInput.ts`

**新增方法（不动现有接口）：**
- `clearText(): void` — 清空输入文本（发送后调用）
- `appendText(suffix: string): void` — 追加文本（用于引用插入、快速输入）
- `setText(next: string): void` — 显式设置输入文本

**理由：** 这些方法是输入框状态的天然操作，不依赖 ChatView/ChatInput，且为后续接入预置便利。接口扩展是纯增量，不破坏现有 `UseChatInputReturn`。

- [ ] **Step 1: 修改 `web/src/composables/useChatInput.ts`**

在 `UseChatInputReturn` interface 追加：
```ts
  /** 清空输入文本 */
  clearText: () => void
  /** 追加文本到输入框 */
  appendText: (suffix: string) => void
  /** 显式设置输入文本 */
  setText: (next: string) => void
```

在 `useChatInput` 函数末尾 return 前追加实现：
```ts
  function clearText() {
    localText.value = ''
  }

  function appendText(suffix: string) {
    localText.value += suffix
  }

  function setText(next: string) {
    localText.value = next
  }
```

return 对象追加：
```ts
    clearText,
    appendText,
    setText,
```

- [ ] **Step 2: 运行类型检查 + 测试**

```bash
cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit
cd d:\Maxma\MaxmaHere\web && npx vitest run
```
预期：vue-tsc 0 错误；vitest 47 测试通过。

### Task B3: 提交 Part B

- [ ] **Step 1: git add + commit**

```bash
cd d:\Maxma\MaxmaHere
git add web/src/composables/useChatInput.ts
git commit -m "feat(composable): add clearText/appendText/setText to useChatInput

Add independent text-management methods that don't require ChatView/ChatInput
wiring. ChatView/ChatInput integration is deferred to Agent 36/37 to avoid
conflicts."
```

---

## Part C: ICONS 补齐

### Task C1: 创建 sidebar 与 chat-input 缺失图标

**Files:**
- Create: `web/src/assets/icons/sidebar/playground.svg`
- Create: `web/src/assets/icons/chat-input/cite.svg`
- Create: `web/src/assets/icons/chat-input/close.svg`

**风格规范（与现有 `chat-input/link.svg` 一致）：**
- `xmlns="http://www.w3.org/2000/svg"`
- `viewBox="0 0 24 24"`
- `fill="none"`
- `stroke="currentColor"`
- `stroke-width="1.5"`
- `stroke-linecap="round"`
- `stroke-linejoin="round"`

- [ ] **Step 1: 创建 `playground.svg`**（火花/实验图标）

- [ ] **Step 2: 创建 `cite.svg`**（引用标记，chat-input 上下文）

- [ ] **Step 3: 创建 `close.svg`**（X 关闭按钮）

### Task C2: 创建 tools 工具气泡图标

**Files (Create under `web/src/assets/icons/tools/`):**
- `search.svg`、`code-quality.svg`、`doc-reader.svg`、`pdf-reader.svg`、`python.svg`、`scraper.svg`、`cookie.svg`、`calendar.svg`、`map-pin.svg`、`bus.svg`、`walk.svg`、`bike.svg`、`todo-due.svg`、`todo-project.svg`、`file-page.svg`、`folder.svg`、`checkmark.svg`、`circle-outline.svg`、`arrow-right.svg`、`chevron-right.svg`、`chevron-down.svg`、`error.svg`、`warning.svg`、`syntax-error.svg`、`syntax-ok.svg`

风格同 C1。

- [ ] **Step 1: 一次性创建 25 个工具气泡 SVG**

### Task C3: 创建 weather 天气图标

**Files (Create under `web/src/assets/icons/weather/`):**
- `thunder.svg`、`snow.svg`、`rain.svg`、`fog.svg`、`sunny.svg`、`cloudy.svg`、`partly-cloudy.svg`

风格同 C1。

- [ ] **Step 1: 一次性创建 7 个天气 SVG**

### Task C4: 更新 ICONS.md

**Files:**
- Modify: `web/src/assets/icons/ICONS.md`

将"待准备图标"章节中的所有条目移动到"已就绪图标"章节，并新增 `tools/` 与 `weather/` 子目录说明。

- [ ] **Step 1: 重写 `web/src/assets/icons/ICONS.md`**

### Task C5: 运行测试 + 类型检查

- [ ] **Step 1: 验证**

```bash
cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit
cd d:\Maxma\MaxmaHere\web && npx vitest run
```
预期：无回归（新增 SVG 不影响测试；vue-tsc 不检查 .svg）。

### Task C6: 提交 Part C

- [ ] **Step 1: git add + commit**

```bash
cd d:\Maxma\MaxmaHere
git add web/src/assets/icons/
git commit -m "feat(icons): add 35 missing SVG icons (playground/cite/close/tools/weather)

- sidebar: playground
- chat-input: cite, close
- tools: 25 bubble icons (search/code-quality/doc-reader/...)
- weather: 7 weather icons (thunder/snow/rain/fog/sunny/cloudy/partly-cloudy)
- Update ICONS.md to mark all as ready
- Icon.vue registration deferred to component owner agent"
```

---

## Icon.vue 注册清单（不在本 agent 范围）

新增的 35 个 SVG 需要在 `web/src/components/Icon.vue` 中通过 `import xxx from '@/assets/icons/.../*.svg?raw'` 注册到 `svgContents` map。建议命名（保持现有 kebab-case + 子目录扁平化惯例）：

**sidebar:**
- `playground` → `sidebar/playground.svg`

**chat-input:**
- `cite` → `chat-input/cite.svg`
- `close` → `chat-input/close.svg`

**tools:**
- `search`、`code-quality`、`doc-reader`、`pdf-reader`、`python`、`scraper`、`cookie`、`calendar`、`map-pin`、`bus`、`walk`、`bike`、`todo-due`、`todo-project`、`file-page`、`folder`、`checkmark`、`circle-outline`、`arrow-right`、`chevron-right`、`chevron-down`、`error`、`warning`、`syntax-error`、`syntax-ok` → `tools/*.svg`

**weather:**
- `weather-thunder`、`weather-snow`、`weather-rain`、`weather-fog`、`weather-sunny`、`weather-cloudy`、`weather-partly-cloudy` → `weather/*.svg`

注：本 agent 不修改 Icon.vue。后续 Agent 36/37 或专门 agent 负责注册。

---

## 自检

- ✅ Part A 只动 App.vue + 新建 markdown.css/paper-texture.css/AppSettingsMenu.vue — 均在独占范围
- ✅ Part B 只动 useChatInput.ts — 在独占范围
- ✅ Part C 只动 assets/icons/ — 在独占范围
- ✅ 不动 ChatView.vue / ChatInput.vue / Icon.vue / 其他 .vue
- ✅ App.vue 拆分保守：仅移出无耦合的 CSS 与设置弹窗，保留核心 layout/router/keep-alive/health polling/paper texture init
- ✅ useChatInput 不接入：仅完善可独立内部实现
- ✅ Part A/B/C 分别提交
- ✅ 每步运行 vue-tsc + vitest 防回归
