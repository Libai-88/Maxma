# 布局响应式测试计划

## 目标
使用 Playwright 在不同视口大小下对 Maxma 前端进行布局响应式测试，验证侧边栏折叠行为和卡片网格自适应。

## 环境信息

| 项目 | 值 |
|------|-----|
| 工作目录 | `D:\Maxma\MaxmaHere\web` |
| 前端框架 | Vue 3 + Vite 5 (TypeScript) |
| Dev Server | `npx vite --port 5173` |
| Playwright | 1.61.1 (`playwright-core`) |
| Chromium | `D:\PlaywrightBrowsers\chromium-1228\chrome-win64\chrome.exe` |
| 截图输出 | `D:\Maxma\MaxmaHere\web\tests\screenshots\responsive\` |

## 关键代码逻辑

### 侧边栏折叠 (`src/stores/sidebar.ts`)
- `forcedCollapsed` 通过 `window.matchMedia('(max-width: 900px)')` 自动触发
- 当视口宽度 <= 900px 时，侧边栏自动折叠（`forcedCollapsed = true`）
- 当视口 > 900px 时，侧边栏展开（除非用户手动折叠）
- 折叠时 sidebar 宽度从 220px 变为 58px，nav-label 隐藏

### 提供商卡片网格 (`src/views/ProvidersView.vue`)
- 当前使用硬编码 `grid-template-columns: repeat(3, 1fr)` — **没有响应式断点**
- 预期测试将发现：在小屏下卡片不会自动变为 2 列或 1 列

## 测试脚本方案

使用 CJS（CommonJS）脚本 + `playwright-core`，遵循项目中现有测试模式（如 `round14-test.cjs`）。

脚本文件：`tests/responsive-test.cjs`

### 测试步骤

#### 测试 1：桌面视图 (1920x1080)
1. 设置视口 1920x1080
2. 访问首页 `http://localhost:5173`
3. 等待 `networkidle`
4. 截取全页截图 `01-desktop-1920x1080.png`
5. 验证侧边栏可见（检查 `.sidebar` 元素可见且非 collapsed 状态）

#### 测试 2：中屏视图 (1280x800)
1. 设置视口 1280x800
2. 访问首页
3. 等待 `networkidle`
4. 截取全页截图 `02-medium-1280x800.png`
5. 验证布局适应（侧边栏应仍展开，内容区域正常）

#### 测试 3：小屏视图 (900x600)
1. 设置视口 900x600
2. 访问首页
3. 等待 `networkidle`
4. 截取全页截图 `03-small-900x600.png`
5. **验证侧边栏自动折叠**：检查 `.sidebar.collapsed` 存在或 `forcedCollapsed` 生效

#### 测试 4：提供商标视图 (800x600 — 验证极端小屏)
1. 设置视口 800x600
2. 访问 `/providers`
3. 等待 `networkidle`
4. 截取全页截图 `04-providers-800x600.png`
5. 验证侧边栏自动折叠

#### 测试 5-7：提供商卡片网格响应式
分别在三个视口下访问 `/providers`，截图并验证卡片列数：
- **测试 5** (1920x1080): 截图 `05-providers-wide-1920x1080.png`，期望 3 列
- **测试 6** (1024x768): 截图 `06-providers-medium-1024x768.png`，期望 2 列（**预期失败** — 当前代码未实现）
- **测试 7** (480x800): 截图 `07-providers-narrow-480x800.png`，期望 1 列（**预期失败** — 当前代码未实现）

### 输出格式

脚本输出 JSON 报告到截图目录，包含：
- 每个测试的名称、视口、通过/失败状态
- 失败原因摘要
- 各截图文件路径

## 执行步骤

1. 启动 Vite dev server（后台运行）
2. 运行 Playwright 测试脚本
3. 停止 dev server
4. 分析结果并报告

## 已知问题 / 预期发现

1. **Provider 卡片网格不响应** — `src/views/ProvidersView.vue` 中的 `.card-grid` 只有 `grid-template-columns: repeat(3, 1fr)`，无任何 `@media` 查询，因此在所有视口下始终为 3 列。
2. **侧边栏响应式行为正常** — `src/stores/sidebar.ts` 正确使用了 `matchMedia('(max-width: 900px)')`，在 <= 900px 视口下应自动折叠。
