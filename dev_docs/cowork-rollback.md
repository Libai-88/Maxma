# Cowork 回滚手册（M0）

本手册只覆盖 **数据/构建/代码** 三条回滚路径。M0 还没有任务表，数据库仍是 `SCHEMA_VERSION=10`；M1 起新增表后，迁移只追加、不删除。

## 0. 基线

- 基线 tag：`baseline-local-workbench-v2.7.0` → `9aee7a4a`
- 开发分支：`feat/cowork-v1`
- 能力开关：`features.cowork`，默认 `false`
- 旧入口：对话 `/`、工作台、代码能力全部保留

## 1. 备份

```powershell
pwsh -NoProfile -File scripts\cowork-backup.ps1
```

默认备份仓库的 `api\data`。备份目录：

```
api\data\backups\cowork-<label>-<timestamp>\
  manifest.json
  payload\
    maxma.db
    maxma.db-wal（存在时）
    maxma.db-shm（存在时）
    providers.yaml / mcp_servers.yaml / panel_configs.json / ...
    config\personas\...
```

要点：

- `maxma.db` 和 WAL/SHM 一起拷，避免只拷主库丢未落盘页。
- `manifest.json` 记录每个文件的 SHA-256、git branch/head；不记录 secret 内容。
- 备份目录已被 `.gitignore` 忽略，不要提交。
- 应用运行时备份可能拿到不一致快照；迁移/大改前先关应用，或加 `-StopApp`。

## 2. 回滚

```powershell
# 最近一次备份 + 切回基线 tag
pwsh -NoProfile -File scripts\cowork-rollback.ps1

# 指定备份 + 只恢复数据，不切 git
pwsh -NoProfile -File scripts\cowork-rollback.ps1 `
  -BackupPath api\data\backups\cowork-before-m1-20261122-120000 `
  -NoGit

# 回滚并重建 Web 便携包 + 冒烟
pwsh -NoProfile -File scripts\cowork-rollback.ps1 -Build -Smoke
```

行为顺序：

1. 检查工作区是否干净；有未提交改动默认拒绝（`-Force` 可强制，慎用）。
2. 给“回滚前”再留一份快照到 `backups\rollback-<timestamp>\`。
3. 停止本工作区/便携包内的 Maxma/Bun/Electron 进程（不杀系统里无关的 bun）。
4. 恢复 `maxma.db`，先删当前 WAL/SHM 再拷备份，避免旧库配新 WAL。
5. 默认恢复 `providers.yaml`、`mcp_servers.yaml`、`panel_configs.json`、`path_whitelist.yaml`、`settings_overrides.json` 等配置；`-NoConfig` 可跳过。
6. 默认 `git switch --detach baseline-local-workbench-v2.7.0`；`-NoGit` 可只恢复数据。
7. `-Build` 重建 Web 便携包；`-BuildDesktop` 重建桌面便携包；`-Smoke` 跑 `build\portable-smoke-test.ps1`。
8. 输出 `backups\rollback-<timestamp>.json` 报告：恢复了哪个库、哪个 git ref、是否重建/冒烟。

## 3. 里程碑回滚演练（每个 M 都做）

1. 关闭 `features.cowork`：旧首页/对话/工作台/设置全部可用，无新入口。
2. 恢复上一里程碑备份：旧会话可读；新表存在但不被旧代码读取；无迁移报错。
3. 用旧版便携包启动：`build\portable-smoke-test.ps1` PASS；不因新目录/新文件崩溃。
4. 新产物留在 `cowork/artifacts`：不阻塞回滚；需要时手工导出。

## 4. 不能靠本脚本解决的事

- 代码签名/自动更新：M0 仍用便携 ZIP；没有证书就不伪装成正式安装器。
- 云端任务/移动端/多人协作：v1 不做；回滚不覆盖这些能力。
- Office 像素级原位编辑：不在本期；已有 Office 文件优先外部 Office/WPS 精修。
