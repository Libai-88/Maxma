# Workbench 2.0 — P0 / P1 / P2 / P3 实施记录

> 更新：2026-11-21  
> 分支：`fix/portable-stop-null-guard`  
> P0 commit：`5fd622e3`；P1 commit：`bfd29b9d`；P0–P3 收口 commit：`74b4375c`
> 结论：P0–P3 已交付；2026-11-21 追加“架构收口 + Agent 真实调用取证 + CDP 原生操控”，不再以“入口存在”代替可调用证据。

## 1. 范围

Workbench 2.0 把右侧工作台从「只有推理/画布」扩成桌面 Agent 工作台：

- 工作区根的新增、切换、重命名、移除与可用性提示；
- 懒加载文件树、按文件名过滤、递归文件名搜索、键盘导航、右键菜单、面包屑回填；
- 多文件 tab、行号与语法高亮预览、文本/Markdown/图片/PDF/二进制/HTML 源码；
- CodeMirror 6 编辑器：`Ctrl+S` 保存、`Ctrl+F` 查找、dirty 标记、`base_hash` 冲突保护；
- 变更/diff：分支/HEAD、工作区与暂存 diff、按文件审阅；
- 命令运行器：无 TTY、cwd 锁工作区根、超时杀进程树、输出截断；
- 任务/计划 Pane：只投影 goal/task_tracker/planCard，不新增第二套状态；
- 内置浏览器（`WebContentsView`）：地址栏、前进/后退/刷新/停止、外部打开、清除数据；
- 浏览器 Agent 控制：open/snapshot/extract/screenshot/scroll/back/forward/act/console，UI 未打开时也可隐藏执行；`browser_act` 走 Chromium CDP 真实鼠标/键盘/拖拽/文件上传，不用 `element.click()` 模拟；
- Pane 注册表单源：tab 顺序、中文名、桥依赖、布局策略与组件加载器只声明一次；已访问 Pane 按会话保活，关闭工作台只隐藏不卸载；
- 每个 Pane 独立错误边界：单个面板崩溃不拖黑对话或其他面板；
- 并行会话 tab（最多 3 个）与每个会话独立工作台状态；
- 截图标注（矩形/箭头/文字/撤销/清空）与网页元素拾取，结果回填输入框；
- Git 写操作：stage/unstage/commit，commit 必须显式确认，不 push；
- 拖拽调宽、双击最大化、`Ctrl/⌘+P` 命令面板；
- Web 端明确降级：文件与浏览器入口不出现，不留下点了没反应的按钮。

本轮范围外（不是待办）：Side chat、系统通知、PR 创建、浏览器网络 allowlist、多 tab 浏览器页签、文件上传/下载、P4（远程/移动、多窗口、computer use、Chrome cookie 导入、Office 深度预览、自动更新/签名、完整 IDE）。

## 2. 文件与职责

### 后端

- `bun-backend/src/services/workspace-store.ts`：根列表持久化、新增/移除/重命名、最近使用排序；最多 64 个根。
- `bun-backend/src/services/workspace-fs.ts`：路径解析与读取；拒绝绝对路径、盘符、UNC、`..`、NUL、ADS、symlink/junction；文本 2 MiB、图片/PDF 50 MiB、目录条目 2000。
- `bun-backend/src/routes/workspace.ts`：`roots` / `tree` / `file` / `blob` 只读接口，PATCH 改名，错误码映射。
- `bun-backend/src/routes/files.ts`：无桌面 bridge 时返回 `501 desktop_required`，不再静默 `{path:null}`。
- `bun-backend/src/routes/capabilities.ts`：能力清单描述 `files readwrite`、`editor codemirror`、`terminal command-runner-only`、`git` 按 `Bun.which("git")`、`browser agent_control`；它是**描述层**，渲染层可执行事实源仍是 preload bridge。
- `web/src/components/workbench/WorkbenchHost.tsx`：Pane 布局、拖拽调宽、最大化、命令面板、窄窗整宽覆盖；按注册表把 Pane 映射成懒加载组件，不写 tab 专属分支。
- `web/src/components/workbench/panes.ts`：tab 顺序/中文名/desktop-browser 依赖/布局类名/组件加载器的唯一声明。
- `web/src/components/workbench/paneProps.ts`：所有 Pane 的统一上下文，宿主与 Pane 之间不互相认识。
- `web/src/components/workbench/{ReasoningPane,CanvasPane}.tsx`：原先内联在宿主的两个 Pane 抽成独立模块。
- `web/src/components/workbench/WorkbenchPaneShell.tsx`：Pane 保活外壳 + 独立错误边界；非当前 Pane 只 `hidden`，不卸载。
- `FilesPane.tsx`：根管理、刷新/忽略项、38% 树 + 预览、右键菜单、复制相对路径、资源管理器定位、加入当前会话引用；根切换 epoch 防止旧异步回写泄漏 blob。
- `FileTree.tsx`：懒加载一层、目录优先、过滤、键盘、右键、`revealPath` 展开祖先。
- `fileTreeModel.ts`：展开/过滤/键盘/面包屑的纯函数，供单测直接覆盖。
- `FilePreview.tsx`：多 tab、行号、自研轻量 token 高亮、Markdown 安全渲染、图片/PDF blob、HTML 仅源码、面包屑。
- `BrowserPane.tsx`：地址栏、工具栏、错误条、DOM bounds 同步、缩放换算；`active=false` 时隐藏 native view，保活但不悬浮。
- `web/src/stores/workbench.ts`：v2 存储键、v1 迁移、宽度 320–860 夹紧。
- `web/src/api/workspace.ts`：工作区 API 从 `api/index.ts` 拆出，主 API 文件回到体量基线内。

### 桌面

- `desktop/electron/browser-view.cjs`：独立 `persist:maxma-browser` 会话、`WebContentsView`、IPC、导航历史状态推送、安全策略。
- `desktop/electron/path-actions.cjs`：`openPath` 只允许存在的普通 `.html/.htm` 文件，避免变成任意可执行文件启动器。
- `desktop/electron/main.cjs` / `preload.cjs`：原生选择器、在资源管理器显示、窄接口 bridge。
- `scripts/_ui-workbench-driver.cjs` / `verify-ui-workbench.mjs`：真实 Electron UI 全流程驱动与三场景截图。

### P2 / P3 新增文件

- 后端：`services/git-service.ts`（全部 async `spawn`，12s/commit 20s 超时，输出上限 8 MiB）、`routes/git.ts`（status/diff/stage/unstage/commit）、`services/command-runner.ts`、`workspace-fs.ts` 的 `writeTextFile`/`searchWorkspaceFiles`、`routes/workspace.ts` 的 `PUT /file`/`GET /search`/`POST /run`。
- 前端：`workbench/FileEditor.tsx`（CodeMirror 6，`React.lazy` 拆包）、`ChangesPane.tsx`、`CommandPane.tsx`、`TasksPane.tsx` + `tasksModel.ts`、`ScreenshotAnnotator.tsx`；`BrowserPane.tsx` 增加截图/元素拾取；`chat/SessionTabs.tsx` + `stores/sessionTabs.ts`；`ChatInput.tsx` 接收截图与元素回填。
- 侧边车：`tools/browser.ts`（`browser_navigate` / `browser_read` / `browser_act`），`kernel/tools.ts`、`pi-contract.ts` 登记；`web/src/components/tools/_shared/displayNames.ts` 同步中文名。
- 桌面：`browser-agent-server.cjs`（loopback + 每次启动随机 secret + 0600 配置 + 动作白名单 + request_id 去重）、`browser-cdp.cjs`（AX 快照 / 原生输入）、`browser-view.cjs` 的 `agentExecute`/`captureData`/`pickElement`。
- 测试：`bun-backend/tests/{workspace-p0,browser-agent,browser-cdp,browser-tools}.test.ts`、`web/tests/{sessionTabs,tasksModel,workbenchPanes}.test.ts`、`web/tests/fileTreeModel.test.ts` 的搜索/树投影；`scripts/_browser-tool-smoke.mjs` 走真实工具端到端。

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

### 3.4 编辑器与保存

- 编辑器只在文本文件上出现；CodeMirror 6 懒加载，ChatView 主包保持约 284 kB。
- 保存走 `PUT /api/workspace/file`，请求带 `base_hash`；不一致返回 `409 FILE_CONFLICT`，前端提示重新加载，不静默覆盖。
- 写入先把内容写同目录临时文件（`wx` 独占），再 `rename` 替换目标；临时文件失败会清理。
- 保存或重新加载成功后只更新对应文件行的 size/mtime（`statPatch`），不整树重载，也不丢失已展开目录。
- 关闭 dirty tab 必须二次确认；`Ctrl+S` 保存、`Ctrl+F` 查找。

### 3.5 变更/diff 与 Git 写

- `git status --porcelain=v2` 解析分支、HEAD、ahead/behind 与逐文件状态；diff 分离工作区与暂存。
- 所有 Git 调用改为异步 `spawn`，避免 Bun `spawnSync` 在高负载下 `ETIMEDOUT`；超时杀进程并返回结构化错误。
- stage/unstage 只接受工作区相对路径，并加 `:(literal)` 前缀防止 pathspec 通配；commit 必须 `confirm:true`，不 push。
- UI 无 discard 按钮：回滚方式为提交前 `git reset` 或提交后 `git revert`；文档明确写清，不假装有撤销。

### 3.6 命令运行器

- 不叫“终端”：无 TTY、无交互，明确是命令运行器。
- 默认关闭，用户首次启用需确认；cwd 固定为当前工作区根，渲染层不能传任意 cwd。
- 默认 60s、上限 120s；超时杀进程树；输出上限 1 MiB，超出标记 `truncated`；返回 `stdout/stderr/exitCode/signal/timedOut/durationMs`。

### 3.7 浏览器 Agent 控制与 CDP 原生操控

- `browser-agent-server.cjs` 只监听 `127.0.0.1`，每次启动生成 32-byte hex secret，配置写 `0600`；请求必须带 `x-maxma-browser-secret`。
- 端点层与控制器双层动作白名单：open/snapshot/extract/screenshot/scroll/back/forward/act/console；未知动作返回 400，不再出现“服务端声称白名单、实际只靠控制器”的伪边界。
- 工具调用生成 `request_id`；服务端 60 秒内对同 id 返回同一 Promise/结果，最多缓存 200 条，避免网络重试造成第二次点击。超时返回 `outcome_unknown` 并带 request_id，明确要求先 snapshot 复核、不得自动重试。
- `browser-cdp.cjs` 用 `webContents.debugger` 接 Chromium DevTools Protocol：
  - `Accessibility.getFullAXTree` 生成 `ref → backendDOMNodeId` 映射，只保留可操作/可聚焦节点，最多 120 个；ref 只在当前快照有效，失效后明确报错；快照同时返回页面 `viewport`（宽高与滚动位置），供视觉定位；
  - `DOM.getBoxModel` 取元素中心，`Input.dispatchMouseEvent` 发真实鼠标按下/释放；`click` 既支持 ref/selector，也支持 `x/y` 视口坐标（截图视觉定位），不依赖元素句柄；
  - `drag` 从 ref/坐标拖到另一个 ref/坐标，真实 `mousePressed → N 次 mouseMoved → mouseReleased`，默认 20 步；
  - `DOM.setFileInputFiles` 把本机绝对路径写入真实 `input[type=file]`，最多 10 个、单文件 ≤512 MiB，拒绝相对路径、目录、NUL 与不存在文件；
  - `Input.dispatchKeyEvent` / `Input.insertText` 发真实按键与文本输入；支持 Enter/Tab/Esc/方向键/Backspace、`Control+A` 等组合键；
  - 支持 click / fill / type / press / hover / select / check / uncheck / drag / upload / scrollIntoView / wait / evaluate；`select` 通过 DOM 属性 + `input/change` 事件，因为原生 select 没有稳定的纯键盘路径；`wait` 可等 selector、正文文本或固定时长；
  - `Runtime.consoleAPICalled`、`exceptionThrown`、`Log.entryAdded` 进环形缓冲，`browser_read console` 可取页面日志和最近异常。
- 工具侧 `browser_navigate`（write）、`browser_read`（read）、`browser_act`（write）注册进 kernel 契约与 pi 会话活动工具表；`browser_act` 走审批门，不是只读工具。
- 不做 DOM `element.click()` 冒充：真实输入测试断言页面状态变化（`Hello Maxma b yes`）、`Enter Maxma` 键盘事件、坐标点击、20 步拖拽（`Drag 20,20 -> 180,80`）、原生文件上传（`File browser-upload.txt`）、`console.log` 回读、失效 ref 拒绝。
- 仍属范围外：浏览器网络 allowlist、多页签、下载落盘策略；`request_id` 去重是服务端 60 秒内存缓存，进程重启不保留。见 §5。

### 3.8 并行会话与截图标注

- `MAX_SESSION_TABS=3`；`maxmahere.session-tabs.v1` 只持久化会话 id，不存消息。
- `useChat` 切换会话不再主动断开 WS；每个组件实例记录本次访问过的 session，卸载时才断开，避免后台流式被切 tab 打断。
- 截图标注画布支持矩形、箭头、文字、颜色、撤销、清空、Esc 关闭；保存为 PNG 后通过 `maxma:add-image-ref` 回填当前会话输入框。
- 元素拾取返回 DOM 路径、bbox 与样式摘要，通过 `maxma:append-composer` 回填；两个事件都按 `sessionId` 严格过滤，不串会话。

### 3.9 Workbench 架构收口（2026-11-21）

**结论：左右两层职责分离，不是两套并列导航。** 左侧 `Sidebar` 是全局路由（对话/模型/记忆/工具/设置等），不承载会话级工作台；右侧 `WorkbenchHost` 是当前会话的上下文工作台，按会话保存 active tab，最多三个并行会话各自独立。两者不做合并，也不把全局路由塞进 Workbench tab。

**Pane 注册表是唯一入口。** `panes.ts` 声明七类 Pane 的顺序、中文名、桥依赖、布局类名、保活策略与组件加载器；`WorkbenchHost` 只按注册表映射成 `React.lazy` 组件，不再写 `activeTab === ...` 或 tab 专属 padding 分支。首次访问才加载 Pane，CodeMirror/浏览器面板不挤进 ChatView 首屏 chunk：ChatView 由 286.73 kB 降到 217.24 kB，文件/浏览器/变更/命令/任务/画布/推理各自独立 chunk；已访问集合按 `sessionId` 分开，换会话不会把上一个会话的 Pane 状态串过来。纯 Web 形态由 `availableWorkbenchTabs({desktop:false,browser:false})` 直接得出「推理/画布/任务」，不出现文件/变更/命令/浏览器死入口。

**桥是运行时事实源。** `window.maxmaDesktop.pickPath` 与 `window.maxmaDesktop.browser` 是渲染层真正能执行的事实；后端 `/api/capabilities` 是描述层，给设置/诊断看，不反过来替 preload 造入口。两者不一致时以 preload 为准，避免“清单说有、点了没反应”。

**保活与错误隔离。** 已访问 Pane 只增不减地挂载：切到浏览器再切回文件，CodeMirror 未保存草稿、命令输出、文件树展开状态都在；关闭工作台仅给 `aside` 加 `hidden`，不卸载，重开即恢复。`BrowserPane` 新增 `active` 门：工作台关闭或切走时原生 `WebContentsView` 立即 `hide()`，不会隔着 `display:none` 悬浮在界面上。每个 Pane 独立错误边界，单个面板异常只降级自己。

**保活回归证据。** 真实 Electron 驱动输入 `<!--maxma-keepalive-->` 草稿 → 关闭工作台（断言 `aside.hidden`）→ 重开 → 草稿仍在 → 保存落盘；`paneKeepAlive={draftPreserved:true,closedHidden:true,saved:true}`。

## 4. 验收证据

### 4.1 自动化

| 项 | 结果 |
| --- | --- |
| 后端全量 | `360 pass / 0 fail`，56 文件，2345 expect，54.91s |
| sidecar 全量 | `234 pass / 0 fail`，25 文件，1038 expect，17.74s |
| 前端单测 | `74 pass / 0 fail`，12 文件，841 expect；Pane 注册表 6 例 |
| 前端 typecheck | 通过 |
| ESLint | 通过，0 error |
| 前端构建 | 通过，9.76s；ChatView 217.24 kB（Pane 懒加载拆分后较 286.73 kB 下降 69.49 kB）；文件/浏览器/变更/命令/任务/画布/推理各自独立 chunk；FileEditor 仍为 662.32 kB 懒加载 chunk |
| 颜色/间距/字号/对比度/无紫/玻璃层数守卫 | 全部通过 |
| 文件体量棘轮 | 通过；贴纸 `service.ts` 由 854 行拆为 748 行 + `legacy.ts`，类型债归零 |
| 类型债闸门 | sidecar 0、backend 0 |
| 根闸门 | `scripts/verify-all-gates.sh` 全绿（18 项 PASS） |

### 4.2 Electron UI smoke

`./bun-sidecar/bun.exe scripts/verify-ui-workbench.mjs` 通过，关键断言：

- 懒加载树、面包屑、HTML 打开守卫、多 tab、关 tab、过滤、忽略项、改名、HTML 源码、二进制、图片预览；
- 递归搜索：输入 `main` 显示 `main.ts · src`，保存后文件树 size 从 49 B 同步到 75 B；
- CodeMirror 编辑 README 并保存，磁盘内容变化；变更面板显示 `src/main.ts` 与 README，diff 含 `+<!--maxma-editor-smoke-->`；
- 命令运行器启用后 `echo maxma-command-ok` exit 0 / 74 ms；Git 暂存、提交信息 `UI acceptance commit`，`git log -1` 与 `git status --porcelain` 证明只本地提交；
- 浏览器加载 `http://127.0.0.1:8137/api/health`、前进/后退/刷新、外部打开、125%/150% bounds 对齐；
- 浏览器 Agent 隐藏打开 `visible=false`、snapshot 734 字符、screenshot 88,929 B、未知动作 `rm-rf` 被端点 400 拒绝；
- 真实工具端到端（独立 bun 进程、实际 `browser_navigate/browser_read/browser_act`）：
  - `snapshot` 得到 textbox/combobox/button/checkbox/option 共 7 个可操作元素（RootWebArea 不计）；
  - `fill` 输入 Maxma 后 `press Enter` 触发 `Enter Maxma`；
  - `select` 选中 `b`、`check` 勾选成功；
  - `click` 原生坐标 `(110,129)` 命中按钮，页面变 `Hello Maxma b yes`；再用同一坐标走 `x/y` 视觉定位点击，`coordinates=true`；
  - `drag` 从 `(28,244)` 拖到 `(188,304)`，20 步真实鼠标移动，页面记录 `Drag 20,20 -> 180,80`；
  - `upload` 把本机 `browser-upload.txt` 写入 `input[type=file]`，页面显示 `File browser-upload.txt`；
  - `wait` 用正文文本等待成功；`scrollIntoView` 返回元素几何坐标；
  - `evaluate` 读回同一文本，`console` 读到 `maxma-greeted`；
  - 失效 ref `e999` 明确返回“已失效，请重新 snapshot”；
- 架构保活：未保存草稿在关闭工作台并重开后仍在，保存后落盘 `maxma-keepalive`；
- 截图标注 Esc 关闭、重新打开后矩形 checksum `2563510462→1129061470`、文字再变到 `2099209095`、撤销栈生效、加入对话提示出现；元素拾取点中页面 `pre` 并回填 `引用网页元素：#note`；
- 并行会话：新建后旧 tab 保留，切回后两张 tab 都在，`max=2`；切换期间旧 session 未被主动断开；
- 命令面板与切 tab 隐藏 native view；768×900 整宽覆盖、`scrollWidth=754=clientWidth`；
- 浅色 `flexoki-light` 恢复；Web 模式 tab 仅 `推理 / 画布 / 任务`；
- `consoleErrors=[]`；2 条 `ResizeObserver loop completed with undelivered notifications` 记为良性忽略警告。

截图（均 1280×900 或 768×900 真实窗口）：

- `dev_docs/visual/workbench-p1-files.png`
- `dev_docs/visual/workbench-p1-files-light.png`
- `dev_docs/visual/workbench-p1-maximized.png`
- `dev_docs/visual/workbench-p1-browser.png`
- `dev_docs/visual/workbench-p1-browser-page.png`
- `dev_docs/visual/workbench-p1-narrow.png`
- `dev_docs/visual/workbench-p2-editor.png`
- `dev_docs/visual/workbench-p2-commands.png`
- `dev_docs/visual/workbench-p2-changes.png`
- `dev_docs/visual/workbench-p3-tasks.png`
- `dev_docs/visual/workbench-p3-annotate.png`

### 4.3 便携包

| 包 | 体积 | SHA-256 | 验证 |
| --- | --- | --- | --- |
| `dist/electron-portable/MaxmaHere-2.7.0-portable-x64.zip` | 252,479,795 B | `a51c62289173fc57a940783841cc98281740ae90261273ca05c7766c91371382` | `verify-desktop-render.ps1`: 后端监听、渲染 WS、主进程存活、残留 0 |
| `dist/web-portable/MaxmaHere-Portable-2.7.0.zip` | 83,535,555 B | `bd870d5514359b2ee9e2fa61f601cdcd73dcc3d6c9a8e7a4b8ebc4734ea66b53` | `portable-smoke-test.ps1`: 启动/health/插件/免费模型/328 表情/图片 200/管理 401 |

Web 包明确降级：没有 preload 时不显示文件/变更/命令/浏览器 tab；UI smoke 的 `webTabs=["推理","画布","任务"]` 是直接证据。压缩包含 2,872 个条目，`.maxma/skills/coding-starter/SKILL.md` 与 `web/dist/index.html` 均在包内。

## 5. 已知边界（范围外，不是待办）

- **真实系统文件对话框**：自动化通过 `maxma:pick-path` 测试钩子返回固定路径；真实 Windows 对话框的人工点选不在本轮自动化范围。系统交互本身由 Electron 原生 API 提供，未改动其行为。
- **系统级 DPI**：125%/150% 通过 `webContents.setZoomFactor` 做等价 bounds 校验；真实 Windows 显示缩放的人工抽查属于发布前设备验收，不是代码缺口。
- **浏览器网络 allowlist**：未实现，已在 `docs/security-contract.md` 披露；浏览器与普通浏览器一致可访问任意 http(s)。
- **浏览器页签/文件上传下载**：当前是单 view 单页面；多页签、上传文件、下载保存不在本轮。
- **CDP 元素 ref 生命周期**：ref 只在最近一次 snapshot 内有效；页面结构变化后必须重新 snapshot，这是有意的安全/正确性边界，不是“ref 会永久记住节点”。
- **浏览器高风险动作**：点击/输入/提交已开放并走 write 审批，但没有支付/密码等业务级二次确认；涉及真实账户操作仍由用户审批门与页面自身确认共同约束。
- **Git discard**：UI 不提供 discard；回滚说明为提交前 `git reset` / 提交后 `git revert`，不是按钮缺口。
- **终端**：本轮按计划允许降级为无 TTY 命令运行器，UI 与文档都不称其为终端。
- **Side chat / 系统通知**：范围外，需独立临时会话设计与通知权限/回跳策略。
- **并行会话后台流**：已验证切 tab 不主动断 WS、旧 tab 保留、三 tab 上限；真实模型长时间流式跨 tab 的弱网/重连矩阵属于后续稳定性测试，不是功能未实现。
