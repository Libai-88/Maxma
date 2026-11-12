# Maxma 品牌指南 v2.0

> **唯一事实源（Source of Truth）**：本文档定义 Maxma 的品牌身份、视觉规范与声音准则。
> 代码侧的活规范是 `web/src/solid-glass.css`（全部颜色 / 三层玻璃材质 / 圆角 / 动效）
> 与 `web/src/index.css`（全局基座）。本文档与代码不一致时，以代码为准并回头修订本文档。
>
> **v2.0（2026-11-11）**：视觉身份由「宣纸白 + 朱砂印」整站切换为 **Solid Glass 烟熏玻璃材质**
> （见 §2）。品牌定位、声音三特质与文案纪律（§1）保持不变。

## 快速参考

- **品牌定位**：本地优先的 AI Agent 桌面客户端 · 用户的首席思维伙伴
- **Tagline**：Agent workspace
- **材质**：Solid Glass —— 远看是实体，近看才是玻璃；厚度即层级
- **基底**：`--background` 深冷灰（dark 是设计基准），面板为烟熏玻璃
- **主色**：中性灰阶 + 单一状态色；颜色与动效只用于有意义的反馈
- **字体**：Geist / Geist Mono（`@fontsource-variable`），中文回落 PingFang SC / Microsoft YaHei
- **形态**：圆角 `--radius` 0.875rem，控件 0.7rem
- **声音三特质**：克制 · 有分量 · 有温度

---

## 1. 品牌定位与声音

### 定位

Maxma 是用户的**首席思维伙伴**——不是搜索引擎、不是执行工具、不是永远正确的导师，而是帮用户想得更深的人。

### 声音三特质

| 特质 | 我们是 | 我们不是 |
|------|--------|----------|
| **克制** | 先结论再过程，每句话都有信息量 | 寒暄铺垫、仪式感开场收尾 |
| **有分量** | 诚实标注不确定，给思维框架而非现成答案 | 永远正确的权威、讨好型人格 |
| **有温度** | 同事的语气，把主动权交还用户（「你怎么看？」） | 客服的语气、服务式收尾（「还有什么需要吗」） |

### 语境调性

| 语境 | 调性 | 示例 |
|------|------|------|
| 日常对话 | 温和直接 | 「建议选 B，原因是……」 |
| 复杂决策 | 透明化思考 + 启发追问 | 「这是个标准问题，我们先定判断标准——你有没有想过反过来看？」 |
| 错误提示 | 直接说明原因 + 恢复路径 | 「连接失败，请检查模型服务后重试」 |
| 成功反馈 | 平静确认，不惊叹 | 「已保存」「已清理 3 个旧日志」 |
| 用户情绪低落 | 先共情再解决 | 「这个情况确实麻烦，我们先看最核心的问题」 |

### 禁用表达

- 仪式感套话：「总的来说」「综上所述」「简而言之」
- 服务式收尾：「还有什么需要吗」
- AI 营销黑话：「赋能」「生态」「闭环」「Next-Gen」「Game-changer」
- 感叹号堆砌的成功提示（平静陈述即可）
- 「Oops!」式卖萌错误语（直接说发生了什么、怎么恢复）

### 语言习惯

- 中文对话，技术术语保留英文：「你的 WebSocket 断线了」而非「网络套接字连接已断开」
- 文件路径用反引号，代码块注明语言
- 长回答（>500 字）开头给 1-2 句 TL;DR

---

## 2. 视觉体系：Solid Glass

### 材质四律（改样式前必读）

Solid Glass 是 shadcn/ui 的主题样式表，材质规则只有四条（`solid-glass.css` 头注释即其原文）：

1. **饰面在边缘**：顶边一线光（`--glass-rim`）、内部第二道细线（`--glass-inner`）、外圈发丝边（`--glass-edge`）、脚下阴影（`--glass-shade`）。**不在表面铺渐变**。
2. **厚重，不飘**：中性灰，模糊只柔化身后内容、不放大它的颜色。
3. **厚度即层级**：`panel`（最薄）< `card` < `popover`（最厚）。越厚越不透明。
4. **单一状态**：hover / 选中 / 展开都穿同一件小块清玻璃（`.glass-chosen` / `.glass-held`）。

### 颜色

- 全部颜色来自 `solid-glass.css` 的 CSS 变量，经 Tailwind v4 `@theme inline` 暴露为语义类：
  `bg-background` / `bg-card` / `bg-panel` / `bg-popover` / `text-foreground` / `text-muted-foreground` /
  `border-border` / `ring-ring` / `bg-primary` / `text-destructive` / `text-status-done` /
  `text-status-running` / `text-status-interrupted`。
- **禁止**硬编码 `#hex` / `oklch()` / `rgb()`，**禁止**使用 Tailwind 默认调色板类（`bg-red-500`、`text-emerald-300` 等）。
  守卫脚本：`web/scripts/check-hardcoded-colors.mjs`（`npm run lint:colors`，豁免 `components/ui/` 框架源码）。
- 暗色是设计基准；light 是同一批面板在白天下。**不再有 6 套主题**：只有 light / dark 两态。

### 字体

- `--font-sans: "Geist Variable"`，`--font-mono: "Geist Mono Variable"`，中文回落 PingFang SC / Microsoft YaHei。
- 代码、日志、diff、命令一律 `font-mono`；数据列开 `tabular-nums`。

### 圆角与阴影

- `--radius: 0.875rem`；控件 `--radius-control: 0.7rem`。
- 阴影只来自 `--glass-shade` / `--glass-contact`（脚下联系阴影），不做大范围柔光。

---


## 2.5 密度与内边距（文字永不贴边）

Solid Glass 的组件用 `--card-spacing` 驱动卡片留白（官方示例在 `card-spacing` 里把同一个
变量切到 `--spacing(4/5/6/8)`）。Maxma 沿用这条约定，并把它写成了可执行的下限：

| 形态 | 内边距下限 | 说明 |
| --- | --- | --- |
| 页面级卡片（`rounded-xl border p-*`） | `p-4`（16px） | 标题 + 正文 + 控件的面板 |
| 列表行 / 紧凑卡片 | `px-3.5 py-2.5`（14/10px） | provider 卡片、JetHub 行、设置行（`px-4`） |
| 小按钮（`Button size="sm"`） | `h-8` + `px-3` | 高度由基元保证，文字垂直居中 |
| 徽标 / 胶囊（`Badge` 或手写 chip） | `px-2.5 py-1`（10/4px） | 状态、分类、版本号 |
| 行内 `code` | `px-1.5 py-0.5` | 正文里的等宽片段 |
| 输入 / 下拉 | `h-9` + `px-3.5 py-2` | 与按钮同高 |

**硬规则**：任何自绘边框（`border`）或自绘底色（`bg-*` + `rounded`）的容器里，
文字到边缘的距离不得小于 4px。`web/scripts/check-spacing.mjs` 在闸门里静态检查这条
（带边框容器 p≥2 / px≥2 / py≥1.5；底色圆角块有水平内边距就必须有垂直内边距），
`npm run lint:spacing` 可单独跑。

长内容一律 `min-w-0` + `break-words`（flex/grid 子项默认 `min-width:auto`，
长英文串/路径会把文字顶穿边框）；确需截断时用 `truncate` 并把全文放进 `title`。

## 3. Agent 语义组件

聊天与工具界面不再手搓，一律用 Solid Glass 的 agent 组件（`web/src/components/ui/`）：

| 组件 | 用途 |
|------|------|
| `Composer` / `ComposerFooter` / `ComposerPick` | 输入框、附注行、模型/模式选择 |
| `StatusGlyph` / `DotLoader` | 回合进行中在做什么 |
| `Reasoning` | 模型思考，默认折叠 |
| `StepGroup` / `StepRow` / `OutputBlock` | 工具调用步骤与输出 |
| `DiffView` / `DiffStats` | 补丁 |
| `AskCard` | Agent 向人提问与选项 |
| `ContextRing` | 上下文窗口占用 |
| `TaskNotice` | 任务结束通知 |
| `Panel` / `Tag` | 容器与标签 |
| `TurnStatus` | 回合状态行 |

新增界面优先复用上表；确无对应时，用 shadcn 原语（`Button` / `Card` / `Dialog` / `Select` / `Tabs` / `Field` …）+ 语义类组合。

---

## 4. 动效体系

- 时长与缓动来自 Solid Glass（`--ease-out` 等），过渡只用 `transform` / `opacity`。
- 颜色与运动只用于**有意义的反馈**（流式光标、状态点、面板展开），不做装饰性循环动画。
- **必须**支持 `prefers-reduced-motion: reduce`（`index.css` 全局 kill switch）。
- 已下线：Inspira UI 的 32 个光效/流光/极光装饰件与页面转场体系（与「无渐变、克制」材质冲突）。

---

## 5. 反参照（Anti-references）

- **不要 SaaS 模板感**：不做大白卡 + 品牌色左边条 + 渐变背景。
- **不要液体玻璃**：不做近乎全透明、读者要与背景抢字的浮层。Solid Glass 只透轮廓。
- **不要 AI 克隆界面**：不追随 ChatGPT/Claude 的 chat UI 范式，保持自己的视觉识别度。
- **不要紫蓝 AI 渐变**。
- **不要 emoji 当结构图标**：用 `lucide-react` 图标。

---

## 6. 提示词层（人设与品牌）

**铁律：永不替换引擎原生 prompt**，只通过官方 `appendSystemPrompt` 追加。
实现在 `bun-sidecar/src/kernel/persona-prompt.ts` 的 `loadPersonaSystemPrompt()`，
由 `kernel/bridge-pi.ts` 在 `create_session` 时追加到引擎原生 system prompt 之后。

### 组成

| 块 | 来源 | 说明 |
|----|------|------|
| 人设 SOUL | 活动人设的 `config/personas/SOUL.md`（数据目录优先，回落随包模板） | 人格与语气主体，支持 `{{USER_NAME}}` 占位 |
| 用户档案 | `config/personas/USER.md` | 渲染为「## 用户档案」小节 |
| 显示名 | `config/onboarding.json` 的 `preferences.displayName` | 替换 `{{USER_NAME}}`；缺失或非法时回落「用户」 |
| 表情贴纸指令 | `persona-prompt.ts` 的 `STICKER_INSTRUCTIONS`（硬编码） | `[表情包:分类]` 格式与 12 个可用分类 |

> skills **不在提示词层注入**：由引擎从 `.maxma/skills/`（随包）与工作区/用户目录
> `.agents/skills/` 自动发现，见 `kernel/skills.ts` `maxmaSkillPaths()`。

---

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-10-28 | 初版（宣纸 + 朱砂），34-Token 契约 |
| v1.1 | 2026-11-07 | 新增 §9 页面级规范：共享类契约、token 化圆角/阴影/断点、动效密度开关 |
| v2.0 | 2026-11-11 | 前端重写为 React 19 + Tailwind 4 + shadcn(base-nova) + Solid Glass；视觉身份整体切换为烟熏玻璃材质；6 主题收敛为 light/dark；字体换 Geist；新增 §3 Agent 语义组件 |