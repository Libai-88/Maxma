# Plan: Color & Surfaces Audit 色彩与表面质感审计

## Audit Findings Summary

### 1. 纯黑 `#000000` 背景 — ❌ 需修复

**delve.css** 的 `--accent-dark` 和 `--accent-hover` 硬编码为 `#000000`（第 54–55 行）。

虽然不是背景色，但纯黑作为 accent-hover 会让 hover 效果显得生硬，且不符合其余主题（均使用 accent 的深色变体）。应改为暗灰以融入 accent 色系。

**范围：** 仅 `delve.css`，2 处。

---

### 2. 过饱和强调色 — ✅ 无需修改

对 11 个主题的 `--accent` 和 `--accent-pink` 进行了 HSL 饱和度计算：

| 主题 | `--accent` 饱和度 | `--accent-pink` 饱和度 |
|------|------------------|----------------------|
| absolutely | 50% (#A54B37) | 25% (#6B8E7A) |
| contemplation | 27% (#597891) | 22% (#C99AAF) |
| coral | 34% (#2B4858) | 60% (#D25F4B) |
| dawn | 27% (#6B9BA5) | 73% (#E8826F) |
| deep-think | 67% (#515FDC) | 77% (#E85A4F) |
| grass-aroma | 25% (#5B8C5F) | 62% (#E8A07A) |
| high-contrast | 48% (#1A3A4A) | 53% (#C03B3B) |
| midnight-contrast | 11% (#E0BFC8) | 32% (#F0C0A0) |
| midnight | 18% (#C99AAF) | 29% (#EAB2A0) |
| warm-paper | 29% (#537D96) | 71% (#EC8F8D) |
| delve | 2% (#202123) | — |

所有饱和度均低于 80%，在合理范围内。**无需修改。**

---

### 3. 多个强调色 — ✅ 无需修改

`--accent`（主色） + `--accent-pink`（辅色）是设计系统有意为之的双强调色体系：
- `--accent` 用于按钮、链接等主交互
- `--accent-pink` 用于高亮、标签等次要强调

命名 `--accent-pink` 在部分主题中与实际色相略有偏差（如 absolutely 的 accent-pink 是鼠尾草绿 #6B8E7A），但作为约定命名可接受。**无需修改。**

---

### 4. 盒阴影色调 — ✅ 无需修改

`tokens.css` 中阴影使用 `var(--shadow-color, rgba(0, 0, 0, 0.04))`。

各主题的 `--shadow-color` 情况：
- **浅色主题（7 个）：** 均基于 `text-primary` 色值，使用 `rgba(text-primary, 0.06–0.09)` — 良好实践
- **暗色主题（midnight/midnight-contrast）：** 使用 `rgba(0, 0, 0, 0.36–0.5)` — 深色背景上黑阴影是正确做法
- **high-contrast：** 使用 `rgba(0, 0, 0, 0.12)` — 高对比主题可接受
- **delve：** 使用 `rgba(0, 0, 0, 0.05)` — 透明度低，视觉影响小

**无需修改。**

---

### 5. 表面质感/纹理 — ⚠️ 小优化

现有 `paper-texture.css` 实现了三层纹理系统（surface / card / 亮度补偿），整体完善。

**发现的小问题：** 亮度补偿层硬编码了暖白色 `rgba(255, 253, 247, ...)`，在冷调主题（contemplation、deep-think）下可能略有违和。建议将补偿色抽取为 CSS 变量。

**范围：** `paper-texture.css` + `tokens.css`，共 2 处。

---

### 6. 额外发现：组件中硬编码 #000

以下文件使用硬编码 `#000`，不计入本次审计范围（属于组件级样式而非主题系统）：
- `ChatInput.vue` — `color-mix` 中用于加深 status-error
- `TaskTrackerBar.vue` / `TaskTrackerBubble.vue` — 工具专用气泡
- `TavilySearchBubble.vue` / `TavilyExtractBubble.vue` — 工具专用气泡

这些不在本次修复范围内，仅标记。

---

## 执行修改

### 修改 A：修复 delve.css 纯黑 accent-dark / accent-hover

将 `#000000` 替换为与 `--accent: #202123` 协调的深灰：

```
--accent-dark: #101010;   /* 接近纯黑但有层次 */
--accent-hover: #101010;
```

### 修改 B：抽取纹理亮度补偿色为 CSS 变量（可选低优先级）

将 `paper-texture.css` 中硬编码的 `rgba(255, 253, 247, ...)` 替换为 `var(--paper-texture-compensate-color)`，并在 `tokens.css` 中定义默认值。

---

## 验证

1. 运行 `npx vue-tsc --noEmit` 检查无类型错误
2. 确认无残留 `#000000` 引用（主题文件内）
3. 通知结果
