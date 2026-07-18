# Plan: Playwright 错误/空状态测试

## 目标

使用 Playwright 验证 Maxma Web 应用的空状态、404 页面以及浏览器控制台错误。

## 测试范围

### 测试 1：空状态截图

待测路由（具备空状态 UI 的页面）：

| 路由 | 预期空状态文案 | 备注 |
|---|---|---|
| `/providers` | "尚未配置任何提供商。点击上方按钮添加。" | `.empty` 类，居中显示 |
| `/mcp` | "尚未配置任何 MCP 服务器。点击上方按钮添加。" | `.empty` 类，带 `.empty-hint` |

操作步骤：
1. 启动 Vite dev server
2. 导航到 `/providers`，等待 `networkidle`
3. 截图保存为 `empty-providers.png`
4. 导航到 `/mcp`，等待 `networkidle`
5. 截图保存为 `empty-mcp.png`

### 测试 2：404 页面测试

待测路由：

| 路由 | 预期行为 |
|---|---|
| `/this-does-not-exist` | 显示 NotFoundView（"404 / 页面不存在" + "返回首页" 链接） |

操作步骤：
1. 导航到 `/this-does-not-exist`
2. 截图保存为 `404-page.png`
3. 验证页面包含 "404" 和 "页面不存在" 文字

### 测试 3：控制台错误检查

对所有已注册路由执行控制台错误检查：

```
/, /memory, /kb, /playground, /appearance, /providers, /soul,
/mcp, /skills, /user, /path-whitelist, /maxma-blocker, /env-vars,
/event-hooks, /privacy, /metrics, /audit-log, /activity
```

操作步骤：
1. 为每个路由：
   - 导航到该路由
   - 等待 `networkidle`
   - 等待 1s 让异步操作完成
   - 收集 `console.error` 和 `console.warn` 消息
2. 汇总控制台错误日志保存到 `console-errors.log`

## 实现方式

使用 `webapp-testing` skill 推荐的 `with_server.py` 管理 dev server 生命周期，结合原生 Python Playwright 脚本。

### 脚本文件

创建 `tests/playwright_error_test.py`，脚本功能：

- 使用 `sync_playwright()` 启动 Chromium headless
- 设置 `page.on("console")` 监听器捕获所有控制台消息
- 依次执行三个测试用例
- 截图保存到 `tests/screenshots/` 目录
- 错误日志保存到 `tests/console-errors.log`

### 启动命令

```bash
python C:/Users/Libai/.agents/skills/webapp-testing/scripts/with_server.py \
  --server "cd D:/Maxma/MaxmaHere/web && npx vite --port 5173" --port 5173 \
  --timeout 30 \
  -- python tests/playwright_error_test.py
```

### 输出

- `tests/screenshots/empty-providers.png` — Providers 空状态截图
- `tests/screenshots/empty-mcp.png` — MCP 空状态截图
- `tests/screenshots/404-page.png` — 404 页面截图
- `tests/console-errors.log` — 所有路由的控制台错误/警告
- 标准输出 — 测试结果摘要

## 执行流程

1. 关闭已占用的 dev server（如有）
2. 使用 `with_server.py` 启动 Vite + 执行测试脚本
3. 脚本执行完成后自动关闭 server
4. 检查截图和日志输出
5. 汇报结果

## 依赖检查

- Playwright (npm): 1.61.1 - 可用
- Playwright (pip): 1.61.0 - 可用
- Python: 3.14.5 - 可用
- Vite: 通过 npm scripts
