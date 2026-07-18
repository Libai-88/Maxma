# 红队第五轮报告（R5）

> 路径：`d:\Maxma\MaxmaHere\RED_TEAM_ROUND5_REPORT.md`
> 日期：2026-07-18
> 比分基线：红队 23 / 蓝队 50

---

## 方向 A：蓝队 R4 修复挑刺

### 审查对象
- 文件：`web/src/components/MessageBubble.vue`
- 蓝队修复：第 6 行 `:class="{ collapsed: isCollapsed }"` → `:class="{ collapsed: isCollapsible && isCollapsed }"`

### 审查结论
**挑刺失败**（0 分）。

蓝队 R4 修复形成完整闭环，无遗留问题、无副作用：

```html
<!-- 第 6 行（修复后） -->
<div class="bubble-content" :class="{ collapsed: isCollapsible && isCollapsed }" ref="contentEl">

<!-- 第 14-20 行：按钮只在可折叠时显示 -->
<button v-if="isCollapsible" class="collapse-toggle" @click="isCollapsed = !isCollapsed">
  {{ isCollapsed ? '展开' : '收起' }}
</button>

<!-- 第 64 行：可折叠判定阈值 -->
const isCollapsible = computed(() => contentHeight.value > 500)
```

逻辑校验：
- 高度 ≤ 500px：`isCollapsible = false` → 不加 `collapsed` class、不显示按钮 → 内容完整可见 ✅
- 高度 401–500px：`isCollapsible = false` → 不截断、无按钮 → 原 bug 修复 ✅
- 高度 > 500px：`isCollapsible = true` → 默认 `isCollapsed = false` 不折叠，点击后折叠 ✅
- 无响应式副作用：`isCollapsible` 与 `isCollapsed` 均为 `computed`/`ref`，Vue 自动追踪 ✅

未发现修复不完整或引入新问题的情形。

---

## 方向 B：新发现 Bug

本轮在尚未深入审查的 `web/src/components/tools/` 区域发现 **5 个中优先级 Bug**，全部已用 Edit 工具实际修复。

### Bug R5-01：AskUserBubble computed 内遗留调试 console.log

- **优先级**：中（2 分）
- **文件**：`web/src/components/tools/AskUserBubble.vue`
- **位置**：原第 228–234 行
- **触发路径**：每次组件响应式更新（props.toolCall 状态变化、submitted 切换、interaction 变更）都会触发 `interactionData` computed 重算，从而执行 console.log，将 `status` / `submitted` / `interactionId` / `mode` 等运行时状态打印到生产控制台，污染日志、可能泄漏交互上下文。
- **修复前**：
  ```js
  const interactionData = computed(() => {
    const raw = props.toolCall.interaction
    const result = raw ? { ...raw, options: raw.options as string[] } : { /* ... */ }
    console.log('[AskUserBubble] interactionData computed:', {  // ← 遗留调试
      status: props.toolCall.status,
      submitted: submitted.value,
      hasInteraction: !!props.toolCall.interaction,
      interactionId: result.interactionId,
      mode: result.mode,
    })
    return result
  })
  ```
- **修复**：删除整个 console.log 块，保留 `return result`。
- **修复后行号**：第 228 行 `return result`

### Bug R5-02：WeatherBubble setup 顶层遗留调试 console.log + 非响应式读取

- **优先级**：中（2 分）
- **文件**：`web/src/components/tools/WeatherBubble.vue`
- **位置**：原第 135–141 行（setup 顶层）
- **触发路径**：每次组件挂载执行一次。`const rawOutput = props.toolCall.output` 是非响应式常量，后续 `JSON.parse` + `console.log` 仅在挂载时刻执行，props 后续变化不会触发；整段代码无任何业务用途，纯属调试残留，污染生产日志。
- **修复前**：
  ```js
  const rawOutput = props.toolCall.output
  if (rawOutput) {
    try {
      const parsed = JSON.parse(rawOutput)
      console.log('[WeatherBubble] raw output data keys:', Object.keys(parsed.data || {}),
        'forecast:', JSON.stringify(parsed.data?.forecast?.slice(0, 2)))
    } catch {}
  }
  ```
- **修复**：整段删除。
- **修复后行号**：第 135 行直接是 `// ── 数据源 ──` 注释

### Bug R5-03：FilesBubble dirName 路径分割未处理 Windows 反斜杠

- **优先级**：中（2 分）
- **文件**：`web/src/components/tools/FilesBubble.vue`
- **位置**：原第 255 行 `dirName` computed
- **触发路径**：Windows 路径（如 `C:\Users\foo\bar`）传入 `directory_path` 或 `search_directory` 时，`path.split('/')` 不会按 `\` 切分，`parts[parts.length - 1]` 返回整段 `C:\Users\foo\bar`，导致目录名显示错误。同文件第 206 行 `fileName` 使用 `[/\\]` 正确处理，存在内部不一致。
- **修复前**：
  ```js
  const dirName = computed(() => {
    const path = (td.value.directory_path as string) || (td.value.search_directory as string) || ''
    const parts = path.split('/').filter(Boolean)
    return parts[parts.length - 1] || path
  })
  ```
- **修复**：`split('/')` → `split(/[/\\]/)`，与 `fileName` 保持一致。
- **修复后行号**：第 255 行

### Bug R5-04：TavilyExtractBubble 页签标题在 url 缺失时崩溃

- **优先级**：中（2 分）
- **文件**：`web/src/components/tools/TavilyExtractBubble.vue`
- **位置**：原第 20 行
- **触发路径**：后端 Tavily Extract 返回的 `results` 数组中，若某个 page 对象的 `title` 为空字符串/null 且 `url` 字段缺失（undefined），模板表达式 `p.title || p.url.slice(0, 28) + '…'` 求值到 `p.url.slice(...)` 时抛 `Cannot read properties of undefined (reading 'slice')`，整个 TavilyExtractBubble 组件渲染崩溃。
- **修复前**：
  ```html
  <button v-for="(p, i) in pages" :key="i" class="te-tab" :class="{ active: tab === i }" @click="tab = i">
    {{ p.title || p.url.slice(0, 28) + '…' }}
  </button>
  ```
- **修复**：`p.title || (p.url ? p.url.slice(0, 28) + '…' : '未命名')`。
- **修复后行号**：第 20 行

### Bug R5-05：TarotBubble card.keywords 缺失时崩溃

- **优先级**：中（2 分）
- **文件**：`web/src/components/tools/TarotBubble.vue`
- **位置**：原第 44 行和第 70 行
- **触发路径**：后端 Tarot 工具返回的 `cards` 数组中，若任一张牌的 `keywords` 字段为 undefined/null（后端漏字段或字段名变更），模板中 `card.keywords.slice(0, 3)` 与 `card.keywords.slice(0, 2).join(' · ')` 均会抛 `Cannot read properties of undefined (reading 'slice')`，整个 TarotBubble 渲染崩溃。由于 Vue 模板表达式整体求值，单张牌缺字段会让整个卡牌列表（横排/竖排）都无法渲染。
- **修复前**：
  ```html
  <!-- 第 44 行 -->
  <span v-for="(kw, ki) in card.keywords.slice(0, 3)" :key="ki" class="kw">{{ kw }}</span>
  <!-- 第 70 行 -->
  <span class="card-row-kw">{{ card.keywords.slice(0, 2).join(' · ') }}</span>
  ```
- **修复**：两处均改为 `(card.keywords || []).slice(...)`，空数组安全降级为无关键词显示。
- **修复后行号**：第 44 行、第 70 行

---

## 修复清单与得分

| Bug ID | 优先级 | 文件 | 得分 |
|--------|--------|------|------|
| R5-01 | 中 | `web/src/components/tools/AskUserBubble.vue` | 2 |
| R5-02 | 中 | `web/src/components/tools/WeatherBubble.vue` | 2 |
| R5-03 | 中 | `web/src/components/tools/FilesBubble.vue` | 2 |
| R5-04 | 中 | `web/src/components/tools/TavilyExtractBubble.vue` | 2 |
| R5-05 | 中 | `web/src/components/tools/TarotBubble.vue` | 2 |

- 新 Bug 得分小计：5 × 2 = **10 分**
- 方向 A 挑刺得分：**0 分**
- 本轮合计：**10 分**
- 累计比分：红队 33 / 蓝队 50

---

## 测试验证

### 前端测试（`npx vitest run`，于 `d:\Maxma\MaxmaHere\web` 执行）

```
Test Files  1 failed | 16 passed (17)
     Tests  47 passed (47)
  Duration  8.08s
```

- **47 个实际执行的测试全部通过**，无回归。
- 唯一失败的 suite：`tests/streamTextSnapshots.spec.ts`
  - 失败原因：`Failed to resolve import "@/composables/streamTextSnapshots" from "tests/streamTextSnapshots.spec.ts". Does the file exist?`
  - **此失败为预先存在的问题**：测试文件引用了一个不存在的 composable `@/composables/streamTextSnapshots`。与本轮 5 个修复（仅触及 `web/src/components/tools/` 下 5 个 Bubble 组件）完全无关。该 spec 没有任何测试被执行（"0 test"），不影响其他 suite。

### 后端测试（`.venv\Scripts\python.exe -m pytest --tb=short -q`，于 `d:\Maxma\MaxmaHere` 执行）

```
4 failed, 1820 passed, 7 skipped in 27.27s
```

- **1820 个测试全部通过**，无回归。
- 4 个失败均为**预先存在的问题**，与本轮修复无关（本轮未触及任何 Python 文件）：
  1. `tests/test_api/test_mcp_routes.py::TestListServerTools::test_returns_empty_tools` — 断言 API 不返回 `note` 字段，但实际返回了 `{'note': 'Tools are managed by OMP sidecar...'}`，属 API 行为变更未同步测试。
  2. `tests/test_pi_bridge/test_sidecar_manager_extra.py::TestResolveBunPath::test_default_bun_path_is_absolute` — 断言 `bun` 解析为绝对路径，但当前环境返回相对路径 `'bun'`，环境依赖问题。
  3. `tests/test_providers_routes.py::TestCreateProvider::test_create_provider_success` — 断言 `result["api_key"] == "sk-xxx"`，但 API 现在返回加密形式 `encv1:eyJ...`，属 Provider 密钥加密功能上线后测试未更新。
  4. `tests/test_providers_routes.py::TestUpdateProvider::test_update_provider_partial` — 同上，`api_key` 加密问题。

### 结论
本轮 5 个 Vue 组件修复未引入任何回归。所有失败均为预先存在的测试与代码不同步问题，与红队 R5 修改无关。

---

## 审查范围说明

本轮重点审查 `web/src/components/tools/` 下尚未深入的角落，发现 5 个中优先级 Bug，全部位于工具结果渲染 Bubble 组件：

- `AskUserBubble.vue`（交互提问）
- `WeatherBubble.vue`（天气）
- `FilesBubble.vue`（文件操作）
- `TavilyExtractBubble.vue`（网页提取）
- `TarotBubble.vue`（塔罗占卜）

### 已审查但未发现中优先级及以上 Bug 的区域

- `web/src/components/ui/`：DsModal / DsOverlay（焦点陷阱）/ DsSelect（WAI-ARIA Combobox）/ DsToast / DsInput / DsTooltip —— 组件库实现规范。
- `web/src/components/workbench/cards/`：ChoiceCard / ConfirmationCard / CodeCard / TableCard / SummaryCard —— Canvas 卡片渲染简单、无空值风险。
- `web/src/components/tools/` 其余 17 个 Bubble（FileEditBubble / GitDiffBubble / GitStatusBubble / ImageBubble / MapBubble / MemoryBubble / PythonBubble / TavilySearchBubble / HolidayBubble / TodoBubble / TaskTrackerBubble / ApprovalBubble 等）+ todo 子组件 6 个 + _shared 3 个 —— 均有合理的空值降级。
- 后端 `api/routes/tools.py`（43 行，硬编码工具列表，无逻辑风险）。

### 未发现的目标区域

- `web/src/components/sidebar/` —— 该目录在当前项目中**不存在**（任务说明建议审查，但实际不存在）。
- 后端 `api/tools/` 子目录 —— **不存在**，仅有 `api/routes/tools.py` 单文件。

---

## 总结

本轮（第五轮，最后一轮）红队工作：

1. **方向 A（挑刺）**：审查蓝队 R4 对 `MessageBubble.vue` 的修复，确认修复正确、完整、无副作用，**挑刺失败 0 分**。
2. **方向 B（找新 Bug）**：在 `web/src/components/tools/` 下 5 个 Bubble 组件中发现 5 个中优先级 Bug（2 个调试残留 console.log、1 个 Windows 路径分割不一致、2 个后端字段缺失导致渲染崩溃），全部用 Edit 工具实际修复，**得分 10 分**。
3. **测试验证**：前端 47 测试全过、后端 1820 测试全过，无回归；剩余 1 前端 + 4 后端失败均为预先存在、与本轮无关。
4. **本轮得分**：**10 分**，累计比分 **红队 33 / 蓝队 50**。

所有修复精准定位到文件:行号，遵循项目既有代码风格（CSP-safe、空值降级、与同文件 `fileName` 实现保持一致），未触及测试文件、Python 文件或 composable，最小化改动范围。
