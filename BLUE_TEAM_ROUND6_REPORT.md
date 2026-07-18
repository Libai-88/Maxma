# 蓝队第六轮（终局轮）报告

> 项目：Maxma · 对抗式开发竞赛 · 第六轮（终局轮）
> 角色：蓝队（找 bug + 挑刺）
> 范围：审查红队 R6 修复 + 在剩余区域寻找中优先级及以上 bug
> 日期：2026-07-18

---

## 一、方向 A：审查红队 R6 修复（挑刺，5 分/个）

### A-1：审查 Bug R6-01（AskUserBubble.vue 的 TDZ ReferenceError）

**红队报告的 bug**：
- 文件：`web/src/components/tools/AskUserBubble.vue`
- 问题：`<script setup>` 中 `watch(() => interactionData.value.interactionId, ...)` 在 `const interactionData = computed(...)` 声明之前，触发 TDZ（Temporal Dead Zone）ReferenceError，组件挂载即崩溃
- 修复：将 `const interactionData = computed(...)` 声明移动到 `watch(...)` 之前

**蓝队审查结论**：

| 审查项 | 结论 |
|--------|------|
| TDZ bug 是否真实存在 | ✅ 真实存在。`watch` 的回调中访问 `interactionData.value`，而 `interactionData` 是 `const` 声明的 computed，在声明前访问会触发 TDZ ReferenceError。这是 JavaScript 规范行为，与 Vue 无关 |
| 修复方式是否正确 | ✅ 正确。红队将 `const interactionData = computed(...)` 移到 `watch(...)` 之前（当前文件第 206-222 行 computed，第 227-229 行 watch），符合 ES 模块的 TDZ 语义 |
| 新增测试是否合理 | ✅ 合理。`web/tests/askUserBubbleTdz.spec.ts` 通过 mount 组件验证不抛 ReferenceError，是有效的回归测试 |
| 是否有副作用 | ✅ 无副作用。computed 是惰性的，提前声明不影响行为；watch 回调仅在 interactionId 变化时触发 |
| 是否有遗漏的同模式 bug | ✅ 已用 Grep 搜索全部 35 处 `watch(`/`watchEffect(` 调用逐一排查，未发现其他 TDZ 模式 |

**挑刺结论**：**挑刺失败，0 分**。红队 R6 修复正确、完整、无副作用，测试合理。

---

## 二、方向 B：寻找新 bug（中优先级及以上）

### B-1：AskUserBubble.vue watch 缺少 `{ immediate: true }`，历史会话恢复场景下倒计时永远不开始

**优先级**：中优先级（2 分）

**文件:行号**：`web/src/components/tools/AskUserBubble.vue:227`（修复前）

**问题代码**（修复前）：
```js
watch(() => interactionData.value.interactionId, (id) => {
  if (id) startCountdown()
})  // ← 缺少 { immediate: true }
```

**触发路径**：
1. 用户与 AI 进行中的会话被中断（刷新页面 / 重启应用 / 切换会话）
2. 用户回到该会话，前端从后端历史记录恢复消息列表
3. 后端返回的 `toolCall.interaction.interactionId` 已存在（交互正在进行中）
4. AskUserBubble 组件挂载，`interactionData.value.interactionId` 在挂载时已有值
5. 由于 `watch` 默认非 immediate，挂载时不会触发回调，`startCountdown()` 不被调用
6. 倒计时进度条（`countdownRemaining`）保持初始值 300s 不递减，用户看到的是"静止的倒计时"
7. 5 分钟超时后后端可能自动结束交互，但前端 UI 完全无倒计时反馈，用户感知为"卡死"

**为什么这个 bug 之前没被发现**：
- 此 bug 被 TDZ 崩溃掩盖。TDZ 修复前，组件挂载即抛 ReferenceError，根本走不到倒计时逻辑
- TDZ 修复后，组件能正常挂载，但 `immediate: true` 的缺失才暴露出来
- 这是一个典型的"修复一个 bug 暴露另一个 bug"案例

**影响**：
- 用户体验：历史会话恢复场景下交互倒计时 UI 失效，用户无法感知剩余时间
- 功能正确性：倒计时逻辑未启动，`countdownRemaining` 永远是 300s，进度条永远满格
- 触发概率：中等（任何中断后恢复进行中交互的场景都会触发）

**修复**（已用 Edit 工具应用）：

```js
// 交互数据到达时启动倒计时（必须在 interactionData 声明之后，否则触发 TDZ ReferenceError）
// immediate: 组件挂载时若 interactionId 已存在（如从历史会话恢复），需立即启动倒计时，
// 否则只有 interactionId 变化时才会启动，导致历史会话恢复场景下倒计时永远不开始。
watch(() => interactionData.value.interactionId, (id) => {
  if (id) startCountdown()
}, { immediate: true })
```

修复要点：
1. 添加 `{ immediate: true }` 选项，确保组件挂载时若 interactionId 已存在则立即启动倒计时
2. 补充注释说明 `immediate` 的必要性和 TDZ 顺序约束，防止后续维护者重蹈覆辙

---

## 三、同模式 bug 排查（方向 B 补充）

为彻底排查同类问题，用 Grep 搜索了前端全部 35 处 `watch(`/`watchEffect(` 调用，逐一检查：

| 文件 | 模式 | 结论 |
|------|------|------|
| `components/ApprovalBubble.vue` | watch | ✅ 无 TDZ，无 immediate 缺失 |
| `components/tools/_shared/BubbleChrome.vue` | watch | ✅ 无 TDZ |
| `components/tools/PythonBubble.vue` | watch/computed | ✅ 声明顺序正确 |
| `components/tools/TaskTrackerBubble.vue` | watchEffect | ✅ 无 TDZ |
| `components/ToolCallCard.vue` | watch | ✅ 无 TDZ |
| `components/SessionSidebar.vue` | watchEffect | ✅ 无 TDZ |
| `components/StickerPicker.vue` | watch | ✅ 无 TDZ |
| `composables/useChat.ts` | watch | ✅ sessionId 是参数，无 TDZ |
| `composables/useTheme.ts` | watch | ✅ 无 TDZ |
| `composables/usePaperTexture.ts` | watch | ✅ 无 TDZ |
| `composables/useHealthPolling.ts` | watch | ✅ 无 TDZ |
| `views/MetricsView.vue` | watch | ✅ 无 TDZ |
| `views/NewsView.vue` | watchEffect | ✅ 无 TDZ |
| `views/OnboardingView.vue` | watch | ✅ 无 TDZ |
| `views/ProvidersView.vue` | watch | ✅ 无 TDZ |
| 其余 20 处 | watch/watchEffect | ✅ 均无 TDZ 或 immediate 缺失 |

**排查结论**：除 B-1 外，未发现其他同模式 bug。

---

## 四、测试验证

### 前端测试（vitest）

在 `d:\Maxma\MaxmaHere\web` 目录执行 `npx vitest run`：

```
Test Files  17 passed (1 failed)   ← 预存在失败，与本修复无关
     Tests  48 passed
```

- ✅ 红队新增的 `tests/askUserBubbleTdz.spec.ts` 通过（1/1）
- ✅ 本次修复未引入回归
- ⚠️ 1 个预存在失败：`streamTextSnapshots.spec.ts`，与本次修复无关（修复前即失败）

### 后端测试（pytest）

本轮蓝队工作未修改后端代码，无需运行后端测试。

---

## 五、本轮得分与累计比分

### 本轮得分

| 方向 | bug 编号 | 优先级 | 得分 |
|------|----------|--------|------|
| A（挑刺） | A-1 | — | 0（挑刺失败） |
| B（找新 bug） | B-1 | 中 | 2 |
| **本轮合计** | | | **2 分** |

### 累计比分（截至 R6）

| 队伍 | R1-R5 累计 | R6 本轮 | 累计总分 |
|------|-----------|---------|----------|
| 红队 | 34 | 3（R6-01 高优先级） | **37** |
| 蓝队 | 66 | 2（B-1 中优先级） | **68** |
| **领先** | 蓝队 +32 | 蓝队 -1 | **蓝队 +31** |

---

## 六、终局轮总结

本轮作为终局轮，蓝队完成了以下工作：

1. **方向 A（挑刺）**：审查红队 R6 唯一一个高优先级 bug 修复（TDZ ReferenceError），确认红队修复正确、完整、无副作用，挑刺失败 0 分
2. **方向 B（找新 bug）**：在审查红队修复时，发现被 TDZ 崩溃掩盖的关联 bug——`watch` 缺少 `{ immediate: true }`，导致历史会话恢复场景下倒计时永远不开始。已用 Edit 工具修复并验证测试通过，得 2 分
3. **同模式排查**：逐一检查全部 35 处 `watch`/`watchEffect` 调用，确认无其他同模式 bug

**最终累计比分**：红队 37 / 蓝队 68，**蓝队领先 31 分获胜**。

### 关键洞察

本轮最有趣的发现是 B-1：红队修复 TDZ 崩溃后，暴露了一个之前被崩溃掩盖的关联 bug。这类"修复一个 bug 暴露另一个 bug"的现象在 TDZ/空指针类问题中很常见——崩溃分支掩盖了后续逻辑的缺陷。这提示在前端组件测试中，除了"组件能否挂载"外，还应覆盖"挂载后状态是否正确"的场景，特别是涉及 `immediate`/初始值的 watch 逻辑。

---

**报告结束**
