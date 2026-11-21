# M1 信任基座基线（2026-11-21）

## 口径

- 引擎：`@earendil-works/pi-coding-agent 1.5.0`（`bun-sidecar/src/kernel/pi-contract.ts`）。
- 仓库：`D:\Maxma\MaxmaHere`，工作区根同时作为 Agent PathPolicy 根。
- 目标：先把“同名不同质”的信任层做实，再进入代码上下文与编排。M1 不承诺 OS 级沙箱；
  Windows 命令层当前明确标记为 `policy-only`，不得对外宣称“命令已被隔离”。

## 已落地

| 工作包 | 行为 | 关键文件 | 取证 |
| --- | --- | --- | --- |
| T1 权限矩阵 | `read_only` 对写/执行返回 deny，不弹审批卡；`ask` 全审批；`operate` 写放行/执行审批；`auto` 不装审批门但路径策略仍生效 | `bun-sidecar/src/kernel/permission-decision.ts`、`approval-gate.ts`、`extensions/maxma-approval.ts`、`web/src/hooks/useSessionPermissionMode.ts` | `approval-gate.test.ts`、`kernel.test.ts`、`permission-mode-contract.test.ts` |
| T2 PathPolicy | 工作区根 + 用户显式 allowlist；拒绝绝对越界、盘符相对、UNC、设备命名空间、ADS、NUL/控制字符、`..`、`~`/环境变量、符号链接/junction；读取缺失 fail-closed | `bun-sidecar/src/kernel/path-policy.ts`、`extensions/maxma-path-policy.ts`、`bun-backend/src/services/path-allowlist.ts`、`routes/security.ts` | `path-policy.test.ts`、`security-path-allowlist.test.ts` |
| T3 命令守卫 | Agent bash/powershell 先过路径/网络/危险命令策略，再重建 HOME/TMP 并清敏感变量；Workbench 命令使用同一策略 + 环境白名单；网络默认拒绝，显式 `allow_network` 才放行 | `bun-sidecar/src/kernel/command-policy.ts`、`bun-backend/src/services/command-sandbox.ts`、`command-runner.ts`、`routes/workspace.ts` | `path-policy.test.ts`、`command-sandbox.test.ts`、`workspace-p0.test.ts` |
| T4 审计与恢复 | 工具 start/end、拒绝决策写 `agent_audit.jsonl`；write/edit 前快照到 `agent_snapshots/<session>/`（8 MiB 上限）；`GET /api/audit-log/snapshots`、`POST /api/audit-log/snapshots/:id/restore` 回环可用，恢复前 PathPolicy 复核 | `bun-sidecar/src/kernel/agent-audit.ts`、`extensions/maxma-audit.ts`、`bun-backend/src/routes/audit-log.ts` | `agent-audit.test.ts`、`audit-agent.test.ts` |
| T5 文档/UI 收口 | 权限选择器与 HelpView 文案改成真实语义；Capabilities 增加路径策略/审计扩展名；security-contract 与架构文档同步 | `web/src/views/HelpView.tsx`、`CapabilitiesView.tsx`、`docs/security-contract.md`、`docs/00-当前架构.md` | `web` 类型检查 + 现有守卫 |

## 边界（未完成，不得冒充）

1. **OS 沙箱未完成**：Windows 受限 token + Job Object 原生辅助器未落地。命令层只做字符串策略、
   环境白名单、cwd 锁定、超时杀树；任意可执行文件仍可能以本机用户权限读取策略未覆盖的路径。
2. **PathPolicy 不是 shell 解析器**：编码脚本、动态拼接、注册表/COM/环境变量间接路径无法全拦。
3. **恢复只覆盖 Agent write/edit**：`bash` 重定向、`write_office_file` 的二进制结构变化、
   外部命令造成的文件变化不在快照范围。
4. **网络命令在 Agent shell 默认拒绝**：需要联网的研究/发布应走专用 Web 工具或显式授权的
   Workbench `allow_network`；这不是浏览器 allowlist 的替代。
5. **审计清空只清日志**：`/api/audit-log/clear` 删除 JSONL 与旧 JSON 审计，不删除已生成的
   快照文件；快照是恢复资料，不等同于审计记录。

## 验证命令

```powershell
cd D:\Maxma\MaxmaHere\bun-sidecar
bun test tests/approval-gate.test.ts tests/kernel.test.ts tests/path-policy.test.ts tests/agent-audit.test.ts
bunx tsc --noEmit

cd D:\Maxma\MaxmaHere\bun-backend
bun test tests/permission-mode-contract.test.ts tests/security-path-allowlist.test.ts tests/command-sandbox.test.ts tests/workspace-p0.test.ts tests/audit-agent.test.ts
bunx tsc --noEmit

cd D:\Maxma\MaxmaHere\web
bunx tsc --noEmit
```

## 下一步

M2 代码上下文（C1 索引、C2 符号/引用、C3 LSP-lite、C4 多文件编辑、C5 上下文总线）；
进入 M2 前先跑 M1 全量闸门与真实会话取证，不能以单测替代产品入口。
