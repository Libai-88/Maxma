# Plan: 增强空状态和首次使用欢迎体验

## 现状分析

### 文件读取结果

| 文件 | 当前空状态情况 |
|---|---|
| `src/components/WelcomeScreen.vue` | **无兜底**。始终渲染 `store.profile.name/scene/greeting`，当 profile 为空时显示空白/undefined。 |
| `src/views/McpView.vue` | **已有基本文案**（第19-22行），使用 `.empty` 类，显示"尚未配置任何 MCP 服务器。点击上方按钮添加。" + 简短 hint。 |
| `src/views/SkillsView.vue` | **已有基本文案**（第25-34行），Skills/Macros 两 tab 分别有提示文案 + hint，使用 `.empty` 类。 |

### 主题变量（`tokens.css` / `design-system.css`）

- `--text-primary` / `--text-secondary` / `--text-tertiary` — 文字色层级
- `--bg-card` / `--bg-primary` / `--bg-secondary` — 背景色
- `--border` — 边框色
- `--accent` — 强调色
- `--status-ok` / `--status-warn` / `--status-error` — 状态色
- `--space-*` — 间距 token
- `--shadow-sm` / `--shadow-md` — 阴影
- `--radius-md` / `--radius-lg` — 圆角

### 其他视图的空状态模式（参考）

- `KbView.vue` / `HooksView.vue` 使用 `.empty-state-wrapper` 全居中布局
- `ActivityView.vue` 使用 `.activity-empty` 独立样式
- `MemoryView.vue` 使用 `.empty` 类居中显示

## 修改方案

### 1. WelcomeScreen.vue — 添加来宾兜底

**问题**：`store.profile` 有默认值（name: 'Maxma'），但 API 失败或用户未配置人格时 profile 可能为空字符串。

**方案**：在现有内容之前添加 `v-if="!store.profile.name"` 的来宾欢迎区块，使用相同的居中布局和动画风格。

```vue
<template>
  <div class="welcome-screen">
    <div class="welcome-content">
      <!-- 来宾模式：profile 为空 -->
      <template v-if="!store.profile.name">
        <div class="welcome-guest-icon">✦</div>
        <h1 class="welcome-name">欢迎使用 Maxma</h1>
        <p class="welcome-greeting">开始对话，或前往设置配置你的偏好</p>
        <div class="welcome-actions">
          <button class="action-btn" @click="$emit('start', '随便聊聊')">
            <span class="action-icon" v-html="chatBubbleSvg"></span>
            <span>随便聊聊</span>
          </button>
        </div>
      </template>
      <!-- 已配置人格 -->
      <template v-else>
        ... 现有内容 ...
      </template>
    </div>
  </div>
</template>
```

**样式**：复用 `.welcome-name` / `.welcome-greeting` / `.welcome-actions` 已有样式，新增 `.welcome-guest-icon` 作为视觉锚点。

### 2. McpView.vue — 增强空状态视觉

**当前**：仅文本"尚未配置任何 MCP 服务器。点击上方按钮添加。" + 一句 hint。

**方案**：替换为带标题 + 描述 + 引导性更强的结构：

```vue
<div v-else-if="servers.length === 0" class="empty-state">
  <div class="empty-state-icon">🔌</div>
  <p class="empty-state-title">还没有 MCP 服务器</p>
  <p class="empty-state-desc">
    MCP（Model Context Protocol）服务器为 Maxma 提供外部工具能力。
    点击上方「添加 MCP 服务器」按钮开始配置。
  </p>
</div>
```

同时将旧的 `.empty` / `.empty-hint` 样式替换为统一的 `.empty-state` 样式体系（见第4节）。

### 3. SkillsView.vue — 增强空状态视觉

**当前**：Skills 和 Macros tab 分别有文本提示 + 一句 hint。

**方案**：替换为结构化空状态，区分 two tabs：

```vue
<div v-else-if="currentList.length === 0" class="empty-state">
  <div class="empty-state-icon">📋</div>
  <template v-if="activeTab === 'skills'">
    <p class="empty-state-title">还没有 Skill</p>
    <p class="empty-state-desc">
      Skills 是可复用的任务指令模板，Maxma 在需要时会自动读取并遵循。
      点击上方「新建」按钮创建你的第一个 Skill。
    </p>
  </template>
  <template v-else>
    <p class="empty-state-title">还没有宏</p>
    <p class="empty-state-desc">
      宏是可复用的指令片段，可嵌入到对话或 Skill 中使用。
      点击上方「新建」按钮创建你的第一个宏。
    </p>
  </template>
</div>
```

### 4. 统一空状态样式

在 `tokens.css` 或 `design-system.css` 中新增一组共享的空状态 CSS 类，供所有页面复用：

```css
/* ── 统一空状态 (Blank Slate) ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--text-secondary);
}
.empty-state-icon {
  font-size: 32px;
  margin-bottom: 16px;
  opacity: 0.6;
  line-height: 1;
}
.empty-state-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px;
}
.empty-state-desc {
  font-size: 14px;
  color: var(--text-secondary);
  max-width: 360px;
  line-height: 1.6;
  margin: 0;
}
```

然后 McpView 和 SkillsView 中移除各自的 `.empty` / `.empty-hint` / `.loading` 样式定义（如果与 .empty-state 重复），改用共享类。

**注意**：保留各 view 中现有的 `.loading` 样式（加载中状态与空状态不同）。如果 `.loading` 和 `.empty` 共享了相同样式，将其拆开。

### 5. 文件改动清单

| 文件 | 操作 |
|---|---|
| `src/components/WelcomeScreen.vue` | 添加来宾兜底的 template + 样式 |
| `src/views/McpView.vue` | 替换空状态模板为 `.empty-state` 结构；清理旧 `.empty` CSS |
| `src/views/SkillsView.vue` | 替换空状态模板为 `.empty-state` 结构；清理旧 `.empty` CSS |
| `src/assets/styles/design-system.css` | 新增 `.empty-state` 系列共享样式 |

### 6. 验证

- 运行 `npx vue-tsc --noEmit` 确保无类型错误
- 手动检查：空状态居中显示、主题色一致、引导文案清晰

---

## 执行顺序

1. 在 `design-system.css` 新增共享 `.empty-state` 样式
2. 修改 `McpView.vue`：替换空状态 template + 清理 CSS
3. 修改 `SkillsView.vue`：替换空状态 template + 清理 CSS
4. 修改 `WelcomeScreen.vue`：添加来宾兜底
5. 运行 `npx vue-tsc --noEmit` 验证
