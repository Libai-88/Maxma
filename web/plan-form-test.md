# 测试计划：Provider 配置表单交互测试

## 环境

- 项目路径: `D:/Maxma/MaxmaHere/web`
- Vite dev server: port 5173 (默认)
- Playwright: 全局安装 v1.61.1（需要 `npx playwright install chromium`）
- 测试脚本路径: `tests/provider-form.spec.ts`
- 截图输出: `tests/screenshots/`

## 被测组件

`src/views/ProvidersView.vue` 中的提供商配置表单，包含：

- **表单字段**：提供商 select（预设列表）、显示名称 input、API Key input、Base URL input、模型参数区域（context window、max tokens、temperature、top P）、高级设置（timeout、custom headers）
- **验证逻辑**：显示名称为空时提示 `显示名称不能为空`，Base URL 为空时提示 `Base URL 不能为空`
- **预设切换**：切换提供商类型（如 deepseek -> openai）时 Base URL 自动填充对应值
- **操作**：添加、编辑、删除提供商，测试连接（PING），拉取模型列表

## 测试用例

### 测试 1：表单渲染
1. 启动 Vite dev server
2. 导航到 `/providers`
3. 截图当前页面（初始列表页）
4. 点击"+ 添加提供商"按钮
5. 截图表单页面
6. 验证表单关键字段存在：
   - 提供商类型 `<select>` 已渲染
   - 显示名称 `<input>` 已渲染
   - API Key `<input>` 已渲染
   - Base URL `<input>` 已渲染
   - 保存按钮已渲染
   - 取消按钮已渲染

### 测试 2：表单验证（显示名称必填）
1. 清空显示名称字段
2. 点击保存按钮
3. 验证页面显示 `显示名称不能为空` 错误消息
4. 截图错误状态

### 测试 3：预设切换自动填充 Base URL
1. 确认默认预设为 deepseek，Base URL 为 `https://api.deepseek.com`
2. 切换预设为 openai
3. 验证 Base URL 自动更新为 `https://api.openai.com/v1`
4. 切换预设为 anthropic
5. 验证 Base URL 自动更新为 `https://api.anthropic.com/v1`
6. 切换预设为 ollama
7. 验证 Base URL 自动更新为 `http://127.0.0.1:11434/v1`

## 输出产物

| 文件 | 说明 |
|------|------|
| `tests/screenshots/01-initial-list.png` | 初始列表页面截图 |
| `tests/screenshots/02-form-page.png` | 表单页面截图 |
| `tests/screenshots/03-validation-error.png` | 验证错误状态截图 |

## 执行步骤

1. 安装 Playwright 浏览器（`npx playwright install chromium`）
2. 创建测试脚本 `tests/provider-form.spec.ts`
3. 后台启动 Vite dev server
4. 运行 Playwright 测试
5. 生成测试结果摘要
6. 停止 Vite dev server
