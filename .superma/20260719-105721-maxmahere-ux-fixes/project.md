# Project — MaxmaHere 前端 UI/UX 问题修复竞赛

## 项目路径
`D:\Maxma\MaxmaHere`

## 基线与分支
基线提交：`6f5d142`（design/blue-warm 分支，蓝队冠军方案状态）

## 竞赛主题
基于用户反馈，找出并解决前端 UI/UX 存在的实际问题。

### 用户反馈问题
1. **显示不全** — 浏览器中内容显示不完整，需要滚动或出现布局溢出
2. **字体太小** — 整体字体偏小，可读性差
3. **页面太乱** — 信息密度过高，缺乏视觉层次
4. **布局杂乱** — 元素排列缺乏规律，间距不一致

### 考察范围
- `web/src/views/` — 所有视图页面（ChatView, ProvidersView, OnboardingView 等）
- `web/src/components/` — 所有组件
- `web/src/assets/styles/` — 全局样式和设计令牌
- `web/src/App.vue` — 根布局
- `web/index.html` — 入口 HTML

### 具体排查方向
- 响应式布局问题（浏览器窗口缩放时内容截断/溢出）
- 字体大小系统（body 15px 是否过小？min-font-size 是否需设置？）
- 间距一致性（组件间距、行距、段距）
- 信息密度（侧边栏、设置页、Provider 列表的拥挤程度）
- CSS 溢出（`overflow: hidden` 导致内容截断，`white-space: nowrap` 导致文字溢出）
- Viewport 设置（`meta viewport` 是否存在并正确）
- 布局断裂（flex/grid 布局在内容过多时断裂）

## 评分标准
- **问题发现 (30%)** — 找到了多少真实 UI/UX 问题
- **修复质量 (40%)** — 修复是否彻底、不引入新问题
- **一致性 (15%)** — 修复是否统一应用于所有类似场景
- **构建通过 (15%)** — `npm run build` 通过

## 技术约束
- 修改必须在 `design/ux-red` 或 `design/ux-blue` 分支上进行
- `npm run build` 必须通过
- 鼓励修改 CSS/组件代码，避免修改业务逻辑
