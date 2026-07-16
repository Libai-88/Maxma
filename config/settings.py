"""Pydantic BaseSettings，从 .env 文件加载配置。

LLM 提供商配置（API key、base_url、model、context_window）
已移至 providers.yaml，通过 Web UI /providers 管理。
此文件仅保留工具类凭据和第三方服务 API key。
"""

import threading

from app_paths import ENV_FILE_PATH
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """全局配置，所有 API Key 从环境变量/.env 加载。"""

    # ZhiPu AI (GLM-5V-Turbo 图片理解工具)
    zhipuai_api_key: str = ""

    # Todoist
    todoist_api_token: str = ""

    # UAPI（天气/娱乐）
    uapis_api_key: str = ""

    # 高德地图
    amap_api_key: str = ""

    # Tavily（网络搜索/提取）
    tavily_api_key: str = ""

    # 服务端口（开发/本地运行）
    maxma_api_port: int = 8000
    maxma_web_port: int = 5173

    # RAG 子系统配置
    embedding_model_name: str = "paraphrase-multilingual-MiniLM-L12-v2"
    embedding_model_local_path: str = ""  # 留空则从 HuggingFace 下载；打包模式下由 app_paths.ONNX_MODEL_PATH 注入
    chromadb_collection_name: str = "long_term_memory"
    rag_top_k: int = 5
    rag_similarity_threshold: float = 0.6

    # TTL 遗忘机制配置
    ttl_purge_interval_seconds: int = 300  # 后台清理任务执行间隔（秒），默认 5 分钟
    default_episodic_ttl: int = 604800  # 情景记忆默认 TTL（秒），7 天

    # 阶段 2：Plan-and-execute executor 配置
    plan_confirm_timeout: int = 120  # HITL 计划确认超时（秒）

    # 阶段 3.4：Python 沙箱 OS 级隔离配置
    sandbox_memory_mb: int = 512  # 沙箱最大内存（MB），MAX_MEMORY_MB 由此值驱动
    sandbox_network_isolation: bool = True  # 是否启用网络隔离（firejail --net=none）
    sandbox_isolation_level: str = "auto"  # 隔离级别：auto/firejail/jobobject/setrlimit/subprocess

    # 阶段 3.1：工具熔断配置
    circuit_breaker_failure_threshold: int = 5  # 连续失败多少次后熔断
    circuit_breaker_recovery_timeout: int = 60  # 熔断后冷却时间（秒），过后进入 half-open
    circuit_breaker_half_open_max_calls: int = 1  # half-open 状态下允许的探测调用数

    # LLM 调用超时（秒）。到达超时后放弃当前调用，防止 provider 卡死导致前端无限"思考中"。
    llm_invoke_timeout: int = 120
    # 单轮对话整体超时（秒），覆盖所有工具调用+LLM 调用的总时长。
    turn_timeout: int = 600

    # 阶段 3.6：LLM 审批网关 —— 工具执行前的统一审批决策层
    approval_required_tools: list[str] = [
        "run_python",
        "file_edit",
        "file_write",
        "git_push",
        "git_commit",
        "shell_exec",
    ]  # 需要审批的工具列表（工具名匹配）
    approval_timeout: int = 300  # 审批超时时间（秒）
    approval_gateway_enabled: bool = True  # 是否启用审批网关（False 时所有工具直接执行）

    # 阶段 3.2：API 限流配置
    rate_limit_http_capacity: int = 10  # HTTP 限流桶容量（按 IP）
    rate_limit_http_window_seconds: int = 60  # HTTP 限流时间窗口（秒）
    rate_limit_ws_capacity: int = 6  # WebSocket 限流桶容量（按 session）
    rate_limit_ws_window_seconds: int = 60  # WebSocket 限流时间窗口（秒）

    # Provider/LTM 的面向用户诊断提示；关闭时保留既有健康状态 UI。
    provider_diagnostics_enabled: bool = False

    # 阶段 4.3：MCP transport URL 白名单 + TLS 校验
    mcp_allowed_url_hosts: list[str] = ["localhost", "127.0.0.1"]  # 允许的 URL host 白名单
    mcp_force_tls: bool = False  # 生产模式强制 HTTPS/WSS（MAXMA_ENV=production 时建议设 True）
    mcp_allowed_url_ports: list[int] | None = None  # 允许的端口白名单，None=不限制

    # 阶段 4.4：MCP 调用速率限制
    mcp_rate_limit_per_minute: int = 60  # 每服务器每分钟最大调用数
    mcp_rate_limit_burst: int = 10  # 突发上限（令牌桶容量）
    mcp_rate_limit_enabled: bool = True  # 是否启用 MCP 限流

    # 阶段 1：MCP OAuth 刷新与受限重连生命周期；默认保留既有一次性初始化路径
    mcp_connection_lifecycle_enabled: bool = False

    # 阶段 5.1：进程级持久化 checkpointer
    # 启用后使用 SqliteSaver 持久化会话状态到磁盘，进程重启可恢复
    persistence_enabled: bool = True  # 是否启用 SQLite 持久化（False 时回退到 MemorySaver）
    persistence_db_path: str = ""  # SQLite 数据库路径，留空时使用 DATA_DIR/checkpoints.sqlite

    # 阶段 5.2：死循环检测
    # 连续 N 次调用相同工具且参数相同时自动终止，防止 LLM 陷入死循环
    loop_detection_enabled: bool = True  # 是否启用死循环检测
    loop_detection_threshold: int = 3  # 连续重复次数阈值，达到后终止

    # ── 编排层特性开关（默认关闭，安全滚动）──
    # Owner, evidence and rollback signals: dev_docs/capability-matrix.md.
    # A false value preserves the pre-flag path; use reload_settings() after config edits.
    # Coordinator：意图路由协调者节点（coordinator → planner → agent）
    coordinator_enabled: bool = False
    # Verifier：答案充分性验证节点（agent → verifier → END/agent 重试）
    verifier_enabled: bool = False
    # Verifier 最大重试次数（达到上限后放行，即使仍 insufficient）
    verifier_max_retries: int = 2
    # DelegationScope：SubAgent 委托范围单调收窄强制
    delegation_scope_enforced: bool = False
    # Async SubAgent：异步委托与结果回收；默认保持同步委托路径
    async_subagent_enabled: bool = False
    # 子 Agent 结果仅在用户展开卡片后读取；依赖 async_subagent_enabled。
    subagent_stream_on_demand_enabled: bool = False
    # Four-mode permission policy remains opt-in until session/UI wiring is enabled.
    permission_modes_enabled: bool = False
    # AUTO mode never gains local-write capability without an explicit tool name.
    permission_auto_allowed_tools: list[str] = Field(default_factory=list)
    # Structured workbench cards stay opt-in until approval and audit wiring is enabled.
    interactive_artifacts_enabled: bool = False
    # Registered, read-only workflow journal. This remains disabled until the
    # async dispatcher and four-mode permission policy are both enabled.
    workflow_enabled: bool = False

    # 阶段 6.1：可见、用户确认的思考深度选择与声明式模型角色路由。
    # 两者均默认关闭；路由不会覆盖用户在聊天输入框显式选择的模型。
    think_path_enabled: bool = False
    declarative_model_routing_enabled: bool = False

    # ── 检索层特性开关（默认关闭，安全滚动）──
    # CRAG-lite：检索分级 + Tavily 自动回退
    crag_enabled: bool = False
    # RAG grading 阈值：相关文档比例低于此值时触发 Tavily 回退
    rag_grade_threshold: float = 0.3

    # ── 自治层特性开关（默认关闭，安全滚动）──
    # autonomy_* remains off until the phase-6 permission/audit gate.
    # 自治调度器：周期性后台自诊断 + 自改进
    autonomy_enabled: bool = False
    # 自治调度器执行间隔（秒），默认 1 小时
    autonomy_interval_seconds: int = 3600
    # 自改进：允许自治 Agent 创建/更新 Skills
    autonomy_self_improve_enabled: bool = False
    # 自治 Agent 单次执行最大超时（秒）
    autonomy_max_agent_timeout: int = 300

    # 流式响应修复管道（默认关闭，接入国产 model 时建议开启）
    # Trial before coordinator/verifier; enable only one high-risk flag at a time.
    stream_repair_enabled: bool = False

    # ── 已交付能力的渐进启用开关（默认关闭）──
    # LTM 的永久错误分类和抖动退避。开启后 401/403 等永久错误不再重试。
    ltm_retry_policy_enabled: bool = True
    # 在上下文摘要中记录 cache-safe 边界元数据；关闭时保持旧摘要格式。
    cache_preserving_compaction_enabled: bool = False
    # 只有显式开启时，MemoryTicker 才会执行编译器。
    memory_ticker_enabled: bool = False
    # FactStore 的 FTS5/CJK 精确事实检索作为现有语义检索的补充，默认不创建
    # 额外的 SQLite 运行时或改变跨层检索结果。
    fact_store_retrieval_enabled: bool = False
    # 前端还需要 VITE_COMPACT_TOOL_RESULTS_ENABLED=true 才会折叠展示。
    compact_tool_results_enabled: bool = False

    # Bun 可执行文件路径（Windows 需全路径）
    sidecar_bun_path: str = "D:/NodeGlobal/node_modules/bun/bin/bun.exe"

    model_config = {
        "env_file": str(ENV_FILE_PATH),
        "env_file_encoding": "utf-8",
        "extra": "forbid",
    }


_settings: Settings | None = None
_settings_lock = threading.Lock()  # 保护单例初始化


def get_settings() -> Settings:
    """获取全局 Settings 单例。

    线程安全：通过 _settings_lock 双重检查，保证仅创建一个实例。
    """
    global _settings
    if _settings is not None:
        return _settings
    with _settings_lock:
        if _settings is None:
            _settings = Settings()
        return _settings


def reload_settings() -> Settings:
    """重建 Settings 单例，用于 .env 更新后的运行时刷新。

    线程安全：在 _settings_lock 内重建，避免与 get_settings 竞争。
    """
    global _settings
    with _settings_lock:
        _settings = Settings()
        return _settings
