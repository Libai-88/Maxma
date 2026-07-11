# Maxma 借鉴设计执行计划（PLAN-1）

## 0. 目标、边界与执行规则

本计划把 `FIND.md` 中“借鉴但不到位”和“未借鉴但有价值”的设计，按 MaxmaHere 的本地优先、Tauri 桌面端、Python sidecar 架构逐步吸收。这里的“借鉴”是复用已被验证的问题拆解与行为契约，不复制 OpenHanako、Halo 或示例项目的运行时、依赖和 UI 外观。

### 目标

1. 先使后台任务在凭据错误、网络抖动、重启与取消时可诊断、可恢复、不会无声失败。
2. 再把同步阻塞的子 Agent 演进为可持久化、可取消、可恢复、权限不升级的异步工作单元。
3. 在可靠执行底座上提升记忆、上下文、会话与高频交互体验。
4. 最后才引入 Workflow、Canvas、模型路由和有限自治，且始终由明确权限、审计和 feature flag 约束。

### 非目标

- 不迁移 OpenHanako 的 Node/React 服务端、数据库模型或其云端/多端假设。
- 不在本计划内实现 IM Bridge、Hub 多端路由、远程写操作 Lease；没有明确消费者前不增加分布式运行时。
- 不把 Agent 输出作为可执行的任意 HTML、JavaScript、Shell 或系统权限请求。
- 不以“补齐清单”为理由重写已经到位的流式修复、Provider fallback、情景记忆隔离、工具气泡或现有工作台。

### 共同约束

- 保持包名 `maxma_platform`；路径常量继续收敛到 `app_paths.py`；YAML 写入继续通过 `api/yaml_store.py` 的原子替换。
- 持久化副作用采用现有 LTM outbox 的幂等、lease 和 fencing token 原则；取消路径必须显式处理 `asyncio.CancelledError`。
- 后端健康状态只使用 `ok` / `degraded` / `error`；前端不可显示 API key、Authorization、MCP server URL 的敏感查询参数或原始上游异常堆栈。
- 每一项先提供关闭状态下零行为变化的 feature flag，再按“开发环境 -> 人工试用 -> 默认开启”推进；一次只打开一个高风险 flag。
- 每个步骤只触碰本步骤列出的文件和新增测试，单独提交；不使用 `git add -A`，不回退无关工作区改动。

### 通用验证命令

在仓库根目录执行，统一使用隔离环境。Windows 全量 `pytest -q` 可能无输出挂起，因此以步骤相关目录的详细模式为主，阶段验收后才分组回归。

```powershell
pytest.bat tests/test_memory -v
pytest.bat tests/test_api -v
pytest.bat tests/test_agent -v
pytest.bat tests/test_tools -v
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7 agent api config maxma_platform memory tools tests
.venv\Scripts\python.exe -m compileall -q agent api config maxma_platform memory tools
Set-Location web; npm run build
```

## 1. 依赖顺序与验收闸门

```text
0 基线与契约
  -> 1 可靠性与安全
      -> 2 异步执行与权限
          -> 3 会话、上下文与记忆
          -> 4 高频交互体验
              -> 5 工件与工作区
                  -> 6 引导与有限自治
```

阶段 1 是阶段 2 的前置：后台任务没有稳定的错误语义、健康反馈和系统隔离前，不能扩大并发与自治范围。阶段 2 是阶段 3-5 的前置：需要先定义任务身份、恢复、取消、权限继承和事件边界。阶段 6 只能在前五阶段均有审计和可观测数据时进入。

每个阶段结束都要满足以下闸门，才能开始下一阶段：

1. 该阶段的新增单元、API 和前端测试全部通过，且相关既有测试无回归。
2. 默认关闭的开关确实不改变旧路径；开启后成功、失败、取消、重启至少各有一个自动化用例。
3. 无敏感信息出现在 HTTP 响应、WebSocket 事件、浏览器控制台或审计摘要中。
4. `git diff --check` 和上面的静态/编译检查通过；桌面相关变更额外完成一次 `web` 构建。
5. 记录一次人工验收：正常操作、断网、无效 key、429、5xx、超时和进程重启中的适用组合。

## 2. 阶段 0：基线、契约与安全发布面

### 0.1 建立能力矩阵和架构决策记录

**做什么：** 把 `FIND.md` 每项设计映射为“现有实现、目标行为、开关、数据归属、风险、验收证据、负责人/状态”。对涉及持久化、权限、系统隔离、远程调用的选择写成简短 ADR。

**为什么：** 现有清单说明“值得借鉴”，但尚未形成不可歧义的产品契约。没有这一层，后续功能容易重复、跨阶段越权或把参考项目的假设带进 Maxma。

**文件：** 修改 `FIND.md` 的状态表；新建 `dev_docs/adr/` 下的编号 ADR 文件（新建），例如异步子 Agent、权限模式、LTM 错误分类和工件协议。保留 `DESIGN.md`、`PRODUCT.md` 作为 UI 和产品约束来源，不在本步改写它们。

**验证：** 人工审阅：FIND 中高/中优先级项均有唯一落点和阶段，且没有一个任务同时由两个阶段修改同一持久化表或同一事件名称。对 ADR 中的每一个 API/事件写出示例 payload 和脱敏要求。

**发布与注意：** 纯文档，无 feature flag。ADR 只记录已作出的决策，未知项标成待决，不把猜测伪装为结论。

### 0.2 统一运行时状态与可观测性词汇

**做什么：** 定义后台作业、Provider、MCP、沙盒共用的状态字段：`status`、`reason_code`、`retry_at`、`updated_at`、面向用户的安全摘要和仅日志可见的技术详情。把健康状态保持为现有 `ok/degraded/error`，后台作业则单独使用 `queued/running/succeeded/failed/cancelled`。

**为什么：** 目前 `api/health.py`、`api/providers/manager.py`、`memory/narrative.py` 各自记录状态。先统一词汇，才能让前端反馈错误而不是解析日志文本。

**文件：** 修改 `api/health.py`、`api/providers/manager.py`、`memory/narrative.py`；必要时新建 `api/runtime_status.py`（新建，放纯数据模型和错误到状态的映射）；修改 `web/src/stores/health.ts`、`web/src/stores/provider.ts`；新增相应 `tests/test_api/` 测试文件（新建）。

**验证：** `pytest.bat tests/test_api/test_health.py -v`、`pytest.bat tests/test_api/test_providers_runtime.py -v`；断言三种健康词汇不变，API 响应没有 `api_key`/`authorization`/token；`npm run build`。

**发布与注意：** 先仅增加字段，旧字段和旧 UI 保持兼容至少一个小版本。状态文本使用稳定 reason code，前端负责本地化，不能以英文异常字符串作为判断条件。

### 0.3 Feature flag 清点与逐步开启试验矩阵

**做什么：** 为 `stream_repair_enabled`、`coordinator_enabled`、`verifier_enabled`、`delegation_scope_enforced`、`crag_enabled`、`autonomy_enabled` 和 `autonomy_self_improve_enabled` 建立开关所有者、默认值、依赖、回滚方式和观察指标；补测试证明关闭时走旧路径、开启时只改变声明的行为。

**为什么：** `HANDOFF.md` 已指出多个默认关闭能力未在真实使用中充分验证。无基线直接开启会混淆回归来源。

**文件：** 修改 `config/settings.py` 的注释和分组；修改触发这些开关的现有模块 `agent/graph.py`、`agent/delegation_scope.py`、`tools/stream_repair.py`（仅在文件已存在时）；新增或扩展 `tests/test_agent/test_delegation_scope.py`、`tests/test_api/test_chat_memory_projection.py` 和对应实际模块的测试。

**验证：** 每个开关至少两条测试：默认关闭和显式开启。按顺序手工灰度：先 `stream_repair_enabled`，再 `coordinator_enabled`，最后 `verifier_enabled`；每次只在测试配置开启一个，连续观察 Provider 错误、延迟和重复工具调用。

**发布与注意：** 不以环境变量覆盖未知用户配置；配置变更后用 `config.settings.reload_settings()` 的既有语义刷新。`autonomy_*` 在阶段 6 前始终保持关闭。

## 3. 阶段 1：可靠性与安全（近期实现）

### 1.1 LTM 错误分类、指数退避和死信可见性

**做什么：** 将 `memory/narrative.py` 的 `_is_unrecoverable_error()` 扩展为显式错误分类：认证/权限/请求格式等永久错误立即完成该 outbox job 并记录失败原因；网络、超时、429、408、409、425、5xx 等暂时性错误根据 attempts 做 capped exponential backoff 加全抖动；未知错误遵循有限重试。为超出预算或永久错误保留可查询的“死信/已放弃”记录，而不是静默完成。

**为什么：** 当前已修复 401 无限重试和最大重试，但连接错误与上游限流仍没有面向用户和维护者的一致恢复语义。LTM 是异步路径，错误若不可见会造成用户误以为记忆已更新。

**文件：** 修改 `memory/narrative.py`、`memory/ltm_outbox.py`；修改 `api/health.py` 以暴露汇总而非原始内容；新增 `tests/test_memory/test_ltm_retry_policy.py`（新建）并扩展 `tests/test_memory/test_ltm_outbox.py`、`tests/test_api/test_health.py`。

**验证：** `pytest.bat tests/test_memory -v` 和 `pytest.bat tests/test_api/test_health.py -v`。使用可注入时钟/随机数验证：401/403 不重试；连接失败和 429 有递增且不超过最大值的 `available_at`；5xx 达最大次数后进入可统计的 terminal 状态；取消不会重试；同一 `(session_id, turn_id)` 重放不重复写记忆。

**发布与注意：** 新增 `ltm_retry_policy_enabled`（默认 `False`）先 shadow 计算并记录建议分类，再打开实际调度；需要回滚时保留原 `fail()` 路径。退避绝不能在协程内 `sleep` 持有 SQLite 事务或 lease；时钟使用可测试的单调/注入时间源；不得把对话正文写入健康摘要。

### 1.2 Provider 与 LTM 健康反馈闭环

**做什么：** 将 LTM 最近一次 terminal failure 以脱敏诊断码关联到当前 Provider 状态，并在 Provider 页面和健康面板显示“配置有误、网络不可达、被限流、服务异常、正在重试”的可操作提示；提供手动“重新检测”入口，不自动泄露或重试用户已明确禁用的 Provider。

**为什么：** `api/routes/providers.py` 已有按需健康检查和 `ProviderManager` 状态，但 LTM 认证失败仍会在后台静默。用户应知道问题在哪个 Provider，而不是看到“记忆没有生效”。

**文件：** 修改 `memory/narrative.py`、`api/health.py`、`api/routes/providers.py`、`api/providers/health_monitor.py`；修改 `web/src/stores/health.ts`、`web/src/stores/provider.ts`、`web/src/components/HealthPanel.vue`、`web/src/views/ProvidersView.vue`；扩展 `tests/test_api/test_health.py`、`tests/test_api/test_providers_runtime.py`，新增前端测试文件（新建，放在 `web/tests/`）。

**验证：** 后端测试验证 401 会展示脱敏的 `authentication_failed`，429 展示 `rate_limited` 和下次重试时间，网络错误显示 `degraded`；前端测试验证提示可见、重新检测触发既有 `/providers/{id}/health`，且不渲染 key。运行 `npm run build`。

**发布与注意：** 由 `provider_diagnostics_enabled`（默认 `False`）控制 UI 展示，后端只增加兼容字段。Provider 健康与 LTM job 健康不能互相覆盖：一次 LTM 失败不能立即把所有聊天请求切走；继续遵守 `provider_unhealthy_threshold`。

### 1.3 凭据加密信封与一次性迁移

**做什么：** 审计现有 Provider SQLite/YAML 存储和 `tools/crypto.py`，将 at-rest 密钥保存改为带版本号、算法标识、key id 的加密信封；首次读取旧格式后在单一事务/原子文件替换中迁移；提供只读预检和可恢复备份策略。

**为什么：** FIND 认定凭据保护尚未借鉴到位。本地优先不等于明文落盘，且升级不能使已有 Provider 配置丢失。

**文件：** 修改 `tools/crypto.py`、`api/providers/store.py`、`api/db/providers.py`、`api/yaml_store.py`、`app_paths.py`；新增 `api/security/credential_envelope.py`（新建）和迁移测试文件 `tests/test_api/test_provider_credential_migration.py`（新建）；必要时更新 `SECURITY.md`。

**验证：** 新旧记录都能读取；迁移幂等；数据库/文件中不出现明文 key；错误 key id、损坏密文和中断迁移可恢复且不覆盖旧数据；`pytest.bat tests/test_api/test_providers_masking.py -v` 和新增迁移测试通过。

**发布与注意：** 不自创弱加密或把主密钥与密文写在同一配置文件；必须先确认桌面端已有安全存储/密钥来源，否则本步骤停在设计与预检，不假设可安全取得主密钥。迁移在单写者和备份存在时才执行，日志仅记录 Provider id 和信封版本。

### 1.4 MCP 凭据提前刷新、重连和脱敏

**做什么：** 为四种既有 MCP transport 增加统一连接生命周期：到期前预刷新（目标 60 秒）、连接中断的限额退避重连、可观察的连接状态，以及 telemetry/错误中的 server id 和工具名脱敏。对不可刷新凭据返回明确的配置诊断。

**为什么：** MCP 已支持 stdio/SSE/HTTP/WS，但 FIND 指出缺 OAuth 提前刷新与自动重连；这会把可恢复的临时中断变成聊天失败。

**文件：** 修改 `tools/mcp.py`、`tools/mcp_runtime.py`、`tools/mcp_security.py`、`api/routes/mcp.py`、`api/routes/mcp_test.py`；扩展 `tests/test_api/test_mcp_runtime.py`、`tests/test_api/test_mcp_test_route.py`、`tests/test_tools/test_mcp_security.py`，新增 `tests/test_tools/test_mcp_connection_lifecycle.py`（新建）。

**验证：** mock transport 验证提前刷新一次、并发刷新去重、断线退避上限、取消即停止重连；测试 HTTP/WS/stdio 至少覆盖各一条；日志断言不含 token、完整 URL query 或原始 MCP 工具名。执行 `pytest.bat tests/test_tools -v` 与 `pytest.bat tests/test_api/test_mcp_runtime.py -v`。

**发布与注意：** 新增 `mcp_connection_lifecycle_enabled`（默认 `False`），保留当前一次性初始化路径。重连任务必须由应用生命周期关闭，避免测试和退出时残留；不得因为刷新失败降低 `mcp_force_tls`、host/port 白名单或速率限制。

### 1.5 双层沙盒：应用路径边界加 Windows 受限执行

**做什么：** 保持现有应用层路径检查为每次文件/代码执行的必经点，并把 `sandbox_isolation_level` 的 Windows 分支补为受限进程能力：最小权限 token/job object、资源上限、工作目录和显式网络策略。先输出能力检测和实际隔离级别，不能声明“已隔离”而实际回退。

**为什么：** FIND 的双层沙盒价值在于“即使应用层校验被绕过，系统层仍限制影响面”。当前 `tools/system/sandbox_runner.py` 与设置中已有隔离入口，适合增量补齐。

**文件：** 修改 `tools/system/sandbox_runner.py`、`config/settings.py`、`app_paths.py`、`api/health.py`；扩展 `tests/test_tools/test_sandbox_isolation.py`、`tests/test_tools/test_sandbox_metaprogramming.py`；新增 `tests/test_tools/test_windows_sandbox_contract.py`（新建）。

**验证：** 单元测试模拟各平台选择逻辑；Windows 集成测试确认超时、内存限制、工作目录逃逸、网络禁用与取消清理。无系统能力时状态必须为 `degraded` 并说明已采用的后备层。执行 `pytest.bat tests/test_tools -v`。

**发布与注意：** 新增 `sandbox_windows_restricted_process_enabled`（默认 `False`）；先仅记录能力和 dry-run，再在 Windows 测试机灰度。不要误用 `firejail` 作为 Windows 隔离；路径白名单、`check_path_access()` 和 MaxmaBlocker 不因 OS 隔离而删除；处理 reparse point/symlink 和子进程树。

## 4. 阶段 2：异步子 Agent 与四档权限（近期实现）

### 2.1 定义异步任务与 Deferred Result Store 的持久化契约

**做什么：** 为子 Agent 定义稳定的 run id、父 session/turn、委派范围快照、模型/Provider 快照、输入摘要、状态、结果引用、错误摘要、取消原因和过期策略。实现“提交后立即返回卡片摘要，结果由后台回灌”的 durable store；重启后恢复 queued/running 中可安全重试的任务，不能重复执行非幂等副作用。

**为什么：** 这是 FIND 中最高优先级架构缺口。当前 `tools/sub_agent/tool_call_sub_agent.py` 与 `tool_parallel.py` 仍将父 Agent 绑定在等待路径上，无法让长任务和主对话独立推进。

**文件：** 修改 `tools/sub_agent/tool_call_sub_agent.py`、`tools/sub_agent/tool_parallel.py`、`tools/sub_agent/delegation_context.py`、`api/session_manager.py`；新增 `tools/sub_agent/deferred_result_store.py`、`tools/sub_agent/run_manager.py`（均为新建）；新增 `tests/test_tools/test_deferred_result_store.py`、`tests/test_tools/test_sub_agent_run_manager.py`（新建）。

**验证：** 提交立即返回 run id；结果可幂等回灌一次；父会话关闭、子任务超时、取消、sidecar 重启和重复 delivery 都有测试；`pytest.bat tests/test_tools/test_delegation_context.py -v`、`pytest.bat tests/test_tools/test_delegation_scope_parallel.py -v` 和新增测试通过。

**发布与注意：** `async_subagent_enabled` 默认 `False`；开启时仅允许只读、无副作用的委派模板，写操作仍走同步确认路径。run store 的事务边界与 LTM outbox 相同，必须有租约/fencing 或等价单 owner 机制；不把完整子消息流复制进父会话持久化表。

### 2.2 调度、取消、超时、重启恢复与父子事件隔离

**做什么：** 在 run manager 上增加有上限的队列、并发配额、deadline、取消传播、心跳/孤儿回收和 restart recovery；WebSocket 主流只发送子任务状态摘要，用户展开子卡后才订阅对应 child run 的增量事件。

**为什么：** fire-and-forget 不等于无管理后台。没有资源上限和流隔离，子 Agent 会拖垮主会话或把高频 token 流泄露到错误会话。

**文件：** 修改 `tools/sub_agent/tool_call_sub_agent.py`、`tools/sub_agent/delegation_context.py`、`api/routes/chat.py`、`api/server.py`、`api/session_manager.py`；修改 `web/src/stores/chat.ts`、`web/src/composables/useChat.ts`、`web/src/components/ChatWindow.vue`；新建 `web/src/components/SubAgentCard.vue` 和新增后端/前端测试文件（新建）。

**验证：** 自动化测试验证父会话在子任务运行期间仍可收发消息；取消不会将 `CancelledError` 误记为失败并重试；重启后可恢复/标记不可恢复；未展开卡片不订阅 child token 流；跨 session 无法读取别人的 run。执行 `pytest.bat tests/test_api -v`、`pytest.bat tests/test_tools -v` 与 `npm run build`。

**发布与注意：** `subagent_stream_on_demand_enabled` 依赖 `async_subagent_enabled`，不能单独打开。所有 background task 必须在 `api/server.py` shutdown 停止和 await；限制每 session 与全局并发数，并防止子 Agent 再无限派生子 Agent。

### 2.3 四档权限模式与统一审批决策

**做什么：** 把现有审批网关扩展成会话级 `read_only / ask / operate / auto`：read_only 拒绝写/执行；ask 按风险确认；operate 允许已获授权的本地操作但外部或高风险动作仍确认；auto 只能在能力白名单、作用域、审计和系统硬边界内自动执行。前端在输入区提供明确模式切换和当前模式可见状态。

**为什么：** `agent/approval_gateway.py` 与 `web/src/components/ApprovalBubble.vue` 已能审批，但没有用户可理解、可持续的风险偏好。四档模式是异步委派、Workflow 与自治的共同安全契约。

**文件：** 修改 `agent/approval_gateway.py`、`agent/approval_tool_node.py`、`agent/delegation_scope.py`、`config/settings.py`、`api/routes/sessions.py`、`api/const_session_store.py`；修改 `web/src/components/ChatInput.vue`、`web/src/components/ApprovalBubble.vue`、`web/src/stores/session.ts`；新增 `web/src/components/PermissionModeControl.vue`、`tests/test_agent/test_permission_modes.py`（新建）及前端测试（新建）。

**验证：** 对每个模式和每类工具至少一条 allow/ask/deny 测试；子 Agent 只能继承或收窄父权限，不能升档；重启后 session 模式一致；用户拒绝、审批超时和 WebSocket 断开均安全失败。执行 `pytest.bat tests/test_agent -v`、`pytest.bat tests/test_tools -v` 与 `npm run build`。

**发布与注意：** `permission_modes_enabled` 默认 `False`，关闭时严格保持 `approval_gateway_enabled` 旧语义。模式是“额外限制层”，永远不能绕过工具白名单、路径安全、MCP TLS/host 限制或系统沙盒；默认模式取最保守的兼容值，不能自动把旧会话升级到 auto。

### 2.4 委派作用域、Provider 快照和审计闭环

**做什么：** 将每次异步委派的目标、允许工具、路径、网络、token/时间预算、权限模式和 Provider/model 固化为不可变快照；父级配置变化不影响已运行任务，结果回灌和审计事件引用同一 run id。

**为什么：** HANDOFF 已强调子 Agent 权限继承；异步化后若读取可变全局设置，会出现执行中换模型、绕过新限制或无法复盘的竞态。

**文件：** 修改 `tools/sub_agent/delegation_context.py`、`agent/delegation_scope.py`、`agent/audit_log.py`、`api/routes/audit_log.py`；扩展 `tests/test_tools/test_delegation_context.py`、`tests/test_tools/test_delegation_scope_single.py`、`tests/test_tools/test_delegation_scope_parallel.py`。

**验证：** 测试父配置在任务提交后改变时 run 使用原快照；无权限路径/工具被拒绝；审计中可从 run id 找到提交、审批、执行、取消和回灌事件，但不含提示词正文和密钥。

**发布与注意：** 此步跟随 `async_subagent_enabled`，不引入第二套权限检查。审计写入失败不得放行高风险操作；审计本身失败应使 ask/operate/auto 采取保守拒绝。

## 5. 阶段 3：会话、上下文与记忆

### 3.1 Cache-preserving Session Compaction

**做什么：** 在保留 `agent/context_manager.py` 和 `api/routes/session_compress.py` 现有摘要能力的基础上，固定系统提示、人格、工具定义和稳定前缀；将动态摘要指令放在缓存前缀之后，并保存结构化摘要版本、来源 turn 边界与 token 统计。

**为什么：** FIND 的 cache-preserving compaction 能降低长会话成本并减少上下文压缩的语义漂移，现有功能已有良好接入点。

**文件：** 修改 `agent/context_manager.py`、`api/routes/session_compress.py`、`api/const_session_store.py`、`web/src/stores/session.ts`；扩展压缩相关现有测试，新增 `tests/test_agent/test_context_compaction_cache.py`（新建）。

**验证：** 相同静态前缀字节级稳定；压缩后最近消息、工具审批记录和摘要版本存在；重复压缩幂等；低于阈值不触发。执行新增测试和 `pytest.bat tests/test_agent -v`。

**发布与注意：** `cache_preserving_compaction_enabled` 默认 `False`。不得把敏感工具结果塞入摘要；压缩失败回退到当前算法，不能丢会话。

### 3.2 Memory Ticker 与 FactStore 混合检索

**做什么：** 将全量记忆维护演进为按日增量 ticker：可断点、可重放、每步有幂等输入/输出；把叙事记忆与 `memory/fact_store.py` 的结构化事实分层检索，并按 CJK/FTS5 适配实际查询。

**为什么：** 长期记忆增长后需要可控的后台维护，而不是每次全量重新计算；结构化事实适合精确检索，叙事适合人格上下文。

**文件：** 修改 `memory/narrative.py`、`memory/fact_store.py`、`memory/pinned_store.py`、`memory/ltm_outbox.py`、`api/routes/memory.py`；新建 `memory/memory_ticker.py` 与 `tests/test_memory/test_memory_ticker.py`（新建）。

**验证：** 断点恢复不重复投影；跨天只处理新增 turn；ticker 崩溃后重启可继续；混合检索排序确定且 session/persona 不串数据。执行 `pytest.bat tests/test_memory -v`。

**发布与注意：** `memory_ticker_enabled` 默认 `False`，与 LTM outbox 共用幂等身份但不共用 worker lease；先 shadow 运行比较结果，不能直接替换用户现有记忆。

## 6. 阶段 4：高频交互体验

### 4.1 工具结果摘要、长流程折叠与失败呈现

**做什么：** 对主聊天中的大工具输出提供固定高度摘要、按需展开、复制和错误摘要；对子 Agent/Workflow 长流程展示状态而非完整 token/日志；错误使用现有红色、警告使用 amber，遵循 `DESIGN.md` 的克制单色系统。

**为什么：** FIND 中的静态卡与按需流订阅能提高聊天可读性，且阶段 2 的事件边界已为其提供基础。

**文件：** 修改 `web/src/components/ToolBubbleRouter.vue`、`web/src/components/ToolCallCard.vue`、`web/src/components/ErrorCard.vue`、`web/src/components/MessageBubble.vue`、`web/src/stores/chat.ts`；扩展 `web/src/components/tools/registry.ts`；新增相关前端测试（新建）。

**验证：** 长内容不撑破会话布局；展开前不会渲染大 payload；失败能显示安全摘要并保留重试/诊断入口；`npm run build` 和组件测试通过。

**发布与注意：** `compact_tool_results_enabled` 默认 `False`；不使用 `v-html` 渲染摘要；折叠不等于删除，原始结果仍按现有数据保留策略可审计。

### 4.2 多会话缓存、懒加载、分段流和快捷键

**做什么：** 在 `web/src/stores/session.ts` 和聊天数据层增加有上限的会话列表/消息页缓存、显式失效、滚动懒加载和批量流更新；补全聊天、搜索、切换会话、停止、权限切换的快捷键，并确保输入法组合键不误触发。

**为什么：** 这是高频使用中的直接延迟收益，且不改变 Agent 语义。

**文件：** 修改 `web/src/stores/session.ts`、`web/src/stores/chat.ts`、`web/src/composables/useChat.ts`、`web/src/components/ChatWindow.vue`、`web/src/components/ChatInput.vue`、`web/src/components/SessionSidebar.vue`；新增 composable 和前端测试文件（新建）。

**验证：** 切换会话不会显示错消息；缓存失效后刷新正确；流式 token 批量更新不丢尾包；快捷键在输入法和 modal 中不误触发；`npm run build`。

**发布与注意：** `session_cache_enabled` 默认 `False`，缓存只能保存已脱敏 UI 数据；设置容量上限和 LRU，登出/清除本地数据时同步清空。

### 4.3 Pulse 状态面板与渐进式首次引导

**做什么：** 将现有 `HealthPanel.vue` 扩展为可折叠 Pulse 面板，汇总 Provider、LTM、MCP、沙盒和后台 run；首次启动引导只覆盖语言/名字、Provider、模型、主题、工作区和简短教程，允许跳过并可在设置重进。

**为什么：** 用户需要看到系统是否“能工作”，但不应面对开发者监控面板；引导降低首次配置失败率。

**文件：** 修改 `web/src/components/HealthPanel.vue`、`web/src/stores/health.ts`、`web/src/views/ProvidersView.vue`、`web/src/router/index.ts`；新建 `web/src/views/OnboardingView.vue`、`web/src/stores/onboarding.ts` 及前端测试（均为新建）；必要时扩展 `api/health.py`。

**验证：** 新用户可跳过，完成状态持久化；Provider 无效时被引导到修复入口；老用户不被重复打断；离线/无 Provider 时可正常进入只读 UI；`npm run build`。

**发布与注意：** `onboarding_enabled` 默认 `False`，完成状态存本地用户数据，不上传；不把首次引导强绑定到某家 Provider 或模型。

## 7. 阶段 5：受控工件、Canvas 与 Workflow

### 5.1 受 schema 约束的确认卡和交互卡协议

**做什么：** 定义后端到前端的 versioned UI artifact schema，只允许已注册卡片类型、结构化数据和显式用户动作；前端通过 registry 渲染，不接受任意组件名、HTML 或 JavaScript。

**为什么：** 交互工件是 Maxma 工作台的自然延伸，但没有协议会扩大 XSS 与权限面。

**文件：** 修改 `web/src/components/workbench/canvas-registry.ts`、`web/src/components/workbench/CanvasContainer.vue`、`web/src/stores/workbench.ts`、`api/routes/chat.py`；新建 `api/artifacts/schema.py`、`tests/test_api/test_artifact_schema.py` 和前端卡片测试（新建）。

**验证：** 未注册 type、过大 payload、未知 action、HTML/script 均被拒绝；合法确认卡能触发现有审批网关；`pytest.bat tests/test_api -v` 与 `npm run build`。

**发布与注意：** `interactive_artifacts_enabled` 默认 `False`；卡片动作仍经阶段 2 权限与审计，不能由前端直接调用受保护工具。

### 5.2 Workflow journal、逐层视图与可恢复执行

**做什么：** 在异步 run 之上实现确定性 Workflow：phase/node、输入输出引用、journal checkpoint、取消/恢复与两级展开视图。Workflow 只编排已注册 Agent/工具，不执行用户提供的任意脚本。

**为什么：** FIND 的 Workflow 价值是可复盘、可继续的多步任务，不是增加另一种无约束自动化语言。

**文件：** 新建 `tools/workflow/`（新建目录及模块）、`api/routes/workflows.py`、对应 `tests/test_tools/test_workflow_*.py`；修改 `api/server.py`、`api/session_manager.py`、`web/src/components/workbench/WorkbenchPanel.vue`；新建 `web/src/components/workbench/WorkflowCard.vue`。

**验证：** 节点成功、失败、取消、重启恢复、幂等 checkpoint、权限拒绝均可复现；Workflow 流不污染父聊天流；前后端构建和相关测试通过。

**发布与注意：** `workflow_enabled` 默认 `False`，依赖阶段 2 的 `async_subagent_enabled` 和 `permission_modes_enabled`；禁止动态 `eval`、任意 JS、跨工作区路径和隐式网络权限。

### 5.3 Canvas 多 Tab 与持久化工作区

**做什么：** 将现有卡片工作台渐进扩为有边界的多 Tab（代码、HTML 预览、JSON、Markdown、表格），支持 pin、关闭、恢复和工件来源引用；HTML 仍由 `HtmlSandbox.vue` 隔离。

**为什么：** FIND 的 Canvas 多 Tab 能让长输出成为可继续编辑的工作成果，但不应替换聊天为全屏 Dashboard。

**文件：** 修改 `web/src/components/workbench/CanvasContainer.vue`、`web/src/components/workbench/canvas-registry.ts`、`web/src/stores/workbench.ts`、`web/src/components/HtmlSandbox.vue`；新建 `web/src/components/workbench/CanvasTabs.vue` 和前端测试（新建）。

**验证：** 多 Tab 切换、恢复、关闭不丢引用；不可信 HTML 无法访问父窗口；大文本懒加载；`npm run build`。

**发布与注意：** `canvas_tabs_enabled` 默认 `False`，保留原卡片入口。代码编辑和文件写入必须分开，保存到磁盘仍走路径安全与审批。

## 8. 阶段 6：引导式思考、声明式路由与有限自治

### 6.1 ThinkPath 与声明式 Provider/角色路由

**做什么：** 为复杂请求提供可选的 3-4 条简短思维路径和预计成本/深度，用户确认后执行；将 Provider 模型能力、成本/上下文、角色偏好和 fallback 规则声明化，仍复用 `api/providers/manager.py` 的健康筛选。

**为什么：** 用户可以在质量、时间和 token 成本间做可见选择；声明式路由减少在图代码中散落的 Provider 特例。

**文件：** 修改 `agent/graph.py`、`api/providers/manager.py`、`api/providers/store.py`、`config/settings.py`、`web/src/components/ChatInput.vue`、`web/src/stores/provider.ts`；新建 `agent/think_path.py`、`config/model_roles.yaml`、相关测试（新建）。

**验证：** 用户未选择时走旧路径；路由不会选择 error Provider；同一输入/配置下选择确定；无匹配能力时回退到当前默认策略。执行 `pytest.bat tests/test_agent -v`、`pytest.bat tests/test_api -v` 和 `npm run build`。

**发布与注意：** `think_path_enabled`、`declarative_model_routing_enabled` 都默认 `False`；不根据不透明提示词猜测敏感任务类别，不自动把用户配置的模型替换为昂贵模型。

### 6.2 Scout/Scheduler/Delivery 与信任审计

**做什么：** 在全部权限、Workflow、审计、沙盒和健康闸门通过后，才引入有限的后台 Scout（发现）、Scheduler（定时）和 Delivery（送达）角色；每次运行都要有用户创建的目标、预算、权限快照、可撤销 schedule 与完整审计。技能自改进继续限制为现有白名单。

**为什么：** 有限自治能减少重复任务，但它是高风险放大器，必须建立在前述可取消、可解释、可恢复的执行模型上。

**文件：** 修改 `agent/autonomy/` 下现有模块、`config/settings.py`、`api/routes/audit_log.py`、`api/routes/event_hooks.py`；新增自治角色模块和测试文件（新建）；必要时修改 `web/src/stores/activity.ts` 与工作台组件。

**验证：** 默认关闭；创建、暂停、恢复、删除 schedule；预算耗尽、权限下降、Provider 故障、重启和用户取消均停止；自治 Agent 不可调用白名单外工具；审计可完整复盘。执行 `pytest.bat tests/test_agent -v`、`pytest.bat tests/test_api -v`、`pytest.bat tests/test_tools -v`。

**发布与注意：** `autonomy_enabled` 和 `autonomy_self_improve_enabled` 继续默认关闭且分开灰度；先只读 Scout，再人工确认 Delivery，最后才评估可自动执行的低风险任务。任何自治失败必须保守停止，不可自动放宽权限或无限重试。

## 9. 变更隔离、交付节奏与最终验收

### 单元化提交边界

- 每个小节（如 1.1、1.2、2.1）是一个独立变更单元：实现、针对性测试、文档/ADR与开关定义同一提交。
- 不在一个提交中同时迁移凭据格式与实现异步子 Agent；不在一个提交中同时改 API 契约和大面积视觉重设计。
- 前后端共同改动时，后端先增加向后兼容字段，再增加前端消费，最后在下一版本才考虑移除废字段。
- 对 SQLite schema，先做幂等迁移和旧版本读取测试；对 YAML，先写临时文件并原子替换；对后台队列，先做 crash/replay 测试。

### 建议近期执行顺序

1. 0.1、0.2、0.3：形成可审计的基线与发布面。
2. 1.1、1.2：首先解决 LTM 重试和用户可见健康反馈，这是当前明确的生产缺口。
3. 1.4、1.5：完成 MCP 生命周期和 Windows 双层沙盒的能力检测/灰度。
4. 1.3：待确认桌面端密钥托管方案后实施加密迁移，不能以自制密钥绕过该前提。
5. 2.1、2.2、2.3、2.4：依次建立异步任务存储、调度边界、权限模式和不可变委派快照。
6. 阶段 3 与 4 可在阶段 2 完成后并行，但同一文件（尤其 `api/routes/chat.py`、`web/src/stores/chat.ts`）一次只由一个变更单元修改。
7. 阶段 5、6 必须等前置闸门完成，不以 UI 原型替代安全和恢复语义。

### 最终验收清单

1. 一个无效 API key 不会产生无限 LTM 重试，用户能在 Provider/Pulse 面板看到安全、可行动的提示。
2. 断网、429、5xx 和重启后的 LTM/MCP/子 Agent 行为与文档定义的状态和退避一致。
3. 异步子 Agent 不阻塞父聊天，结果只回灌一次，取消/超时/重启/权限继承均可测试。
4. 四档权限不会绕过任何既有硬边界，子任务和 Workflow 无法自行提权。
5. 长会话压缩、记忆 ticker、会话缓存和工件 UI 均可关闭回退，且不会串会话、泄密或破坏旧数据。
6. 完成所有相关目录测试、静态检查、Python 编译检查和前端构建；桌面影响项再执行一次 `build/build-desktop.bat` 的人工冒烟验证。
