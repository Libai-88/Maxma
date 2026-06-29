# Playwright 浏览器工具

## 可用工具
| Tool | 功能 | 适用场景 |
|------|------|---------|
| `browser_browse` | 访问网页并提取文本内容 | JS 渲染的动态页面（SPA、Vue/React） |
| `browser_screenshot` | 网页截图保存为 PNG | 需要视觉信息或配合 analyze_image |
| `browser_extract` | CSS 选择器/JS 提取结构化数据 | 从特定元素提取链接、表格、列表等 |

## 工具选择策略
- **静态页面内容提取** → 优先 `tavily_extract`（更快、更轻量）
- **JS 渲染的动态页面** → 使用 `browser_browse`
- **需要看页面长什么样** → 使用 `browser_screenshot`，再用 `analyze_image` 分析
- **需要从页面提取特定数据** → 使用 `browser_extract`（CSS 选择器或 JS）

## 协作流程
- **截图 + 图片理解**：`browser_screenshot` 截图 → `analyze_image` 用 `local:路径` 分析截图内容
- **搜索 + 深入阅读**：`tavily_search` 发现链接 → `browser_browse` 阅读 JS 渲染页面
- **结构化提取**：`browser_browse` 先看页面结构 → `browser_extract` 用 CSS 选择器精确提取

## 常见陷阱
- **性能**：Playwright 启动浏览器较重，非必要不用。静态页面用 tavily_extract
- **超时**：默认 30 秒，慢网站可增加到 60-120 秒
- **wait_until 策略**：`load` 适合大多数页面；`networkidle` 适合 AJAX 密集型页面但更慢
- **browser_extract JS**：`javascript` 参数在页面上下文中执行，返回值必须是 JSON 可序列化的
- **截图存储**：截图保存在 uploads/ 目录，不会被自动清理，注意磁盘空间
