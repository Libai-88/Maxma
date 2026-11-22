# Cowork M4 阶段报告：信任、模型与交付

日期：2026-11-22
分支：`main`
基线：`2bae7989`（M3）
实现提交：`73343c6c`（M4 后端 + UI + 专项测试）

## 出口验收结论

| 出口条件 | 结果 | 证据 |
|---|---|---|
| 非技术用户 0 配置完成第一条任务 | **外部阻断，未宣称通过** | UI 从模板到发送前确认全流程跑通；内置 Maxma 免费模型返回 `429 FreeUsageLimitError`，首任务未完成 |
| `local_only` 任务 0 次云端请求 | 通过 | 真实本地任务 `b518f1ac-8d30-4022-adff-324ec8074dbb` 完成；路由事件 `location=local`、`estimated_usd=0`；本地请求日志全部 `127.0.0.1:4321` |
| 所有写入可回滚 | 通过（工作区写入） | 导出前自动备份；恢复前再备份；恢复后 SHA-256 一致；删除进 `trash/`，同路径历史版本一起隐藏 |
| 交付包可发给老师/同事 | 通过 | 真实下载 `5 篇 PDF 热导率汇总-交付包.zip`：产物 + `sources.json` + `README.md`，解压内容完整 |

M4 的信任链已经闭合。唯一未闭合的是“零配置首任务”的最终完成证据，卡在上游免费额度，不是本地代码路径。

## 交付内容

### T4.1 审批中心

- `cowwork-approval-center.ts`：跨任务 `listApprovals`，返回任务、项目、操作类型、风险级别与是否可批量。
- 批量只允许 `kind=tool + risk_level=low + tool_name∈{read,grep,find,ls,doc_search,doc_read,read_office_file}`；最多 10 项，逐项重新校验。
- 计划、写入、导出、删除永远逐项确认。
- UI `CoworkApprovalCenter.tsx`：5 秒轮询待处理数；计划项跳回任务详情审阅；导出/删除展示目标文件与 TTL。

### T4.2 数据边界

- 任务级 `data_policy`：`local_only` / `cloud`；项目 `local_only` 强制覆盖任务请求，无法被 `cloud` 绕过。
- `local_only` 下模型层只允许本机渠道；显式 `MAXMA_COWORK_MODEL=cloud/...` 也拒绝。
- Cowork 工具白名单不含 `web_search` / `web_fetch`，联网路径在同一层被移除。
- UI：任务详情 badge、新建任务三档模型、项目页“仅本地模型 · 0 云端请求”、云端发送前确认弹窗。
- 预检接口只返回 `publicModelRoute`，剔除 `params`，不泄露解密后的 `api_key`。

### T4.3 模型路由与成本

- `cowwork-model.ts`：`private` / `balanced` / `quality`；长文档（资产或 prompt > 20k 字符）自动质量档。
- 本机可达优先本机；本机不可达按策略回退或明确失败；`private`/`local_only` 不偷上云。
- 成本：本机 0 USD；云端按 provider 单价估算；缺价 `estimated_usd=null`，绝不写成 0。
- 每次运行写 `cowwork.model.routed`，包含 provider/model/location/profile/reason/fallback/cost/data_policy。

### T4.4 源文件安全与恢复

- DB v13 新表 `cowwork_file_backups`；升级前 `VACUUM INTO` 备份到 `api/data/backups/maxma-before-m4-*.db`。
- 导出目标必须在任务 `workspace_root` realpath 内；同名自动 `name.vN.ext`；临时文件 + rename 原子写；写完校验 SHA-256。
- 导出前把目标字节写入任务 `file-backups/` 并登记；恢复前把当前文件再备份为 `pre_restore`。
- 删除只动 staging 真实产物，移入任务 `trash/`，DB 置 `deleted`；同路径历史版本一起隐藏；回收站不因再次删除被清空。
- 修复了本轮真实 UI 暴露的“删了还在”幽灵条目：任务详情查询过滤 `status='deleted'`。

### T4.5 交付包与首次引导

- `cowwork-package.ts`：`fflate.zipSync`；每个 path 取最新非 deleted 版本；重名 basename 加序号。
- ZIP 内 `artifacts/<name>`、`sources.json`、`README.md`，文件名 `<安全标题>-交付包.zip`。
- UI 新建任务模板 chips（整理周报/论文摘要/表格汇总）、模型预检、成本/回退原因、云端确认。
- EmptyState 三步引导：选文件夹、写目标（可套模板）、批准计划再看产物；明示不需要配置模型地址或权限文件。
- 计划审批页去掉原始 Markdown 与步骤列表的重复展示，原始计划改为可展开查看。

### T4.6 安全负例与回归

新增 `cowwork-m4.test.ts` 与 `cowwork-m4-routes.test.ts`，覆盖：

- 路径越界、目录 junction 越界、目标目录不存在；
- 同名不覆盖、备份、恢复、恢复前备份；
- 删除入回收站、历史版本隐藏、回收站保留；
- 批量白名单、计划/写入/导出拒绝批量；
- `local_only` 云端候选拒绝、显式云端拒绝、缺价 null；
- ZIP 内容、导出审批→批准→写入、模型预检不泄露密钥。

## 真实验收记录

环境：后端 `127.0.0.1:8000`，数据 `D:\Temp\maxma-m3a-data`，工作区 `D:\Temp\maxma-m3a-ws`，Vite `127.0.0.1:5199`。数据库从 v12 升 v13，迁移前备份 `maxma-before-m4-2026-11-22T15-56-29-134Z.db`。

1. 任务页显示“已完成 / 实时事件已连接 / 仅本地 · 0 云端请求”，左侧出现审批中心与活动中心。
2. 新建任务对话框展示三档模型、450ms 预检、成本/回退说明；项目内新建任务锁 `private`，平衡/质量档禁用。
3. 产物区显示“下载 / 导出 / 删除”；导出生成 `medium` 审批，批准前工作区无目标文件，批准后写入。
4. 导出文件 SHA-256 `35fa51f6316c52a2bed6835a3e5333771c66fcc961374e4f5f7d7b1bb1614af6`，与产物一致；备份 ledger `de76b4c5-...` reason=`export`。
5. 恢复后 `restored_at=2026-11-22T16:00:15.713Z`；恢复前自动生成 `pre_restore` 备份 `533d4f1e-...`。
6. 删除审批批准后 staging 文件消失，`trash/4e96d316-...-m4-验收摘要.txt` 保留 176 B；详情刷新后不再显示该产物。
7. 真实下载交付包 `5 篇 PDF 热导率汇总-交付包.zip`（1443 B）；条目：`artifacts/m4-验收摘要.txt` 176 B、`sources.json` 587 B、`README.md` 689 B。
8. 本地闭环：注册仅监听 `127.0.0.1:4321` 的本地模型桩；项目内创建 `M4 本地闭环验证`，提交 2 步计划 → UI 批准 → 本地模型回复 → 验收完成。事件 `cowwork.model.routed` 显示 `provider_id=local-m4-stub`、`location=local`、`estimated_usd=0`、`data_policy=local_only`。
9. 本地桩请求日志 `artifacts/m4-local-stub-requests.log` 全部 `host=127.0.0.1:4321`，没有任何云端渠道请求。
10. 零配置云任务 `M4 零配置验证`：新建 → 质量优先 → 发送前确认 → 启动；内置免费模型返回 `429 FreeUsageLimitError: Free usage limit reached`。该条不记为通过。

截图：

- `artifacts/m4-cowork-overview.png`
- `artifacts/m4-new-task.png`
- `artifacts/m4-artifacts.png`
- `artifacts/m4-approval-export.png`
- `artifacts/m4-backups.png`
- `artifacts/m4-package-button.png`
- `artifacts/m4-local-plan.png`
- `artifacts/m4-local-completed.png`
- `artifacts/m4-project-workspace.png`

## 自动验证

全量闸门：`artifacts/verify-all-gates-m4.log`，全部通过。

| 项目 | 结果 |
|---|---|
| sidecar bun test | 332 pass / 0 fail |
| core coverage | 35 项 ≥65%，DEBT 4 项不低于下限 |
| backend bun test | 442 pass / 0 fail |
| web bun test | 111 pass / 0 fail |
| sidecar tsc / web tsc | 0 error / 0 error |
| web eslint（changed） | 0 error（12 个目标） |
| web build | ✓ built in 22.00s |
| 颜色 / 间距 / 字号 / 玻璃 / 对比度 / 无紫 | 全部通过 |
| 类型预算 / 体量棘轮 | 通过 |
| backend bundle | 34.7MB，externals OK（23 个） |

聚焦用例：

- `cowwork-m4.test.ts`：12 pass / 50 expect
- `cowwork-m4-routes.test.ts`：3 pass / 33 expect
- `routes-2.5.test.ts`：22 pass / 435 expect
- `capabilities.stage=m4-trust`，schedules/connectors/model_router/share/approvals/data_boundary/file_safety 均为 true

## 已知限制

- 零配置首任务被上游免费额度 `429` 阻断；本轮没有用假成功掩盖。换可用渠道或额度恢复后需补一次真实首任务验收。
- 本地闭环用的是 `127.0.0.1` 模型桩，证明路由、工具白名单与 0 云端请求，不证明真实本地模型质量。
- 安装包 wrapper 未在本轮重建；便携包 smoke 只把阶段断言更新为 `m4-trust` 并做了 PowerShell 语法校验，未实际跑完整便携包。
- 导出 UI 目前只导到工作区根；后端支持 `target_path` 子目录，但 UI 未提供选择。
- 删除范围只覆盖 staging 产物，不提供删除用户工作区文件。
- 批量审批只覆盖低风险只读工具；低风险写操作是否纳入批量，留待产品决策。
- Electron 桌面通知、`ProjectSettingsPane` 保存、`ProjectSchedulesPane` 启停/删除仍未在 M4 重新人工点验。

## 复现 / 启动

```powershell
cd D:\Maxma\MaxmaHere

# 后端：监听 MAXMA_BUN_PORT（默认 8000）
cd bun-backend
$env:MAXMA_DATA_DIR='D:\Temp\maxma-m3a-data'
bun run start

# 前端：代理端口由 MAXMA_API_PORT 决定（不设则默认 8000）
cd ..\web
bun run dev -- --host 127.0.0.1 --port 5199
```

全量闸门：

```powershell
cd D:\Maxma\MaxmaHere
$env:BUN_BIN='D:\NodeGlobal\node_modules\bun\bin\bun.exe'
& 'D:\mingit\bin\bash.exe' scripts/verify-all-gates.sh
```

M4 证据索引：`benchmarks/cowwork/results-m4.json`。
