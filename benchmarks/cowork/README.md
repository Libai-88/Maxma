# Cowork 基准套件（M0 骨架）

这组基准不追求“看起来能跑”，而是把 **v2.7.0 的真实缺口** 留下来：当前没有任务对象、计划审批、交付物版本和 PPTX 生成器，所以三条基线任务在 v2.7.0 都是 `unsupported`。M1/M2 完成后，再用同一套输入重跑，才能比较“任务→成品”的真实提升。

## 文件

- `tasks.json`：三条固定任务（学生报告、职场周报、会议纪要），含输入、期望产物、验收点。
- `fixtures/*.md`：合成输入，不含真实个人/公司数据。
- `results-v2.7.0.json`：v2.7.0 基线记录；`unsupported` 是事实，不是失败伪装。

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
