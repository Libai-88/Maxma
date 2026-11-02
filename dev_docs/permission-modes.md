# 权限模式

> 权威实现：`bun-sidecar/src/kernel/pi-contract.ts`（档位清单 `MAXMA_PERMISSION_MODES` 单源，
> 模式类型由它派生）、`kernel/approval-gate.ts`（判据）、
> `kernel/extensions/maxma-approval.ts`（官方 `tool_call` 钩子）、`bun-backend/src/routes/sessions.ts`（REST 面）。
> 决策背景见 [adr/0004-permission-modes.md](adr/0004-permission-modes.md)。

## 四档

| 模式 | 读操作 | 本地写入 | 执行/破坏性操作 |
| --- | --- | --- | --- |
| `read_only` | 允许 | 审批 | 审批 |
| `ask` | 允许 | 审批 | 审批 |
| `operate` | 允许 | 允许 | 审批 |
| `auto` | 允许 | 允许 | 放行（仍受 MaxmaBlocker、MCP 命令白名单、Provider URL 校验约束） |

判据只看官方 `Tool.annotations`，不猜语义：`readOnlyHint === true` 视为只读；
`operate` 下的"执行类"= `destructiveHint === true` 或工具名属于 bash / powershell 族。
无效模式值回落 `ask`。

两点必须写明白，否则文档会承诺代码没有的行为：

- **`read_only` 与 `ask` 当前判定完全相同**（`needsApprovalForMode`：
  `if (mode === "read_only" || mode === "ask") return !readOnly`）——都是"非只读工具逐次审批"，
  `read_only` 并不额外拒绝写入。它作为独立档位保留是给未来的收紧留位置；
  UI 文案（`PermissionModeControl.vue`）不许写成"只读会拒绝写入"。
- **`auto` 不装配审批门**（`pi-session.ts` `approvalExtensionFor`：`mode === "auto"` → 不装），
  所以 auto 下**没有任何逐次确认**，只剩 MaxmaBlocker 拒止锚、MCP stdio 命令白名单与
  Provider URL 校验。UI 文案不许承诺"高风险操作仍会要求确认"。

## 生效链路

1. 会话创建时传入 `permission_mode`，kernel 据此决定是否装配审批门。
2. `auto` → 门不装配；其余 → 命中判据的工具调用产生 `ask_user` 事件（带 `interaction_id`）。
3. 前端应答 `user_response`；**超时默认拒绝**（5 分钟），会话销毁时 `rejectAll` 清理在途审批。
4. 运行时切换有两条链，**语义不同，别混用**：
   - `set_permission_mode` RPC（REST `PUT /api/sessions/:id/permission-mode` 走这条）：
     四档任选，改的就是运行中会话的 `record.permissionMode`，审批门按闭包读它，即时生效。
   - WS `update_auto_approve` → `set_auto_approve`：只有两态，`true` → `auto`、
     `false` → `ask`。它是"自动执行"开关的链路，会把已选的 `read_only` / `operate`
     改写掉，所以权限模式控件**不得**在 PUT 之后再补发它（曾经补发过：Python/sidecar
     跨进程时代 PUT 碰不到运行中会话，只能靠这条兜底；现在 in-process 直调，补发只剩副作用）。
5. 两条链写的是**同一个字段**，收敛机制是**写入方自己广播**（PERM-ANNOUNCE-001）：
   `bridge-pi.ts` 的 `writePermissionMode` 是唯一写入口，每次真正写入都发一条
   `permission_mode_updated { permission_mode }`（被拒的写入——非法档位——一条都不发）。
   事件经 `chat-ws.ts` 的透传分支广播给该会话的**所有**连接，所以：
   - `useChat.ts` 把它落到 per-channel 状态（`permissionMode` + 派生的 `autoApprove`）；
   - `SessionPermissionModeControl.vue` 的显示从那份状态收敛，GET 只负责首屏与
     `available_permission_modes` 清单，迟到的 GET 不许把选择器带回旧档。
   以前这里是**两个写入方 + 零反馈**：开关拨完（`set_auto_approve` 把档位覆盖成 auto/ask），
   选择器仍显示它自己那次 GET 拿到的档位——内核、REST、WS 三条链各自都没错，
   缺的是那条 announce 边。同一会话的另一个标签页也只能靠重新 GET 撞运气。
   判据：`bun-backend/tests/permission-mode-contract.test.ts` 的 PERM-ANNOUNCE-001 组
   （真跑 in-process kernel，比对 record 与广播序列；两种顺序都测）+
   `web/tests/wsEventSink.spec.ts`（事件→通道状态）+ `web/tests/sessionPermissionModeControl.spec.ts`（状态→渲染）。

权限模式是**附加限制层**：只收紧，任何一档都不能绕过 MaxmaBlocker 拒止锚、MCP stdio 命令白名单、
Provider URL 校验或凭据加密。没有兼容性开关，四档始终生效。

## REST 契约

`GET` / `PUT` `/api/sessions/:sessionId/permission-mode` 都回同一个形状
（`routes/sessions.ts` 的 `permissionModeView()`）：

```json
{"session_id":"…","permission_mode":"ask","available_permission_modes":["read_only","ask","operate","auto"]}
```

- `available_permission_modes` 是**可用性信号本身**：非空即可交互，前端
  `SessionPermissionModeControl.vue` 据此决定渲染，`PermissionModeControl.vue`
  按这份清单的顺序渲染选项。没有 feature flag，所以也就没有 `enabled` 之类的布尔量——
  四档恒生效，一个恒为 true 的开关只是让 UI 有机会骗人。
- 档位清单**单源**：`bun-sidecar/src/kernel/pi-contract.ts` 的 `MAXMA_PERMISSION_MODES`，
  数组顺序即 REST `available_permission_modes` 与前端选项的展示顺序（限制由强到弱）。
  `MaxmaPermissionMode` 由这份清单**派生**（`typeof … [number]`，`kernel/types.ts` 只做再导出），
  `bridge-pi.ts` 的 RPC 入参校验与 `routes/sessions.ts` 的 REST 返回值运行时 import 同一份常量
  （跨 workspace 先例：`routes/capabilities.ts:29`）。以前这四个字符串在四处各写一份，
  只动一处会出现"REST 说这档可用、kernel 判它非法"（用户选到必 422 的档位）或反过来。
- 前端仍是**被纪律要求成的副本**：`engine-boundary.test.ts` 判据是「前端只认 Maxma
  REST/WS 契约」，`web/src` 不许 import kernel 源码。所以前端那几处（`web/src/types/session.ts`
  的 `PermissionMode` 联合、`PermissionModeControl.vue` 的 `availableModes` 默认值 /
  `options` 文案表 / `modeRank`）由 `bun-backend/tests/permission-mode-contract.test.ts`
  与单源清单逐字**双向**对账；同一个测试还把 `needsApprovalForMode` 实际分支的档位集合
  与清单对账（漏分支的档位会落进函数末尾的兜底 `return true`：名字收下、语义全错）。
- 新增/改名一档要动的地方：单源清单 → 审批门分支 → 前端文案表与 `modeRank`；
  少任何一处，上面那条测试当场红。
- `PUT` 非法档位 422，会话不存在 404；`GET` 会话不存在 404。

## 改动要求

改权限模式至少跑：`cd bun-sidecar && bun test` 与 `cd bun-backend && bun test`，
并验证：会话创建参数、`autoApprove`/审批门装配、`ask_user`/`user_response` 往返、
cancel/超时/断线时的待处理审批、MaxmaBlocker 与 MCP 检查仍生效。
涉及安全边界时同步 [docs/security-contract.md](../docs/security-contract.md)。
