# Maxma 品牌指南 v1.0

> **唯一事实源（Source of Truth）**：本文档定义 Maxma 的品牌身份、视觉规范与声音准则。
> 代码侧的活规范是 `web/src/assets/styles/tokens.css`（结构 token）与 `web/src/themes/*.css`（36-Token 主题契约）。
> 本文档与代码不一致时，以代码为准并回头修订本文档。

## 快速参考

- **品牌定位**：本地优先的 AI Agent 桌面客户端 · 用户的首席思维伙伴
- **品牌名由来**：墨色（ink tone）——不是最鲜艳的颜色，但落在纸上最清楚
- **Tagline**：温润如纸 · 智能如你
- **主色**：朱砂 `#C23B22`
- **基底**：宣纸白 `#F4F0E8`
- **显示字体**：EB Garamond + Noto Serif SC（衬线）
- **声音三特质**：克制 · 有分量 · 有温度

---

## 1. 品牌定位与声音

### 定位

Maxma 是用户的**首席思维伙伴**——不是搜索引擎、不是执行工具、不是永远正确的导师，而是帮用户想得更深的人。名字取自「墨色」：判断不喧哗，但有分量。

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

## 2. 色彩体系

### 旗舰主题「素影」— 宣纸白 + 朱砂印

**表面四阶**（越浮起越亮）：

| 层级 | 值 | 意象 | 用途 |
|------|-----|------|------|
| `--bg-primary` | `#F4F0E8` | 宣纸 | 主画布 |
| `--bg-secondary` | `#EEE9E0` | 旧纸 | 侧边栏 |
| `--bg-card` | `#F8F5EF` | 素笺 | 卡片/气泡 |
| `--bg-raised` | `#FDFBF6` | 雪纸 | 弹窗/悬停 |

**文字四阶**（墨分五色）：

| 层级 | 值 | 意象 | 对比度 |
|------|-----|------|--------|
| `--text-primary` | `#1C1C1C` | 浓墨 | ~13:1（AAA） |
| `--text-secondary` | `#3D3D3D` | 重墨 | ~9:1（AAA） |
| `--text-tertiary` | `#6E6E6E` | 淡墨 | ≥4.5:1（AA） |
| `--text-inverse` | `#FFFFFF` | 留白 | 用于暗底亮文 |

**强调色四阶**（朱砂印）：

| 层级 | 值 | 用途 |
|------|-----|------|
| `--accent` | `#C23B22` | 主强调、品牌印 |
| `--accent-hover` | `#A8311A` | 悬停 |
| `--accent-active` | `#8E2814` | 按下 |
| `--accent-light` | `rgba(194,59,34,0.08)` | 选中背景 |

**状态四色**（矿物颜料命名）：

| 状态 | 值 | 意象 |
|------|-----|------|
| `--status-ok` | `#6B8E6B` | 松烟绿 |
| `--status-error` | `#C5554A` | 胭脂红 |
| `--status-warn` | `#C99A5A` | 藤黄 |
| `--status-info` | `#5A8A9A` | 石青 |

### 色彩纪律

- **单一强调色**：朱砂是唯一的高饱和品牌色，其余颜色一律低饱和融入纸面
- **阴影带色温**：阴影用暖棕调 `rgba(120,100,80,*)` 或墨调 `rgba(28,28,28,*)`，禁止纯黑高透明度
- ** tint 用 color-mix**：所有半透明着色通过 `color-mix(in srgb, ...)` 派生，不手写 rgba 魔法值
- **暗色主题不反色**：暗色主题（夜航/子夜）使用降饱和的暖暗色，而非简单反转

### 主题家族

| 主题 | 文件 | 性格 |
|------|------|------|
| 素影 Shadow & Substance | `suying.css` | 旗舰：宣纸 + 朱砂，数字文房 |
| 極線 Ultraline | `ultraline.css` | 变体：近零圆角、发丝线、无阴影 |
| 夜航 Night Voyage | `night.css` | 暗色：暖暗纸面 |
| 金継 Kintsugi | `kintsugi.css` | 变体：金缮意象 |
| 青原 Grass | `grass.css` | 变体：松烟绿调 |
| 子夜 Midnight | `midnight.css` | 暗色：更深的夜 |

每个主题遵守 **36-Token 契约**：表面 4 + 文字 4 + 强调 4 + 边框 3 + 状态 4 + 圆角 4 + 阴影 5 + 动效 2 + 布局 2 + 专用 4。新增主题必须填满契约。

---

## 3. 字体体系

### 字体族

```css
--font-ui:      'LXGW WenKai Screen', 'Noto Serif SC', serif;   /* 界面/正文 */
--font-serif:   'EB Garamond', 'Noto Serif SC', serif;          /* 显示标题 */
--font-mono:    'JetBrains Mono', ui-monospace, monospace;      /* 代码/数据 */
```

- 仅加载这 3 族（+ Noto Serif SC 的 CJK 支撑），禁止引入新字体族而不更新本文档
- `body.font-sans` 提供无衬线降级模式（`--font-display` 切回 `--font-ui`）

### 字号梯度

**显示字号**（衬线，标题/区块，须配 `font-family: var(--font-display)` + 负 letter-spacing）：

| Token | 值 | 用途 |
|-------|-----|------|
| `--fs-display-xl` | 1.6rem (~26px) | 页面主标题（欢迎屏等焦点场景） |
| `--fs-display-lg` | 1.35rem (~22px) | 视图页面标题 |
| `--fs-display-md` | 1.15rem (~18px) | 卡片/面板标题 |
| `--fs-display-sm` | 1.05rem (~17px) | 小节标题 |

**正文字号**：

| Token | 值 | 用途 |
|-------|-----|------|
| `--fs-title` | 1.15rem | 区块标题 |
| `--fs-body` | 0.95rem | 正文 |
| `--fs-ui` | 0.88rem | 次级 UI |
| `--fs-caption` | 0.84rem | 控件 |
| `--fs-hint` | 0.78rem | 提示/badge |

### 排版纪律

- 大标题用负 letter-spacing（-0.01em ~ -0.02em），小号文字用正 letter-spacing
- 正文行高 1.6，标题行高 1.3
- 响应式基准：`font-size: clamp(16px, 15px + 0.2vw, 18px)`
- 数据/代码用 `--font-mono`，等宽数字场景开 `tabular-nums`

---

## 4. 品牌印记

### 朱砂印「玛」

- **形态**：52px 朱砂方印，圆角 10px，内含白色「玛」字（衬线 26px）
- **使用场景**：启动屏呼吸动画、品牌强调处
- **禁止**：改印色（必须朱砂 `#C23B22`）、改字形、加渐变、当装饰纹样平铺

### Favicon / 应用图标

- 源文件：`web/src/assets/images/brand/favicon.png`
- 头像类资产（logo-companion / logo-hero）用于人格化场景，不替代 favicon

### 纸面纹理

- 宣纸质感由 SVG 噪声纹理实现（`paper-texture.css`），三层叠加：表面纹理 + 卡片混合 + 亮度补偿
- 纹理是品牌基底的一部分，暗色主题同样保留（调低不透明度）

---

## 5. 动效体系

### 时长三档

| Token | 值 | 用途 |
|-------|-----|------|
| `--duration-instant` | 0.1s | hover、关闭、退场 |
| `--duration-fast` | 0.15–0.2s | 默认：按钮、面板、focus |
| `--duration-slow` | 0.25s | 模态、大块进场 |

### 缓动曲线

| Token | 曲线 | 用途 |
|-------|------|------|
| `--ease-out` | (0.23, 1, 0.32, 1) | 退场、关闭、收起 |
| `--ease-standard` | (0.77, 0, 0.175, 1) | 位移、转场 |
| `--ease-smooth` | (0.22, 0.68, 0, 1) | 淡入淡出 |
| `--ease-drawer` | (0.32, 0.72, 0, 1) | 抽屉、侧栏滑出 |
| `--ease-spring` | (0.34, 1.56, 0.64, 1) | 点击反馈、活泼交互 |

### 动效纪律

- 只用 `transform` / `opacity` 做动画（GPU 加速），禁止动画 width/height/top/left
- 进场用 ease-out，退场时长约为进场的 60–70%
- 列表交错入场 40ms/item，封顶 10 项
- **必须**支持 `prefers-reduced-motion: reduce`（全局 kill switch 在 animations.css）
- hover 效果仅在 `(hover: hover) and (pointer: fine)` 下启用

---

## 6. 反参照（Anti-references）

- **不要 SaaS 模板感** — 不做典型 SaaS Dashboard 的大白卡 + 品牌色左边条 + 渐变背景
- **不要 AI 克隆界面** — 不追随 ChatGPT/Claude 的 chat UI 范式，保持自己的视觉识别度
- **不要紫蓝 AI 渐变** — 这是最常见的 AI 设计指纹，朱砂 + 宣纸是我们的回答
- **不要 emoji 当结构图标** — 用 `web/src/assets/icons/` 下的 SVG 图标

---

## 7. 提示词增强层（Prompt Enhancement）

品牌软包装在提示词层的落点。**铁律：永不替换 OMP 原生 prompt**，
只通过 `appendSystemPrompt` 机制追加增强内容（`agent/prompts.py`
`build_append_prompt` → `build_brand_prompt`）。

### 分层

| 层 | 内容 | 开关 |
|----|------|------|
| 功能层 | 中文回复指令 + `anthropic_skills/` / macros 清单 | 永久保留 |
| 品牌增强层 | 产品名 + 语气引导 + 表情指令 | `brand_enhancement` |

### 品牌增强块规范（`build_brand_prompt`）

1. **只做风格引导，不定义 AI 身份** — 禁止「你是 Maxma 不是 ChatGPT」这类
   身份替换。OMP 原生 ROLE（"helpful assistant in Oh My Pi harness"）必须
   完整保留，品牌块只追加风格约束，不覆盖原生人格。
2. **语气**：克制但有温度，先结论后细节，不寒暄、不推销、不堆感叹号。
3. **表情指令**：`[表情包:情绪]`。情绪词表与前端
   `web/src/composables/stickerUtils.ts` 的 `EMOTION_MAP` **严格对齐**
   （12 类，与 `config/stickers/` 目录一一对应），保证模型写出的情绪词
   一定能命中贴纸系统。
4. **墨色**：作为品牌理念（判断有分量但不喧哗），不是 AI 名字。

### 修改纪律

- 品牌增强块内容变化 → 同步更新 `EMOTION_MAP` / `config/stickers/` 目录 / 本文档
- 任何提示词改动必须验证不破坏 OMP 原生 tool inventory 与内部 URL 体系
- 开关：`config/settings.py` 的 `brand_enhancement`（与 `native_prompt_mode` 正交）

---

## 8. 设计原则（承自 PRODUCT.md）

1. **对话即界面** — 聊天窗口是产品核心，配置和工具是配角
2. **克制中的温度** — 纸墨基底保持克制，朱砂点缀赋予个性；不为装饰而装饰
3. **渐进式复杂度** — 新手觉得简单，老手觉得够用
4. **本地优先** — 界面传达「私有、安全、属于你」的感觉

---

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-07-28 | 首版：从生产 token 系统 + 首席思维伙伴定位提炼，取代 DESIGN.md (alpha) |
