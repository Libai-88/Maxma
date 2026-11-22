# Cowork M3 阶段报告：上下文、项目与自动化

日期：2026-11-22
分支：`main`
提交：`4425ecd6`（M3-A 文档索引）、`31c1bbd6`（M3-B/C/D + UI）

## 出口验收结论

| 出口条件 | 结果 | 证据 |
|---|---|---|
| 一个项目里 5 篇 PDF 可搜 | 通过 | `doc-index.db`：5 文件 / 10 块 / 0 未识别；`marker-page-4` 命中 `paper-4.pdf` 第 2 页，snippet 含 `40 W/mK` |
| 任务能引用页码 | 通过 | 工具 `doc_search` / `doc_read` 返回 `{page, part?}` locator；任务输入可带项目资产；前端显示“第 2 页” |
| 周报任务可设每周一 9 点 | 通过 | schedule `2ab8b378-c47c-46c1-bbc1-9def7136aced`，cron `0 9 * * 1`，`Asia/Shanghai`，UI 显示下次 `2026/11/23 09:00` |
| 应用重启后补跑/跳过符合策略 | 通过 | 48h 过期后重启，`last_status=skipped_missed`，事件 `cowork.schedule.skipped`，payload `reason=missed_over_24h` |
| 项目记忆可查 | 通过 | 项目记忆按 `cowork-<projectId>` 隔离；设置 tab 可搜索命中；验收弹层确认后写入 |
| 连接器未配置诚实显示 | 通过 | 4 个连接器：local-folder/project-assets/web 已连接，mcp 未配置；3 条只读 MCP 配方 |
| 通知可关闭、不重复轰炸 | 代码与单测通过 | Electron `maxma:notify`、5 分钟窗口、事件 id 去重、前台抑制；真实 Electron 弹窗未在本轮人工点验 |

## 交付内容

### C3.1 文档索引（M3-A，已独立提交）

- `bun-sidecar/src/docintel/{store,extract,index,search}.ts`
- 独立 FTS5 库 `<data>/api/data/doc-index.db`，`MAXMA_DOC_INDEX_DB` 可覆盖
- PDF 按页抽取（`unpdf@2.2.1`），页内约 1200 字切块，locator `{page, part?}`
- DOCX/XLSX 解 OOXML；MD/TXT/HTML 按行
- 中文索引把 CJK 拆单字 token，查询折成 FTS 相邻短语
- 工具 `doc_search` / `doc_read`，REST `/api/doc-index/{status,build,cancel,search}`
- 限制：单文件 20MB、单根 20k 文件、PDF 2000 页；无文本层 PDF 返回 `unsupported`

### C3.2 项目 / 资产

- DB v12：`cowork_projects`、`cowork_project_assets`
- 项目工作区根约束：任务 `workspace_root` 必须位于项目根内
- 资产只接受绝对路径、存在、文件、≤2GB，realpath 后必须位于项目 roots 或项目资产目录
- 资产重复 409；加入任务只允许 draft，最多 50 个、按 path 去重
- 项目事件单独写 `<data>/cowork/projects/<id>/events.jsonl`
- 项目指令/模板写入 `inputs.project`，由 prompt 注入；项目资产只读注入

### C3.3 定时任务

- `cowork-cron.ts`：5 字段 cron、标准 OR 语义、IANA 时区校验、最多扫 366 天、4 个预设
- `cowork-scheduler.ts`：30 秒循环、启动即 tick、活动上限 20
- 错过策略：`skip` 超过 24h 跳过；`run_once` 只补一次；任务活动中记 `skipped_overlap`
- 失败写 `last_error`；事件 `cowork.schedule.created/removed/triggered/skipped/failed`
- 允许 completed 任务重新启动，供重复定时使用

### C3.4 记忆

- `cowork-project-memory.ts`：key `cowork-<projectId>`，按项目隔离，强制 `confirmed=true`
- 任务验收弹层默认摘要 `标题：目标`，用户勾选后才写项目记忆

### C3.5 连接器

- `connector-registry.ts`：local-folder / project-assets / web / mcp
- 未配置显示 `unconfigured`，不伪装已连接
- 只读；写入默认走审批
- `docs/connectors/mcp-recipes/{feishu,mail,calendar}.md`

### C3.6 通知 / 活动

- Electron 主进程 `maxma:notify`：trusted sender、title ≤120、body ≤600、点击聚焦窗口
- `web/src/utils/coworkNotify.ts`：开关、事件 id 去重（最多 300）、只通知 5 分钟内、前台抑制
- 通知事件：`approval.requested` / `run.completed` / `run.failed` / `schedule.triggered` / `schedule.failed`
- 活动中心：跨任务活动流，类型中文化，payload `message` 提取

## 真实验收记录

环境：真实后端 `127.0.0.1:8012`，数据 `D:\Temp\maxma-m3a-data`，工作区 `D:\Temp\maxma-m3a-ws`，Vite `127.0.0.1:5199`。

1. 5 篇两页 PDF 由 Word COM 生成；索引 `fileCount=5`、`chunkCount=10`、`unsupportedCount=0`。
2. 项目 `M3 验收项目`（`0ca37d64-bd1d-48e6-9c0b-4ecb4250b2f8`），root 为 PDF 工作区，策略 `local_only`，指令要求引用写页码。
3. 资产 `paper-1.pdf`、`paper-4.pdf` 加入项目；UI“加入任务”后任务 inputs 真含 project + 指令 + 资产。
4. UI 新建任务 `5 篇 PDF 热导率汇总`（`eb5a145d-6aa3-42f8-8fc4-0c4bce981e16`），root 自动预填。
5. 定时 tab 创建每周一 9 点、上海时区、超过 24h 跳过；事件 `cowork.schedule.created`。
6. 验收弹层：任务置 review 后点“验收完成”，确认摘要后 completed，提示“任务已验收，摘要已写入项目记忆”。
7. 重启补跑：把 `next_run_at` 调到 48h 前，停后端再启动；启动 tick 后 `last_status=skipped_missed`，`next_run_at=2026-11-23T01:00:00.000Z`。
8. 文档检索 UI：文件面板显示“文档索引：5 文件 · 10 块”，`marker-page-4` 命中 `paper-4.pdf` + “第 2 页”。
9. 活动中心显示 `cowork.schedule.created`、`cowork.task.inputs.updated`、`cowork.task.created`。

截图：

- `artifacts/m3-doc-search.png`
- `artifacts/m3-project-workspace.png`
- `artifacts/m3-schedules.png`

## 自动验证

全量闸门：`artifacts/verify-all-gates-m3.log`，全部通过。

| 项目 | 结果 |
|---|---|
| sidecar bun test | 332 pass / 0 fail / 25 snapshots / 1499 expect（39 文件） |
| backend bun test | 427 pass / 0 fail / 2894 expect（71 文件） |
| web bun test | 111 pass / 0 fail / 1004 expect（17 文件） |
| sidecar tsc | 0 error |
| web tsc | 0 error |
| web eslint（changed） | 0 error（1 条既有 `FilesPane` exhaustive-deps warning） |
| web build | ✓ built in 18.29s |
| 颜色/间距/字号/玻璃/对比度/无紫 | 全部通过 |
| 类型预算棘轮 / 体量棘轮 | 通过；`cowork-store.ts` 815→拆分后 <800，`FilesPane.tsx` 814→776 |
| backend bundle | `server.js` 34.7MB，externals 23 个 |

聚焦用例：

- `cowork-m3.test.ts`：9 pass / 44 expect
- `cowork-m3-routes.test.ts`：2 pass / 28 expect
- `db-schema.test.ts`：新表断言通过
- `docintel.test.ts`：3 pass / 30 expect
- `doc-index.test.ts`：2 pass / 15 expect

## 已知限制

- 无文本层 PDF 不做 OCR，返回 `unsupported` 与扫描件警告。
- 文档检索命中只 reveal 并激活已有 tab，不自动新开 tab。
- Electron 桌面通知只做了 `node --check`，未在真实 Electron 窗口人工点验弹窗与点击聚焦；浏览器形态无 `maxmaDesktop` 桥。
- `ProjectSettingsPane` 保存设置、`ProjectSchedulesPane` 启停/删除控件未在真实 UI 点击验证（后端单测覆盖）。
- `capabilities.stage` 仍为 `m2-office`；`schedules/connectors/model_router/share` 能力位仍为 false，留给 M4/M5 收口。
- `read_office_file` 的 PDF 分支仍走系统 `pdftotext`，尚未切到 `unpdf`；`office.test.ts` 未覆盖 PDF。

## 复现 / 启动

```powershell
cd D:\Maxma\MaxmaHere
$env:MAXMA_API_PORT='8012'
bun run bun-backend/src/server.ts

cd web
$env:MAXMA_API_PORT='8012'
bun run dev -- --host 127.0.0.1 --port 5199
```

全量闸门：

```powershell
cd D:\Maxma\MaxmaHere
$env:BUN_BIN='D:\NodeGlobal\node_modules\bun\bin\bun.exe'
& 'D:\mingit\bin\bash.exe' scripts/verify-all-gates.sh
```
