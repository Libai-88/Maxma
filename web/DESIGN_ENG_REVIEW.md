# Maxma 设计工程深度审查报告

> **审查时间**: 2026-07-21
> **审查范围**: MaxmaHere Web 前端（`D:/Maxma/MaxmaHere/web/`）
> **审查技能源**: `skills-main/skills/` 中的 7 套设计工程技能（apple-design, emil-design-eng, review-animations, find-animation-opportunities, improve-animations, animation-vocabulary, pick-ui-library）
> **前置审查**: 已有 `UI_UX_REVIEW.md` (8.5/10) 和 `FRONTEND_REVIEW_REPORT.md` (8.2/10) 覆盖了架构、主题系统、品牌等宏观维度。本报告聚焦前两次审查未深入触及的**动效物理感、交互中断性、CSS 动画卫生、手势与材质细节**，并用设计师视角提出改进路径。

---

## 执行摘要

Maxma 的动画和交互质量在同类 AI 聊天应用中属于顶尖水平。主题系统的完整度、`tokens.css` 缓动曲线体系的成熟度（6 条定制曲线 + 三档时长）、以及 `prefers-reduced-motion` 的全面覆盖，说明团队对动效有深入理解。

但这批审查技能来自 Apple WWDC 设计工程和 Emil Kowalski 的极高标准。在这个标准下，**"够好"不等于"对"**。本报告的核心发现是：项目大量使用 CSS `@keyframes` 和硬编码 `transition: all`，这些模式在日常使用中表现良好，但在高频交互、中断场景和极端性能条件下会暴露问题。

---

## 一、从 Apple 流体交互框架的审视

### 1.1 按压反馈（Response on pointer-down）

**Apple 原则**：必须在 pointer-down（而非 click/pointer-up）瞬间给出反馈，否则"直接操控感会断崖式下降"。

| 当前状态 | 问题 |
|---------|------|
| `design-system.css` 中 `.ds-btn` 的 `:active` 状态被包裹在 `@media (prefers-reduced-motion: no-preference)` 中 | 设置了 `prefers-reduced-motion: reduce` 的用户完全失去按压反馈 —— 但 Apple 原则说 reduced motion ≠ no feedback，只是换成更温和的版本 |
| `DsButton.vue` 自身的 scoped CSS 没有 `:active` 样式，完全依赖全局 `design-system.css` | 如果组件在 isolated 环境中使用（Shadow DOM、iframe、独立加载），按压反馈丢失 |
| 工具气泡中的按钮（AskUserBubble, PythonBubble, FilesBubble 等）大部分没有 `:active` 状态 | 用户点击时得不到即时确认 |

**建议**：
- 将 `scale(0.97)` 按压反馈移到 `:active` 本身，不绑定在 `prefers-reduced-motion` 媒体查询上。对于 reduced-motion 用户，保留 `opacity` 变化作为替代反馈。
- 每个可点组件应该自带按压反馈，不依赖全局样式。

### 1.2 中断性（Interruptibility）—— 最严重的架构性问题

**Apple 原则**："每个动画必须可中断、可重定向。用户必须能在动画中途抓住一个元素并反转它，而不必等动画完成。"

Maxma 的入场动画全部使用 CSS `@keyframes`：

```
MessageBubble.vue  → userBubbleIn / assistantBubbleIn（keyframes）
ChatInput.vue      → quote-pop-in（keyframes）
SessionSidebar.vue → 多个 Transition name（keyframes）
FloatSidebar.vue   → fs-slide-in / fs-slide-out（keyframes）
StickerPreviewOverlay → previewScaleIn / previewFadeIn（keyframes）
```

**keyframes 和 CSS transitions 的关键区别**：
- **`@keyframes` 不可中断** —— 动画一旦开始，必须播完或完全停止。如果用户快速连发消息，前一条消息的 `animation` 无法被平滑中断和重定向，只能要么播完、要么瞬间消失。
- **CSS `transition` 可中断** —— 如果 mid-animation 改变目标值，过渡会从当前计算值平滑重定向，不会跳帧。

**严重性**：对于 chat 这种高频消息场景（用户可能连续发送多条消息、快速切换会话），keyframe 动画的不可中断性意味着：

1. 快速发送消息时，前一条气泡的 `scale(0.96)→scale(1)` 动画被截断的视觉表现不佳
2. 快速切换会话时，旧会话消息的 exit animation 和新会话的 enter animation 可能冲突

**建议**：将气泡入场改为 CSS `transition` + `@starting-style` 组合：

```css
.message-row {
  opacity: 1;
  transform: translateX(0) scale(1);
  transition: opacity 0.3s var(--ease-spring),
              transform 0.3s var(--ease-spring);
  @starting-style {
    opacity: 0;
    transform: translateX(var(--slide-x, 16px)) scale(0.96);
  }
}
.message-row.user { --slide-x: 16px; }
.message-row.assistant { --slide-x: -16px; }
```

使用 `@starting-style` 代替 keyframes，将消息变成可中断的 transition。这是一个大改动，建议先从高频触发区域（消息气泡、引用标签）开始。

### 1.3 速度交接（Velocity handoff）

**Apple 原则**：手势结束和动画开始之间不能有可见缝隙。动画必须继承手指离开时的精确速度。

Maxma 目前没有手势驱动的拖拽/轻扫交互（消息没有 swipe-to-dismiss、侧边栏没有手势操控）。如果未来计划增加这些交互：

- `<script>` 中使用 Pointer Events + 速度历史记录
- 释放时用 spring 动画接手，传入 `initialVelocity`
- 使用 `Motion` 库或 WAAPI `animate()`，避免 CSS transition（因为 transition 不支持自定义初始速度）

目前无需改动，但此条应纳入未来手势开发的架构预设。

### 1.4 空间一致性

**Apple 原则**：元素从哪里进，就从哪里出。

| 组件 | 进场方向 | 退场方向 | 一致？ |
|------|---------|---------|-------|
| SessionDrawer | `translateX(-100%)` 从左滑入 | 使用 `v-if` 控制，未定义退场动画 | ❌ 退场无动画 |
| 消息气泡 | 各自从侧边滑入 | 无退场动画 | ✅ 暂无不一致（因为没有退场） |

**建议**：为 SessionDrawer 添加退场动画，路径与进场对称：

```css
.session-drawer-leave-active {
  animation: fs-slide-out 0.2s var(--ease-out);
}
```

### 1.5 材质化入场（Materialize, don't just fade）

`glass.css` 的 `maxma-glass-materialize` 动画非常出色 —— 同时动画 `opacity`、`scale` 和 `backdrop-filter`，模拟真实材料到达而非简单淡入。这是项目中品质最高的动画之一，建议扩展到所有面板类元素（SessionDrawer、ContextMenu、ThemePicker 弹窗）。

---

## 二、从 Emil Kowalski 设计工程的审视

### 2.1 不可接受的模式：`transition: all`

**Emil 原则**：`transition: all` 是无界限的属性动画，会引发非预期的布局属性和滤镜被动画化，导致性能下降和感知怪异。

项目中有 **15 处以上** `transition: all`：

| 文件 | 行 | 当前代码 |
|------|----|---------|
| `AskUserBubble.vue` | 360 | `transition: all 0.12s` |
| `PythonBubble.vue` | 213, 351 | `transition: all 0.12s` / `transition: all 0.15s` |
| `TavilyExtractBubble.vue` | 157 | `transition: all .15s` |
| `PinButton.vue` | 42 | `transition: all 0.15s` |
| `WorkbenchPanel.vue` | 215 | `transition: all 0.15s` |
| `ErrorCard.vue` | 150 | `transition: all 0.15s` |
| `MessageBubble.vue` | 245 | `transition: all 0.2s` |
| `PlanCard.vue` | 386 | `transition: all 0.15s` |
| `StickerPicker.vue` | 599, 652, 777 | `transition: all 0.15s` / `transition: all 0.2s ease` |
| `ThemePicker.vue` | 104, 173 | `transition: all var(--duration-fast)` |
| `ThinkingBlock.vue` | 77, 109, 127 | `transition: all 0.4s ease` |
| `ChatInput.vue` | 1777 | `transition: all 0.2s cubic-bezier(…)` |

**严重性**：BLOCK。每条都列出它具体动画了哪些属性会导致问题，并给出精确替换。

**修复优先级**：
1. `ThinkingBlock.vue` — 3 处 `transition: all 0.4s ease`，400ms + `ease` 是双重问题：既指定了 all 又使用了弱缓动曲线
2. `MessageBubble.vue` — `transition: all 0.2s` 影响气泡 hover，`all` 意味着 `border-radius`、`background` 等也在动画列表里
3. 各工具气泡中的 `all 0.12s` — 虽时长短，但 `all` 本身语义错误

**修复示例**：
| Before | After | Why |
|--------|-------|-----|
| `transition: all 0.4s ease` | `transition: opacity 0.25s var(--ease-out), transform 0.25s var(--ease-out)` | 指定属性、缩短时长、使用定制曲线 |
| `transition: all 0.2s` | `transition: box-shadow 0.15s var(--ease-out), transform 0.15s var(--ease-out)` | box-shadow 和 transform 是真正需要动画的属性 |

### 2.2 弹入动画从 scale(0.8) 开始

**Emil 原则**：Nothing in the real world disappears and reappears completely. 不要从 `scale(0)` 做入场动画。

`ChatInput.vue` 的 `quote-pop-in` keyframes 使用 `scale(0.8)`：

```css
@keyframes quote-pop-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
```

`scale(0.8)` 已经比 `scale(0)` 好很多，但 Emil 推荐 **`scale(0.95)` 以上 + opacity**。0.8 的缩放意味着元素从 64% 的原始尺寸弹出，视觉上仍然有"从无到有"的效果。

**建议**：改为 `scale(0.93)` 或 `scale(0.95)`。

### 2.3 弱缓动曲线

**Emil 原则**：Built-in CSS easings are too weak. 必须使用强定制曲线。

| 位置 | 使用 | 问题 |
|------|------|------|
| `StickerPreviewOverlay.vue:154` | `animation: previewFadeIn 0.16s ease` | 使用内置 `ease` 代替定制曲线 |
| `StickerPreviewOverlay.vue:165` | `animation: previewScaleIn 0.2s ease` | 同上 |
| `StickerPicker.vue:777` | `transition: all 0.15s ease` | 内置 `ease` + `all` 双问题 |
| `ThinkingBlock.vue:77,109,127` | `transition: all 0.4s ease` | 内置 `ease` + `all` + 400ms 过长 |

项目已经定义了 `--ease-out`, `--ease-standard`, `--ease-smooth`, `--ease-spring` 等优秀曲线——为什么不使用它们？

**建议**：将内置 `ease` 替换为 `var(--ease-out)` 或 `var(--ease-smooth)`，后者 `cubic-bezier(0.22, 0.68, 0, 1)` 在开头更有冲击力。

### 2.4 悬停动画缺少 pointer: fine 门控

**Emil 原则**：触摸设备触发 hover 会导致伪激活。hover 动画必须 `@media (hover: hover) and (pointer: fine)` 门控。

项目中有大量 `:hover` 样式，但检查发现：

| 位置 | 当前 | 问题 |
|------|------|------|
| `.ds-btn:hover { transform: translateY(-2px) }` in `design-system.css` | 已包裹 `@media (prefers-reduced-motion: no-preference)` | ❌ 缺少 `(hover: hover) and (pointer: fine)` |
| `.ds-card:hover` in `design-system.css` | 未包裹任何媒体查询 | ❌ 触摸设备上 hover 会粘滞 |
| `.bubble:hover { transform: translateY(-1px) }` in `MessageBubble.vue` | 已包裹 `@media (pointer: fine)` | ✅ 正确 |

好消息是气泡已经做对了。坏消息是全局按钮和卡片的 hover 效果在触摸设备上（iPad 接键盘、触屏笔记本）会产生 sticky hover 问题。

### 2.5 按钮按压反馈的频率边界

**Emil 原则**：检查频率决策表。

项目中的按钮按压反馈 `transform: scale(0.96)` + `transition-duration: 80ms` 是正确的。但对高频按钮（发送消息、切换会话、侧边栏展开/收起），80ms 还是有些久。建议高频按钮用 50ms 甚至 30ms。

但对于 `ds-btn--primary`（发送按钮），它是**hundreds of times per day** 高频使用——按压反馈的 80ms 还可以，但入场动画不应该存在。好消息是发送按钮没有入场动画。

### 2.6 相同入场/退场速度

**Emil 原则**：退出应该比进入快。用户决定要关闭时，系统应该立刻响应。

| 组件 | 入场时长 | 退场时长 | 是否非对称？ |
|------|---------|---------|------------|
| ContextMenu (`menu-pop`) | — | — | 需要检查 |
| DsModal | `var(--duration-fast)` ~0.15s | `var(--duration-instant)` ~0.1s | ✅ 正确（退出快于进入） |
| DsOverlay | `var(--duration-fast)` | `var(--duration-fast)` | ❌ 对称——退出应该更快 |
| DsTooltip | `var(--duration-instant)` | `var(--duration-instant)` | 可以接受（tooltip 轻量） |

**建议**：DsOverlay 的 leave-active 使用 `var(--duration-instant)` 让退出更快。

---

## 三、性能与 GPU 动画

### 3.1 多属性动画在 tool 气泡中

AskUserBubble、FilesBubble 等工具气泡中有大量 `transition: background 0.15s`、`transition: border-color 0.15s`。这些属性会触发重绘（repaint），但问题不大因为时长短。

真正需要注意的是 `box-shadow` 动画：
- `design-system.css` 中 `.ds-btn:hover` 动画了 `box-shadow`（2 个 shadow）
- `plan-shadow` 等动态阴影变化

**建议**：如果 hover 时出现掉帧，可以在 hover 前用 `will-change: box-shadow` 提示浏览器。

### 3.2 `color-mix()` 无 fallback

**已在 FRONTEND_REVIEW_REPORT.md 中指出** —— 确认这个问题的存在。项目中大量使用 `color-mix()`，在不支持的浏览器（主要是旧版 Safari < 16.2）上会完全失效。建议生产构建时使用 PostCSS 插件或设计降级策略。

---

## 四、动效机会分析（Find Animation Opportunities）

### 4.1 缺失的微交互

| 机会 | 位置 | 频率 | 目的 | 建议动效 |
|------|------|------|------|---------|
| **会话切换时**侧边栏活跃项指示器过渡 | `SessionSidebar.vue` | 数十次/天 | 状态指示 | 活跃状态条从旧项滑动到新项 |
| **ThemePicker** 主题卡片悬停放大 | `ThemePicker.vue` | 偶尔 | 反馈 | `scale(1.03)` + `box-shadow` 加深，`transition 0.15s ease-out` |
| **StickerPicker** 贴纸网格入场 | `StickerPicker.vue` | 偶尔 | 防止突兀变化 | 30ms stagger 级联入场 |
| **ErrorCard** 出现时的反馈 | `ErrorCard.vue` | 偶尔 | 防止突兀 | 从 `scale(0.97)` + `opacity: 0` 过渡 |
| **设置面板**从触发按钮展开 | `AppSettingsMenu.vue` | 偶尔 | 空间一致性 | `transform-origin` 设为触发按钮位置 |

### 4.2 被拒绝的候选（说明为什么不做）

| 候选 | 拒绝原因 |
|------|---------|
| 发送按钮按下动画 | 高频（100+/天）。按压反馈足够，无需额外动效 |
| 侧边栏导航项切换动画 | 数十次/天。去掉或极度简化——用户导航时希望立即到达 |
| 消息列表渲染动画（每一条） | 消息频繁出现时，stagger 会拖慢阅读节奏 |

---

## 五、动画代码卫生与规范检查

### 5.1 分散的 `@keyframes`

`animations.css` 是 keyframes 的单一来源，但不少组件依然在 scoped style 中定义了自己的 keyframes：

| 文件 | keyframes |
|------|-----------|
| `ChatWindow.vue` | `blink`, `memory-spin`, `typingBounce`, `skeleton-pulse`, `empty-float` |
| `ChatInput.vue` | `quote-pop-in`, `chat-error-in` |
| `MessageBubble.vue` | `userBubbleIn`, `assistantBubbleIn` |
| `LeavesOverlay.vue` | `leaves-drift-1/2/3` |
| `FloatSidebar.vue` | `fs-slide-in`, `fs-slide-out` |
| `BubbleChrome.vue` | `tool-spin` |
| `shared.css` | `bubble-spin` |

**问题**：这些 keyframes 没有被 `maxma-` 前缀命名，不遵循 `animations.css` 设立的规范。如果多个组件定义了同名的 `spin`，浏览器行为可能不确定。

**建议**：将所有 keyframes 迁移至 `animations.css`，使用统一的 `maxma-` 前缀。已有 8 个不同的 keyframes 前缀（`tool-`, `bubble-`, `quote-`, `chat-`, `fs-`, `leaves-`, `memory-`, `skeleton-`），应统一。

### 5.2 硬编码时长而非使用 token

多个工具气泡使用硬编码的 `0.12s`, `0.15s` 而非 `var(--duration-fast)`：

```css
/* 当前 */
transition: background 0.12s;

/* 建议 */
transition: background var(--duration-fast) var(--ease-out);
```

这损害了 tokens 系统的价值——如果全局 `--duration-fast` 从 0.15s 调整为 0.2s，硬编码的 `0.12s` 不会同步更新。

影响文件：`AskUserBubble`, `PythonBubble`, `FilesBubble`, `GitStatusBubble`, `MapBubble`, `TavilySearchBubble`, `TavilyExtractBubble`, `FileEditBubble`, `shared.css` 等。

### 5.3 `--ease-in` token 定义但不应使用

`tokens.css` 定义了 `--ease-in: cubic-bezier(0.7, 0, 0.84, 0)` 并在注释中说"不推荐独立使用"。如果某个地方使用了它（目前 grep 未发现），应标记。

---

## 六、ARIA 与可访问性的动画维度

### 6.1 骨架屏脉冲没有 reduced-motion 替代

`ChatWindow.vue` 的 `skeleton-pulse` 动画：

```css
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
```

`prefers-reduced-motion: reduce` 下该动画被 `animation: none` 禁用——骨架屏变成了纯色静态占位块。指示"加载中"的视觉反馈完全丢失。

**建议**：对于 reduced-motion 用户，用简单的纯色骨架屏代替脉冲动画（opacity 保持 0.5，不再闪烁）。CSS 中的 `opacity` 变化可以保留——它们是安全的。

### 6.2 `empty-float` 动画对前庭障碍用户的影响

`ChatWindow.vue:1183`：

```css
@keyframes empty-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
.empty-desc { animation: empty-float 3s ease-in-out infinite; }
```

3 秒周期的上下浮动（~0.33 Hz）接近易诱发前庭不适的 0.2 Hz 范围（Apple 设计指南 §14 特别警告这个频段）。

**建议**：将浮动幅度降低到 2px，或只在首次进入空状态时播放 1 次循环（`animation-iteration-count: 1` 或更少）。生产环境中建议前庭障碍用户测试。

---

## 七、组件级具体修复建议

### 7.1 DsButton — 缺失按压反馈

**DsButton.vue scoped CSS 中没有 `:active` 样式**

```css
/* 添加 */
.ds-btn:active {
  transform: scale(0.97);
  transition: transform 80ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .ds-btn:active {
    transform: none;
    opacity: 0.9; /* 保留非运动反馈 */
  }
}
```

### 7.2 DsTooltip — 缺少 transform-origin

DsTooltip 的入场使用 `scale(0.97)` 但是 `transform-origin` 是默认的 `center`。Tooltip 应该从触发器方向缩放。

```css
.ds-tooltip {
  transform-origin: var(--tooltip-origin, center);
}
```

通过 JS 根据实际 placement 设置 `--tooltip-origin`：
- `top` → `bottom center`
- `bottom` → `top center`
- `left` → `right center`
- `right` → `left center`

### 7.3 ContextMenu — transform-origin 硬编码

`transform-origin: top left` 硬编码——如果菜单在屏幕右下角触发，这个 transform origin 可能导致菜单从错误方向弹出。

**建议**：使用 `floatingPosition.ts` 中的 `origin` 字段动态设置。

### 7.4 MessageBubble — 退场动画不存在

消息从列表中移除时直接消失。虽然 chat 场景中消息通常不会被移除，但 TransitionGroup 的 `leave` 阶段没有动画。

**建议**：为 `TransitionGroup` 添加 leave 动画，使用 `opacity` + `scale(0.95)` 快速淡出。

### 7.5 ThinkingBlock — 多重问题

| 问题 | 当前 | 建议 |
|------|------|------|
| `transition: all 0.4s ease` | 4 处 | 拆分 + 缩短到 0.25s + 使用 `var(--ease-out)` |
| 400ms 过长 | UI 动效上限 300ms | 250ms max |
| `ease` 曲线弱 | `ease` | `var(--ease-smooth)` |
| `maxma-spin` 无限旋转 | 0.8s linear infinite | 这是 loading spinner，可以接受 |

---

## 八、库层面建议（Pick UI Library）

根据 `pick-ui-library` skill，结合 Maxma 的现状：

| 需求 | 当前方案 | 推荐 | 说明 |
|------|---------|------|------|
| **命令菜单（⌘K）** | 无 | `cmdk` | 如果需要 ⌘K 全局搜索/命令面板，`cmdk` 是最优解 |
| **Toast** | 自建 `DsToast` | 已足够好 | DsToast 的 accessibility（role/aria-live/aria-atomic）已完善，不需要迁移到 Sonner |
| **动画** | CSS + @keyframes | `motion`（Motion库） | 如果需要手势弹簧动画（swipe-to-dismiss、drag sheets），现有的 CSS transition 不够，需要 `motion` 的 spring + velocity handoff |
| **状态管理** | Pinia | ✅ 已经是最优选择 | |
| **虚拟列表** | `vue-virtual-scroller` | 考虑 `Virtuoso` | 如果消息列表超长渲染遇到性能问题，Virtuoso 的 API 在 Vue 生态中兼容性更好 |

---

## 九、优化路线图（EMIL 优先级框架）

### P0 — 立即修复（感觉会出问题）

| # | 项目 | 工作量 | 影响 |
|---|------|--------|------|
| 1 | 全局 `transition: all` → 指定属性 | 1-2h | 消除性能隐患 + 非预期动画行为 |
| 2 | `ThinkingBlock.vue` 的 `all 0.4s ease` → 拆分 + 缩短 | 0.5h | 明显改善"思考中"面板的响应感 |
| 3 | 将 `sticker-picker` 和 `preview-overlay` 的内置 `ease` 替换为 `var(--ease-out)` | 0.5h | 与项目设计系统一致 |
| 4 | 为 `hover` 效果添加 `(hover: hover) and (pointer: fine)` 门控 | 1h | 触摸设备交互正确性 |

### P1 — 重要改进（架构/规范）

| # | 项目 | 工作量 |
|---|------|--------|
| 5 | 键盘触发的动作移除动画 | 0.5h |
| 6 | 分散的 `@keyframes` 迁移到 `animations.css` + `maxma-` 前缀 | 1-2h |
| 7 | 消息气泡入场从 keyframes 迁移到 `transition` + `@starting-style` | 1-2h（核心改动，需要测试） |
| 8 | 所有 tool 气泡的硬编码动画时长替换为 `var(--duration-*)` token | 1h |
| 9 | DsButton 的 `:active` 按压反馈从媒体查询中移出 | 0.5h |

### P2 — 体验打磨

| # | 项目 | 工作量 |
|---|------|--------|
| 10 | 为 `empty-float` 降低幅度或限制循环次数 | 0.5h |
| 11 | DsTooltip 动态 `transform-origin` | 1h |
| 12 | SessionDrawer 添加退场动画（从左滑出） | 0.5h |
| 13 | ContextMenu `transform-origin` 动态化 | 0.5h |
| 14 | 主题字体切换/纹理切换的过渡动画 | 1h |

### P3 — 长期方向

| # | 项目 | 工作量 |
|---|------|--------|
| 15 | 引入 `useSpring` 或 Motion 库以支持手势弹簧动画 | 2-3h |
| 16 | 为高频消息入口使用 `vue-virtual-scroller` 替代当前列表渲染 | 2-4h |
| 17 | 重构 `color-mix()` 降级策略 | 2h |
| 18 | 构建键盘导航的 skip-to-content + modal focus guard 测试 | 2h |

---

## 十、关键对照表：技能源 × 发现

| 技能源 | 关键发现 | 严重性 |
|--------|---------|--------|
| **apple-design** | 中断性——keyframes 不支持动画中途重定向 | HIGH |
| **apple-design** | reduced-motion 下按压反馈完全消失 | MEDIUM |
| **apple-design** | SessionDrawer 退场无动画，空间一致性断裂 | LOW |
| **emil-design-eng** | `transition: all` 在 15+ 组件中存在 | BLOCK |
| **emil-design-eng** | 使用内置 `ease` 弱曲线而非 `var(--ease-*)` | MEDIUM |
| **emil-design-eng** | `scale(0.8)` 入场偏激进 | LOW |
| **emil-design-eng** | hover 动画缺少 pointer: fine 门控 | MEDIUM |
| **review-animations** | 全局 keyframes 命名分散，8 种不同前缀 | MEDIUM |
| **find-animation-opportunities** | 6 处可添加微交互的机会 | LOW |
| **pick-ui-library** | cmdk 推荐（未来 ⌘K 需求） | 参考 |
| **accessible-motion** | `empty-float` 频段接近前庭刺激阈值 | MEDIUM |

---

## 总结

从苹果和 Emil 的极高标准来看，Maxma 的动效体系已有非常好的骨架——token 体系完整、reduced-motion 覆盖全面、弹性缓动曲线选择考究。需要改进的并非方向性错误，而是**一致性**（避免硬编码 vs. token 的混杂）和**物理正确性**（keyframes vs. transition 的选择、按压反馈的门控策略）。

按优先级，**最值得投入的三件事**：
1. 消除 `transition: all`（立即可做，收益明确）
2. 消息气泡入场从 keyframes 迁移到 `transition` + `@starting-style`（最关键的中断性改进）
3. 将分散的 keyframes 收归集中管理 + 硬编码动画时长替换为 token（规范统一）

这三件事做完后，Maxma 的动效质量会从"优秀"（8.5/10）逼近"顶尖"（9.5/10）。
