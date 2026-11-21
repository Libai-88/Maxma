# Maxma 安全边界契约

> **Status: Active.** 定义当前代码真实执行的安全检查。改动任一检查必须同步本文与对应测试。
> Python 时代的 `path_whitelist.yaml` / `check_path_access` 已随 Python 后端移除；2026-11-21 起
> **Agent 文件工具重新有了 PathPolicy 层**（工作区根 + 用户显式 allowlist），但它不是 OS 沙箱，
> 也不能约束所有 shell 语义。本文只描述现存机制，不把“策略层”写成“隔离层”。

## 1. 执行中的检查

| 检查 | 实现 | 失败语义 | 测试 |
| --- | --- | --- | --- |
| MaxmaBlocker 拒止锚 | `bun-sidecar/src/blocker.ts` `findBlockerPath`/`checkToolBlocked`；kernel 侧 `kernel/extensions/maxma-blocker.ts` 挂官方 `tool_call` 钩子 | 命中即 block 单次调用并把原因回给 agent，整轮不中断；NUL 字节/解析异常视为存在 blocker（**fail-closed**） | `bun-sidecar/tests/`、`bun-backend/tests/` |
| 审批门（权限模式） | `bun-sidecar/src/kernel/approval-gate.ts` `permissionDecisionForMode`（三值 allow/ask/deny）+ `extensions/maxma-approval.ts` | `read_only` 对写入/执行 **deny**（不弹审批卡）；`ask` 全审批；`operate` 执行类审批；`auto` 不装审批门。审批超时默认拒绝（5 分钟）；会话销毁 `rejectAll` 防 promise 泄漏 | `bun-sidecar/tests/approval-gate.test.ts`、`bun-backend/tests/permission-mode-contract.test.ts` |
| Agent 路径策略 | `bun-sidecar/src/kernel/path-policy.ts` + `extensions/maxma-path-policy.ts`；根来自 `workspaces.json` 的 realpath 与用户显式 `path_allowlist.json`；后端 `GET/POST/DELETE /api/security/path-allowlist` 管理 allowlist | 绝对越界、盘符相对、UNC、Win32 设备命名空间、ADS、NUL/控制字符、`..`、`~`/环境变量展开、符号链接/junction 一律在 `tool_call` 执行前 block；读取目标不存在也拒绝（fail-closed） | `bun-sidecar/tests/path-policy.test.ts`、`bun-backend/tests/security-path-allowlist.test.ts` |
| Agent 命令守卫（降级） | `bun-sidecar/src/kernel/command-policy.ts` + path 扩展：网络命令默认拒绝、系统破坏性命令拒绝、路径逃逸复用 PathPolicy；Agent bash/powershell 在命令前重建 HOME/TMP 并清掉常见凭据变量 | 策略拒绝时 `tool_call` block；放行时只改环境前缀，不改命令语义。**不是 OS 级沙箱**，不能阻止任意可执行文件读取用户权限下的文件 | `bun-sidecar/tests/path-policy.test.ts` |
| 工作区命令守卫（降级） | `bun-backend/src/services/command-sandbox.ts` + `command-runner.ts`：同一 `evaluateCommandPolicy`，子进程环境白名单（`sanitizedEnv`），HOME/USERPROFILE/TMP 指向工作区；`POST /api/workspace/run` 支持显式 `allow_network` | 路径/网络/危险命令 403 `COMMAND_*`；超时/输出超限杀进程树。**Windows 无受限 token / Job Object 原生辅助器，当前是 policy-only，不是完整沙箱** | `bun-backend/tests/command-sandbox.test.ts`、`workspace-p0.test.ts` |
| Agent 工具审计与写入快照 | `bun-sidecar/src/kernel/agent-audit.ts` + `extensions/maxma-audit.ts`：`tool_execution_start/end` 写 `<data>/api/data/agent_audit.jsonl`；write/edit 前把已存在普通文件快照到 `agent_snapshots/<session>/`（上限 8 MiB）；拒绝由 path/approval 扩展写 `denied` 记录 | 审计写入失败只告警，不影响工具；`GET /api/audit-log` 合并 JSONL；`GET /api/audit-log/snapshots` + `POST .../:id/restore` 仅回环，恢复前用 PathPolicy 复核目标 | `bun-sidecar/tests/agent-audit.test.ts`、`bun-backend/tests/audit-agent.test.ts` |
| 生命周期 Hooks | `bun-sidecar/src/kernel/hooks/config.ts`：默认 `<data>/config/hooks.json`，`MAXMA_HOOKS_FILE` 覆盖；整份 HMAC-SHA256 签名（`hooks.secret`，0600）；处理器仅 `command`（不经 shell）/`http`（仅 POST http(s) 且拒绝带凭据 URL）/`prompt`（不调模型） | 配置存在但签名缺失/不匹配 → **整份不加载**；坏钩子 fail-open、写 `<data>/api/data/hooks_audit.jsonl`；`command` 仍以本机用户权限运行，不是沙箱 | `bun-sidecar/tests/hooks.test.ts` |
| 代码索引 | `bun-sidecar/src/codeintel/*` + `tools/code.ts`：只读索引与单个源文件；索引库 `<data>/api/data/code-index.db`；路径仍由 `maxma-path-policy` 在 `tool_call` 前统一检查 | 越界路径被 PathPolicy 拒绝；`code_apply_patch` 预检失败/回滚，不执行任意命令（验证命令固定为 `typecheck`） | `bun-sidecar/tests/{codeintel,code-patch}.test.ts` |
| 本地模型接入 | `bun-backend/src/services/model-fallback.ts` + `routes/hardware.ts` `POST /api/models/local-setup`：只探测 loopback 的 OpenAI 兼容 `/models`，自定义 `base_url` 也必须是本机地址 | 不可达 409 `LOCAL_MODEL_UNREACHABLE` 且**不写** `providers.yaml`；可达但无模型 409 `LOCAL_MODEL_EMPTY`；探测超时 2.5s，网络/HTTP/坏 JSON 一律按不可达处理 | `bun-backend/tests/{model-fallback,local-model-setup}.test.ts` |
| Office 读写 | `bun-sidecar/src/tools/office.ts`：`read_office_file`/`write_office_file` 仅接受当前工作区内路径，单文件上限 20 MiB；DOCX/XLSX 用内存 ZIP 解析 | 越界/非普通文件/超大文件拒绝；解析失败返回错误而不是部分写入 | `bun-sidecar/tests/office.test.ts` |
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
| 浏览器 Agent 控制 | `desktop/electron/browser-agent-server.cjs`：只监听 `127.0.0.1`，每次启动随机 32-byte hex secret，配置 `0600`；`POST /execute` 校验 `x-maxma-browser-secret`；端点与控制器双层动作白名单 open/snapshot/extract/screenshot/scroll/back/forward/act/console/tabs/close_tab/downloads；`request_id` 60s 去重（最多 200 条） | 未知动作 400；无 secret/错 secret 拒绝；未打开 tab 时创建隐藏 view，不擅自显示原生层；同 id 重放不再触发第二次点击；`tabs/close_tab/downloads` 只读或页签管理，不能改网络策略 | `bun-backend/tests/browser-agent.test.ts`、`browser-cdp.test.ts`、`browser-tools.test.ts` |
| 浏览器网络 allowlist | `desktop/electron/browser-net-policy.cjs` + `browser-view.cjs` 的 `browserSession.webRequest.onBeforeRequest`：默认 `mode:"all"`，用户显式切 `allowlist` 后只放行列表域名及其子域；IPv4/IPv6 仅精确匹配；输入归一支持 URL/端口/`*.example.com`/逗号换行，最多 200 个域名；策略存 `<data>/api/data/browser-policy.json`（临时文件 + rename）；只能由 UI/主进程设置，Agent 工具无修改入口 | 不在 allowlist 的 HTTP(S) 主请求和子资源被 `cancel` 并记入最近 20 条拦截；顶层 open/navigate 前置拒绝；坏策略文件回退 `all` | `bun-backend/tests/browser-policy.test.ts`、`scripts/verify-ui-workbench.mjs` |
| 浏览器下载落盘 | `desktop/electron/browser-downloads.cjs` + `browser-view.cjs` 的 `will-download`：目录固定 `<data>/downloads`，不使用页面提供的路径；文件名只取 basename、清 Windows 非法字符/保留名/末尾点空格、超长保留扩展名截断，同名改 `name (1).ext`；单文件上限 512 MiB，记录最多 20 条；中断/取消删除半成品；`reveal-download` 只允许 downloads 目录内已存在的文件 | 超限 `item.cancel()` 并标 `cancelled`；非 completed 不保留文件；目录外/不存在文件拒绝 reveal；下载文件按不可信内容对待，不做病毒扫描 | `bun-backend/tests/browser-policy.test.ts`、`scripts/verify-ui-workbench.mjs` |
| 截图标注与元素拾取 | `BrowserPane` 截图像素在渲染层标注后作为图片附件；元素拾取只在用户主动点击时执行，返回 DOM 路径/bbox/样式摘要；事件按 `sessionId` 过滤 | 不把截图或元素写入其它会话；不回传浏览器 cookie/Token | `scripts/verify-ui-workbench.mjs` |
| 内置浏览器隔离 | `desktop/electron/browser-view.cjs`：独立 `persist:maxma-browser` 会话；多页签共享该会话但各自独立 `WebContentsView`/CDP；开 `contextIsolation`、关 `nodeIntegration`、开 `sandbox`；只允许 http(s)/`about:blank`，`will-navigate`/`will-redirect`/`window.open` 同规则；可选网络 allowlist；权限请求全部拒绝；窗口打开只交给系统浏览器 | 非法协议/重定向被取消；页面拿不到 Node、preload 或 Maxma 主界面；清除数据只清浏览器会话，不改网络策略文件，也不删已下载文件 | `scripts/verify-ui-workbench.mjs` |
| HTML 外部打开守卫 | `desktop/electron/path-actions.cjs` `assertOpenableHtml`：必须是存在、普通的 `.html/.htm` 文件 | 其他文件/目录/符号链接 → 拒绝，不启动任意可执行文件 | `bun-backend/tests/desktop-path-actions.test.ts` |
| 敏感字段脱敏 | `mcp-validation.ts` `REDACTED` + `bun-backend/src/runtime-status.ts` | 写日志/事件/前端响应前脱敏 | 同上 |
| 扩展启停边界 | `bun-sidecar/src/kernel/extensions.ts` `filterDisabledExtensions`（只过滤 `scope=user`）+ `bun-backend/src/routes/extensions.ts`（`isValidExtensionId` 拒绝绝对路径/穿越/`<inline:…>`，内置名 403）+ `extensions-config.ts`（落盘前同校验） | 非用户扩展、内置安全扩展（approval/blocker/telemetry）一律拒绝禁用；非法 id → 400；内置名 → 403 | `bun-sidecar/tests/extensions-visibility.test.ts`、`bun-backend/tests/extensions-route.test.ts` |

## 2. 不可回退的原则

1. **异常一律视为拒绝**，禁止 `catch { /* 继续 */ }` 出现在安全检查路径上。
2. **Token 不进前端构建产物；API Key 不进日志、事件、前端响应。**
3. 权限模式（`read_only` / `ask` / `operate` / `auto`，`kernel/types.ts`）是**附加限制层**：
   只能收紧，任何模式都不得绕过 MaxmaBlocker、PathPolicy、命令守卫、MCP 命令白名单、Provider URL 校验。
   判据只看官方 `Tool.annotations`（`readOnlyHint` / `destructiveHint`）与工具名族，不猜语义。
   `read_only` 的写入/执行是 deny，不是 ask；`auto` 不装审批门，但仍装 PathPolicy / 命令守卫 / 审计。
4. 取消与断线必须经 kernel `cancel`；只取消前端会让 Agent 继续跑并烧模型额度。
5. Electron 壳不引入特权：`contextIsolation` + `sandbox` + `nodeIntegration:false`，
   preload 只暴露原生选择/定位、HTML-only 外部打开和浏览器控制这些窄接口；IPC 校验
   sender frame 必须是 `appOrigin`，渲染层其余能力仍只走 HTTP/WS。主窗口
   `setWindowOpenHandler` 拒绝新窗口，外链仅放行 `https:`/`http:`/`mailto:`。
6. 内置浏览器是**独立、可清除的会话**：不得复用 Maxma 主会话的 cookie/缓存，不得向页面
   暴露 `maxmaDesktop` bridge；清除数据是显式用户动作，不随导航自动发生。
7. 浏览器网络 allowlist 是**收紧开关**，不是放行代理：默认 `all` 表示不额外收紧；只有用户显式切到
   `allowlist` 才按域名放行。Agent 工具没有修改策略的入口，不能把 allowlist 改回 `all` 来绕过限制。
   下载目录、文件名和大小上限由主进程决定，页面不能指定落盘路径。

## 3. 已知缺口（不要当成已具备的保证）

- **PathPolicy 是策略层，不是 OS 沙箱。** 它约束 Agent 的 read/write/edit/grep/find/ls 与可识别的
  bash/powershell 路径参数；工作区根来自用户显式选择，allowlist 来自用户显式追加，二者都不是自动发现。
  `auto` 模式下没有审批门，PathPolicy / 命令守卫 / 审计仍在，但 shell 仍以本机用户权限运行：
  任意可执行文件、编码/脚本/动态拼接路径、环境变量/注册表/COM 等语义无法被字符串策略完全覆盖。
  Windows 的受限 token + Job Object 原生辅助器尚未落地，现状明确标记 `MAXMA_COMMAND_SANDBOX=policy-only`；
  不得宣称“命令被沙箱隔离”或“只能访问工作区”。
  Workbench `workspace roots` 同时是文件面板授权与 Agent PathPolicy 根；删除根只撤销授权，不删磁盘目录。
  旧 `path_whitelist.yaml` 已无读取方，用户磁盘上残留的文件不产生任何拦截效果。
- **网络 allowlist 是可选策略，默认仍全放行。** 默认 `mode:"all"` 与普通浏览器一样可访问任意
  http(s)，包括本机 loopback 与局域网地址；只有用户在浏览器面板显式切到 `allowlist` 并保存域名后，
  才会拦截不在列表中的 HTTP(S) 主请求和子资源。该策略是**浏览器会话级、全局生效**，不按页签隔离；
  它是 Chromium 请求层的收紧，不是操作系统防火墙、代理或企业 DNS 策略，不能替代网络隔离。
  Maxma 的 `/api/**` 仍需 Token，浏览器会话拿不到该 Token，但未鉴权的本地服务仍可能被页面访问；
  当前不得宣称“浏览器只能访问外网”或“浏览器被完全隔离”。
- **下载自动落盘，且下载内容不可信。** 页面触发的下载会直接写入 `<data>/downloads`，没有“每次询问保存位置”
  的系统对话框；文件名来自页面但经主进程清洗，路径不可由页面指定。单文件超过 512 MiB 会被取消，
  非 completed 的半成品会删除，记录最多 20 条。主进程不做病毒/恶意内容扫描；下载后打开或执行文件仍是
  用户自己的风险决策。Agent 可通过 `browser_navigate`（write，走审批门）触发下载，但只能通过
  `browser_read downloads` 读取记录，不能改下载目录、上限或网络策略。
- **浏览器 Agent 现在开放写动作，但边界明确。** `browser_navigate` 与 `browser_act` 都是 write，走审批门；`browser_act` 的 click/fill/select/check/upload 会改变页面甚至提交表单。端点层只接受固定动作白名单；每次调用带 `request_id`，服务端 60 秒内对同 id 返回同一结果，避免重试造成二次副作用。超时返回 `outcome_unknown` 并带 request_id，要求先 snapshot 复核，不得自动重试。
- **CDP 只连内置浏览器的独立 WebContentsView。** `webContents.debugger` 接 Chromium DevTools Protocol，页面仍是 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；CDP 不暴露 Electron 对象，也不给页面主界面 DOM/本地文件能力。无障碍快照只保留可操作/可聚焦节点，最多 120 个；ref 只在当前快照内有效。坐标点击/拖拽只发 `Input.dispatchMouseEvent`，不通过页面脚本点元素。
- **上传是本机文件外发面，必须按写动作看。** `upload` 用 `DOM.setFileInputFiles` 把调用方给的绝对路径写进页面 `input[type=file]`：只收已存在普通文件、最多 10 个、单文件 ≤512 MiB，拒绝相对路径/目录/NUL；它不会读取文件内容进模型上下文，但会把文件提交给当前网页。审批模式应把每次 `browser_act`（含 upload）当作可能外发数据确认；`auto` 模式下没有二次确认，这是与普通浏览器一致的能力边界，不是沙箱。
- **原生输入不等于网页信任。** 点击/键盘/拖拽/上传都是真实输入事件，会触发页面自身校验、风控与确认；Maxma 不替网页绕过验证码、支付密码或二次确认。
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
- **Hooks 是用户自己的代码，不是受控插件市场。** 签名只证明配置来自持有本机 `hooks.secret` 的人；
  `command` 处理器以当前用户权限运行，`http` 处理器会把工具入参/结果发到它配置的远端。启用前必须自己审阅；
  未签名配置整份不加载，但加载后的钩子失败是 fail-open（审计留痕，不阻断主流程）。
  PreToolUse 可以改写工具入参，因此它排在 PathPolicy 之前，改写后的入参仍会被 PathPolicy 复检；
  这不能把“用户自己签名的代码”变成沙箱。
- **本地模型探测只覆盖 loopback，不等于本机模型安全。** `POST /api/models/local-setup` 只允许
  `127.0.0.1`/`localhost`/`::1` 等本机地址，避免把内网或云元数据端点当模型探针；但 Ollama/LM Studio
  本身加载的模型文件、插件和推理内容不在 Maxma 的路径策略内。回退只换渠道，不重试已开始的回合。
- **代码索引是只读加速层，不是权限来源。** 索引库可能包含源码片段与符号名，默认落在用户数据目录；
  是否允许建索引仍由工作区根与 PathPolicy 决定。删除索引库只影响检索，不影响源码。
- **`dev_docs/security/` 已被 `.gitignore` 屏蔽**，不会出现在 `git status`；
  该目录不再存放现行规范，安全事实以本文为准。

### 3.1 扩展（2026-11-18 起）

扩展是 pi 的能力面之一，但**不是沙箱**：扩展代码以与当前会话相同的系统权限运行。
因此启停机制按"能关、但关不掉安全机制"设计：

1. **可禁用的只有 `<agentDir>/extensions` 下的用户扩展**（`scope=user`，id 为相对该目录的
   posix 路径）。Maxma 内联装配的 `maxma-approval` / `maxma-blocker` / `maxma-path-policy` /
   `maxma-audit` / `request-telemetry` **硬拒**（接口 403、过滤函数按 scope 拒绝）——关掉审批扩展
   等于静默取消审批门，关掉路径策略等于静默取消文件边界。
2. 过滤点是官方 `DefaultResourceLoaderOptions.extensionsOverride`（会话级），
   **不写 pi 的全局 settings**：一次 Maxma 内的开关不应扩散到用户命令行里的 pi。
   持久化只在本机 `api/data/disabled_extensions.json`，值是相对路径，换机不会误伤。
3. 禁用语义是"不参与会话"（handler/tool 不注册），**不是隔离**：扩展模块在加载期仍会被
   import，顶层副作用仍会执行。UI 文案必须与此一致。
4. 生效时机是**之后新建的会话**；当前会话保持创建时的扩展集合（扩展在会话创建时加载并绑定）。
5. 加载失败（`extensionsResult.errors`）必须可见：`GET /api/extensions` 与扩展页直接呈现，
   不允许静默吞掉。
