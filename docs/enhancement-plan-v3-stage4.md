# MaxmaHere 阶段 4 实施计划：MCP 安全闭环 + Tauri 桌面打包

> **版本**：v3-stage4
> **创建时间**：2026-07-04
> **目标**：MCP 安全闭环（工具级 allowlist + 调用审计 + URL 白名单 + 速率限制）+ Tauri 桌面应用真正一键分发
> **前置依赖**：阶段 3.2（API 限流的 TokenBucket 可复用于 4.4）；阶段 1.6（metrics 持久化承接 MCP 限流统计）
> **追踪方式**：每个任务含「相关文件」「改动类型」「预期改动点」「状态」四字段，开发时按文件路径定位即可

> **2026-07-04 更新**：阶段 3 已全部完成，本文档已同步调整以下细节：
> - 4.4：3.2 已落地 `api/middleware/rate_limit.py`，TokenBucket 可直接复用（不再有"若已落地"条件）
> - 4.4：3.2 已落地 `ErrorCode.RATE_LIMITED`，MCP 限流错误码可复用
> - 4.2/4.4：3.1 已落地 `agent/circuit_breaker.py`，`_wrap_tool_with_safety` 需与 CircuitBreaker 协同（CircuitBreaker 在 executor 层，包装在 init_mcp_tools 层，不冲突但需在文档中说明）
> - 4.5：`build/maxma-server.spec` 已包含 Phase 3 新增模块（`agent.circuit_breaker`、`api.middleware.*`、`api.providers.health_monitor` 等），4.5 的 spec 改动基于此最新版本
> - 4.5：3.3 已在 lifespan shutdown 中调用 `stop_health_monitor()`，sidecar 优雅关闭时 health_monitor 任务会自动停止

---

## 总览

| 子任务 | 名称 | 优先级 | 涉及文件数 | 新建文件数 |
|---|---|---|---|---|
| 4.1 | MCP 工具级 allowlist | P1 | 10 | 0 |
| 4.2 | MCP 调用审计日志 | P1 | 6 | 3 |
| 4.3 | SSE/HTTP/WS transport URL 白名单 + TLS 校验 | P0 | 6 | 1 |
| 4.4 | MCP 调用速率限制 | P1 | 6 | 2 |
| 4.5 | Tauri 桌面应用打包增强 | P1 | 18 | 3 |

---

## 关键背景发现（影响设计）

1. **tools/mcp/ 目录不存在**：项目用单文件 [tools/mcp.py](file:///d:/Maxma/MaxmaHere/tools/mcp.py) 实现全部 MCP 逻辑，依赖 `langchain-mcp-adapters` 的 `MultiServerMCPClient`，**没有自实现的 stdio/sse/http/wss client**。transport 实现细节由该库内部完成
2. **agent/audit_log.py 的 log_event 是死代码**：在整个代码库零调用（grep 仅命中定义与 import），阶段 4.2 需从零接入
3. **Tauri 桌面打包已大量落地**：2026-07-04 已修复 build-server.bat 硬编码 PyInstaller 路径、main.rs Rust 编译错误，sidecar 启动 + 崩溃重启 + 健康检查 + 优雅关闭均已实现。4.5 主要是补齐数据持久化、端口管理、安装包优化
4. **人格级 native tool allowlist 已存在**：[agent/prompts.py:270](file:///d:/Maxma/MaxmaHere/agent/prompts.py) `get_persona_allowed_tools` + [tools/__init__.py:504-514](file:///d:/Maxma/MaxmaHere/tools/__init__.py)，但**当前显式跳过 MCP 工具**（注释 "MCP 工具不受限制"），是 4.1 的天然接入点
5. **api/middleware/rate_limit.py 不存在**（阶段 3.2 计划新建），4.4 需依赖或独立实现
6. **MCP 限流不能在 HTTP 中间件层**：MCP 工具调用在 LangGraph ToolNode 内部，不经过 HTTP，必须在 tool 包装层

---

## 子任务 4.1 — MCP 工具级 allowlist

**目标**：让每个 MCP 服务器可配置允许/屏蔽的工具名单（allowlist/blocklist），防止恶意工具调用。

### 4.1.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [tools/mcp.py](file:///d:/Maxma/MaxmaHere/tools/mcp.py) | MCP 工具管理器：4 种 transport 配置模型 + MultiServerMCPClient 加载 + 热加载回调 | ① `_BaseServerMixin` 新增 `allowed_tools: list[str] \| None` 与 `blocked_tools: list[str] \| None` 字段；② `init_mcp_tools()` 在 `_client.get_tools()` 后按 server_id 前缀过滤，仅保留 allowlist 内/排除 blocklist 内的工具；③ `get_mcp_servers_info()` 返回每个服务器的 allowlist/blocklist 配置；④ `MCPServersConfigFile` 持久化新字段 |
| [tools/mcp_security.py](file:///d:/Maxma/MaxmaHere/tools/mcp_security.py) | MCP stdio 命令白名单校验（_ALLOWED_STDIO_COMMANDS 5 个命令） | 新增 `validate_tool_filter(allowed, blocked, tool_names)` 工具函数：校验 allowlist/blocklist 互斥、通配符格式（如 `github_*`）、与实际工具名前缀匹配 |
| [api/routes/mcp.py](file:///d:/Maxma/MaxmaHere/api/routes/mcp.py) | MCP 服务器 CRUD + 热加载端点 | ① MCPServerCreateBody/MCPServerUpdateBody 新增 `allowed_tools`/`blocked_tools` 字段；② `_build_server_dict` 写入新字段；③ 新增 `GET /mcp/servers/{id}/tools` 列出该服务器所有工具名（供前端选择） |
| [tools/config/tool_manage_mcp.py](file:///d:/Maxma/MaxmaHere/tools/config/tool_manage_mcp.py) | 自然语言管理 MCP 服务器工具 | ManageMCPInput 新增 `allowed_tools`/`blocked_tools` 字段（`-` 分隔字符串），`add`/`enable` action 写入 YAML |
| [tools/__init__.py](file:///d:/Maxma/MaxmaHere/tools/__init__.py) | 工具集中注册 + select_tools_for_query 动态过滤 + 人格 allowlist 过滤 | L497-499 注释 "MCP 工具不受限制" 改为：读取每个 MCP 工具来源服务器的 allowlist 配置，应用过滤；或在 `merge_tool_lists(result, list(mcp_tools))` 前先按服务器 allowlist 过滤 `mcp_tools` |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | Pydantic BaseSettings | 新增 `mcp_tool_filter_strict_mode: bool = False`（strict 模式下未在 allowlist 的工具直接报错而非隐藏） |
| [api/data/mcp_servers.yaml](file:///d:/Maxma/MaxmaHere/api/data/mcp_servers.yaml) | MCP 服务器配置持久化（gitignored） | YAML 新增 `allowed_tools`/`blocked_tools` 字段（向后兼容，缺失=不限制） |
| [web/src/views/McpView.vue](file:///d:/Maxma/MaxmaHere/web/src/views/McpView.vue) | 前端 MCP 管理页面（列表 + 添加/编辑表单） | ① 表单新增"允许的工具"/"屏蔽的工具"输入区（chips 组件，支持通配符）；② 加载服务器详情后展示该服务器所有工具列表供勾选；③ `handleSave` body 携带新字段 |
| [web/src/types/index.ts](file:///d:/Maxma/MaxmaHere/web/src/types/index.ts) | TS 类型定义 | MCPServerConfig/MCPServerCreateBody/MCPServerUpdateBody 新增 `allowed_tools?: string[]`、`blocked_tools?: string[]` |
| [web/src/api/index.ts](file:///d:/Maxma/MaxmaHere/web/src/api/index.ts) | 前端 API 封装 | 新增 `listMcpServerTools(serverId)` 调用 `GET /mcp/servers/{id}/tools` |

### 4.1.2 不动的参考文件

| 文件路径 | 说明 |
|---|---|
| [agent/prompts.py](file:///d:/Maxma/MaxmaHere/agent/prompts.py) | get_persona_allowed_tools 已实现 native 工具过滤，仅参考其实现模式，MCP allowlist 在 tools/mcp.py 内部完成 |
| [agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py) | MCP 工具过滤在 select_tools_for_query 阶段完成，graph 无需感知 |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | allowlist 在 init_mcp_tools 内部生效，server 无需改动 |
| [app_paths.py](file:///d:/Maxma/MaxmaHere/app_paths.py) | 配置文件路径不变，仅扩展 YAML schema |

### 4.1.3 关键设计点

- **过滤时机**：allowlist 应在 `init_mcp_tools()` 内部、`_client.get_tools()` 之后过滤，而非在 `select_tools_for_query` 中。理由：MCP 工具名带 `{server_id}_` 前缀，过滤逻辑天然按前缀分组
- **热加载一致性**：`reload_mcp()` 重建工具时需重新应用 allowlist，避免配置更新后旧工具残留
- **向后兼容**：YAML 中 `allowed_tools`/`blocked_tools` 缺失 = 不限制，现有配置无需迁移

### 4.1.4 状态

- [x] 已完成（2026-07-04）
  - tools/mcp.py: `_BaseServerMixin` 新增 allowed_tools/blocked_tools 字段，`_filter_tool_by_name` 支持 fnmatch 通配符
  - tools/mcp_security.py: `validate_tool_filter` 校验互斥与通配符格式
  - api/routes/mcp.py: 新增 `GET /mcp/servers/{id}/tools` 端点
  - web/src/views/McpView.vue: chips 输入组件 + 工具列表展示
  - config/settings.py: `mcp_tool_filter_strict_mode`

---

## 子任务 4.2 — MCP 调用审计日志

**目标**：激活死代码 audit_log.py，让每次 MCP 工具调用写入审计日志（服务器/工具名/参数/结果/耗时），可追溯。

### 4.2.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [agent/audit_log.py](file:///d:/Maxma/MaxmaHere/agent/audit_log.py) | AuditLogger：log_event/read_log/get_stats/clear_log/trim_log（**log_event 当前零调用，死代码**） | ① log_event 新增 `mcp_call` 事件类型常量；② 新增便捷函数 `log_mcp_call(server_id, tool_name, args_summary, result_summary, duration_ms, status, error=None)`；③ 考虑异步写入（`asyncio.to_thread` 包裹文件 IO）避免阻塞 Agent；④ MAX_RECORDS 调大或改为按时间窗口轮转 |
| [api/routes/audit_log.py](file:///d:/Maxma/MaxmaHere/api/routes/audit_log.py) | 审计日志查看/清理 API（/audit-log、/audit-log/stats、/audit-log/clear、/audit-log/encrypt-keys） | ① list_audit_log 支持 `event_type=mcp_call` 过滤（已支持，验证）；② 新增 `GET /audit-log/mcp-summary` 聚合统计每个 server_id+tool_name 的调用次数/成功率/平均耗时；③ audit_log_stats 的 by_type 自动包含 mcp_call |
| [tools/mcp.py](file:///d:/Maxma/MaxmaHere/tools/mcp.py) | MCP 工具加载（MultiServerMCPClient.get_tools() 返回 BaseTool 列表） | ① `init_mcp_tools()` 在 `_tools = await _client.get_tools()` 后，用 `_wrap_tool_with_audit(tool, server_id)` 包装每个工具的 `_run`/`_arun`；② 包装内：调用前 `log_event('mcp_call', status='started', extra={server_id, tool_name, args})`，调用后 `log_event('mcp_call', status='ok'/'error', extra={duration, result_size})`；③ `reload_mcp()` 重建时也要重新包装 |
| [SECURITY.md](file:///d:/Maxma/MaxmaHere/SECURITY.md) | 安全清单：L93 "Audit logging — 所有 API 请求审计日志（规划中）" 未勾选 | 勾选审计日志项；更新说明为 "MCP 工具调用审计日志已落地，HTTP 请求审计待阶段 3.2" |
| [web/src/api/index.ts](file:///d:/Maxma/MaxmaHere/web/src/api/index.ts) | 前端 API 封装（已有 getAuditLog/getAuditStats/clearAuditLog） | 新增 `getMcpAuditSummary()` 调用 `GET /audit-log/mcp-summary` |

### 4.2.2 不动的参考文件

| 文件路径 | 说明 |
|---|---|
| [agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py) | 审计日志在 tool 包装层完成，graph 无需感知 |
| [api/routes/chat.py](file:///d:/Maxma/MaxmaHere/api/routes/chat.py) | 工具已在 init_mcp_tools 阶段被包装，chat 路由拿到的是已包装的 BaseTool |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | 包装逻辑在 init_mcp_tools 内部 |
| [app_paths.py](file:///d:/Maxma/MaxmaHere/app_paths.py) | 打包模式下 LOGS_DIR 已指向 `%APPDATA%/MaxmaHere/logs`，审计日志持久化路径正确 |

### 4.2.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `web/src/views/AuditLogView.vue` | 审计日志查看页面，展示 mcp_call 事件，支持按 server_id/tool_name/status 过滤（阶段 1.5 计划新建，4.2 需确保含 mcp_call 筛选） |
| `web/src/components/AuditLogTable.vue` | 审计日志表格组件，复用于 AuditLogView 和 Settings 页面（可选） |
| `tests/test_agent/test_audit_log.py` | log_mcp_call 单测：写入/读取/过滤/统计 |

### 4.2.4 关键设计点

- **与 4.4 合并实现**：审计包装应与 4.4 限流合并为单一装饰器 `_wrap_tool_with_safety(tool, server_id)`，避免双重包装开销
- **BaseTool 包装保留元信息**：`langchain-mcp-adapters` 返回的 BaseTool 可能是动态生成的子类，包装时需保留原工具的 `name`/`description`/`args_schema`，否则 LLM 无法正确调用。建议用 `functools.wraps` 或继承原类
- **异步 IO**：审计日志 IO 应异步（`asyncio.to_thread`），避免阻塞 Agent 主循环

### 4.2.5 状态

- [x] 已完成（2026-07-04）
  - agent/audit_log.py: 激活 `log_event` 死代码，新增 `log_mcp_call()` 与 `get_mcp_summary()`
  - tools/mcp.py: `_wrap_tool_with_safety` 装饰器合并审计与限流，`functools.wraps` 保留 BaseTool 元信息
  - api/routes/audit_log.py: 新增 `GET /audit-log/mcp-summary` 端点
  - 审计 IO 通过 `asyncio.to_thread` 异步写入

---

## 子任务 4.3 — SSE/HTTP/WS transport URL 白名单 + TLS 校验

**目标**：为 SSE/HTTP/WebSocket transport 增加 URL 白名单 + TLS 校验，当前仅 stdio 有命令白名单。

### 4.3.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [tools/mcp.py](file:///d:/Maxma/MaxmaHere/tools/mcp.py) | 4 种 transport 配置模型（StdioServerConfig/SSEServerConfig/StreamableHttpServerConfig/WebsocketServerConfig），to_connection() 仅传递 url/headers/timeout，**无任何 URL 校验** | ① SSEServerConfig/StreamableHttpServerConfig/WebsocketServerConfig 的 `url` 字段加 `@field_validator` 调用 `validate_transport_url(url, transport)`；② 新增 `tls_verify: bool = True` 字段（允许开发时关闭）；③ to_connection() 传递 tls_verify 给 client（若 langchain-mcp-adapters 支持，否则在包装层强制） |
| [tools/mcp_security.py](file:///d:/Maxma/MaxmaHere/tools/mcp_security.py) | stdio 命令白名单（_ALLOWED_STDIO_COMMANDS + validate_stdio_command） | ① 新增 `_ALLOWED_URL_SCHEMES = {"http", "https", "ws", "wss"}`；② 新增 `_ALLOWED_URL_HOSTS` 白名单（localhost/127.0.0.1/0.0.0.0 + 用户配置的内部服务域名）；③ 新增 `validate_transport_url(url, transport)` 函数：校验 scheme 与 transport 匹配（sse/http→http(s)，websocket→ws(s)）、host 在白名单、端口在允许范围、HTTPS/WSS 强制 TLS（生产模式）；④ 新增 `validate_tls_config(url, tls_verify)`：生产模式下 http/ws 直接拒绝（除非显式 `tls_verify=False` + 日志告警） |
| [api/routes/mcp.py](file:///d:/Maxma/MaxmaHere/api/routes/mcp.py) | MCP CRUD：_build_server_dict 写入 url 字段 | ① MCPServerCreateBody/MCPServerUpdateBody 新增 `tls_verify: bool = True`；② `_build_server_dict` 对 sse/http/websocket 调用 `validate_transport_url(body.url, body.transport)`，失败返回 400 |
| [tools/config/tool_manage_mcp.py](file:///d:/Maxma/MaxmaHere/tools/config/tool_manage_mcp.py) | 自然语言管理 MCP | `add` action 对 url 类型 transport 调用 `validate_transport_url` |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | Pydantic BaseSettings | 新增 `mcp_allowed_url_hosts: list[str] = ["localhost", "127.0.0.1"]`、`mcp_force_tls: bool = False`（生产模式默认 True）、`mcp_allowed_url_ports: list[int] \| None = None`（None=不限制） |
| [web/src/views/McpView.vue](file:///d:/Maxma/MaxmaHere/web/src/views/McpView.vue) | MCP 管理表单 | ① URL 输入框新增校验提示（http/https/ws/wss 协议、host 白名单）；② 新增"TLS 校验"开关（默认开）；③ 错误信息展示后端返回的校验失败原因 |
| [web/src/types/index.ts](file:///d:/Maxma/MaxmaHere/web/src/types/index.ts) | TS 类型 | MCPServerConfig/MCPServerCreateBody/MCPServerUpdateBody 新增 `tls_verify?: boolean` |

### 4.3.2 新建文件

| 文件路径 | 职责 |
|---|---|
| `tests/test_tools/test_mcp_security.py` | validate_transport_url/validate_tls_config 单测：scheme/host/port/TLS 强制校验 |

### 4.3.3 关键设计点与风险

- **最高风险：没有自实现 transport client**：项目全部由 `langchain-mcp-adapters` + `mcp` 包内部处理 transport。TLS 校验只能两层做：
  - **路径 A（推荐，简单）**：URL 预校验，在 `to_connection()` 阶段拒绝不合规 URL
  - **路径 B（纵深防御，复杂）**：monkey-patch `mcp` 库的 httpx/websockets 客户端强制 `verify=True`，但可能破坏库内部行为
  - 建议优先做 A，B 作为可选增强
- **生产 vs 开发模式**：生产模式（`MAXMA_ENV=production`）强制 HTTPS/WSS，开发模式允许 HTTP/WS 但日志告警
- **langchain-mcp-adapters 0.3.0 兼容性**：是否支持自定义 SSL context 需验证；若不支持，只能做 URL 预校验

### 4.3.4 状态

- [x] 已完成（2026-07-04）
  - tools/mcp_security.py: `validate_transport_url()` + `validate_tls_config()`，host 白名单 + 屏蔽 metadata 服务地址（169.254.169.254 等）
  - tools/mcp.py: SSE/HTTP/WebsocketServerConfig 的 `url` 字段加 `@field_validator`，新增 `tls_verify: bool = True`
  - config/settings.py: `mcp_allowed_url_hosts` / `mcp_force_tls` / `mcp_allowed_url_ports`
  - web/src/views/McpView.vue: TLS 校验开关 + URL 校验失败提示

---

## 子任务 4.4 — MCP 调用速率限制

**目标**：每个 MCP 服务器设调用速率上限（如 60 次/分钟），防止资源滥用。

### 4.4.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [tools/mcp.py](file:///d:/Maxma/MaxmaHere/tools/mcp.py) | MCP 工具加载 | ① 新增 `MCPRateLimiter` 类（per-server_id 令牌桶，默认 10 calls/min/server）；② `init_mcp_tools()` 包装每个工具的 `_run`/`_arun`，调用前 `limiter.acquire(server_id)`，超限返回 `format_error("速率超限，请稍后重试")`；③ 与 4.2 审计包装可合并为单一装饰器 `_wrap_tool_with_safety(tool, server_id)` |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | Pydantic BaseSettings | 新增 `mcp_rate_limit_per_minute: int = 60`（每服务器每分钟最大调用数）、`mcp_rate_limit_burst: int = 10`（突发上限）、`mcp_rate_limit_enabled: bool = True` |
| [api/metrics.py](file:///d:/Maxma/MaxmaHere/api/metrics.py) | Metrics 单例：record_request/record_error | 新增 `record_mcp_rate_limit(server_id)` 统计被限流的 MCP 调用数 |
| [agent/audit_log.py](file:///d:/Maxma/MaxmaHere/agent/audit_log.py) | 审计日志 | 限流触发时也写 `log_event('mcp_call', status='rate_limited', extra={server_id, tool_name})`（与 4.2 协同） |

### 4.4.2 不动的文件

| 文件路径 | 说明 |
|---|---|
| [api/routes/chat.py](file:///d:/Maxma/MaxmaHere/api/routes/chat.py) | 限流在 tool 包装层完成，chat 路由无感知 |
| [agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py) | 限流在 tool 层，graph 无感知 |
| [api/middleware/rate_limit.py](file:///d:/Maxma/MaxmaHere/api/middleware/rate_limit.py) | 阶段 3.2 已落地，4.4 复用其 `TokenBucket` 类（仅数据结构，不复用 HTTP 中间件层逻辑） |

### 4.4.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `tools/mcp_rate_limiter.py` | MCPRateLimiter 类：per-server 令牌桶，避免 tools/mcp.py 膨胀；复用 3.2 已落地的 `api/middleware/rate_limit.py` 的 `TokenBucket`，但 MCP 限流逻辑独立（per-server_id 而非 per-IP/session） |
| `tests/test_tools/test_mcp_rate_limiter.py` | 令牌桶单测：突发/持续/恢复 |

### 4.4.4 关键设计点

- **MCP 限流不能在 HTTP 中间件层**：MCP 工具调用在 LangGraph ToolNode 内部，不经过 HTTP，必须在 tool 包装层
- **限流粒度**：per-server_id（而非 per-tool），避免单服务器工具过多导致全局限流过严
- **与 4.2 合并**：建议 4.2 审计 + 4.4 限流合并为 `_wrap_tool_with_safety` 单一装饰器，避免双重包装开销
- **复用 3.2 的 TokenBucket**：阶段 3.2 已落地 `api/middleware/rate_limit.py`，其 `TokenBucket` 类（线程安全、支持 capacity/refill_rate/try_take/peek/remaining）可直接复用。MCP 限流逻辑独立于 HTTP 中间件层，仅在 tool 包装层使用 TokenBucket 数据结构
- **复用 3.2 的 RATE_LIMITED 错误码**：阶段 3.2 已落地 `ErrorCode.RATE_LIMITED`，MCP 限流超限时可复用此错误码，通过 `format_error()` 返回结构化错误响应（含 retry_after/limit/remaining 详情）
- **与 3.1 CircuitBreaker 协同**：阶段 3.1 的 CircuitBreaker 在 executor 层工作（通过 ErrorRecoveryManager），`_wrap_tool_with_safety` 在 init_mcp_tools 层工作，两者不冲突。CircuitBreaker 响应工具调用失败（计数→熔断），`_wrap_tool_with_safety` 在调用前预检（限流→拒绝）。当 `_wrap_tool_with_safety` 因限流拒绝调用时，不应触发 CircuitBreaker 的 failure 计数（避免限流导致误熔断）—— 在包装层返回 `format_error` 而非抛异常即可，CircuitBreaker 仅统计真实调用失败

### 4.4.5 状态

- [x] 已完成（2026-07-04）
  - tools/mcp_rate_limiter.py: `MCPRateLimiter` 类，per-server_id 令牌桶，复用 3.2 的 `TokenBucket`
  - tools/mcp.py: `_wrap_tool_with_safety` 合并审计（4.2）+ 限流（4.4），限流拒绝返回 `format_error` 不触发 CircuitBreaker
  - api/metrics.py: `record_mcp_rate_limit()` 统计被限流调用数
  - config/settings.py: `mcp_rate_limit_per_minute` / `mcp_rate_limit_burst` / `mcp_rate_limit_enabled`

---

## 子任务 4.5 — Tauri 桌面应用打包增强

**目标**：在已落地的 Tauri 桌面端基础上，补齐数据持久化、端口管理、安装包优化，实现真正一键分发。

**现状**：Tauri 桌面端已大量落地（sidecar 启动 + 崩溃重启 + 健康检查 + 优雅关闭均已实现）。4.5 主要是增强而非从零构建。

### 4.5.1 核心改动文件

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [desktop/src-tauri/src/main.rs](file:///d:/Maxma/MaxmaHere/desktop/src-tauri/src/main.rs) | Tauri 入口：sidecar 启动 + 崩溃重启（MAX_RESTARTS=3）+ 健康检查（30s 超时，轮询 /api/auth/token）+ Windows 文件对话框 + 优雅关闭 | ① 健康检查端点改为 `/api/health`（更语义化）；② 新增 sidecar stdout/stderr 写入日志文件（`%APPDATA%/MaxmaHere/logs/server.log`）；③ 新增端口冲突处理：启动前检测 8000 端口，被占用时自动选择下一个可用端口并通过环境变量传给 sidecar；④ 新增 single-instance 插件防止多开 |
| [desktop/src-tauri/tauri.conf.json](file:///d:/Maxma/MaxmaHere/desktop/src-tauri/tauri.conf.json) | Tauri 配置：productName、CSP、bundle targets（nsis）、externalBin（maxma-server） | ① `bundle.resources` 添加 `resources/**/*`（如需捆绑额外资源）；② 新增 `bundle.windows.nsis.installerIcon`；③ CSP 收紧（移除 `ws://localhost:5173` 生产模式不需要的源）；④ `app.security.freezePrototype` 设为 true |
| [desktop/src-tauri/Cargo.toml](file:///d:/Maxma/MaxmaHere/desktop/src-tauri/Cargo.toml) | Rust 依赖：tauri 2、tauri-plugin-shell、tauri-plugin-http、reqwest、windows | ① 新增 `tauri-plugin-single-instance = "2"`（防多开）；② 新增 `tauri-plugin-log = "2"`（日志）；③ 新增 `log = "0.4"` |
| [desktop/src-tauri/capabilities/default.json](file:///d:/Maxma/MaxmaHere/desktop/src-tauri/capabilities/default.json) | Tauri 权限：shell:allow-spawn/kill、http:default（127.0.0.1:8000） | ① 新增 `single-instance:default`；② http 权限收窄为精确路径 |
| [build/maxma-server.spec](file:///d:/Maxma/MaxmaHere/build/maxma-server.spec) | PyInstaller 配置：datas、hiddenimports、excludes、onedir 模式（已含 Phase 3 的 `agent.circuit_breaker`、`api.middleware.*`、`api.providers.health_monitor` 等模块） | ① `datas` 新增 `api/data` 下的默认配置模板（注意 `auth_token.yaml`/`providers.yaml` 等用户数据不应打包，运行时在 `%APPDATA%` 创建）；② `hiddenimports` 新增阶段 4 新建的模块（`tools.mcp_rate_limiter`、`tools.mcp_security` 等），**在现有 Phase 3 模块列表基础上追加**；③ 评估 `--onefile` vs `--onedir`（当前 onedir，体积大但启动快）；④ 新增 `icon='desktop/src-tauri/icons/icon.ico'`；⑤ **修复 pre-existing 的 `tools/registry.py` 兼容性问题**：`discover_tools()` 用 `Path.rglob("tool_*.py")` 扫描磁盘，PyInstaller 打包后 `.py` 在 PYZ 内磁盘上找不到，导致 `discovered 0 tool(s)` → `validate_tool_registry` 报错。需改为用 `pkgutil.iter_modules` 或在 spec 中把 `tools/` 作为 datas 打包 |
| [build/build-server.bat](file:///d:/Maxma/MaxmaHere/build/build-server.bat) | 后端打包：venv 检查 → PyInstaller 安装 → 前端构建 → PyInstaller 打包 → 冒烟测试 → 复制到 Tauri binaries | ① 打包前清理 `desktop/src-tauri/binaries/` 旧 exe；② 新增 `/SKIP_FRONTEND` 参数跳过前端构建（开发时加速）；③ 日志输出到 `build/logs/build-server.log` |
| [build/build-desktop.bat](file:///d:/Maxma/MaxmaHere/build/build-desktop.bat) | 桌面打包入口：调用 build-server.bat → cargo tauri build | ① 修复中文乱码（当前文件含 `?` 乱码）；② 新增构建产物大小报告；③ 新增 `/SKIP_SERVER` 参数跳过 sidecar 重建 |
| [build/run-desktop-dev.bat](file:///d:/Maxma/MaxmaHere/build/run-desktop-dev.bat) | 桌面开发模式：端口清理 → build-server.bat → Vite dev → port-guard → cargo tauri dev | ① 新增 `MAXMA_ENV=development` 环境变量传递给 sidecar；② Vite 启动后等待 URL 改为 `http://127.0.0.1:{web_port}` 而非 localhost（避免 IPv6 解析问题） |
| [build/smoke-test-server.ps1](file:///d:/Maxma/MaxmaHere/build/smoke-test-server.ps1) | 后端冒烟测试：启动 exe → 等待 /api/auth/token → /api/health → /api/providers | 新增 MCP 端点测试：`/api/mcp/servers` 应返回 200（验证 4.1-4.4 改动后 MCP 路由正常） |
| [app_paths.py](file:///d:/Maxma/MaxmaHere/app_paths.py) | 路径解析：_is_frozen() 检测 PyInstaller、_get_bundle_dir() 返回 _MEIPASS、_get_data_dir() 返回 %APPDATA%/MaxmaHere | ① 新增 `ensure_data_dirs()` 在首次运行时复制默认配置（如 `config/personas/SOUL.example.md` → `%APPDATA%/MaxmaHere/config/personas/`）；② 新增 `MCP_CONFIG_PATH` 打包模式下首次运行创建空 YAML |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | FastAPI 工厂：L469 MAXMA_ENV=production 时挂载前端静态文件 | ① 生产模式启动时调用 `ensure_data_dirs()`；② 静态文件挂载路径确认用 `BUNDLE_DIR/web/dist`（当前已用 WEB_DIST_DIR，验证） |
| [main.py](file:///d:/Maxma/MaxmaHere/main.py) | 应用入口（uvicorn 启动） | 打包模式下 `host` 强制 `127.0.0.1`（防意外暴露）、端口从 `MAXMA_API_PORT` 环境变量读取（Tauri 传入） |
| [docs/desktop-app-plan.md](file:///d:/Maxma/MaxmaHere/docs/desktop-app-plan.md) | 桌面应用构建方案（Phase 1-6） | 更新进度：Phase 1-5 已完成，标注 Phase 6（数据持久化）状态 |
| [docs/desktop-build-checklist.md](file:///d:/Maxma/MaxmaHere/docs/desktop-build-checklist.md) | 桌面打包检查清单 | 新增 4.5 改动项的验证步骤 |
| [SECURITY.md](file:///d:/Maxma/MaxmaHere/SECURITY.md) | 安全清单 | 新增 "Desktop app sidecar isolation" 项 |
| [docs/ROADMAP.md](file:///d:/Maxma/MaxmaHere/docs/ROADMAP.md) | 总路线图 | 新增阶段 4 章节 |

### 4.5.2 不动的文件

| 文件路径 | 说明 |
|---|---|
| [desktop/src-tauri/build.rs](file:///d:/Maxma/MaxmaHere/desktop/src-tauri/build.rs) | Tauri 构建脚本（仅 tauri_build::build()） |
| [build/port-guard.ps1](file:///d:/Maxma/MaxmaHere/build/port-guard.ps1) | 端口清理脚本 |
| [build/setup-dev-env.bat](file:///d:/Maxma/MaxmaHere/build/setup-dev-env.bat) | 开发环境初始化 |
| [build/setup-desktop-env.bat](file:///d:/Maxma/MaxmaHere/build/setup-desktop-env.bat) | 桌面环境初始化 |
| [build/dev-tools.ps1](file:///d:/Maxma/MaxmaHere/build/dev-tools.ps1) | 通用开发工具脚本 |
| [start.bat](file:///d:/Maxma/MaxmaHere/start.bat) | 开发模式启动（仅开发用，打包后不使用） |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | 端口已支持环境变量，Tauri 通过 MAXMA_API_PORT 传入 |
| [web/package.json](file:///d:/Maxma/MaxmaHere/web/package.json) | 前端依赖（已含 @tauri-apps/plugin-http） |
| [web/vite.config.ts](file:///d:/Maxma/MaxmaHere/web/vite.config.ts) | Vite 配置已支持环境变量端口 |
| [pyproject.toml](file:///d:/Maxma/MaxmaHere/pyproject.toml) | pyinstaller>=6.0.0 在 dev extras，无需新增 |
| [requirements.txt](file:///d:/Maxma/MaxmaHere/requirements.txt) | 打包依赖已齐全（pywin32==312、mcp==1.28.1、langchain-mcp-adapters==0.3.0） |

### 4.5.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `desktop/src-tauri/src/port_manager.rs` | 端口分配与冲突检测：启动前选可用端口，传给 sidecar |
| `desktop/src-tauri/resources/default-config/mcp_servers.yaml` | 打包内置的默认 MCP 配置模板，首次运行复制到 %APPDATA% |
| `docs/enhancement-plan-v3-stage4.md` | 本阶段实施计划文档（即此文件） |

### 4.5.4 关键设计点与风险

#### 进程管理
- **现状**：main.rs 已实现 sidecar 启动 + 崩溃重启（3 次）+ 健康检查（30s）+ 优雅关闭（窗口 Destroyed 时 kill child）
- **风险**：`child.kill()` 在 Windows 上是强制终止（`TerminateProcess`），不等 sidecar 清理资源。建议改为先 `child.write_stdin("shutdown\n")` 等 5s 再 kill（但需 sidecar 支持优雅关闭信号）
- **风险**：sidecar 崩溃后重启，但前端 WebSocket 未断开重连，导致"幽灵连接"。main.rs 已 emit `server-restarting` 事件，需确认前端监听并重连

#### 端口分配
- **现状**：main.rs 从 `MAXMA_API_PORT` 环境变量读端口（默认 8000），但未做端口冲突检测
- **风险**：若 8000 被占用，sidecar 启动失败 → 触发重启循环 → 3 次后放弃。建议新增 `port_manager.rs`：启动前检测端口，被占用则选下一个可用端口（8001-8010），通过环境变量传给 sidecar 和前端
- **风险**：前端 `getApiBase()` 需动态获取端口。Tauri 可通过 `invoke('get_api_port')` 命令获取

#### PyInstaller 兼容性
- **现状**：maxma-server.spec 已完整配置，含动态 `collect_local_extension_modules()`、`safe_collect_submodules`
- **风险**：`langchain-mcp-adapters==0.3.0` 的动态导入可能未被 hiddenimports 覆盖。建议打包后冒烟测试增加 MCP 工具加载验证（`/api/mcp/servers` 返回非空且无 error）
- **风险**：`mcp==1.28.1` 依赖 `pywin32==312`，PyInstaller 需确保 `pywin32_system32` DLLs 被收集
- **风险**：Playwright 浏览器二进制（~200MB）未打包，首次运行需下载。需确认是否触发首次下载流程
- **体积**：当前 `dist/maxma-server.exe` 是单文件模式（`EXE` 含 `a.binaries, a.datas`），启动慢（每次解压 `_MEIPASS`），建议评估改回 onedir（`COLLECT` 段）以加速启动

#### 数据持久化
- **现状**：app_paths.py 已实现 `_get_data_dir()` 打包模式返回 `%APPDATA%/MaxmaHere/`
- **风险**：首次运行时 `%APPDATA%/MaxmaHere/config/personas/` 为空，用户无人设文件。需在 `ensure_data_dirs()` 后复制 `BUNDLE_DIR/config/personas/SOUL.example.md` → `DATA_DIR/config/personas/SOUL.md`
- **风险**：`MCP_CONFIG_PATH` 在打包模式下指向 `%APPDATA%/MaxmaHere/api/data/mcp_servers.yaml`，首次运行不存在。需 `load_mcp_config()` 处理首次创建空 YAML

#### 应用更新
- **现状**：`tauri-plugin-updater` 未集成
- **建议**：自动更新需配置更新服务器（GitHub Releases / 自建）。若无更新服务器，建议先不做自动更新，改为手动下载新版本覆盖安装（NSIS 安装包支持覆盖安装）

#### CSP 与 Tauri 权限
- **现状**：tauri.conf.json 的 CSP 含 `ws://localhost:5173 ws://127.0.0.1:5173`（开发用），生产模式应移除
- **风险**：`capabilities/default.json` 的 `http:default` 允许 `http://127.0.0.1:8000/*`，生产模式若端口动态分配需动态更新权限（或允许 `http://127.0.0.1:*`）

### 4.5.5 状态

- [x] 已完成（2026-07-04）
  - desktop/src-tauri/src/port_manager.rs: 端口冲突检测，优先 MAXMA_API_PORT 环境变量，回退扫描 8000-8010
  - desktop/src-tauri/src/main.rs: 动态端口传递（`MAXMA_API_PORT`）、`get_api_port` Tauri 命令、sidecar stdout/stderr 重定向到 `%APPDATA%/MaxmaHere/logs/server.log`、健康检查改用 `/api/health`、`tauri-plugin-single-instance` 防多开
  - desktop/src-tauri/Cargo.toml: 新增 `tauri-plugin-single-instance` / `tauri-plugin-log` / `log`
  - desktop/src-tauri/capabilities/default.json: `single-instance:default` 权限 + http 端口 8000-8010
  - desktop/src-tauri/tauri.conf.json: 收紧 CSP（移除开发源）、bundle.resources 默认配置、NSIS installerIcon
  - desktop/src-tauri/resources/default-config/mcp_servers.yaml: 首次运行复制的默认 MCP 配置模板
  - app_paths.py: `_ensure_mcp_config()` 首次运行创建空 MCP 配置
  - web/src/utils/env.ts: `ensurePortLoaded()` 通过 `invoke('get_api_port')` 加载运行时端口
  - web/src/api/index.ts: `ensureTokenLoaded()` 内重载 BASE，修复 upload 路径双 `/api` bug
  - build/smoke-test-server.ps1: 新增 MCP 端点冒烟测试
  - build/maxma-server.spec: hiddenimports 追加 Phase 4 新模块

---

## 实施顺序建议

```
4.3 transport URL 白名单 + TLS 校验（独立，P0 安全风险，最先做）
    ↓
4.1 MCP 工具级 allowlist（独立，P1）
    ↓
4.2 MCP 调用审计日志（独立，P1）
    ↓
4.4 MCP 调用速率限制（与 4.2 合并为 _wrap_tool_with_safety 装饰器）
    ↓
4.5 Tauri 桌面应用打包增强（依赖 4.1-4.4 落地后打包验证）
```

**并行机会**：
- 4.1 / 4.2 / 4.3 完全独立，可并行
- 4.4 建议在 4.2 之后（合并装饰器，避免双重包装）
- 4.5 建议最后（需 4.1-4.4 落地后打包验证）

**关键约束**：
- 4.3 必须先于 4.5（URL 校验需在打包前验证）
- 4.2 + 4.4 合并实现（避免双重 tool 包装）
- 4.5 的 PyInstaller spec 更新需同步 4.1-4.4 新增模块（`tools.mcp_rate_limiter` 等）加入 `hiddenimports`，**在现有 Phase 3 模块列表基础上追加**
- 4.5 需修复 pre-existing 的 `tools/registry.py` PyInstaller 兼容性问题（`Path.rglob` 在打包后失效，需改用 `pkgutil.iter_modules` 或将 `tools/` 作为 datas 打包）

---

## 验收标准

| 子任务 | 验收点 |
|---|---|
| 4.1 | 每个 MCP 服务器可配置 allowed_tools/blocked_tools；init_mcp_tools 按配置过滤；热加载重新应用过滤；YAML 向后兼容；前端 McpView 可视化配置 |
| 4.2 | audit_log.py 不再是死代码；每次 MCP 工具调用写入 mcp_call 事件；GET /audit-log/mcp-summary 返回聚合统计；AuditLogView 展示 mcp_call 事件 |
| 4.3 | SSE/HTTP/WS transport URL 校验生效；host 白名单拒绝外部地址；生产模式强制 HTTPS/WSS；TLS 校验开关可用；前端展示校验失败原因 |
| 4.4 | 每服务器速率限制生效（默认 60/min）；超限返回 format_error；限流事件写入审计日志；MCPRateLimiter 单测通过 |
| 4.5 | 端口冲突自动选择可用端口；首次运行复制默认配置；sidecar 日志写入文件；打包后冒烟测试含 MCP 端点；NSIS 安装包可覆盖安装 |

---

## 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| **`tools/registry.py` 在 PyInstaller 打包后失效（pre-existing）** | `discover_tools()` 用 `Path.rglob("tool_*.py")` 扫描磁盘，打包后 `.py` 在 PYZ 内找不到。4.5 需改为 `pkgutil.iter_modules` 或将 `tools/` 作为 datas 打包。**此问题在阶段 3 之前就存在，非 Phase 3 引入** |
| langchain-mcp-adapters 不支持自定义 SSL context | 优先做 URL 预校验（路径 A），monkey-patch（路径 B）作为可选增强 |
| BaseTool 包装丢失元信息导致 LLM 无法调用 | 用 functools.wraps 或继承原类，保留 name/description/args_schema |
| 4.2 + 4.4 双重包装开销 | 合并为单一 _wrap_tool_with_safety 装饰器 |
| **4.4 限流拒绝触发 3.1 CircuitBreaker 误熔断** | `_wrap_tool_with_safety` 因限流拒绝时返回 `format_error` 而非抛异常，CircuitBreaker 仅统计真实调用失败（不统计限流拒绝） |
| child.kill() 强制终止不等 sidecar 清理 | 先 write_stdin("shutdown") 等 5s 再 kill（需 sidecar 支持优雅关闭） |
| sidecar 崩溃后 WebSocket 幽灵连接 | 确认前端监听 server-restarting 事件并重连 |
| 端口 8000 被占用导致重启循环 | port_manager.rs 启动前选可用端口（8001-8010） |
| PyInstaller 漏掉 langchain-mcp-adapters 动态导入 | 冒烟测试增加 MCP 工具加载验证；spec 的 hiddenimports 显式声明 |
| Playwright 浏览器二进制未打包 | 确认首次下载流程；或评估打包浏览器二进制（体积+200MB） |
| onefile 启动慢（每次解压 _MEIPASS） | 评估改回 onedir 模式（COLLECT 段）加速启动 |
| 首次运行无默认配置 | ensure_data_dirs 复制 BUNDLE_DIR 默认模板到 DATA_DIR |
| CSP 生产模式含开发源 | 生产构建移除 ws://localhost:5173 等 |
| 端口动态分配与 Tauri 权限冲突 | capabilities 允许 http://127.0.0.1:* 或动态更新权限 |

---

## 与阶段 1/2/3 的依赖关系

| 前置阶段 | 依赖点 | 类型 |
|---|---|---|
| 阶段 1.5 AuditLogView 前端面板 | 4.2 复用 AuditLogView 展示 mcp_call 事件 | 建议先做 1.5（4.2 在其基础上加 mcp_call 筛选） |
| 阶段 1.6 metrics SQLite 持久化 | 4.4 的 record_mcp_rate_limit 可落盘 | 非阻塞（4.4 可先用内存存储） |
| 阶段 1.7 工具注册去中心化 | 4.1 的 tools/__init__.py 改动不冲突 | 非阻塞 |
| 阶段 2.1 executor 节点 | 4.2/4.4 的 tool 包装与 executor 协同 | 非阻塞（包装在 init_mcp_tools 层，graph 无感知） |
| 阶段 3.2 API 限流 | 4.4 复用 `TokenBucket` 类与 `ErrorCode.RATE_LIMITED` | **已落地**（4.4 直接复用，无需独立实现） |

**结论**：阶段 4 与阶段 1/2/3 弱耦合。4.3 完全独立可立即启动（P0 安全风险）；4.1/4.2 独立可并行；4.4 建议在 4.2 之后；4.5 建议最后（需 4.1-4.4 落地后打包验证）。

---

## 阶段 1-3 遗留 Bug 善后（2026-07-04 完成）

> 阶段 4 收尾阶段，对前三个阶段引入的深藏 bug 进行系统排查与修复。所有修复均通过全量测试（857 passed, 9 skipped）与前端构建验证。

### 修复清单

| Bug ID | 文件 | 问题 | 修复方案 |
|---|---|---|---|
| 5.1 | `memory/kb/chunker.py` | 边界调整截断 chunk 后，固定 `step` 推进 offset 会跳过 `end` 到 `offset+step` 之间的文本，导致文档内容丢失 | 改为 `next_offset = max(end - overlap, offset + 1)`，基于实际 end 位置推进 |
| 5.2 | `agent/executor.py` | `record_success` 对所有 ToolMessage 调用，包括失败的（content 含 `"success": false`），导致失败工具的 CircuitBreaker 失败计数被错误重置 | 调用前过滤掉 content 含 `"success": false`/`"success":false` 的 ToolMessage |
| 5.3 | `memory/kb/indexer.py` | `datetime.now()` 返回 naive datetime，与其他时区时间戳比较出错 | 改为 `datetime.now(timezone.utc).isoformat()` |
| 4.1 | `memory/kb/indexer.py` | `_index_document` 两段独立 `portalocker.Lock`（删除旧切块 / 写新 meta），中间无锁阶段其他请求可能写入 meta，后段锁内读到过期 meta 覆盖他人写入（TOCTOU） | 合并为单段锁覆盖「读 meta → 删旧切块 → 写新 meta」，无副作用的切块与 embedding 保留在锁外 |
| 1.1 | `memory/rag/vector_store.py` | `get_vector_store()` 单例初始化无锁，两线程可同时进入 init，重复创建 chromadb client | 新增 `_init_lock` + 双重检查 |
| 1.2 | `memory/rag/embedding.py` | `get_embedding_engine()` 单例初始化无锁，同 1.1 | 新增 `_init_lock` + 双重检查 |
| 1.3 | `memory/memory_manager.py` | `_auto_reindexed` 集合的 `in`/`add` 操作无锁，并发场景两线程可同时通过 `in` 检查并重复 reindex | 新增 `_auto_reindexed_lock`，check-then-add 在同一个锁内原子完成 |
| 1.4/1.6 | `api/providers/manager.py` | `iter_enabled()`/`get_healthy()`/`get_fallback()` 读 `_providers` 和 `health_status` 不持锁，与 `load_all()`/`mark_*()` 的锁内写入竞争 | 所有读路径加 `with self._lock`；`load_all()` 改为锁外构建新 dict 再锁内 swap |
| 1.5 | `api/providers/health_monitor.py` | 直接读 `provider.consecutive_failures` 和 `provider.health_status`，与 `mark_unhealthy`/`mark_healthy` 的锁内写入不一致 | `ProviderManager` 新增 `get_failure_snapshot()` 原子返回 `(failures, health_status)` |
| 1.7 | `agent/performance.py` | `PerformanceMonitor` 所有状态读写无锁，并发请求的 `start_turn`/`record_tool_call`/`end_turn` 互相覆盖 | 所有方法加 `threading.Lock` |
| 1.8 | `agent/performance.py` | `get_performance_monitor()` 单例初始化无锁 | 新增 `_monitor_lock` + 双重检查 |
| 5.4 | `api/middleware/rate_limit.py` | `_reject`/`try_consume` 多次调用 `bucket.remaining`（每次触发 `_refill()` 改变内部状态），前后读到不同值（TOCTOU） | 一次性快照 `remaining`/`capacity`/`refill_rate` |
| — | `api/middleware/rate_limit.py` | `get_ws_rate_limiter()` 单例初始化无锁（与 1.8 同类） | 新增 `_ws_rate_limiter_lock` + 双重检查 |
| — | `api/db/core.py` | v3 迁移 `ALTER TABLE providers ADD COLUMN priority` 非幂等，崩溃重启后重复执行报错 | 改为 callable 迁移 `_migrate_v3_add_priority`，先 `PRAGMA table_info` 检查列是否存在 |
| — | `web/src/api/index.ts` | `uploadImage()` 用 `${BASE}/api/upload`，但 BASE 已以 `/api` 结尾，产生 `/api/api/upload` | 改为 `${BASE}/upload` |

### 自检阶段额外修复的单例竞态（2026-07-04）

自检发现项目中所有 `global _x; if _x is None: _x = X()` 模式的单例初始化均无锁保护，统一修复为双重检查锁：

| 文件 | 单例函数 | 引入阶段 |
|---|---|---|
| `tools/mcp_rate_limiter.py` | `get_mcp_rate_limiter()` | 阶段 4.4（阶段4新增 bug） |
| `agent/error_recovery.py` | `get_recovery_manager()` | 阶段 2.3 |
| `agent/hooks.py` | `get_hook_manager()` | 历史代码 |
| `tools/__init__.py` | `_get_client()` / `get_all_tools()` / `clear_tool_cache()` | 历史代码 |
| `tools/system/sandbox_runner.py` | `get_sandbox_runner()` | 阶段 3.4 |
| `config/settings.py` | `get_settings()` / `reload_settings()` | 历史代码 |

### 验证

- **后端测试**：`pytest tests\ -x --tb=short -q` → 857 passed, 9 skipped（180s）
- **前端构建**：`npm run build` → ✓ built in 5.98s
- **回归检查**：所有修复均未引入新测试失败；v3 DB 迁移修复后 `test_provider_fallback.py` 46 用例全通过
- **自检追加修复**：发现并修复 6 个同类单例竞态（含阶段4.4 新引入的 `get_mcp_rate_limiter`），二次全量测试 857 passed, 9 skipped
