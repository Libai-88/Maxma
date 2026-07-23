# 权限模式

> 本文档描述当前 session 权限模式与 sidecar 审批行为。实际生效逻辑以 `config/settings.py`、`api/session_manager.py`、`api/routes/sessions.py` 和 `bun-sidecar/src/session-bridge.ts` 为准。

## 模式

| 模式 | 读操作 | 本地写入 | 外部、可执行、破坏性或未知操作 |
| --- | --- | --- | --- |
| `read_only` | 允许 | 拒绝 | 拒绝 |
| `ask` | 允许 | 询问 | 询问 |
| `operate` | 允许 | 允许 | 询问 |
| `auto` | 允许 | 允许 | 询问；仍受工具和路径白名单约束 |

权限模式是附加限制层，不替代以下独立检查点：

- oh-my-pi 工具审批
- Maxma 路径白名单和 MaxmaBlocker
- MCP stdio 命令白名单
- Provider URL 校验
- 凭据加密和脱敏
- 子 Agent 或后台任务的父级权限继承

## 生效流程

1. 前端通过 `PUT /api/sessions/{id}/permission-mode` 修改 session 模式。
2. Python 将模式保存在 `SessionState.permission_mode`，并在创建 sidecar session 时传入 `permission_mode`。
3. `bun-sidecar/src/session-bridge.ts` 将 `ask` 和 `read_only` 转为需要 UI 审批的 session；`auto` 和 `operate` 使用自动批准语义，但仍不能绕过 Maxma 安全检查。
4. sidecar 通过 `ask_user` 事件向前端发出工具审批请求。
5. 前端通过 `user_response` 把批准或拒绝结果发回 sidecar。

## 功能开关

`MAXMA_PERMISSION_MODES_ENABLED` / `permission_modes_enabled` 默认关闭，以兼容旧配置。关闭时，后端把有效模式收敛为 `ask`，因此工具采用确认优先行为；开启后才使用 session 中选择的四种模式。

这是兼容开关，不代表权限代码不存在。变更该开关时必须同时验证：

- session 创建参数
- sidecar `autoApprove` 和 `hasUI`
- `ask_user` / `user_response` 往返
- cancel、超时和断线时的待处理审批
- 路径与 MCP 安全检查仍然生效

## 修改要求

修改权限模式时至少运行：

```text
pytest tests/test_api tests/test_pi_bridge -q
cd bun-sidecar && bun test
```

涉及安全边界时还要同步更新 [docs/security-contract.md](../docs/security-contract.md) 和相关 ADR。
