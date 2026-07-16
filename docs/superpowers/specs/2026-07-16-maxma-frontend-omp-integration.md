# Phase 3: 前端 OMP 核心体验整合

> **目标：** 在 Maxma Vue 3 前端中集成三个核心 OMP 能力模块，保持品牌设计风格。

---

## 一、范围

### 三个模块

| 模块 | 复杂度 | 涉及文件 |
|------|--------|---------|
| 1. Provider 选择器（会话级） | 高 | `chat.ts` store, `ChatInput.vue`, 新 `ModelSelector.vue` 组件 |
| 2. 上下文监控 | 中 | `chat.ts` store, `ContextUsageBadge.vue`（重构）, WS 事件处理 |
| 3. 模型设置面板 | 低 | 新 `ModelSettingsPanel.vue`, `SessionSidebar.vue` |

### 不包含（后续 Phase）

- 工具面板（OMP 32 内置工具清单）
- 记忆浏览器（OMP recall/reflect 对接）
- MCP 管理增强

---

## 二、模块设计

### 2.1 Provider 选择器

**位置：** ChatInput 上方，左侧

```
┌─────────────────────────────────────────────────────────┐
│  [🤖 gpt-4o  ▼]                            [📊 2.1k/128k] │
│  ┌─ 输入消息... ─────────────────────────── [发送] ──┐  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**交互：**
- 点击打开下拉菜单，显示按 provider 分组的所有可用模型
- 下拉菜单使用 DsModal/DsOverlay 风格，符合 DESIGN.md 规范
- 切换模型即时生效，不打断当前对话
- 当前会话的选择持久化到 `chat.ts` store

**数据结构（chat store）：**
```typescript
interface ChatState {
  currentModel: string;        // "openai/gpt-4o"
  availableModels: ModelInfo[]; // 从 API 获取
  temperature: number;         // 0.7
  maxTokens: number;           // 4096
  thinkingEnabled: boolean;    // false
}

interface ModelInfo {
  id: string;         // "openai/gpt-4o"
  provider: string;   // "openai"
  name: string;       // "GPT-4o"
  contextWindow: number; // 128000
}
```

**数据来源：** `GET /api/providers` — Python 薄层从 OMP ModelRegistry 获取。

### 2.2 上下文监控

**位置：** ChatInput 右侧，一行紧凑显示

**组件：** 重构现有 `ContextUsageBadge.vue`

**显示内容：**
```
[📊 2.1k used / 128k max  ■■■■■■■□□□□□  1.6%]
```

**交互：**
- 默认一行显示
- hover 展开详情 tooltip：消息数、模型名、上下文窗口大小
- 当用量 > 70% 时进度条变 amber
- 当用量 > 90% 时进度条变 red（警告）

**数据来源：** 从 WS 事件 `context_usage` 获取实时数据。

**WS 事件格式（Python 薄层透传 OMP）：**
```json
{
  "type": "context_usage",
  "payload": {
    "estimated_tokens": 2100,
    "max_tokens": 128000,
    "percentage": 1.6,
    "message_count": 12,
    "model_name": "gpt-4o"
  }
}
```

### 2.3 模型设置面板

**位置：** 侧边栏底部设置区域，可折叠面板

```
模型设置 ─────────────────
Temperature     [────────●──]  0.7
Max Tokens      [────●──────]  4096
Thinking        ○ 关闭  ● 开启
```

**设计：**
- 每个设置项一行，标签左对齐
- 滑块控件使用 DESIGN.md 的 input 样式
- 切换开关使用现有 toggle 组件
- 设置持久化到 `chat.ts` store
- 随 WS chat 消息发送给 OMP

---

## 三、设计原则

1. **品牌一致** — 所有新 UI 遵循 DESIGN.md：黑白基底、纯黑 accent、系统字体栈、6px 圆角
2. **紧凑不占空间** — Provider 选择器和上下文监控都只需一行高度
3. **渐进式暴露** — 默认只显示模型名和用量百分比，详情 hover 可见
4. **即时响应** — 切换模型/设置立即生效，不需要刷新页面

---

## 四、实施步骤

### Task 1: 数据层 — 扩展 chat store

修改 `src/stores/chat.ts`，添加：
- `currentModel` 字段
- `temperature`/`maxTokens`/`thinkingEnabled` 字段
- `availableModels` 列表
- `setModel()` action
- `updateContextUsage()` action
- WS 事件监听 `context_usage`

### Task 2: Provider 选择器组件

创建 `src/components/ModelSelector.vue`：
- 下拉菜单，按 provider 分组显示模型
- 从 chat store 读取 availableModels
- 调用 chat store 的 setModel() action

### Task 3: 集成到 ChatInput

修改 `src/components/ChatInput.vue`：
- 在输入框上方添加 ModelSelector
- 在右侧添加 ContextUsageBadge
- WS 消息中添加 model/temperature/maxTokens 字段

### Task 4: 重构 ContextUsageBadge

修改 `src/components/ContextUsageBadge.vue`：
- 从 chat store 读取 contextUsage
- 实时更新进度条
- hover tooltip 显示详情

### Task 5: 模型设置面板

创建 `src/components/ModelSettingsPanel.vue`：
- Temperature 滑块
- Max Tokens 滑块
- Thinking 开关
- 集成到 SessionSidebar
