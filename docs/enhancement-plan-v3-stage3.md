# MaxmaHere 阶段 3 实施计划：工程弹性（熔断/限流/降级 + 沙箱加固）

> **版本**：v3-stage3
> **创建时间**：2026-07-04
> **目标**：补齐生产级容错能力（工具熔断 + API 限流 + LLM provider 降级）+ Python 沙箱安全加固（OS 级隔离 + 元编程入口过滤）
> **前置依赖**：阶段 2.3（失败重规划）共享 ErrorRecoveryManager 抽象；阶段 1.6（metrics SQLite 持久化）承接熔断/限流指标落盘
> **追踪方式**：每个任务含「相关文件」「改动类型」「预期改动点」「状态」四字段，开发时按文件路径定位即可

---

## 总览

| 子任务 | 名称 | 优先级 | 涉及文件数 | 新建文件数 |
|---|---|---|---|---|
| 3.1 | 工具熔断（ErrorRecoveryManager + CircuitBreaker） | P1 | 8 | 2 |
| 3.2 | API 限流（令牌桶 + RATE_LIMITED 错误码落地） | P1 | 8 | 2 |
| 3.3 | LLM provider 降级（优先级 + 健康标记 + fallback） | P1 | 13 | 2 |
| 3.4 | Python 沙箱 OS 级隔离（firejail/nsjail/Job Object） | P1 | 11 | 3 |
| 3.5 | 沙箱元编程入口过滤 + MAX_MEMORY_MB 真正生效 | P0 | 5 | 1 |

---

## 关键背景发现（影响设计）

1. **error_recovery 已接入 executor（阶段 2.3 完成）**：[agent/error_recovery.py](file:///d:/Maxma/MaxmaHere/agent/error_recovery.py) 的 `ErrorRecoveryManager` 已在阶段 2.3 接入 [agent/executor.py](file:///d:/Maxma/MaxmaHere/agent/executor.py)：`record_failure`/`record_success`/`should_replan`/`build_replan_trigger` 均已落地；`_suggest_alternatives` 已扩充 parallel_execute→call_sub_agent、call_sub_agent→（无）、file_read→file_search/run_python 等映射；`ReplanTrigger` 数据类已携带 alternative_tools + suggestion_message。阶段 3.1 需在其上叠加 CircuitBreaker，**复用现有失败计数抽象，避免两套独立机制**
2. **CircuitBreaker 概念完全不存在**（grep 0 命中），需从零新建
3. **RATE_LIMITED 错误码已定义但未落地**：仅在 [api/errors.py:28](file:///d:/Maxma/MaxmaHere/api/errors.py) 和前端类型中存在，无任何中间件/路由实际返回该码
4. **ProviderManager 无降级能力**：[api/providers/manager.py](file:///d:/Maxma/MaxmaHere/api/providers/manager.py) 的 `iter_enabled()` 按 dict 插入顺序遍历，无 priority 字段、无健康标记、无 fallback 路由
5. **MAX_MEMORY_MB=512 是"装饰性常量"**：在 [tools/system/tool_python.py:21](file:///d:/Maxma/MaxmaHere/tools/system/tool_python.py) 定义后从未被任何 `resource.setrlimit` 或 Windows Job Object 调用引用，沙箱子进程实际无内存限制
6. **_SANDBOX_WRAPPER 用黑名单而非白名单**：与 [tools/path_security.py](file:///d:/Maxma/MaxmaHere/tools/path_security.py) 的 `get_safe_builtins()` 白名单策略不一致，存在元编程逃逸风险
7. **tests/test_agent/ 已有 test_graph.py 覆盖 ErrorRecoveryManager 接入**：阶段 2.3 新增 26 个测试（record_failure/should_replan/build_replan_trigger/ReplanTrigger/_state_summary 降级标记/_maybe_notify_plan_degraded），但 CircuitBreaker 三态状态机仍无测试覆盖
8. **OS 级隔离的跨平台复杂度**：项目桌面端为 Windows（[desktop/src-tauri/src/main.rs](file:///d:/Maxma/MaxmaHere/desktop/src-tauri/src/main.rs) 引入 `windows` crate），但 Python 后端跨平台。firejail/nsjail 仅 Linux、AppContainer/Windows Sandbox 仅 Windows、`resource.setrlimit` 仅 Unix——必须设计平台抽象层

---

## 子任务 3.1 — 工具熔断（ErrorRecoveryManager + CircuitBreaker）

**目标**：在阶段 2.3 已接入的 ErrorRecoveryManager 基础上，新增 CircuitBreaker 状态机，让工具连续失败达到阈值后自动熔断，半开探测恢复。复用现有 record_failure/record_success/should_replan 抽象，避免两套失败计数机制。

### 3.1.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [agent/error_recovery.py](file:///d:/Maxma/MaxmaHere/agent/error_recovery.py) | ErrorRecoveryManager（线程安全，FAILURE_THRESHOLD=2）、ToolFailureRecord、RecoverySuggestion、ReplanTrigger、retry_network_call 装饰器、get_recovery_manager() 全局单例；**阶段 2.3 已接入 executor**：record_failure/record_success/should_replan/build_replan_trigger 均已落地；_suggest_alternatives 已扩充 parallel_execute/call_sub_agent/file_read 等映射 | ① 新增 `CircuitBreaker` 类（closed/open/half-open 三态，含冷却时间窗口）；② `record_failure` 触发熔断后短路返回，不再只生成建议；③ `record_success` 在 half-open 状态下恢复熔断器；④ 评估 `threading.Lock` 改 `asyncio.Lock`（阶段 2 已标注此风险，3.1 在 2 之后实施需落地此决策）；⑤ 与现有 `should_replan`/`build_replan_trigger` 协同（CircuitBreaker 在 ToolNode 层短路，should_replan 在 executor 层重规划） |
| [agent/executor.py](file:///d:/Maxma/MaxmaHere/agent/executor.py) | **阶段 2.1/2.3 落地**：executor_node 含 HITL 确认、步骤状态机驱动、并行组处理、失败检测（detect_tool_failure）、replan 路由；已接入 recovery_manager + performance_monitor；detect_tool_failure 返回 3-tuple（has_failure, error_msg, tool_name） | ① 在失败路径（has_failure=True 分支）叠加 CircuitBreaker 检查：熔断打开时短路返回 ToolMessage 而非让 agent 重试；② 熔断打开时跳过 record_failure（避免重复计数）；③ CircuitBreaker 状态变化推送 WS 事件（可选） |
| [tools/tool_base.py](file:///d:/Maxma/MaxmaHere/tools/tool_base.py) | ToolBase(BaseTool) 基类：仅含 client 字段、_client 访问器、_load_doc() 读取 TOOL.md | ① 新增统一的 `_handle_error`/`_safe_run` 钩子，自动调用 `record_failure`；② 成功路径调用 `record_success`；③ 提供熔断打开时的快速失败响应 |
| [tools/base.py](file:///d:/Maxma/MaxmaHere/tools/base.py) | 向后兼容 re-export 门面（SharedAPIClient/ToolBase/format_*/check_path_*/get_safe_builtins） | 追加 re-export `CircuitBreaker`/`ErrorRecoveryManager`/`get_recovery_manager`，保持 `from tools.base import X` 兼容 |
| [tools/client.py](file:///d:/Maxma/MaxmaHere/tools/client.py) | SharedAPIClient：requests.Session + HTTPAdapter，_make_retry_strategy() 已有 urllib3 Retry（total=3, backoff=0.5, 5xx 重试） | ① 与 `retry_network_call` 协同（当前两套重试逻辑并存，需统一）；② 熔断打开时跳过 HTTP 请求直接返回降级响应 |
| [tests/test_agent/test_graph.py](file:///d:/Maxma/MaxmaHere/tests/test_agent/test_graph.py) | **阶段 2 已扩展至 71 个测试**：含 _request_plan_confirmation、StepStateMachine、detect_tool_failure（3-tuple）、executor HITL/步骤/失败/并行组、executor_router、parse_plan_to_steps、ExecutionPlan 并行组、error_recovery 接入（record_failure/should_replan/build_replan_trigger/ReplanTrigger）、_state_summary 降级标记、_maybe_notify_plan_degraded | 新增 CircuitBreaker 单测：三态状态迁移（closed→open→half-open→closed/open）、冷却时间窗口、half-open 探测调用、线程安全、与 executor 失败路径的协同 |
| [agent/performance.py](file:///d:/Maxma/MaxmaHere/agent/performance.py) | PerformanceMonitor 单例：record_tool_call(tool_name, duration, success)；**阶段 2.3 已在 executor 失败路径接入 record_tool_call(success=False)** | 在 CircuitBreaker 接入点（ToolNode 层）同步调用 `record_tool_call(success=False)`，让单次工具调用失败统计进入性能监控（与 executor 层的失败统计互补） |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | Pydantic BaseSettings；**阶段 2 已新增 plan_confirm_timeout/replan_threshold/executor_max_replans/executor_enable_by_default** | 新增配置项：`circuit_breaker_failure_threshold`（默认 5）、`circuit_breaker_recovery_timeout`（默认 60s）、`circuit_breaker_half_open_max_calls`（默认 1） |

### 3.1.2 不动的参考文件

| 文件路径 | 说明 |
|---|---|
| [tools/formatting.py](file:///d:/Maxma/MaxmaHere/tools/formatting.py) | format_success/format_error JSON 序列化，熔断快速失败响应复用 format_error |

### 3.1.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `agent/circuit_breaker.py` | CircuitBreaker 独立实现（避免 error_recovery.py 膨胀），含状态机、冷却时间、half-open 探测 |
| `tests/test_agent/test_error_recovery.py` | ErrorRecoveryManager + CircuitBreaker 单测（当前完全缺失） |

### 3.1.4 关键设计点

- **CircuitBreaker 三态**：
  - **closed**：正常调用，记录失败次数；达阈值 → open
  - **open**：短路返回降级响应，不真正调用工具；冷却时间到 → half-open
  - **half-open**：允许少量探测调用；成功 → closed，失败 → open
- **与阶段 2.3 的协同（已落地，3.1 需适配）**：阶段 2.3 的失败重规划在 executor 层（多步计划级别），3.1 的熔断在 ToolNode 层（单次工具调用级别）。**阶段 2.3 已建立 record_failure/record_success/should_replan/build_replan_trigger 抽象**，3.1 需在其上叠加 CircuitBreaker：
  - CircuitBreaker 在 ToolNode 层短路（熔断打开时不真正调用工具，直接返回降级 ToolMessage）
  - should_replan 在 executor 层重规划（熔断短路返回的 ToolMessage 仍会被 detect_tool_failure 检测到，触发 replan）
  - 两者共享 record_failure 的失败计数（CircuitBreaker 触发熔断后，executor 的 should_replan 也会因 failure_count 达阈值而触发 replan）
- **ErrorRecoveryManager 线程安全**：阶段 2 已落地（当前为 threading.Lock），3.1 在阶段 2 之后实施，**需决策是否改为 asyncio.Lock 或无锁设计（per-tool 状态用 ContextVar）**。考虑到 executor 在 asyncio 事件循环中运行，且 CircuitBreaker 状态机需在协程间共享，建议改为 asyncio.Lock 或无锁设计

### 3.1.5 状态

- [x] 已完成（2026-07-04）
  - `agent/circuit_breaker.py` 创建：CircuitBreaker 三态状态机（closed/open/half_open）+ CircuitState 枚举 + CircuitBreakerStats dataclass + create_circuit_breaker_from_settings 工厂；线程安全（threading.Lock）；冷却时间自动迁移 open→half_open；half_open 探测调用配额限制
  - `config/settings.py` 新增 3 个配置项：circuit_breaker_failure_threshold=5 / circuit_breaker_recovery_timeout=60 / circuit_breaker_half_open_max_calls=1
  - `agent/error_recovery.py` 集成 CircuitBreaker：新增 _circuit_breakers dict / get_circuit_breaker() / is_tool_circuit_open() / can_tool_execute() / get_all_circuit_stats()；record_failure 在锁外驱动 CB（避免嵌套锁）；record_success / reset 同步 CB
  - `tools/base.py` 追加 re-export CircuitBreaker / CircuitState / ErrorRecoveryManager / ReplanTrigger / get_recovery_manager
  - `agent/executor.py` 失败路径接入熔断：record_failure 后检查 is_tool_circuit_open；熔断打开时强制触发 replan（绕过 rm_should 阈值）；replan SystemMessage 追加 circuit_hint 警告
  - `tests/test_agent/test_circuit_breaker.py` 创建：24 个测试（5 类：三态状态迁移 9 / 冷却窗口 3 / 线程安全 2 / ErrorRecoveryManager 集成 7 / 配置集成 2）
  - 修复 4 个测试 bug：(1) recovery_timeout 不钳制下限（允许测试用 0.1s 加速）；(2) get_all_circuit_stats 测试用 side_effect 工厂避免多工具共享同一 CB 实例；(3) fallback 测试 patch config.settings.get_settings 而非 agent.circuit_breaker.get_settings（延迟导入）；(4) is_open 语义修正：half_open 不算 open（允许探测调用）
  - 24/24 测试通过；全量测试无新增回归（7 个 pre-existing 测试隔离问题与 3.1 无关）

---

## 子任务 3.2 — API 限流（令牌桶 + RATE_LIMITED 错误码落地）

**目标**：让 `RATE_LIMITED` 错误码真正生效，防止恶意调用，HTTP 用中间件限流，WebSocket 用 per-session 令牌桶。

### 3.2.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [api/errors.py](file:///d:/Maxma/MaxmaHere/api/errors.py) | ErrorCode 枚举：RATE_LIMITED（L28）、QUOTA_EXCEEDED（L29）；AppError.category 已含 rate_limit 分类；format_ws_error/make_error 工具函数 | ① 新增 `RateLimitError` 异常类便捷构造；② `details` 约定字段：`retry_after`、`limit`、`remaining`、`reset_at` |
| [api/middleware/__init__.py](file:///d:/Maxma/MaxmaHere/api/middleware/__init__.py) | 空文件 | 导出 `RateLimitMiddleware` |
| [api/middleware/request_log.py](file:///d:/Maxma/MaxmaHere/api/middleware/request_log.py) | RequestLogMiddleware：request_id 注入、耗时记录、get_metrics().record_request、X-Request-ID 响应头 | 限流触发时记录 warning 日志 + 调用 `get_metrics().record_error` |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | FastAPI 工厂：create_app() 中 add_middleware(AuthMiddleware) + add_middleware(RequestLogMiddleware)（L463-466） | ① 新增 `app.add_middleware(RateLimitMiddleware)`；② 注意中间件执行顺序（后 add 先执行），限流应在 Auth 之后、路由之前 |
| [api/routes/chat.py](file:///d:/Maxma/MaxmaHere/api/routes/chat.py) | WebSocket /ws/chat/{session_id} 端点：消息循环、_run_agent_turn、provider_id/model_name 动态 LLM 选择 | ① WebSocket 消息频率限流（per-session 令牌桶）；② 限流触发时 `format_ws_error(ErrorCode.RATE_LIMITED, ...)` |
| [api/metrics.py](file:///d:/Maxma/MaxmaHere/api/metrics.py) | Metrics 单例（内存 dict + 线程锁），record_request/record_error | 新增 `record_rate_limit` 方法统计被限流请求数 |
| [web/src/components/ErrorCard.vue](file:///d:/Maxma/MaxmaHere/web/src/components/ErrorCard.vue) | 错误卡片：icon/title/suggestion 按 category 切换（network/auth/timeout/permission/not_found），无 rate_limit 分支 | ① 新增 `rate_limit` category 分支（沙漏图标 + "请稍后重试"建议）；② 显示 `retry_after` 倒计时 |
| [web/src/types/index.ts](file:///d:/Maxma/MaxmaHere/web/src/types/index.ts) | ErrorEvent.payload.category 已含 'rate_limit' 联合类型（L50）；ChatMessage.payload 含 provider_id/model_name | ① ErrorEvent.payload.details 补充 retry_after/limit/remaining 字段类型；② 新增 `RateLimitDetails` 接口 |

### 3.2.2 不动的参考文件

| 文件路径 | 说明 |
|---|---|
| [api/middleware/auth.py](file:///d:/Maxma/MaxmaHere/api/middleware/auth.py) | AuthMiddleware ASGI 鉴权，限流中间件结构同此 |
| [api/dependencies.py](file:///d:/Maxma/MaxmaHere/api/dependencies.py) | 依赖注入，不涉及限流 |
| [api/interaction.py](file:///d:/Maxma/MaxmaHere/api/interaction.py) | Future 注册表，不涉及限流 |

### 3.2.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `api/middleware/rate_limit.py` | RateLimitMiddleware ASGI 中间件 + TokenBucket 令牌桶实现（per-IP / per-session / per-route 三维策略） |
| `tests/test_api/test_rate_limit.py` | 令牌桶单测 + 中间件集成测试 |

### 3.2.4 关键设计点

- **限流中间件与 WebSocket 的特殊性**：`RateLimitMiddleware` 对 HTTP 请求可直接返回 429，但 WebSocket 是长连接，需在消息循环内做 per-session 令牌桶（不能在中间件层）。建议：
  - HTTP 请求：`RateLimitMiddleware` 按 IP 限流
  - WebSocket 消息：在 `chat.py` 的 `while True` 循环内做 per-session 令牌桶，触发时 `format_ws_error(ErrorCode.RATE_LIMITED)`
- **令牌桶参数**：默认 10 req/min/user（HTTP）、6 msg/min/session（WebSocket），可在 settings.py 配置

### 3.2.5 状态

- [x] 已完成（2026-07-04）
  - `api/middleware/rate_limit.py` 创建：TokenBucket（线程安全令牌桶）+ TokenBucketRegistry（惰性创建 + 过期清理）+ RateLimitMiddleware（HTTP 按 IP 限流 ASGI 中间件，超限返回 429 + Retry-After 头）+ WsSessionRateLimiter（WebSocket per-session 限流器）+ get_ws_rate_limiter 全局单例
  - `api/middleware/__init__.py` 更新：导出 RateLimitMiddleware
  - `api/server.py` 新增 `app.add_middleware(RateLimitMiddleware)`，中间件执行顺序：RequestLog → RateLimit → Auth → 路由（限流在 Auth 之前，避免被拒绝的鉴权请求消耗配额）
  - `config/settings.py` 新增 4 个配置项：rate_limit_http_capacity=10 / rate_limit_http_window_seconds=60 / rate_limit_ws_capacity=6 / rate_limit_ws_window_seconds=60
  - `api/metrics.py` 新增 `record_rate_limit(scope)` 方法统计被限流请求数（按 http/ws 分类）
  - `api/routes/chat.py` WebSocket 消息循环 `case "chat":` 分支接入 per-session 令牌桶限流，超限时推送 format_ws_error 格式错误事件
  - `web/src/components/ErrorCard.vue` 新增 `rate_limit` category 分支：⏳ 图标 + "请求过于频繁" 标题 + "请稍候片刻再重试" 建议 + 紫色样式
  - `web/src/types/index.ts` 新增 `RateLimitDetails` 接口（retry_after/limit/remaining），ErrorEvent.payload.details 类型细化
  - `tests/test_api/test_rate_limit.py` 创建：32 个测试（6 类：TokenBucket 基础 9 / TokenBucketRegistry 6 / RateLimitMiddleware 5 / WsSessionRateLimiter 4 / Metrics 集成 3 / 全局单例 5）
  - 32/32 测试通过；既有 26 个 middleware/metrics/server 测试无回归；server create_app 正确加载 4 个中间件

---

## 子任务 3.3 — LLM provider 降级（优先级 + 健康标记 + fallback）

**目标**：让 ProviderManager 支持 priority 排序 + 健康标记 + 自动 fallback，主 provider 失败时自动切换到备用。

### 3.3.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [api/providers/__init__.py](file:///d:/Maxma/MaxmaHere/api/providers/__init__.py) | ProviderConfig dataclass（id/provider_type/label/api_key/base_url/models/enabled/context_window）、HealthStatus（status/latency_ms/detail）、Provider ABC（create_llm/check_health/default_model/available_models） | ① ProviderConfig 新增 `priority: int = 0` 字段；② Provider 新增 `health_status`/`last_check_time`/`consecutive_failures` 实例属性；③ HealthStatus 新增 `degraded` 状态 |
| [api/providers/manager.py](file:///d:/Maxma/MaxmaHere/api/providers/manager.py) | ProviderManager：load_all() 按 store 顺序加载 enabled、get(id)、iter_enabled()（dict 顺序，无优先级）、_build_provider 工厂 | ① `iter_enabled()` 改为按 `priority` 排序；② 新增 `get_healthy()` 跳过健康标记为 error 的 provider；③ 新增 `get_fallback(exclude_ids)` 返回下一个可用 provider；④ 新增 `mark_unhealthy(provider_id)`/`mark_healthy(provider_id)`；⑤ 后台周期性健康检查任务 |
| [api/providers/openai_provider.py](file:///d:/Maxma/MaxmaHere/api/providers/openai_provider.py) | OpenAIProvider(Provider)：create_llm 用 ChatOpenAI，check_health 调 AsyncOpenAI().models.list() | ① check_health 失败时自动调用 `mark_unhealthy`；② 新增轻量级 `quick_check`（只 ping，不调 models.list）；③ 健康检查超时阈值 |
| [api/providers/store.py](file:///d:/Maxma/MaxmaHere/api/providers/store.py) | ProviderConfigStore（YAML 存储，api_key 落盘加密）：load_all/save/delete/migrate_from_* | ① `_serialize_config`/`_deserialize_config` 增加 `priority` 字段读写；② 向后兼容（无 priority 字段的旧配置默认 0） |
| [api/db/providers.py](file:///d:/Maxma/MaxmaHere/api/db/providers.py) | ProviderDbStore（SQLite 存储）：load_all/save/delete/migrate_from_yaml/_row_to_config | ① `save` SQL 增加 `priority` 列；② `_row_to_config` 读取 priority；③ 需要 DB schema 迁移（api/db/core.py SCHEMA_VERSION bump） |
| [api/routes/providers.py](file:///d:/Maxma/MaxmaHere/api/routes/providers.py) | Provider CRUD + /providers/test + /providers/{id}/test + /providers/discover-models；ProviderCreateBody/ProviderUpdateBody 无 priority 字段 | ① ProviderCreateBody/ProviderUpdateBody 新增 `priority: int = 0`；② 新增 `POST /providers/{id}/health` 端点手动触发健康检查；③ 返回值含 `health_status`/`last_check_time` |
| [api/routes/chat.py](file:///d:/Maxma/MaxmaHere/api/routes/chat.py) | _run_agent_turn：动态 LLM 选择，provider_id+model_name 不匹配时降级到 app_state.llm（无 fallback 链）；**阶段 2.3 在 _stream_turn 后添加了 _maybe_notify_plan_degraded 调用**（约 L618-624） | ① 动态 LLM 选择 `KeyError` 时改为调用 `provider_manager.get_fallback()` 尝试下一个 provider；② LLM 调用失败时自动标记 unhealthy 并 fallback；③ 记录实际使用的 provider_id 推送给前端 |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | lifespan L234-280：ProviderManager 初始化、load_all()、后台 _init_llm_background() | ① lifespan 中启动周期性健康检查后台任务（如每 60s 调用 check_health）；② 健康检查结果写入 provider_manager 缓存；③ 关闭时取消健康检查任务 |
| [api/health.py](file:///d:/Maxma/MaxmaHere/api/health.py) | check_llm（L40-89）：probe_remote=False 时仅判断本地状态，True 时遍历 providers 返回首个 ok | ① check_llm 改为遍历所有 enabled provider 并行健康检查；② check_health_providers（L165-200）返回每个 provider 的健康状态；③ 健康状态持久化（可选） |
| [api/dependencies.py](file:///d:/Maxma/MaxmaHere/api/dependencies.py) | get_llm(provider_manager)：取 iter_enabled() 第一个 provider 创建 LLM，无 fallback | ① 改为 `get_healthy()` 第一个；② 若全部 unhealthy 则抛 `RuntimeError` 并触发后台恢复探测 |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | Pydantic BaseSettings | 新增配置项：`provider_health_check_interval_seconds: int = 60`、`provider_unhealthy_threshold: int = 3`、`provider_recovery_check_interval: int = 300` |
| [api/db/core.py](file:///d:/Maxma/MaxmaHere/api/db/core.py) | SQLite schema（SCHEMA_VERSION=1，7 张表） | ① SCHEMA_VERSION bump；② providers 表新增 `priority INTEGER DEFAULT 0` 列；③ 迁移脚本 |
| [web/src/types/index.ts](file:///d:/Maxma/MaxmaHere/web/src/types/index.ts) | ProviderConfig（L405-414）含 id/type/label/api_key/base_url/models/enabled/context_window，无 priority/health | ① ProviderConfig 新增 `priority?: number`、`health_status?: 'ok'\|'degraded'\|'error'`、`last_check_time?: number`；② 新增 `ProviderHealthCheckResponse` 类型 |

### 3.3.2 新建文件

| 文件路径 | 职责 |
|---|---|
| `api/providers/health_monitor.py` | 后台健康监控任务（周期性 check_health + 状态标记 + 恢复探测） |
| `tests/test_api/test_provider_fallback.py` | provider 降级链路测试（主 provider 失败 → fallback → 全部失败 → NO_LLM） |

### 3.3.3 关键设计点

- **降级链路**：指定 provider 失败 → 按 priority fallback 链 → 全部失败才返回 NO_LLM
- **与阶段 2 的耦合（已落地）**：工具失败 → CircuitBreaker（3.1）→ executor 检测失败 → should_replan 重规划（阶段 2.3 已落地）；LLM 调用失败 → provider fallback（3.3）→ 标记 unhealthy → 后台恢复检测。**阶段 2.3 已建立 record_failure/should_replan 抽象**，3.1 的 CircuitBreaker 与 3.3 的 provider fallback 都应复用此抽象，避免三套独立失败计数机制
- **DB schema 迁移**：providers 表新增 priority 列，SCHEMA_VERSION bump，需与阶段 1.6 的 metrics 表迁移协调（避免版本冲突）

### 3.3.4 状态

- [x] 已完成（2026-07-04）

**完成内容**：

1. **ProviderConfig + HealthStatus 类型增强**（`api/providers/__init__.py`）：
   - `ProviderConfig` 新增 `priority: int = 0` 字段（数字越小优先级越高）
   - `HealthStatus.status` Literal 扩展为 `"ok" | "degraded" | "error"`
   - `Provider` ABC 新增 `health_status` / `last_check_time` / `consecutive_failures` 实例属性与 `is_healthy` / `is_unhealthy` 属性

2. **ProviderManager fallback 链路**（`api/providers/manager.py`）：
   - 新增 `threading.Lock` 保护健康状态读写
   - `iter_enabled()` 按 `priority` 升序稳定排序
   - 新增 `iter_all()` / `get_healthy()` / `get_fallback(exclude_ids)` / `mark_unhealthy()` / `mark_healthy()` / `mark_degraded()` / `get_health_status()` / `get_all_health_status()`

3. **后台健康监控**（新建 `api/providers/health_monitor.py`）：
   - `_check_provider_health` — 5s 超时，ok→mark_healthy、degraded→mark_degraded、error→mark_unhealthy、超时→mark_degraded（避免完全禁用）
   - `_health_check_loop` — 健康 provider 按 `check_interval` 检查，unhealthy 按 `recovery_interval` 重新探测，连续失败 `< unhealthy_threshold` 时降级为 degraded
   - `start_health_monitor` / `stop_health_monitor` — 幂等启动 / 5s 超时停止

4. **DB schema 迁移**（`api/db/core.py`）：
   - `SCHEMA_VERSION` 从 2 升到 3
   - v3 迁移：`ALTER TABLE providers ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`

5. **Store 适配**（`api/db/providers.py` + `api/providers/store.py`）：
   - `save()` SQL 增加 `priority` 列与 ON CONFLICT UPDATE
   - `_row_to_config` / `migrate_from_yaml` / `_deserialize_config` 读取 `priority`，旧数据缺字段时默认 0

6. **chat.py LLM fallback**（`api/routes/chat.py`）：
   - `_run_agent_turn` 的 KeyError 分支改为先尝试 `provider_manager.get_fallback(exclude_ids={provider_id})`，无可用 provider 时才回退到 `app_state.llm`

7. **dependencies.get_llm 用 get_healthy**（`api/dependencies.py`）：
   - 优先 `get_healthy()`，全部 unhealthy 时回退到 `iter_enabled()` 第一个

8. **server lifespan 集成**（`api/server.py`）：
   - 启动后调用 `start_health_monitor(provider_manager, ...)`，参数来自 `config.settings`
   - 关闭时 `await stop_health_monitor()`

9. **config 新增配置**（`config/settings.py`）：
   - `provider_health_check_interval_seconds: int = 60`
   - `provider_recovery_check_interval_seconds: int = 300`
   - `provider_unhealthy_threshold: int = 3`

10. **routes/providers.py 增强**（`api/routes/providers.py`）：
    - `ProviderCreateBody` / `ProviderUpdateBody` 新增 `priority` 字段
    - 新增 `POST /providers/{id}/health` 端点（按需触发健康检查并同步运行时状态）
    - 所有响应通过 `_config_with_health()` 附带 `health_status` / `health_detail` / `health_latency_ms` / `last_check_time` / `consecutive_failures`

11. **前端 types 适配**（`web/src/types/index.ts` + `web/src/api/index.ts`）：
    - `ProviderConfig` 新增 `priority?` / `health_status?` / `health_detail?` / `health_latency_ms?` / `last_check_time?` / `consecutive_failures?`
    - 新增 `ProviderHealthCheckResponse` 类型
    - 新增 `checkProviderHealth(id)` API 方法

12. **测试**（新建 `tests/test_api/test_provider_fallback.py`）：
    - 46 个测试覆盖 10 类场景：priority 字段、HealthStatus degraded、Provider 健康属性、iter_enabled 排序、get_healthy、get_fallback、mark_* 方法、get_all_health_status、`_check_provider_health` 状态驱动、端到端 fallback
    - 全部通过；同时修复 `tests/test_api/test_dependencies.py::TestGetLlm` 以适配新的 `get_healthy` 优先逻辑

**验证**：
- `pytest tests/test_api/test_provider_fallback.py tests/test_api/test_providers_runtime.py tests/test_api/test_dependencies.py tests/test_api/test_metrics.py tests/test_api/test_rate_limit.py tests/test_api/test_health.py tests/test_api/test_server.py tests/test_agent/test_circuit_breaker.py` — 132 passed
- `npm run build` — 391 modules transformed，类型检查通过

---

## 子任务 3.4 — Python 沙箱 OS 级隔离（firejail/nsjail/Job Object）

**目标**：在现有 subprocess + builtins 过滤基础上，叠加 OS 级隔离层（资源限制 + 网络隔离 + 文件系统隔离），实现纵深防御。

### 3.4.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [tools/system/tool_python.py](file:///d:/Maxma/MaxmaHere/tools/system/tool_python.py) | RunPythonTool：_SANDBOX_WRAPPER（L25-65，黑名单 builtins）、_ALLOWED_ENV_VARS（L70-76，白名单）、_build_sandbox_env（L79-85）、_run_in_sandbox（L88-158，subprocess.Popen + communicate timeout）、MAX_MEMORY_MB=512（定义未用）、DEFAULT_TIMEOUT=30、MAX_TIMEOUT=120、_arun（L185-246，用户确认 + asyncio.to_thread 执行） | ① `_run_in_sandbox` 改为调用平台抽象层 `SandboxRunner`；② Linux 下用 firejail/nsjail 包装命令；③ Windows 下用 Job Object 限制内存 + AppContainer（可选）；④ `MAX_MEMORY_MB` 真正生效（Unix: `preexec_fn=resource.setrlimit`；Windows: `psutil` 或 `win32job`）；⑤ 网络隔离（firejail `--net=none`；Windows 防火墙规则） |
| [tests/test_tools/test_tool_python.py](file:///d:/Maxma/MaxmaHere/tests/test_tools/test_tool_python.py) | 7 个测试：TestRunInSandbox（简单执行/超时/eval 阻断/import 阻断/open 阻断/环境变量过滤）、TestSandboxEnv（env 过滤、subprocess 不泄漏 secret） | ① 新增 OS 级隔离测试（需 mock 或条件跳过：`pytest.mark.skipif` 检测 firejail/Job Object 可用性）；② 新增内存限制测试（分配大数组触发 OOM）；③ 新增网络隔离测试（尝试 socket 连接应失败） |
| [SECURITY.md](file:///d:/Maxma/MaxmaHere/SECURITY.md) | 安全政策：单用户本地部署、127.0.0.1 binding、AuthMiddleware、MaxmaBlocker、安全清单（加密/审计日志未勾选） | ① 安全清单新增 "Python sandbox OS-level isolation" 项；② 文档化沙箱隔离策略与平台差异 |
| [desktop/src-tauri/src/main.rs](file:///d:/Maxma/MaxmaHere/desktop/src-tauri/src/main.rs) | Tauri 桌面端：sidecar 启动 + 崩溃重启 + Windows 文件对话框 | ① 可能新增 Tauri command 检测 firejail/Windows Sandbox 可用性；② 桌面端打包时捆绑 firejail（Linux）或配置 Windows Sandbox（仅 Pro+） |
| [desktop/src-tauri/tauri.conf.json](file:///d:/Maxma/MaxmaHere/desktop/src-tauri/tauri.conf.json) | Tauri 配置：productName、CSP、bundle targets（nsis）、externalBin（maxma-server） | 可能新增 externalBin 捆绑 firejail 二进制（Linux 包）；或 resources 捆绑 firejail profile |
| [tools/system/TOOL.md](file:///d:/Maxma/MaxmaHere/tools/system/TOOL.md) | run_python 领域知识：沙箱特性说明（独立进程/超时/512MB/环境变量过滤） | 更新为 OS 级隔离说明（firejail/Job Object）+ 真实内存限制 + 网络隔离 |
| [requirements.txt](file:///d:/Maxma/MaxmaHere/requirements.txt) | 锁定依赖：无 psutil | 新增 `psutil`（跨平台进程资源限制） |
| [pyproject.toml](file:///d:/Maxma/MaxmaHere/pyproject.toml) | 项目依赖声明 | 新增 `psutil>=5.9.0` |
| [docs/ROADMAP.md](file:///d:/Maxma/MaxmaHere/docs/ROADMAP.md) | L204-232 "1.6 代码执行沙箱"：Phase 1 进程级（已实现）、Phase 2 Windows Sandbox、Phase 3 Docker | 更新进度：Phase 1 已完成，标注 OS 级隔离为 Phase 1.5 |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | Pydantic BaseSettings | 新增配置项：`sandbox_isolation_level`（none/subprocess/os_level）、`sandbox_firejail_path`、`sandbox_network_isolation`（默认 True） |

### 3.4.2 不动的参考文件

| 文件路径 | 说明 |
|---|---|
| [tools/path_security.py](file:///d:/Maxma/MaxmaHere/tools/path_security.py) | 路径访问控制 + get_safe_builtins()（白名单策略），沙箱内 open 仍走此白名单（OS 级隔离是额外层） |
| [tools/mcp_security.py](file:///d:/Maxma/MaxmaHere/tools/mcp_security.py) | MCP stdio 命令白名单校验，模式参考（白名单策略可借鉴到 firejail profile） |
| [tests/test_path_security.py](file:///d:/Maxma/MaxmaHere/tests/test_path_security.py) | check_maxma_blocker/check_path_whitelisted/check_path_access/get_safe_builtins 全覆盖测试 |

### 3.4.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `tools/system/sandbox_runner.py` | 平台抽象层 `SandboxRunner`：检测平台 → 选择 firejail/nsjail/Job Object/无隔离降级；构造带资源限制的命令 |
| `tools/system/firejail.profile` | firejail 配置文件（白名单路径、禁网络、禁 /tmp 之外写入） |
| `tests/test_tools/test_sandbox_isolation.py` | OS 级隔离专项测试（内存/网络/文件系统逃逸尝试） |

### 3.4.4 关键设计点（最高风险：跨平台复杂度）

**OS 级隔离方案矩阵**：

| 平台 | 可用方案 | 限制 |
|---|---|---|
| Linux | firejail（推荐）/ nsjail / bubblewrap | firejail 需 setuid，nsjail 需编译 |
| Windows | Windows Job Object + AppContainer / Windows Sandbox | Job Object 需 pywin32；Windows Sandbox 仅 Pro/Enterprise；AppContainer API 复杂 |
| macOS | 无原生沙箱方案（sandbox-exec 已弃用） | 需降级到无 OS 级隔离 |

**缓解策略**：`SandboxRunner` 必须实现能力探测 + 优雅降级链：
```
firejail → nsjail → Job Object → subprocess + resource.setrlimit（仅内存）→ 纯 subprocess（当前行为）
```
每个降级层级在日志中明确告警。

**MAX_MEMORY_MB 跨平台实现**：
- **Unix**：`subprocess.Popen(preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_AS, (mb*1024*1024, mb*1024*1024)))`
- **Windows**：需用 `win32job.CreateJobObject` + `SetInformationJobObject(JobObjectExtendedLimitInformation, ...)` 设 `JOB_OBJECT_LIMIT_PROCESS_MEMORY`，然后 `AssignProcessToJobObject`
- **macOS**：`resource.setrlimit(RLIMIT_RSS)` 不强制，`RLIMIT_AS` 可能导致 Python 自身崩溃

### 3.4.5 状态

- [x] 已完成（2026-07-04）
  - `tools/system/sandbox_runner.py` 创建：SandboxRunner 平台抽象层（能力探测 + 优雅降级链）
  - `tools/system/firejail.profile` 创建：firejail 配置（白名单路径 + 网络隔离 + 资源限制）
  - `tools/system/tool_python.py` `_run_in_sandbox` 集成 SandboxRunner（build_command + get_popen_kwargs + on_process_started）
  - `config/settings.py` 新增 3 个配置项：sandbox_memory_mb / sandbox_network_isolation / sandbox_isolation_level
  - `tests/test_tools/test_sandbox_isolation.py` 创建：24 个测试（能力探测 / 命令构造 / 单例工厂 / 集成 / 内存限制 / Windows Job Object / Unix setrlimit）
  - 修复两个 Windows 兼容性 bug：(1) resource 模块延迟导入（Windows 无该模块）；(2) 移除 CREATE_SUSPENDED + ResumeThread 模式（Python subprocess 关闭线程句柄），改为进程启动后立即 AssignProcessToJobObject（Windows 8+ 支持）
  - `tools/system/TOOL.md` 更新：OS 级隔离文档（降级链 + 跨平台实现 + 配置项）
  - 全部 134 个既有测试 + 15 个新测试通过（9 个平台条件跳过）

---

## 子任务 3.5 — 沙箱元编程入口过滤 + MAX_MEMORY_MB 真正生效

**目标**：将 _SANDBOX_WRAPPER 从黑名单升级为白名单（复用 path_security），拦截已知元编程逃逸入口，让 MAX_MEMORY_MB 真正生效。

### 3.5.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [tools/system/tool_python.py](file:///d:/Maxma/MaxmaHere/tools/system/tool_python.py) | _SANDBOX_WRAPPER L25-65：`_DANGEROUS = frozenset({"open", "exec", "eval", "compile", "__import__", "input", "breakpoint", "help"})` 黑名单；_safe_builtins 从 __builtins__ 移除黑名单；_blocked_import 替换 __import__ | ① **改黑名单为白名单**（复用 `path_security.get_safe_builtins()` 或独立维护 `_SAFE_BUILTIN_NAMES`）；② **拦截元编程入口**：`type.__subclasses__`、`object.__subclasses__`、`__bases__`、`__mro__`、`__class__`、`__globals__`（通过函数对象 `func.__globals__` 逃逸）、`globals()`、`locals()`、`vars()`、`dir()`、`getattr`/`setattr`/`delattr` 需评估；③ **MAX_MEMORY_MB 真正生效**：见 3.4 |
| [tools/path_security.py](file:///d:/Maxma/MaxmaHere/tools/path_security.py) | _SAFE_BUILTIN_NAMES L409-418（白名单，含 globals/locals/vars/dir/type/getattr/super 等危险函数）；_DANGEROUS_BUILTIN_NAMES L421-424；get_safe_builtins() L427-447 | ① **_SAFE_BUILTIN_NAMES 收紧**：移除 `globals`/`locals`/`vars`/`dir`/`type`/`getattr`/`setattr`/`delattr`/`super`/`classmethod`/`staticmethod`/`property`/`memoryview`（这些是元编程逃逸入口）；② 新增 `_BLOCKED_DUNDER_ATTRIBUTES` 集合（`__subclasses__`/`__bases__`/`__mro__`/`__class__`/`__globals__`/`__builtins__`）；③ 提供 `get_sandbox_builtins()` 专供 tool_python.py 使用（比 get_safe_builtins 更严格） |
| [tests/test_tools/test_tool_python.py](file:///d:/Maxma/MaxmaHere/tests/test_tools/test_tool_python.py) | 现有测试未覆盖元编程逃逸尝试 | ① 新增元编程逃逸测试：`().__class__.__bases__[0].__subclasses__()` 应被阻断；② `type('X',(),{})` 应被阻断；③ `getattr(obj, '__class__')` 应被阻断；④ 内存超限测试（`[0]*10**9` 触发 OOM） |
| [tests/test_path_security.py](file:///d:/Maxma/MaxmaHere/tests/test_path_security.py) | TestGetSafeBuiltins 已测 open 替换、危险函数移除、自引用 | 新增 `test_metaprogramming_entries_blocked` 断言 `globals`/`locals`/`vars`/`type`/`getattr` 不在 sandbox builtins 中 |

### 3.5.2 不动的参考文件

| 文件路径 | 说明 |
|---|---|
| [api/routes/env_vars.py](file:///d:/Maxma/MaxmaHere/api/routes/env_vars.py) | 环境变量管理路由（grep 命中 vars() 但应为 env_vars 名称匹配，非元编程） |
| [docs/python-exec-confirm-plan.md](file:///d:/Maxma/MaxmaHere/docs/python-exec-confirm-plan.md) | Python 执行用户确认机制计划（已实现），参考 |
| [dev_docs/notes/](file:///d:/Maxma/MaxmaHere/dev_docs/notes/) | 7 个笔记文件，无 sandbox 笔记 |

### 3.5.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `tests/test_tools/test_sandbox_metaprogramming.py` | 元编程逃逸专项测试（覆盖 10+ 种已知逃逸技巧） |

### 3.5.4 关键设计点

- **已知元编程逃逸路径**：
  - `().__class__.__bases__[0].__subclasses__()` → 找到 `subprocess.Popen`
  - `type('X', (object,), {'run': lambda self: __import__('os').system('...')})()`
  - `[x for x in ().__class__.__mro__[-1].__subclasses__() if 'wrap' in x.__name__.lower()][0]`
  - `func.__globals__['__builtins__']['__import__']('os')`
- **建议策略**：直接复用 `path_security.get_safe_builtins()` 的白名单策略，并额外拦截 `__subclasses__`/`__bases__`/`__mro__`/`__globals__` 等 dunder 属性访问（通过自定义 `type`/`object` 沙箱代理）
- **真正的根治方案是 OS 级隔离**（3.4），元编程过滤是纵深防御的第二层。即便元编程逃逸成功，OS 级隔离仍能限制其权限

### 3.5.5 状态

- [x] 已完成（2026-07-04）
  - `tools/system/tool_python.py` `_SANDBOX_WRAPPER` 改为白名单策略 + AST 变换（`_SandboxTransformer` 重写 `obj.attr` → `_safe_getattr(obj, 'attr')`）
  - `tools/path_security.py` `_BLOCKED_DUNDER_ATTRIBUTES` 新增 7 个元 dunder（`__getattribute__`/`__getattr__`/`__reduce__`/`__reduce_ex__`/`__closure__`/`__init_subclass__`/`__subclasshook__`）
  - `tools/system/tool_python.py` `_BLOCKED_DUNDER_ATTRIBUTES` 同步更新
  - `tests/test_tools/test_sandbox_metaprogramming.py` 创建：69 个测试（13+ 已知逃逸 payload × AST 检查 + 沙箱执行 / 危险 builtins 阻断 / 安全代码放行 / 纵深防御）
  - `SECURITY.md` 更新：第三层"AST 变换 + 运行时 dunder 拦截"文档
  - `tools/system/TOOL.md` 更新：双层元编程逃逸拦截文档
  - 全部 134 个测试通过（69 元编程 + 33 tool_python + 32 path_security）

---

## 实施顺序建议

```
3.5 沙箱元编程过滤（独立，P0，最高优先级，安全风险）
    ↓
3.4 Python 沙箱 OS 级隔离（依赖 3.5 的白名单基础）
    ↓
3.1 工具熔断（独立，可与 3.4 并行）
    ↓
3.2 API 限流（独立，可与 3.1 并行）
    ↓
3.3 LLM provider 降级（建议在 3.1 之后，共享失败计数抽象）
```

**并行机会**：
- 3.5 与 3.1/3.2/3.3 完全独立，可最先启动
- 3.1 与 3.2 可并行（都独立）
- 3.3 建议在 3.1 之后（共享"失败计数 + 恢复探测"抽象）

**关键约束**：
- 3.5 必须先于 3.4（白名单基础是 OS 级隔离的补充层）
- 3.3 的 DB schema 迁移需与阶段 1.6 的 metrics 表迁移协调（避免 SCHEMA_VERSION 冲突）

---

## 验收标准

| 子任务 | 验收点 |
|---|---|
| 3.1 | CircuitBreaker 三态正确迁移；工具连续失败 ≥5 次自动熔断；冷却后 half-open 探测；成功恢复 closed；error_recovery 不再是死代码；单测覆盖状态机 |
| 3.2 | RATE_LIMITED 错误码真正生效；HTTP 按 IP 限流（10/min）；WebSocket per-session 限流（6/min）；前端 ErrorCard 显示 rate_limit 分支；令牌桶单测通过 |
| 3.3 | ProviderConfig 含 priority 字段；iter_enabled 按 priority 排序；主 provider 失败自动 fallback；后台健康检查每 60s 运行；DB schema 迁移成功 |
| 3.4 | SandboxRunner 平台抽象层实现；Linux firejail 包装生效；Windows Job Object 内存限制生效；MAX_MEMORY_MB 真正生效；网络隔离（firejail --net=none）；优雅降级链有日志告警 |
| 3.5 | _SANDBOX_WRAPPER 改为白名单；`__subclasses__`/`__globals__` 等元编程入口被阻断；元编程逃逸测试覆盖 10+ 种技巧；MAX_MEMORY_MB 在 Unix/Windows 均生效 |

---

## 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| OS 级隔离跨平台复杂度（最高风险） | SandboxRunner 实现能力探测 + 优雅降级链；每个降级层级日志告警；macOS 明确降级到无 OS 级隔离 |
| MAX_MEMORY_MB 跨平台实现差异 | Unix 用 RLIMIT_AS；Windows 用 Job Object；macOS 标注不强制；测试用 `pytest.mark.skipif` 按平台跳过 |
| 元编程逃逸"军备竞赛" | 白名单 + dunder 拦截 + OS 级隔离三层纵深防御；真正的根治是 OS 级隔离，元编程过滤是第二层 |
| ErrorRecoveryManager 线程安全 | 若在阶段 2 之前实施保持 threading.Lock + 限制临界区；若在阶段 2 之后改 asyncio.Lock |
| Provider DB schema 与阶段 1.6 冲突 | 协调 SCHEMA_VERSION bump 顺序；3.3 与 1.6 可合并为一次迁移（v2 同时加 metrics 表和 providers.priority 列） |
| CircuitBreaker 与阶段 2.3 重规划的协同 | 共享"失败计数 + 恢复探测"抽象；3.1 在 ToolNode 层（单次调用），2.3 在 executor 层（多步计划） |
| WebSocket 限流不能在中间件层 | HTTP 用 RateLimitMiddleware；WebSocket 在 chat.py 消息循环内做 per-session 令牌桶 |
| firejail 打包到 Tauri 桌面端 | Linux 包捆绑 firejail 二进制或要求系统安装；Windows 用 Job Object 不需额外二进制 |

---

## 与阶段 1/2 的依赖关系

| 前置阶段 | 依赖点 | 类型 |
|---|---|---|
| 阶段 1.6 metrics SQLite 持久化 | 熔断/限流指标落盘 | 非阻塞（3.1/3.2 可先用内存存储） |
| 阶段 1.7 工具注册去中心化 | ToolBase 改动不冲突 | 非阻塞（3.1 的 ToolBase 钩子与 1.7 装饰器正交） |
| 阶段 2.3 失败重规划 | 共享 ErrorRecoveryManager 抽象 | 建议 3.1 在 2.3 之后（避免两套失败计数机制） |
| 阶段 2.1 executor 节点 | 熔断接入点在 executor 或 ToolNode | 非阻塞（3.1 可先接 ToolNode，2.1 落地后迁移到 executor） |

**结论**：阶段 3 与阶段 1/2 弱耦合。3.5（沙箱元编程）完全独立可立即启动；3.1/3.2 独立可并行；3.3 建议在 2.3 之后；3.4 可在 3.5 之后随时启动。
