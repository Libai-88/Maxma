# Plan: 增强 splash.html 艺术感与品牌感

## 当前状态
- 纯色背景 `#F4F0E4` (暖米色)
- 静态 SVG 樱花（蓝色调），仅有 `spin` 旋转动画
- 底部 "MaxmaHere" 文字，仅有 `fadeIn` 动画
- 总大小约 1.1 KB

## 变更计划

### 1. 背景：纯色 → 渐变
- 从 `#F4F0E4` 改为 `linear-gradient(135deg, #F8F4ED 0%, #F0E8DA 50%, #EAE0D0 100%)`

### 2. SVG Logo：增加 `fadeInUp` 入场动画
- 保留现有 `spin` 旋转，叠加 `fadeInUp`：透明→不透明 + 向上 12px 位移
- 品牌色 `#537D96`（远山青）不变

### 3. 品牌标语
- 在 `splash-text` 下方新增 `<div class="splash-tagline">温润如纸 · 智能如你</div>`
- 字号 11px，颜色 `rgba(83, 125, 150, 0.4)`，letter-spacing 3px

### 4. 品牌文字呼吸动画
- `splash-text` 增加 `pulseText` 循环：opacity 0.6 ↔ 1.0，3 秒周期

### 5. 动画保护
- 所有动画包裹在 `@media (prefers-reduced-motion: no-preference)` 中
- 减少动效用户直接显示静态内容

### 6. 约束遵守
- 总大小保持 < 2KB（纯 CSS，无外部资源）
- 品牌色系：暖米 #F8F4ED / 远山青 #537D96 / 墨色 #3B3D3F

## 文件
- 修改：`D:\Maxma\MaxmaHere\web\splash.html`
