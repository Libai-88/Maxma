# Maxma 安全边界契约

> **Status: Active.** 定义当前代码真实执行的安全检查。改动任一检查必须同步本文与对应测试。
> 上一代 Python 路径白名单（`path_whitelist.yaml` + `check_path_access`）已随 Python 后端整体移除，
> **今天没有任何代码执行它**；本文只描述现存机制。

## 1. 执行中的检查

| 检查 | 实现 | 失败语义 | 测试 |
| --- | --- | --- | --- |
| MaxmaBlocker 拒止锚 | `bun-sidecar/src/blocker.ts` `findBlockerPath`/`checkToolBlocked`；kernel 侧 `kernel/extensions/maxma-blocker.ts` 挂官方 `tool_call` 钩子 | 命中即 block 单次调用并把原因回给 agent，整轮不中断；NUL 字节/解析异常视为存在 blocker（**fail-closed**） | `bun-sidecar/tests/`、`bun-backend/tests/` |
| 审批门（权限模式） | `bun-sidecar/src/kernel/approval-gate.ts` `needsApprovalForMode` + `extensions/maxma-approval.ts` | 超时默认拒绝（5 分钟）；会话销毁 `rejectAll` 防 promise 泄漏 | `bun-sidecar/tests/plan-bridge.test.ts` 等 |
| MCP stdio 命令白名单 | `bun-backend/src/routes/mcp-validation.ts` `ALLOWED_STDIO_COMMANDS` / `validateStdioCommand` | 不在白名单 → 400 拒绝保存 | `bun-backend/tests/` |
| MCP 环境变量黑名单 | 同上 `validateEnvVars` | 命中敏感 key → 400 | 同上 |
| Provider URL 校验 | `bun-backend/src/routes/providers.ts`（含 `169.254.169.254`、`metadata.google.internal` 等云元数据主机拒绝） | 危险协议/元数据地址 → 拒绝保存与请求前拦截 | `bun-backend/tests/` |
| 凭据加密 | `bun-backend/src/security/credential-envelope.ts`（Fernet 规范逐字节互操作 + `encv1:` 信封层） | HMAC 校验失败 → 空串；前端只拿脱敏值 | 向量测试锁定 |
| Token 鉴权 | `bun-backend/src/middleware/auth.ts`：仅 `/api/**` 与 `/ws/**`；`X-Maxma-Token` 头 → `?token=` → WS subprotocol | 401 / WS close 4001；白名单仅 `/api/health`、`/api/auth/token`、`GET /api/mcp/oauth/callback`、贴纸静态 GET/HEAD | `bun-backend/tests/` |
| 限流 | `bun-backend/src/middleware/rate-limit.ts` | 超限 429 + `RATE_LIMITED` 结构；本地回环豁免 | 同上 |
| CORS | `bun-backend/src/cors-config.ts` 精确 origin 集合 | 非白名单 origin 不放行 | 同上 |
| 敏感字段脱敏 | `mcp-validation.ts` `REDACTED` + `bun-backend/src/runtime-status.ts` | 写日志/事件/前端响应前脱敏 | 同上 |

## 2. 不可回退的原则

1. **异常一律视为拒绝**，禁止 `catch { /* 继续 */ }` 出现在安全检查路径上。
2. **Token 不进前端构建产物；API Key 不进日志、事件、前端响应。**
3. 权限模式（`read_only` / `ask` / `operate` / `auto`，`kernel/types.ts`）是**附加限制层**：
   只能收紧，任何模式都不得绕过 MaxmaBlocker、MCP 命令白名单、Provider URL 校验。
   判据只看官方 `Tool.annotations`（`readOnlyHint` / `destructiveHint`）与工具名族，不猜语义。
4. 取消与断线必须经 kernel `cancel`；只取消前端会让 Agent 继续跑并烧模型额度。
5. Electron 壳不引入特权：`contextIsolation` + `sandbox` + `nodeIntegration:false` + 无 preload，
   渲染层只走 HTTP/WS；`setWindowOpenHandler` 拒绝新窗口，外链仅放行 `https:`/`http:`/`mailto:`。

## 3. 已知缺口（不要当成已具备的保证）

- **没有路径白名单层（产品级缺口，非缺陷清单里的"待接线"）。** 文件访问的约束只剩
  MaxmaBlocker（用户主动放置的拒止锚）+ 审批门逐次确认；`auto` 模式下审批门不装配，
  此时拒止锚是仅存的文件拦截层。**不存在"预先放行清单"**，因此任何文档/UI 都不得
  宣称"默认拒绝"或"仅受白名单约束"。恢复该层属独立工作项。
- **已收口（2026-11-02）：白名单的残留不再伪装成保护。** 阶段二 cutover 删掉了执行层，
  但留下了三处"看起来还在"的残迹，现已全部清除：
  1. `bun-backend/src/db/core.ts` 的 v1 schema 不再创建零读写方的 `path_whitelist` 表
     （就地删声明，不新增 drop 迁移——`initializeDatabase()` 对已有库只跑
     `SCHEMA_MIGRATIONS.slice(current)`，v1 永不重放，故老库保留那张空表、升级路径不变）；
  2. `web/src/views/MaxmaBlockerView.tsx` 的"优先级高于白名单 / 白名单放行条目不生效 / 参见设置页的
     「路径白名单」配置"（该设置分区不存在）已改写为真实机制；
  3. `web/src/views/PrivacyView.tsx` 的数据存储清单不再列 `api/data/path_whitelist.yaml`。
     用户磁盘上那份 yaml 属未跟踪的个人数据，**刻意不删**，但它已无任何读取方、
     不产生任何拦截效果。
  回归锁：`bun-backend/tests/db-schema.test.ts`（老库升级路径）——前端 Vue 组件测试随重写退役，
  文案诚实性改由视图实现与本文审查保证；
  `bun-backend/tests/db-schema.test.ts`（新库不建该表 + 老库升级路径不破 + 源码零引用）。
- **权限模式 UI 链已接通（2026-11-02 修）**：REST 回 `{session_id, permission_mode,
  available_permission_modes}`，前端按该清单渲染并据其非空判定可交互。
  字段名由 `bun-backend/tests/permission-mode-contract.test.ts` 对账；档位清单**单源**在
  `bun-sidecar/src/kernel/pi-contract.ts` 的 `MAXMA_PERMISSION_MODES`——kernel 入参校验、
  REST 返回值、类型派生共用它，前端副本与 `needsApprovalForMode` 的分支集合由同一条测试
  双向核对。
  注意：`set_auto_approve`（WS `update_auto_approve`）只有 auto/ask 两态，会把已选的
  `read_only`/`operate` 改写掉——它不是四档切换的兜底通道。
- **`dev_docs/security/` 已被 `.gitignore` 屏蔽**，不会出现在 `git status`；
  该目录不再存放现行规范，安全事实以本文为准。
