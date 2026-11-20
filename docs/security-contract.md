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
| 限流 | `bun-backend/src/middleware/rate-limit.ts` | 超限 429 + `RATE_LIMITED` 结构；本地回环豁免（IP 取自 `server.requestIP`，取不到则按 `unknown` 限流，不放宽） | `bun-backend/tests/rate-limit-ip.test.ts` |
| CORS | `bun-backend/src/cors-config.ts` 精确 origin 集合 | 非白名单 origin 不放行 | 同上 |
| 工作区面板授权 | `bun-backend/src/routes/workspace.ts` + `services/workspace-fs.ts` + `services/workspace-store.ts`：根目录由用户在桌面壳显式选择，存 `<data>/api/data/workspaces.json`；路径先规范化再逐段 `lstat`，拒绝绝对路径/盘符/UNC/NUL/ADS/`..`/符号链接逃逸；读取/写入/执行前跑 MaxmaBlocker | 400/403 结构化错误；文本 2 MiB、图片/PDF 50 MiB；目录最多 2000 项；非回环 403 | `bun-backend/tests/workspace-p0.test.ts` |
| 工作区写入与命令执行 | `PUT /api/workspace/file` 带 `base_hash` 乐观并发，临时文件 `wx` + `rename`；`POST /api/workspace/run` 无 TTY、cwd 锁工作区根、默认 60s/上限 120s、超时杀进程树、输出 1 MiB 截断；两者都只允许回环 + Token，并在读取/执行前跑 MaxmaBlocker | 冲突 `409 FILE_CONFLICT`；路径/大小/二进制错误结构化拒绝；命令超时返回 `timedOut` 而不是假装成功 | `bun-backend/tests/workspace-p0.test.ts` |
| Git 写操作 | `bun-backend/src/services/git-service.ts` + `routes/git.ts`：全部 async `spawn`（12s / commit 20s，输出上限 8 MiB），path 加 `:(literal)`；`commit` 必须 `confirm:true`，不 push | 未确认 commit 400；非法 path/超时/非 Git 仓库返回结构化错误；不自动 stage/push | `bun-backend/tests/workspace-p0.test.ts` |
| 浏览器 Agent 控制 | `desktop/electron/browser-agent-server.cjs`：只监听 `127.0.0.1`，每次启动随机 32-byte hex secret，配置 `0600`；`POST /execute` 校验 `x-maxma-browser-secret`；动作白名单 open/snapshot/extract/screenshot/scroll/back/forward | 未知动作拒绝；无 secret/错 secret 拒绝；未打开 tab 时创建隐藏 view，不擅自显示原生层 | `bun-backend/tests/browser-agent.test.ts`、`browser-tools.test.ts` |
| 截图标注与元素拾取 | `BrowserPane` 截图像素在渲染层标注后作为图片附件；元素拾取只在用户主动点击时执行，返回 DOM 路径/bbox/样式摘要；事件按 `sessionId` 过滤 | 不把截图或元素写入其它会话；不回传浏览器 cookie/Token | `scripts/verify-ui-workbench.mjs` |
| 内置浏览器隔离 | `desktop/electron/browser-view.cjs`：独立 `persist:maxma-browser` 会话；`WebContentsView` 开 `contextIsolation`、关 `nodeIntegration`、开 `sandbox`；只允许 http(s)/`about:blank`，`will-navigate`/`will-redirect`/`window.open` 同规则；权限请求全部拒绝；窗口打开只交给系统浏览器 | 非法协议/重定向被取消；页面拿不到 Node、preload 或 Maxma 主界面；清除数据只清浏览器会话 | `scripts/verify-ui-workbench.mjs` |
| HTML 外部打开守卫 | `desktop/electron/path-actions.cjs` `assertOpenableHtml`：必须是存在、普通的 `.html/.htm` 文件 | 其他文件/目录/符号链接 → 拒绝，不启动任意可执行文件 | `bun-backend/tests/desktop-path-actions.test.ts` |
| 敏感字段脱敏 | `mcp-validation.ts` `REDACTED` + `bun-backend/src/runtime-status.ts` | 写日志/事件/前端响应前脱敏 | 同上 |
| 扩展启停边界 | `bun-sidecar/src/kernel/extensions.ts` `filterDisabledExtensions`（只过滤 `scope=user`）+ `bun-backend/src/routes/extensions.ts`（`isValidExtensionId` 拒绝绝对路径/穿越/`<inline:…>`，内置名 403）+ `extensions-config.ts`（落盘前同校验） | 非用户扩展、内置安全扩展（approval/blocker/telemetry）一律拒绝禁用；非法 id → 400；内置名 → 403 | `bun-sidecar/tests/extensions-visibility.test.ts`、`bun-backend/tests/extensions-route.test.ts` |

## 2. 不可回退的原则

1. **异常一律视为拒绝**，禁止 `catch { /* 继续 */ }` 出现在安全检查路径上。
2. **Token 不进前端构建产物；API Key 不进日志、事件、前端响应。**
3. 权限模式（`read_only` / `ask` / `operate` / `auto`，`kernel/types.ts`）是**附加限制层**：
   只能收紧，任何模式都不得绕过 MaxmaBlocker、MCP 命令白名单、Provider URL 校验。
   判据只看官方 `Tool.annotations`（`readOnlyHint` / `destructiveHint`）与工具名族，不猜语义。
4. 取消与断线必须经 kernel `cancel`；只取消前端会让 Agent 继续跑并烧模型额度。
5. Electron 壳不引入特权：`contextIsolation` + `sandbox` + `nodeIntegration:false`，
   preload 只暴露原生选择/定位、HTML-only 外部打开和浏览器控制这些窄接口；IPC 校验
   sender frame 必须是 `appOrigin`，渲染层其余能力仍只走 HTTP/WS。主窗口
   `setWindowOpenHandler` 拒绝新窗口，外链仅放行 `https:`/`http:`/`mailto:`。
6. 内置浏览器是**独立、可清除的会话**：不得复用 Maxma 主会话的 cookie/缓存，不得向页面
   暴露 `maxmaDesktop` bridge；清除数据是显式用户动作，不随导航自动发生。

## 3. 已知缺口（不要当成已具备的保证）

- **没有路径白名单层（产品级缺口，非缺陷清单里的"待接线"）。** 文件访问的约束只剩
  MaxmaBlocker（用户主动放置的拒止锚）+ 审批门逐次确认；`auto` 模式下审批门不装配，
  此时拒止锚是仅存的文件拦截层。**不存在"预先放行清单"**，因此任何文档/UI 都不得
  宣称"默认拒绝"或"仅受白名单约束"。恢复该层属独立工作项。
  Workbench 的 `workspace roots` 只是**文件面板的读写授权**（用户显式选中的目录），
  **不是 Agent 的全局路径白名单**，也不改变 Agent 工具的文件访问边界。命令运行器同样只在
  当前工作区根内执行，但它使用你的本机用户权限，不是沙箱。
- **内置浏览器没有网络 allowlist（已知边界，本轮未消除）。** 它可访问任意 http(s)，包括本机
  loopback 与局域网地址；这与普通浏览器一致。Maxma 的 `/api/**` 仍需 Token，浏览器会话
  拿不到该 Token，但未鉴权的本地服务仍可被页面访问。需要网络隔离时属后续企业策略/代理工作，
  当前不得宣称“浏览器只能访问外网”或“浏览器被完全隔离”。
- **浏览器 Agent 只开放只读动作。** open/snapshot/extract/screenshot/scroll/back/forward 可执行；
  点击/输入/提交尚未接线，因此不存在“可能已点击却报成功”的路径。开放写动作前必须先补
  `request_id` + 超时 + `outcome_unknown`，且不得自动重试副作用动作。
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

### 3.1 扩展（2026-11-18 起）

扩展是 pi 的能力面之一，但**不是沙箱**：扩展代码以与当前会话相同的系统权限运行。
因此启停机制按"能关、但关不掉安全机制"设计：

1. **可禁用的只有 `<agentDir>/extensions` 下的用户扩展**（`scope=user`，id 为相对该目录的
   posix 路径）。Maxma 内联装配的 `maxma-approval` / `maxma-blocker` / `request-telemetry`
   **硬拒**（接口 403、过滤函数按 scope 拒绝）——关掉审批扩展等于静默取消审批门。
2. 过滤点是官方 `DefaultResourceLoaderOptions.extensionsOverride`（会话级），
   **不写 pi 的全局 settings**：一次 Maxma 内的开关不应扩散到用户命令行里的 pi。
   持久化只在本机 `api/data/disabled_extensions.json`，值是相对路径，换机不会误伤。
3. 禁用语义是"不参与会话"（handler/tool 不注册），**不是隔离**：扩展模块在加载期仍会被
   import，顶层副作用仍会执行。UI 文案必须与此一致。
4. 生效时机是**之后新建的会话**；当前会话保持创建时的扩展集合（扩展在会话创建时加载并绑定）。
5. 加载失败（`extensionsResult.errors`）必须可见：`GET /api/extensions` 与扩展页直接呈现，
   不允许静默吞掉。
