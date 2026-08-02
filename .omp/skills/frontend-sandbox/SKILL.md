---
name: frontend-sandbox
description: 前端 HTML/CSS/JS 沙箱渲染规则：设计令牌、排版规范、布局约束、触发条件。当需要输出交互式 HTML 内容或前端组件时加载此 skill。
---

# 前端沙箱渲染规则

## HTML 交互效果的渲染机制

你可以直接输出原始的 HTML/CSS/JS 来创建交互式内容，前端会自动将其放入沙箱 iframe 中渲染。

**关键规则**：HTML **应包裹在 ````html 围栏代码块内**，系统会自动将其渲染为页面元素而非源代码。直接输出的原始 HTML 同样兼容，但推荐使用 ````html` 代码块以获得更稳定的渲染效果。

## 正确 vs 错误示范

```
✅ 推荐：使用 ```html 代码块包裹 HTML（优先选择）
一个交互式计数器：

```html
<div id="counter">
  <style>
    .counter-wrap { text-align: center; padding: 20px; }
    .counter-num { font-size: 48px; font-weight: 700; color: var(--accent); }
    .counter-btn { background: var(--accent); color: #fff; border: none; padding: 8px 24px; border-radius: 6px; cursor: pointer; font-size: 16px; }
    .counter-btn:hover { opacity: 0.8; }
  </style>
  <div class="counter-wrap">
    <div class="counter-num" id="num">0</div>
    <button class="counter-btn" onclick="document.getElementById('num').textContent=parseInt(document.getElementById('num').textContent)+1">+1</button>
  </div>
</div>
```

✅ 也支持直接输出原始 HTML（无代码块包裹）
<div>hello</div>

❌ 错误：包裹在非 html 代码块中，会被渲染为源代码
```js
<div>hello</div>
```

❌ 错误：包裹在非 html 代码块中的 script 不会被执行
```js
<script>alert('test')</script>
```
```

## 触发沙箱的条件

内容中出现以下任何一种模式（无论是否在代码块内），就会进入 iframe 沙箱渲染：

| 模式 | 示例 |
|------|------|
| `<script>` 标签 | `<script>...</script>` |
| `<style>` 标签 | `<style>.cls { color: red; }</style>` |
| 外部样式表 | `<link rel="stylesheet" href="...">` |
| 事件处理器属性 | `onclick="..."`、`onmouseover="..."` 等 |
| `javascript:` 链接 | `<a href="javascript:...">` |
| `<iframe>` 嵌入 | `<iframe src="...">` |

**技术说明**：
- 沙箱使用 `<iframe srcdoc="...">` + `sandbox="allow-scripts allow-modals"` 隔离执行
- 无 `allow-same-origin` → JS 无法访问父页面 DOM、Cookie、localStorage
- 无 `allow-popups` → 弹窗被阻止
- 无 `allow-top-navigation` → 无法导航父页面
- 内容高度自动适配（ResizeObserver + 定时器兜底）

## 设计令牌（Design Tokens）

沙箱 iframe 会自动继承宿主页面的以下 CSS 自定义属性，可直接在 `<style>` 中使用：

| 令牌 | 默认值 | 用途 |
|------|--------|------|
| `--bg-primary` | `#ffffff` | 页面/代码块背景 |
| `--bg-secondary` | `#f9fafb` | 次要背景（表格头等） |
| `--bg-card` | `#ffffff` | 卡片表面 |
| `--text-primary` | `#1f2937` | 主要文字色 |
| `--text-secondary` | `#6b7280` | 次要文字色 |
| `--text-tertiary` | `#9ca3af` | 占位文字色 |
| `--accent` | `#000000` | 强调色（链接、按钮） |
| `--border` | `#e5e7eb` | 边框和分割线 |

**推荐用法**：编写 HTML 时优先使用这些变量而非硬编码颜色，以保持与界面主题一致：
```html
<div style="color: var(--text-primary); background: var(--bg-secondary); border: 1px solid var(--border);">
  自动适应当前主题
</div>
```

## 排版规范

字体栈（沙箱内已预置）：
```
-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
'Hiragino Sans GB', 'Microsoft YaHei', sans-serif
```

等宽字体系列：
```
'SF Mono', 'Consolas', monospace
```

- 正文：16px，行高 1.6
- 标题：font-weight 600，行高 1.3
- 代码块：13px，等宽字体，12px padding，8px border-radius
- 引用块：3px 实线左边框，次要颜色文字

## 内容布局

- 消息气泡最大宽度为消息容器的 72%（约 553px）
- 内容不应超出此宽度，长文本注意换行
- 图片默认 `max-width: 100%` + `border-radius: 8px`
- 表格会自动占满容器宽度
- 避免使用 `position: fixed` / `absolute`，会因 iframe 边界被截断
- 避免使用 `document.write()`（加载后调用会清空文档，已被拦截）

## 整体页面布局（参考）

```
+----------- 应用全屏 -----------+
| 侧栏 220px  |  主区域 (flex: 1)  |
| (可折叠至   |   +-- 聊天头部 ----+
|   58px)     |   | 状态 | 按钮 |   |
|             |   +----------------+
| 导航        |   消息区 (max-width: 768px, 居中)
| 会话列表    |   +----------------+
| 健康状态    |   |  助手气泡       |
|             |   |  .markdown-body |
|             |   |  排版内容        |
|             |   +----------------+
|             |   |  输入框          |
+-------------+-------------------+
```
