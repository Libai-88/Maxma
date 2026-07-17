# SVG 图标清单

## 风格规范（新增图标必须遵循）

- `xmlns="http://www.w3.org/2000/svg"`
- `viewBox="0 0 24 24"`
- `fill="none"`（除需要填充实心点的细节外）
- `stroke="currentColor"`
- `stroke-width="1.5"`
- `stroke-linecap="round"`
- `stroke-linejoin="round"`

参考样板：`chat-input/link.svg`

> 旧版图标（如 `sidebar/chat.svg`、`sidebar/memory.svg`、`context-menu/copy.svg`）使用 Adobe Illustrator 导出的 `fill="currentColor"` + 任意 viewBox 风格，保留以避免回归。新图标统一采用上述 24×24 stroke 风格。

---

## 已就绪图标

### sidebar/（导航栏）
- `chat.svg` — 对话
- `memory.svg` — 记忆
- `model.svg` — 模型
- `pin.svg` — 固定
- `playground.svg` — Playground 导航链接 ⭐ 新增

### chat-input/（输入框）
- `attach.svg` — 添加文件
- `cite.svg` — 引用标签图标 ⭐ 新增
- `close.svg` — 标签移除按钮 ⭐ 新增
- `file.svg` — 文件引用标签
- `link.svg` — 链接
- `menu-file.svg` — 选择文件菜单
- `menu-folder.svg` — 选择文件夹菜单
- `send.svg` — 发送按钮
- `sparkles.svg` — 闪光
- `stop.svg` — 停止按钮
- `tool.svg` — 工具

### context-menu/（右键菜单）
- `cite-speech.svg` — 引用
- `copy.svg` — 复制
- `undo-arrow.svg` — 撤销

### status/（状态指示）
- `gear.svg` — 齿轮
- `warning.svg` — 警告

### welcome/（欢迎页）
- `chat-bubble.svg` — 对话气泡
- `search.svg` — 搜索

### tools/（工具气泡）⭐ 新增子目录
- `arrow-right.svg` — 步骤指示
- `bike.svg` — 骑行路线（MapBubble）
- `bus.svg` — 公交路线（MapBubble）
- `calendar.svg` — 日历/日期（HolidayBubble）
- `checkmark.svg` — 成功勾（FilesBubble / AskUserBubble / TaskTrackerBubble / TodoBubble）
- `chevron-down.svg` — 展开折叠 ▾（ScraperBubble / UnitTestBubble）
- `chevron-right.svg` — 展开折叠 ▸（ScraperBubble / DebuggerBubble / UnitTestBubble）
- `circle-outline.svg` — 未完成（TaskTrackerBubble / TodoBubble）
- `code-quality.svg` — 代码质量（CodeQualityBubble）
- `cookie.svg` — Cookie 设置（CookieBubble）
- `doc-reader.svg` — 文档阅读（DocReaderBubble）
- `error.svg` — 测试失败 ✕（UnitTestBubble / DebuggerBubble）
- `file-page.svg` — 文件（FilesBubble）
- `folder.svg` — 文件夹（FilesBubble）
- `map-pin.svg` — 地图定位（MapBubble）
- `pdf-reader.svg` — PDF 阅读（PdfReaderBubble）
- `python.svg` — Python 代码（PythonBubble）
- `scraper.svg` — 网页抓取（ScraperBubble）
- `search.svg` — 搜索查询（SearchBubble）
- `syntax-error.svg` — 语法检查错误 ✗（SyntaxBubble）
- `syntax-ok.svg` — 语法检查通过 ✓（SyntaxBubble）
- `todo-due.svg` — 任务截止日期（TodoBubble）
- `todo-project.svg` — 任务项目（TodoBubble）
- `walk.svg` — 步行段（MapBubble）
- `warning.svg` — 测试警告 ⚠（UnitTestBubble）

### weather/（天气）⭐ 新增子目录

`WeatherBubble.vue` 根据天气文本动态映射：

| 图标 | 文件 | 匹配条件 |
|------|------|---------|
| `weather-thunder` | `thunder.svg` | 包含「雷」 |
| `weather-snow` | `snow.svg` | 包含「雪」 |
| `weather-rain` | `rain.svg` | 包含「雨」 |
| `weather-fog` | `fog.svg` | 包含「雾」或「霾」 |
| `weather-sunny` | `sunny.svg` | 包含「晴」且不包含「多云」 |
| `weather-cloudy` | `cloudy.svg` | 包含「阴」或「云」 |
| `weather-partly-cloudy` | `partly-cloudy.svg` | 其他情况 |

---

## Icon.vue 注册清单（待办）

以下新增的 35 个 SVG 需要在 `web/src/components/Icon.vue` 中通过 `import xxxRaw from '@/assets/icons/.../*.svg?raw'` 注册到 `svgContents` map。建议命名（保持现有 kebab-case + 子目录扁平化惯例）：

**sidebar:**
- `playground` → `sidebar/playground.svg`

**chat-input:**
- `cite` → `chat-input/cite.svg`
- `close` → `chat-input/close.svg`

**tools:**（命名与文件名一致，去除子目录前缀）
- `search`、`code-quality`、`doc-reader`、`pdf-reader`、`python`、`scraper`、`cookie`、`calendar`、`map-pin`、`bus`、`walk`、`bike`、`todo-due`、`todo-project`、`file-page`、`folder`、`checkmark`、`circle-outline`、`arrow-right`、`chevron-right`、`chevron-down`、`error`、`warning`、`syntax-error`、`syntax-ok`

**weather:**（加 `weather-` 前缀避免与其他命名冲突）
- `weather-thunder`、`weather-snow`、`weather-rain`、`weather-fog`、`weather-sunny`、`weather-cloudy`、`weather-partly-cloudy`

> Icon.vue 不在本次 icon 补齐 agent 独占范围内，注册由后续 agent（Icon.vue 负责人）完成。

---

## 其他资源
- `logo.svg` — 品牌 logo
