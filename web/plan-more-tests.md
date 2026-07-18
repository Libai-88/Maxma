# 补充 Playwright 端到端测试计划

## 目标

在现有 `tests/playwright/smoke.mjs` 基础上，新增 `tests/playwright/e2e.mjs` 脚本，覆盖四大交互场景：
1. 设置菜单弹出与关闭
2. Provider 添加表单流程
3. 外观主题切换（3 个主题截图）
4. 路由前进/后退导航保持

## 前置条件

- Vite 开发服务器运行在 `http://localhost:5173`
- 若 `@playwright/test` 未安装，需先执行 `npm install -D @playwright/test`（或全局安装）
- 沿用现有配置 `tests/playwright/config.mjs`

## 测试脚本设计

### 文件位置

`D:/Maxma/MaxmaHere/web/tests/playwright/e2e.mjs`

---

### Test Suite 1: 设置菜单交互 (Settings Menu)

| # | 步骤 | 断言 |
|---|------|------|
| 1 | 访问首页 `/`，等待 `networkidle` | 页面加载完成 |
| 2 | 点击 `.nav-item.settings-btn` (设置按钮) | `.settings-popup` 变为可见 |
| 3 | 验证弹出菜单中包含主要菜单项 | 包含文本：模型/MCP 服务/Skills/外观/用户/路径白名单/拒止锚/环境变量/隐私仪表盘/运行指标 |
| 4 | 点击页面空白处关闭菜单，或点击设置按钮再次关闭 | `.settings-popup` 不可见 |

### Test Suite 2: Provider 添加流程 (Provider Add Flow)

| # | 步骤 | 断言 |
|---|------|------|
| 1 | 导航到 `/providers`，等待 `networkidle` | `<h2>` 包含"提供商管理 PROVIDERS" |
| 2 | 点击"添加提供商"按钮 (`text="+ 添加提供商"`) | 表单 `.wizard-form` 可见，`.card-grid` 不可见 |
| 3 | 验证表单基础字段存在 | provider_type 下拉框、label 输入框、api_key 输入框、base_url 输入框 |
| 4 | 选择 "OpenAI" 提供商 | provider_type 选为 openai，base_url 自动填充为 `https://api.openai.com/v1` |
| 5 | 填写显示名称和 API Key | 输入框值正确反映输入 |
| 6 | 点击"返回列表"取消 | 回到列表模式，表单不可见 |

> 说明：不执行实际保存（避免污染后端状态），仅验证表单渲染和填写交互。

### Test Suite 3: 外观页面主题切换 (Theme Switching with Screenshots)

| # | 步骤 | 断言 |
|---|------|------|
| 1 | 导航到 `/appearance`，等待 `networkidle` | `<h2>` 包含"外观 APPEARANCE" |
| 2 | 统计 `.theme-card` 数量 | 等于 12（不含 auto 选项） |
| 3 | 依次点击 3 个不同主题卡片：`coral`、`midnight`、`dawn` | 每个点击后 `document.documentElement.getAttribute('data-theme')` 等于对应 theme id |
| 4 | 每个主题切换后截图 | 截图保存至 `test-results/screenshots/` |

> 注意：`useTheme.ts` 定义了 12 个具体主题（不含 `auto`）。主题卡片通过 `title` 属性匹配描述文本，通过 `data-theme` 验证切换生效。

### Test Suite 4: 路由导航保持 (Route Navigation Persistence)

| # | 步骤 | 断言 |
|---|------|------|
| 1 | 从首页 `/` 开始 | 当前 URL 为 `/` |
| 2 | 点击侧边栏 `对话` 链接导航到 `/` | URL 为 `/` |
| 3 | 点击侧边栏 `活动` 链接导航到 `/activity` | URL 为 `/activity`，`<h2>` 包含"活动" |
| 4 | 点击侧边栏 `记忆` 链接导航到 `/memory` | URL 为 `/memory`，`<h2>` 包含"记忆" |
| 5 | 按浏览器后退按钮 | URL 回到 `/activity` |
| 6 | 再次按后退按钮 | URL 回到 `/` |
| 7 | 按浏览器前进按钮 | URL 回到 `/activity` |
| 8 | 验证页面内容正确渲染 | `<h2>` 内容与路由匹配 |

## 执行步骤

1. 确认 `@playwright/test` 已安装（若否：`npm install -D @playwright/test`，然后 `npx playwright install chromium`）
2. 确保 Vite 开发服务器已在 `:5173` 运行
3. 执行：`npx playwright test tests/playwright/e2e.mjs --config tests/playwright/config.mjs`
4. 检查 `test-results/` 下的截图和报告

## 预期结果

- 4 个测试套件全部通过
- 主题切换截图清晰反映主题变化
- 前进/后退导航保持页面状态正确
- 无控制台错误或超时

## 失败处理

- 若某测试失败，截图将保留在 `test-results/` 供人工审查
- 不修改任何源代码——bug 发现后单独报告
