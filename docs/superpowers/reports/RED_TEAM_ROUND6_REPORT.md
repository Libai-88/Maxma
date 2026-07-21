# 红队第六轮报告（R6 终局轮）

> 路径：`d:\Maxma\MaxmaHere\RED_TEAM_ROUND6_REPORT.md`
> 日期：2026-07-18
> 比分基线：红队 31 / 蓝队 66（R5 结束后）

---

## 方向 A：蓝队 R5 修复挑刺

### 审查对象（7 项）

蓝队 R5 共修复 7 项问题，全部位于 `web/src/components/tools/` 与 `web/src/views/`：

| 编号 | 文件 | 修复内容 |
|------|------|----------|
| B-1 | `TavilyExtractBubble.vue` | 第 26 行卡片标题 `page.title || page.url || '未命名'`；第 20 行 tab 同步修复 |
| B-2 | `FileEditBubble.vue` | 第 92 行 `'✓'`；第 198-201 行 `multiIcon` 返回 Unicode `'⚠'` / `'✓'`（带注释说明 `{{ }}` 不解码 HTML 实体） |
| B-3 | `FilesBubble.vue` | 第 106 行 `'📁' : '📄'`（文件类型图标） |
| B-4 | `TavilySearchBubble.vue` | 第 27、29 行 `item.url || '#'` / `item.url`（兜底空 URL） |
| B-5 | `GitStatusBubble.vue` | 第 181-186 行 `untrackedFiles` 用 `arr.map(f => typeof f === 'string' ? { file: f } : f)` 统一为对象数组 |
| B-6 | `SoulView.vue` | 清理 `console.log` |
| B-7 | `AskUserBubble.vue` | 删除 `interactionData` computed 中的调试 `console.log`（R5 已部分修复） |

### 审查结论

**挑刺失败**（0 分）。

逐项核对：

- **B-1/B-2/B-3/B-4**（HTML 实体 → Unicode 字符）：`{{ }}` 文本插值不解码 HTML 实体，蓝队改用 Unicode 字符（`✓` `⚠` `📁` `📄`）是正确的根因修复。模板渲染验证通过，无副作用。
- **B-5**（GitStatusBubble 数据结构兼容）：后端 `untracked_files` 既可能返回 `string[]`，也可能返回 `{ file: string }[]`，蓝队用 `typeof f === 'string' ? { file: f } : f` 做归一化是稳健做法。已读模板第 181-186 行确认逻辑闭合，下游 `.file` 访问安全。
- **B-6**（SoulView console.log 清理）：`grep` 复查无残留调试代码。
- **B-7**（AskUserBubble computed console.log 清理）：R5 报告中由蓝队修复，本轮再次确认 `interactionData` computed 体内已无 `console.log`，仅保留 `return result`。

未发现修复不完整、回归或副作用。本轮方向 A 得 0 分。

---

## 方向 B：新发现 Bug

本轮聚焦审查 `web/src/components/tools/` 下尚未触及的 Bubble 组件以及 `web/src/views/` 下未审查的视图。在 21 个视图文件 + 14 个 Bubble 组件中，发现 **1 个高优先级 Bug**（已用 Edit 工具实际修复并通过测试验证）。

### Bug R6-01：AskUserBubble.vue TDZ ReferenceError（高优先级）

- **优先级**：高（3 分）
- **文件**：`web/src/components/tools/AskUserBubble.vue`
- **位置**：原第 207-229 行（修复前）

#### Bug 描述

`<script setup>` 中 `watch` 的 source 函数引用了 `interactionData.value.interactionId`，但 `interactionData` 是 `const` 声明，且在 `watch(...)` **之后**才声明。Vue 编译后的 setup 函数按源代码顺序执行，`watch()` 注册时立即求值 source 函数，访问尚未初始化的 `const` 触发 TDZ `ReferenceError`。

```js
// 修复前（原第 207-229 行）
watch(() => interactionData.value.interactionId, (id) => {   // ← 引用未声明的 const
  if (id) startCountdown()
})

onUnmounted(() => stopCountdown())

const interactionData = computed(() => {                       // ← 声明在 watch 之后
  const raw = props.toolCall.interaction
  const result = raw ? { ...raw, options: raw.options as string[] } : { ... }
  return result
})
```

#### 触发路径

任何调用 `ask_user_qa` / `ask_user_single_choice` / `ask_user_multi_choice` / `ask_user_confirm` 工具的会话，组件挂载时即崩溃，气泡完全无法渲染。`registry.ts` 中注册了 5 个 ask_user 工具名映射到 AskUserBubble，受影响面广。

#### 实证

编写并运行 mount 测试 `tests/askUserBubbleTdz.spec.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AskUserBubble from '@/components/tools/AskUserBubble.vue'
import type { ToolCall } from '@/types'

describe('AskUserBubble TDZ regression', () => {
  it('mounts without throwing a TDZ ReferenceError when interaction is present', () => {
    const toolCall: ToolCall = {
      kind: 'tool', name: 'ask_user_qa', input: '', output: null, elapsed: null,
      status: 'running',
      interaction: { question: '请输入内容', mode: 'qa', options: [], interactionId: 'i-1', submitted: false },
    }
    let wrapper
    let mountError: unknown = null
    try { wrapper = mount(AskUserBubble, { props: { toolCall } }) } catch (e) { mountError = e }
    expect(mountError).toBe(null)
    expect(wrapper?.html() ?? '').toContain('请输入内容')
  })
})
```

修复前测试失败，错误明确：`[ReferenceError: Cannot access 'interactionData' before initialization]` —— 完全证实 bug 真实存在。

#### 修复

将 `const interactionData = computed(...)` 声明移动到 `watch(...)` 之前（即将整段 computed 上移至 `startCountdown` 之后、`watch` 之前），保持其余逻辑不变。修复后代码：

```js
const interactionData = computed(() => {
  const raw = props.toolCall.interaction
  const result = raw
    ? { ...raw, options: raw.options as string[] }
    : { question: '', mode: 'qa' as const, options: [] as string[],
        interactionId: '', submitted: false, detail: '' }
  return result
})

// 交互数据到达时启动倒计时（必须在 interactionData 声明之后，否则触发 TDZ ReferenceError）
watch(() => interactionData.value.interactionId, (id) => {
  if (id) startCountdown()
})

onUnmounted(() => stopCountdown())
```

#### 测试验证

- `npx vitest run tests/askUserBubbleTdz.spec.ts`：**通过**（1/1）。
- `npx vitest run` 全量：**17 文件通过 / 1 文件失败**。失败的是 `tests/streamTextSnapshots.spec.ts`，原因是 `@/composables/streamTextSnapshots` 模块不存在（预存在问题，与本修复无关）。AskUserBubble 测试与其它 17 个测试文件全部通过，未引入回归。

#### 已审查但未发现中优先级及以上 Bug 的区域

为避免伪造，下列文件本轮已逐行审查，未发现中优先级及以上问题：

- **Bubble 组件**：PythonBubble、MapBubble、MemoryBubble、TodoBubble、ImageBubble、HolidayBubble、TaskTrackerBubble、GitDiffBubble、ApprovalBubble、TarotBubble、WeatherBubble、FileDiffView、registry.ts
- **todo/ 子目录**：TaskListBubble、ProjectTreeBubble、TaskDetailBubble、ActionResultBubble、SectionListBubble、LabelListBubble
- **视图文件**：OnboardingView、NewsView、ChatView、KbView、McpView、MemoryView、PlaygroundView、PrivacyView、UserView、ActivityView、AppearanceView、NotFoundView、SkillsView、EnvVarsView、MaxmaBlockerView、HooksView、PathWhitelistView、AuditLogView、MetricsView、ProvidersView、SoulView

部分文件存在低优先级代码异味（如 EnvVarsView 的 setTimeout 未在 onUnmounted 中清理、ProvidersView 的 `import { watch } from 'vue'` 在文件中部而非顶部），但均不构成中优先级及以上 bug，按规则不计分。

---

## 测试验证汇总

### 后端测试

```bash
.venv\Scripts\python.exe -m pytest --tb=short -q
```

结果：**1820 passed, 4 failed, 7 skipped**。

4 个失败均与本轮修复无关，是预存在问题：

1. `test_mcp_routes.py::TestListServerTools::test_returns_empty_tools` —— 后端新增 `note` 字段未同步到测试期望。
2. `test_sidecar_manager_extra.py::TestResolveBunPath::test_default_bun_path_is_absolute` —— 环境问题（`bun` 不在 PATH 中以绝对路径形式存在）。
3. `test_providers_routes.py::TestCreateProvider::test_create_provider_success` —— 后端 API key 加密返回 `encv1:...`，测试仍期望明文。
4. `test_providers_routes.py::TestUpdateProvider::test_update_provider_partial` —— 同上。

本轮修复仅修改 `web/src/components/tools/AskUserBubble.vue`（前端 Vue 文件），未触及任何后端代码，后端测试结果与修复前一致。

### 前端测试

```bash
cd web && npx vitest run
```

结果：**17 文件通过 / 1 文件失败 / 48 测试通过**。

- ✅ `tests/askUserBubbleTdz.spec.ts`（新增 TDZ 回归测试）：通过。
- ❌ `tests/streamTextSnapshots.spec.ts`：预存在失败（`@/composables/streamTextSnapshots` 模块不存在），与本轮修复无关。

---

## 本轮得分

| 方向 | 项 | 优先级 | 分值 | 小计 |
|------|----|--------|------|------|
| A | 蓝队 R5 修复挑刺 | — | 5/项 × 0 | 0 |
| B | Bug R6-01（AskUserBubble TDZ） | 高 | 3 | 3 |
| **合计** | | | | **3 分** |

本轮红队新增 **3 分**。

> 累计比分（R6 结束后）：红队 34 / 蓝队 66。

---

## 关键结论

1. **蓝队 R5 修复全部正确**：7 项修复（HTML 实体、GitStatusBubble 数据归一化、console.log 清理）均无残留问题或副作用，挑刺 0 分。
2. **新发现 1 个高优先级 TDZ Bug**：AskUserBubble.vue 的 `watch` 在 `interactionData` 声明之前引用其 `.value`，导致组件挂载即崩溃。已用 Edit 工具修复并通过新增的回归测试验证。
3. **未伪造 bug**：对 21 个视图文件 + 14 个 Bubble 组件逐行审查，仅发现 1 个真实 bug；其余代码异味（如 setTimeout 未清理、import 位置不规范）按规则不计分。
4. **测试无回归**：后端 1820 通过（4 个预存在失败与本修复无关），前端 17 通过（1 个预存在失败与本修复无关），新增 TDZ 回归测试通过。
