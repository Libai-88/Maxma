# Workbench 2.0 — P0 实施记录

> 更新：2026-11-20。本文只写**已经落地**的 P0；P1/P2/P3 仍是计划，不把计划当能力。
> 方案来源：会话计划 `38454337536412162_1795159740478_plan`；架构总览见
> [`docs/00-当前架构.md`](../docs/00-当前架构.md)。

## 1. 已交付范围

对话页右侧工作台从旧 `WorkbenchSidebar` 换成 `WorkbenchHost`，注册三类 Pane：

| Pane | 状态 | 说明 |
| --- | --- | --- |
| 推理 | 保留 | 旧时间线行为不变 |
| 画布 | 保留 | 旧卡片/artifact action 行为不变 |
| 文件 | P0 新增 | 只读：选根、切根、单层浏览、返回上级、刷新、文本/图片/PDF 预览 |

**明确未交付**：浏览器、编辑器、变更/diff、终端、任务面板、Git。能力清单里这些项全部
`enabled:false`，分别标 `phase1`/`phase2`；UI 不渲染对应 tab，避免“按钮存在但点了无事发生”。

## 2. 前端契约

- `WorkbenchTab = reasoning | canvas | files | browser`；`changes/terminal/tasks` 留到 P2。
- 持久化键 `maxmahere.workbench-ui.v2`；旧键 `maxmahere.canvas-ui-state.v1` 只读兼容，
  未知 tab 回退 `reasoning`。
- 纯 Web 形态（`window.maxmaDesktop` 不存在）不渲染「文件」tab。文件面板依赖原生
  文件夹选择器，不能把 Web 端做成半死入口。
- `FilesPane` 只读：不做编辑、保存、删除、拖拽上传。文本预览限 2 MiB，
  图片/PDF 限 50 MiB；目录一层最多 2000 项，默认隐藏 `.git/node_modules/dist` 等。

## 3. 桌面 IPC

`desktop/electron/preload.cjs` 通过 `contextBridge` 只暴露：

```ts
window.maxmaDesktop.pickPath('file' | 'folder') => Promise<{ path: string } | { canceled: true }>
window.maxmaDesktop.revealPath(path: string) => Promise<void>
```

主进程约束：

- `contextIsolation:true`、`sandbox:true`、`nodeIntegration:false`；
- `maxma:pick-path` / `maxma:reveal-path` 校验 `event.senderFrame.url` 必须属于 `appOrigin`；
- 非打包开发态设置 `MAXMA_UI_TEST_PICK_PATH` 时，picker 直接返回该路径，供 UI 自动化，
  **不用于生产**；
- 后端 `GET /api/select-file` 不再返回 `{path:null}`，改为 **501 `desktop_required`**；
  Web 端显示桌面端专属提示，不会静默成功。

## 4. 只读工作区 API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/workspace/roots` | 列出已授权根，带 `available` |
| POST | `/api/workspace/roots` | 添加根，最多 64 个；只存路径，不复制文件 |
| DELETE | `/api/workspace/roots/:id` | 移除授权，不删除磁盘目录 |
| GET | `/api/workspace/tree?root_id&path&show_ignored` | 列一层目录 |
| GET | `/api/workspace/file?root_id&path` | 读 UTF-8 文本 + SHA-256 |
| GET | `/api/workspace/blob?root_id&path` | 读图片/PDF，带 `nosniff` |

存储：`<data>/api/data/workspaces.json`，`version:1`，根 ID `wr_<16hex>`，同时保存
`path` 与 `realpath`。所有请求经过全局 Token 鉴权，并额外要求 loopback。

### 路径安全

- 拒绝绝对路径、盘符、UNC、NUL、ADS、`..`；
- 从根开始逐段 `lstat`，符号链接/junction 一律拒绝；
- 读取前跑 MaxmaBlocker：目标路径或任一祖先目录存在 `.maxma_blocker` 即拒绝；
- 文本 2 MiB、图片/PDF 50 MiB；目录条目最多 2000；
- 错误码：`PATH_INVALID`、`PATH_OUTSIDE_ROOT`、`PATH_BLOCKED`、`FILE_TOO_LARGE`、
  `BINARY_NOT_PREVIEWABLE`、`WORKSPACE_ROOT_NOT_FOUND`。

**边界**：工作区根只是文件面板的读取授权，不是 Agent 工具的全局路径白名单；Agent 的
文件访问边界仍由 `docs/security-contract.md` 描述，不因 Workbench 而放宽。

## 5. 验证证据

- `bun-backend/tests/workspace-p0.test.ts`：7 例，覆盖 roots/tree/file/blob、
  路径逃逸、symlink/junction、MaxmaBlocker、无 Token、非 loopback、删除根只撤销授权、
  select-file 501。
- backend 全量：**338 pass / 0 fail**（52 files）。
- web：**52 pass / 0 fail**；`tsc --noEmit`、production build、ESLint 通过。
- `scripts/verify-ui-workbench.mjs`：真实 Electron 窗口 + preload + 测试 IPC，
  点「文件」→ 选文件夹 → 树出现 `README.md/src/dot.png` → 点 `README.md` 读到正文；
  同一脚本的纯 Web 窗口 tab 只有「推理/画布」。截图：
  [`visual/workbench-p0.png`](visual/workbench-p0.png)。768 窄窗实测
  `scrollWidth=754 / clientWidth=754`，无横向溢出。
- 未验证：真实系统文件对话框的人工点选（UI 自动化用 `MAXMA_UI_TEST_PICK_PATH` 等价的
  IPC handler，绕过了系统弹窗）；Electron 打包/便携包冒烟。

## 6. P1 入口条件

P1 先做文件树懒加载、面包屑、多文件 tab、Markdown 安全渲染、文件引用塞回对话；
内置浏览器需要先 spike `WebContentsView`（或 `webview`）在 `sandbox:true` 下的
导航/权限/崩溃恢复，再决定是否删除 P0 的 `browser:false`。P0 不预先接一个
“看起来能打开”的浏览器壳。
