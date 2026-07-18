# 导航冒烟测试计划

## 目标
使用 Playwright（Python）对 Maxma 前端进行浏览器级别的冒烟测试，验证基本导航功能正常。

## 工具
- **Playwright (Python)**：浏览器自动化，依据 `webapp-testing` skill 推荐
- **`with_server.py`**：管理 Vite 开发服务器生命周期
- **截图输出**：`D:/Maxma/MaxmaHere/web/tests/screenshots/`

## 测试脚本

### 文件位置
`D:/Maxma/MaxmaHere/web/tests/smoke_test.py`

### 脚本逻辑

#### Test 1: 首页加载
1. 打开 `http://localhost:5173/`
2. 等待 `networkidle`
3. 验证 `document.title` 包含 "Maxma"
4. 验证侧边栏导航链接存在（通过文本匹配：`对话`、`活动`、`动态 NEWS`、`设置`）
5. 截图 `01-homepage.png`

#### Test 2: 路由导航
依次导航以下路由，每个均：
- 等待 `networkidle`
- 截图 `02-{route-name}.png`
- 验证 `<h2>` 内容符合预期（或 fallback 验证标题）

| 路由 | 截图文件名 | 预期 h2 文本 |
|------|-----------|-------------|
| `/` | `02-chat.png` | 无 h2，验证 title 含 "对话" |
| `/memory` | `02-memory.png` | "AI 记忆" |
| `/appearance` | `02-appearance.png` | "外观 APPEARANCE" |
| `/providers` | `02-providers.png` | "提供商管理 PROVIDERS" |
| `/mcp` | `02-mcp.png` | "MCP 服务 MCP" |
| `/skills` | `02-skills.png` | "Skills & 宏" |
| `/soul` | `02-soul.png` | 动态标题，验证 title 含 "角色设定" |

#### Test 3: 404 页面
1. 导航到 `/nonexistent-page`
2. 等待 `networkidle`
3. 截图 `03-404.png`
4. 验证页面显示 "404" 和 "页面不存在"

## 执行步骤

1. 安装 playwright 系统依赖（若首次使用）
2. 创建截图目录 `tests/screenshots/`
3. 写入测试脚本
4. 使用 `with_server.py` 启动 Vite 并运行测试
   ```bash
   python "<skills-path>/scripts/with_server.py" \
     --server "cd D:/Maxma/MaxmaHere/web && npx vite --port 5173" \
     --port 5173 \
     -- python D:/Maxma/MaxmaHere/web/tests/smoke_test.py
   ```
5. 分析截图和测试报告

## 预期结果
- 所有页面加载成功（无崩溃、无空白页）
- 标题格式符合 `{中文名} - Maxma`
- 侧边栏导航链接可交互
- 404 页面正确显示
- 截图清晰可辨

## 失败处理
- 若 Vite 启动失败，重试一次后中止
- 若某个页面加载超时，标记为 FAIL 并继续下一个
- 最终输出汇总报告（Pass/Fail 列表）
