# Typography 字体排版系统审计与优化计划

> 基于 redesign-skill 的 Typography audit checklist

---

## 审计发现

### 1. Headings 缺乏存在感

| 项目 | 当前值 | 评价 |
|------|--------|------|
| `--fs-title` (tokens.css:19) | `1rem` (16px) | 偏小，作为"区块标题"不够醒目 |
| `markdown.css` h1 | `1.5em` | 合理（相对父元素） |
| `markdown.css` h2 | `1.3em` | 合理 |
| `markdown.css` h3 | `1.15em` | 合理 |
| 视图 h2（各 view 文件） | 1.1em ~ 1.3rem，分散定义 | 缺乏统一规范 |
| 视图 h3 | 0.9rem ~ 15px | 偏小，建议统一 |

**结论**: `--fs-title` 从 `1rem` 提升到 `1.15rem`；为视图 h2/h3 建立统一的 letter-spacing 规范。

### 2. 正文行宽约束

| 项目 | 当前值 | 评价 |
|------|--------|------|
| `.markdown-body` | 无 `max-width` | **缺失**，应加 `max-width: 65ch` |
| 各视图容器 | 部分有 `max-width`（如 AppearanceView 720px） | 不一致 |

**结论**: 在 `.markdown-body` 上添加 `max-width: 65ch`。对于视图级别的正文容器，不做强制约束以避免破坏布局。

### 3. 字距调整

| 元素 | 当前值 | 评价 |
|------|--------|------|
| `.logo`（App.vue:295） | `letter-spacing: -0.3px` | 正确，保持 |
| `.empty-title`（ChatWindow.vue:735） | `letter-spacing: -0.5px` | 正确，保持 |
| 各视图 `<h2>` | 无 letter-spacing | **缺失**，大标题应加负字距 |
| 各视图 `<h3>` | 无 letter-spacing | **缺失**，小标题可加正字距或保持 |
| `.nav-en`（App.vue:382） | `letter-spacing: 0.5px` | 正确（小号大写用正字距） |

**结论**: 为视图中的 h2 添加 `letter-spacing: -0.3px`；为 h3 保持中性或 `letter-spacing: 0.02em`。

### 4. 孤词（Orphaned words）

| 项目 | 当前值 | 评价 |
|------|--------|------|
| 所有标题 | 无 `text-wrap` 属性 | **缺失**，应加 `text-wrap: balance` |

**结论**: 在 `markdown.css` 的 h1-h6 上添加 `text-wrap: balance`。视图中的 h2/h3 酌情添加。

---

## 修复方案

### 高优先级

#### A. 添加 `text-wrap: balance` 到主要标题

**文件**: `D:\Maxma\MaxmaHere\web\src\assets\styles\markdown.css`
- 在 `.markdown-body h1, h2, h3, h4, h5, h6` 块中添加 `text-wrap: balance`

#### B. 为 markdown 标题添加 letter-spacing

**文件**: `D:\Maxma\MaxmaHere\web\src\assets\styles\markdown.css`
- h1: `letter-spacing: -0.5px`（大标题收紧）
- h2: `letter-spacing: -0.3px`（中等标题适度收紧）
- h3: 保持默认

### 中优先级

#### C. 提升 `--fs-title` token

**文件**: `D:\Maxma\MaxmaHere\web\src\assets\styles\tokens.css`
- `--fs-title`: `1rem` → `1.15rem`

#### D. 为正文添加行宽约束

**文件**: `D:\Maxma\MaxmaHere\web\src\assets\styles\markdown.css`
- 在 `.markdown-body` 上添加 `max-width: 65ch`，确保长段落可读性

### 低优先级

#### E. 检查并补充 missing font-weight 变体

EB Garamond 在 Google Fonts 中加载的变体: Regular 400, Medium 500, SemiBold 600, Bold 700（已在项目中引用）。
Inter: 完整的多轴可变字体。
**结论**: 字体变体已基本完整，无需修改。

#### F. 视图 h2 字距统一（可选）

涉及多个 view 文件，每个需要单独添加 scoped 样式。影响较大，建议仅在 markdown 渲染层做改动，视图标题暂不动。

---

## 修改清单

| # | 文件 | 修改内容 | 优先级 |
|---|------|---------|--------|
| 1 | `src/assets/styles/markdown.css` | 为 `.markdown-body h1-h6` 添加 `text-wrap: balance` | 高 |
| 2 | `src/assets/styles/markdown.css` | 为 `.markdown-body h1` 添加 `letter-spacing: -0.5px` | 高 |
| 3 | `src/assets/styles/markdown.css` | 为 `.markdown-body h2` 添加 `letter-spacing: -0.3px` | 高 |
| 4 | `src/assets/styles/markdown.css` | 为 `.markdown-body` 添加 `max-width: 65ch` | 中 |
| 5 | `src/assets/styles/tokens.css` | 提升 `--fs-title` 从 `1rem` 到 `1.15rem` | 中 |

---

## 验证方式

```bash
cd D:/Maxma/MaxmaHere/web
npx vue-tsc --noEmit
```

请确认上述计划是否合适，确认后我将执行修改。
