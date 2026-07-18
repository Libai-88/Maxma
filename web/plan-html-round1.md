# Plan: HTML 构建问题修复 (Round 1)

## 范围
三个 HTML 文件需要修改：
- `D:/Maxma/MaxmaHere/web/index.html`
- `D:/Maxma/MaxmaHere/web/quick-chat.html`
- `D:/Maxma/MaxmaHere/web/splash.html`

## 任务 1: 添加 CSP meta 标签
**策略：** Tauri 桌面应用，允许连接本地后端 ws/http localhost。

在每个文件的 `<head>` 中,在 `</head>` 前添加：
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws://localhost:* http://localhost:*; img-src 'self' data: blob:; frame-src 'self';" />
```

## 任务 2: Google Fonts display=swap
- **index.html** 第 10 行 URL 已包含 `&display=swap` → **无需修改**。
- **quick-chat.html** 第 10 行同样已包含 `&display=swap` → **无需修改**。
- **splash.html** 未使用 Google Fonts（使用系统字体 `Songti SC`）→ **无需修改**。
- **关于 preload woff2：** Google Fonts 的 woff2 文件 URL 由 Google 动态生成，无法静态预知具体 URL。当前已有 `preconnect` 标签，这是最优方案。**不添加 preload。**

## 任务 3: 添加 meta description 和 noscript
对三个文件分别：

1. **meta description** 放在 `<head>` 中,在 `<title>` 之后、任意 `<link>` 之前：
   - `index.html` → `content="Maxma - AI 助手桌面应用"`
   - `quick-chat.html` → `content="Maxma Quick Chat"`
   - `splash.html` → `content="Maxma - AI 助手桌面应用"`

2. **noscript** 放在 `<body>` 内部最开头（`<div>` 之前）：
   - 统一使用 `请启用 JavaScript 以使用 Maxma。`

## 修改顺序（3 个文件，共 9 次 Edit）
1. `index.html` — 添加 CSP
2. `index.html` — 添加 meta description
3. `index.html` — 添加 noscript
4. `quick-chat.html` — 添加 CSP
5. `quick-chat.html` — 添加 meta description
6. `quick-chat.html` — 添加 noscript
7. `splash.html` — 添加 CSP
8. `splash.html` — 添加 meta description
9. `splash.html` — 添加 noscript
