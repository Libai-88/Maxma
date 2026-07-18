# 计划：使用 Playwright 对 Maxma 主题切换进行视觉验证

## 背景

验证 Maxma 应用的外观设置页面中所有 12 个主题的正确切换。使用 Playwright 进行端到端视觉测试。

## 技术方案

### 依赖
- **Playwright** 已全局可用（v1.61.1），Chromium 浏览器已安装
- **Vite dev server** 项目已有，端口 5173
- 无需额外安装 npm 包

### 测试脚本位置
`D:/Maxma/MaxmaHere/web/tests/theme-visual.spec.ts`

### 截图目录
`D:/Maxma/MaxmaHere/web/tests/screenshots/themes/`

### 测试策略

#### 测试 1：主题列表渲染
1. 启动 Vite dev server: `cd D:/Maxma/MaxmaHere/web && npx vite --port 5173`
2. 使用 Playwright 打开 `http://localhost:5173/appearance`
3. 等待页面加载完成（`h2` 标题 "外观 APPEARANCE" 可见）
4. 截取完整页面截图作为基线
5. 统计 `.theme-card` 元素数量，验证 >= 10

#### 测试 2：逐个主题切换（覆盖 11 个主题 + auto 解析验证）
对每个主题（共 12 个，包括 auto）：
1. 点击对应的 `.theme-card` 按钮（按 `data-theme-id` 属性或索引定位）
2. 等待 500ms 让 CSS 过渡生效
3. 截图页面，文件名为 `theme-{id}.png`
4. 验证 `document.documentElement` 的 `data-theme` 属性已正确设置
   - 对于 auto 主题，验证 data-theme 为 warm-paper 或 midnight（取决于系统偏好）
   - 对于具体主题，验证 data-theme 等于该主题 id

#### 测试 3：衬线字体开关
1. 找到 `.toggle-btn` 第一个开关（衬线字体）
2. 截图初始状态
3. 点击开关切换
4. 截图切换后状态
5. 再次点击恢复
6. 验证 `document.body` 的 `font-sans` class 状态与开关状态一致

#### 测试 4：纸质纹理开关（额外验证）
1. 找到第二个 `.toggle-btn`（纸质纹理）
2. 截图初始状态
3. 点击切换
4. 截图切换后状态
5. 再次点击恢复

### 测试执行方式

使用 `npx playwright test` 或直接运行 Playwright 脚本。考虑到项目目前只有 Vitest 测试，我们可以：

**方案 A**：使用 Playwright 独立脚本（`node` 执行），完全隔离
- 优势：不与现有 Vitest 配置冲突，灵活
- 劣势：需要自己管理浏览器生命周期

**方案 B**：安装 `@playwright/test` 作为 devDependency，使用 Playwright Test Runner
- 优势：完整的测试框架支持（断言、重试、报告）
- 劣势：需要安装依赖，与现有配置整合

**方案 C**：使用 Playwright 的 `chromium.launch()` 在 Node.js 脚本中直接运行
- 优势：简单直接，零安装
- 劣势：基础

推荐方案 A/C，因为 Playwright CLI 已经全局可用。

### 计划执行步骤

1. 创建截图目录 `tests/screenshots/themes/`
2. 创建 Playwright 测试脚本 `tests/theme-visual.spec.ts`
3. 启动 Vite dev server（后台运行）
4. 运行测试脚本
5. 停止 dev server
6. 分析结果并报告

## 输出产物

- 截图文件：每个主题的页面截图
- 测试摘要：各主题切换结果、衬线字体测试结果
- 问题列表：任何视觉问题或功能缺陷
