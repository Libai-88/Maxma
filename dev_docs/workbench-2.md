# Workbench 2.0 — P0 / P1 实施记录

> 更新：2026-11-20  
> 分支：`fix/portable-stop-null-guard`  
> P0 commit：`5fd622e3`（父 `da974d7c`）  
> 结论：P0 与 P1 均已实现并通过本轮验收；P1 代码在本记录生成后提交，提交号见 `HANDOFF.md`。

## 1. 范围

P1 目标是让右侧工作台从「只有推理/画布」变成可看文件、可用内置浏览器的桌面 Agent 工作台：

- 工作区根的新增、切换、重命名、移除与可用性提示；
- 懒加载文件树、按文件名过滤、键盘导航、右键菜单、面包屑回填；
- 只读文件预览：文本/代码、Markdown、图片、PDF、二进制元信息、HTML 源码；
- 多文件 tab、关闭当前 tab 后自动落到相邻 tab；
- 内置浏览器（`WebContentsView`）：地址栏、后退/前进/刷新/停止、外部打开、清除数据；
- 拖拽调宽、双击最大化、`Ctrl/⌘+Shift+P` 命令面板；
- Web 端明确降级：文件与浏览器入口不出现，不留下点了没反应的按钮。

P1 明确不做：编辑器/保存、变更/diff、终端、Git 写操作、浏览器多 tab、HTML 注入主 React DOM、完整 IDE 布局。

## 2. 文件与职责

### 后端

- `bun-backend/src/services/workspace-store.ts`：根列表持久化、新增/移除/重命名、最近使用排序；最多 64 个根。
- `bun-backend/src/services/workspace-fs.ts`：路径解析与读取；拒绝绝对路径、盘符、UNC、`..`、NUL、ADS、symlink/junction；文本 2 MiB、图片/PDF 50 MiB、目录条目 2000。
- `bun-backend/src/routes/workspace.ts`：`roots` / `tree` / `file` / `blob` 只读接口，PATCH 改名，错误码映射。
- `bun-backend/src/routes/files.ts`：无桌面 bridge 时返回 `501 desktop_required`，不再静默 `{path:null}`。
- `bun-backend/src/routes/capabilities.ts`：`features.workbench.browser` 为桌面可用；files 只读、桌面专属。

### 前端

- `web/src/components/workbench/WorkbenchHost.tsx`：四个 tab、拖拽调宽、最大化、命令面板、窄窗整宽覆盖；打开浮层或切 tab 时隐藏 native view。
- `FilesPane.tsx`：根管理、刷新/忽略项、38% 树 + 预览、右键菜单、复制相对路径、资源管理器定位、加入当前会话引用；根切换 epoch 防止旧异步回写泄漏 blob。
- `FileTree.tsx`：懒加载一层、目录优先、过滤、键盘、右键、`revealPath` 展开祖先。
- `fileTreeModel.ts`：展开/过滤/键盘/面包屑的纯函数，供单测直接覆盖。
- `FilePreview.tsx`：多 tab、行号、自研轻量 token 高亮、Markdown 安全渲染、图片/PDF blob、HTML 仅源码、面包屑。
- `BrowserPane.tsx`：地址栏、工具栏、错误条、DOM bounds 同步、缩放换算、native view 隐藏。
- `web/src/stores/workbench.ts`：v2 存储键、v1 迁移、宽度 320–860 夹紧。
- `web/src/api/workspace.ts`：工作区 API 从 `api/index.ts` 拆出，主 API 文件回到体量基线内。

### 桌面

- `desktop/electron/browser-view.cjs`：独立 `persist:maxma-browser` 会话、`WebContentsView`、IPC、导航历史状态推送、安全策略。
- `desktop/electron/path-actions.cjs`：`openPath` 只允许存在的普通 `.html/.htm` 文件，避免变成任意可执行文件启动器。
- `desktop/electron/main.cjs` / `preload.cjs`：原生选择器、在资源管理器显示、窄接口 bridge。
- `scripts/_ui-workbench-driver.cjs` / `verify-ui-workbench.mjs`：真实 Electron UI 全流程驱动与三场景截图。

## 3. 关键实现细节

### 3.1 文件树与预览

- 目录第一次展开才请求，避免一次性递归整棵工作区；
- 面包屑目录段点击后，`revealPath` 展开祖先并聚焦目标；
- 关闭 tab 后由副作用收敛 activePath，快速连点不会因渲染期 `tabs` 闭包互相覆盖；
- HTML 不进入主 React DOM：只展示源码，另有受守卫的「用系统浏览器打开」；
- 图片/PDF 走 blob，卸载/关 tab 时 `revokeObjectURL`。

### 3.2 内置浏览器

- 浏览器视图只允许 http(s) 与 `about:blank`；`will-navigate`、`will-redirect`、`window.open` 全部校验，外部打开仅 http(s)；
- 权限请求全部拒绝，`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；
- bounds 从 React 占位 div 取，ResizeObserver + window resize 同步，主进程按 `getZoomFactor()` 换算 DIP；125%/150% 实测误差 ≤3px；
- 后退/刷新后历史标志可能在 `did-navigate` 时尚未更新，控制器延迟 80ms 再补发一次状态，修复「前进按钮长期 disabled」；
- 命令面板、切 tab、卸载时 `hide()` native view，避免盖住 UI。

### 3.3 窄窗

窗口宽度小于 1000px 时，工作台不再挤占聊天区，而是覆盖聊天区整宽显示（侧边栏保留），隐藏拖拽分隔条与最大化按钮；关闭后回到完整对话。这样 768×900 下不再出现欢迎卡文字竖排，也没有横向溢出。

## 4. 验收证据

### 4.1 自动化

| 项 | 结果 |
| --- | --- |
| 后端全量 | `341 pass / 0 fail`，53 文件，2239 expect，49.99s |
| 前端单测 | `62 pass / 0 fail`，9 文件，791 expect |
| 前端 typecheck | 通过 |
| ESLint | 通过，0 error |
| 前端构建 | 通过，7.78s |
| 间距/字号/硬编码颜色守卫 | 通过 |
| 文件体量棘轮 | `api/index.ts` 已回到 1090 行（基线 1095）；仅剩贴纸 `service.ts` 854 行的历史越界 |
| 类型债闸门 | 仅剩贴纸模块历史错误（`stickers.ts` / `market.ts` / `service.ts`），P1 新增文件无错误 |

### 4.2 Electron UI smoke

`./bun-sidecar/bun.exe scripts/verify-ui-workbench.mjs` 通过，关键断言：

- 懒加载树、面包屑、HTML 打开守卫、多 tab、关 tab、过滤、忽略项、改名、HTML 源码、二进制、图片预览；
- 拖拽 380→404、最大化 `aside=parent=1042`、还原宽度 404；
- 浏览器加载 `http://127.0.0.1:8137/api/health`、前进/后退/刷新、外部打开、125%/150% bounds 对齐；
- 命令面板与切 tab 隐藏 native view；768×900 整宽覆盖、`scrollWidth=754=clientWidth`；
- 浅色 `flexoki-light` 恢复；Web 模式 tab 仅 `推理 / 画布`；
- `consoleErrors=[]`。

截图（均 1280×900 或 768×900 真实窗口）：

- `dev_docs/visual/workbench-p1-files.png`
- `dev_docs/visual/workbench-p1-files-light.png`
- `dev_docs/visual/workbench-p1-maximized.png`
- `dev_docs/visual/workbench-p1-browser.png`
- `dev_docs/visual/workbench-p1-browser-page.png`
- `dev_docs/visual/workbench-p1-narrow.png`

### 4.3 便携包

| 包 | 体积 | SHA-256 | 验证 |
| --- | --- | --- | --- |
| `dist/electron-portable/MaxmaHere-2.7.0-portable-x64.zip` | 245,888,830 B | `fe7aad61732671d8915427b39c46f22218ca22d14c52fba56f4d9474a8d2edf4` | `verify-desktop-render.ps1`: 后端监听、渲染 WS、主进程存活、残留 0 |
| `dist/web-portable/MaxmaHere-Portable-2.7.0.zip` | 83,281,980 B | `78d9ab65e77af2a2742c9386803c071a85b2bdcb5cdd313449353d84ced1a7c2` | `portable-smoke-test.ps1`: 启动/health/插件/免费模型/328 表情/图片 200/管理 401 |

Web 包明确降级：没有 preload 时不显示文件/浏览器 tab；UI smoke 的 `webTabs=["推理","画布"]` 是直接证据。

## 5. 已知边界

- 原生系统文件对话框尚未人工点击；自动化通过 preload 测试钩子/驱动 IPC 返回固定路径，真实对话框仍需一次人工验收。
- `clear-data` 依赖 `window.confirm`，未自动化点击；浏览器错误条保留到下一次主动导航。
- 125%/150% 通过 `webContents.setZoomFactor` 验证 bounds 换算；真实 Windows 显示缩放仍需在 125%/150% 系统 DPI 下人工抽查一次。
- `openPath` 仅允许 `.html/.htm`；若 P2 需要打开更多类型，必须重新评审。
- `check-file-size-budget` / `check-type-budget` 仍会因贴纸模块历史债务报红；这两项不是 P1 新增，未顺手重构贴纸服务。
