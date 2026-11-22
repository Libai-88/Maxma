# Cowork 基准套件

这组基准不追求“看起来能跑”，而是把 **v2.7.0 的真实缺口** 留下来：v2.7.0 没有任务对象、计划审批、交付物版本和 PPTX 生成器，所以三条基线任务都是 `unsupported`。M2 用同一套输入重跑后，三条均变成 `completed`；结果与幂等证据见 `results-m2.json`。

## 文件

- `tasks.json`：三条固定任务（学生报告、职场周报、会议纪要），含输入、期望产物、验收点。
- `fixtures/*.md`：合成输入，不含真实个人/公司数据。
- `results-v2.7.0.json`：v2.7.0 基线记录；`unsupported` 是事实，不是失败伪装。
- `results-m2.json`：Cowork M2 真实重跑结果，三条均 `completed`，保留任务 id、产物 SHA-256 与验收说明。
- `results-m4.json`：M4 信任、数据边界、模型路由、源文件安全与交付包的真实验收记录；包含 UI 截图、运行事件与闸门数字。

## M4 信任与交付验收（2026-11-22）

M4 不重跑 M2 的三条写作任务，而是验证“能不能放心把真实资料交给它”：审批默认最小权限、`local_only`
不偷上云、同名文件不覆盖、写入可恢复、ZIP 可以发给老师/同事。逐项证据见 `results-m4.json`。

| 检查 | 结果 | 关键证据 |
|---|---|---|
| 导出审批 | 通过 | 批准前无文件；批准后写入；备份 ledger 与恢复前自动备份齐全 |
| local_only 0 云端 | 通过 | 真实本地任务 3 次运行后完成；路由事件 location=local；本地桩请求日志全部 127.0.0.1 |
| 同名不覆盖 | 通过 | 自动 `report.v2.docx`，原 `report.docx` 字节不变 |
| 一键恢复 | 通过 | 恢复后 SHA-256 与导出前一致，`pre_restore` 备份可回滚 |
| 删除可审计 | 通过 | staging 文件进 `trash/`，DB 状态 deleted，详情不再显示幽灵条目 |
| ZIP 交付包 | 通过 | 产物 + `sources.json` + `README.md` 三件套，真实下载解压 |
| 零配置首任务 | 通过（本机免费路由组） | 测试机预置 `magpie`，任务未手选渠道/模型；`3db0b901-...` 计划批准后 completed，产物 1059 B；内置 Maxma 免费模型仍受 429 限制 |

M4 的四项出口已闭合。零配置补测使用测试机预置的 Magpie 免费路由组（`127.0.0.1:3425`），未写入仓库默认 `providers.yaml`；它证明用户侧 0 配置流程，不等于发行包内置。Magpie 是本地网关，网关内部转发不可见，故不作为数据不出机的强证明。


## M2 重跑结果（2026-11-22）

同一套 fixture 在 M2 临时后端上按真实任务执行：创建任务 → 人工批准计划 → Agent 用
`read_office_file` / `write_office_file` 产出 → 从 artifact 快照下载 → Office COM 打开校验。
三条任务均一次通过，实际墙钟时间分别为 38.4s、28.3s、28.3s；结构验收前无需人工修改。

| 任务 | M0 基线 | M2 | 产物 |
|---|---|---|---|
| student-report | unsupported | completed | DOCX v2（2536 B） |
| weekly-report | unsupported | completed | DOCX + 5 页可编辑 PPTX |
| meeting-notes | unsupported | completed | DOCX + 6 行 XLSX |

详细哈希与验收见 `results-m2.json`。本轮只验证“产物结构与来源口径可交付”，不替代主观文风润色；
`manual_edit_minutes = 0` 指结构验收通过，不是“零润色”。

## 用法

```powershell
# 校验任务定义与 fixture 是否存在
pwsh -NoProfile -File scripts\run-cowork-bench.ps1 -Mode validate

# 打印将要跑的任务（M0 不执行）
pwsh -NoProfile -File scripts\run-cowork-bench.ps1 -Mode dry-run

# M1/M2 后录入一次人工结果
pwsh -NoProfile -File scripts\run-cowork-bench.ps1 -Mode record `
  -TaskId student-report -Status completed `
  -DurationSeconds 420 -ManualEditMinutes 6 -FileUsable yes
```

## 评分口径

- 完成：产物存在且能打开；结构/来源/未决项符合 `acceptance`。
- 人工修改：从打开产物到可交付的分钟数；超过 10 分钟记为不可接受。
- 安全：源文件未被静默覆盖；local_only 任务无云端请求。
- 恢复：运行中重启后能继续；不重复执行已完成步骤。

**M0 结论：** 三条都 `unsupported`。这不是“跑输了”，而是证明 v2.7.0 还没有把能力包装成任务；M1 的首要验收就是让第一条任务从 `unsupported` 变成 `completed`。
