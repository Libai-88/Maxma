"""Pydantic BaseSettings，从 .env 文件加载配置。

LLM 提供商配置（API key、base_url、model、context_window）
已移至 providers.yaml，通过 Web UI /providers 管理。
此文件仅保留工具类凭据和第三方服务 API key。
"""

import threading

from app_paths import ENV_FILE_PATH
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
    embedding_model_local_path: str = ""  # 打包时预置模型路径，留空则从 HuggingFace 下载
    chromadb_collection_name: str = "long_term_memory"
    rag_top_k: int = 5
    rag_similarity_threshold: float = 0.6

    # TTL 遗忘机制配置
    ttl_purge_interval_seconds: int = 300  # 后台清理任务执行间隔（秒），默认 5 分钟
    default_episodic_ttl: int = 604800  # 情景记忆默认 TTL（秒），7 天

    # 阶段 2：Plan-and-execute executor 配置
    plan_confirm_timeout: int = 120  # HITL 计划确认超时（秒）
    replan_threshold: int = 2  # 触发重规划的最小失败次数
    executor_max_replans: int = 2  # 最大重规划次数（防止无限循环）
    executor_enable_by_default: bool = True  # build_agent 默认是否启用 executor 节点

    # 阶段 3.4：Python 沙箱 OS 级隔离配置
    sandbox_memory_mb: int = 512  # 沙箱最大内存（MB），MAX_MEMORY_MB 由此值驱动
    sandbox_network_isolation: bool = True  # 是否启用网络隔离（firejail --net=none）
    sandbox_isolation_level: str = "auto"  # 隔离级别：auto/firejail/jobobject/setrlimit/subprocess

    # 阶段 3.1：工具熔断配置
    circuit_breaker_failure_threshold: int = 5  # 连续失败多少次后熔断
    circuit_breaker_recovery_timeout: int = 60  # 熔断后冷却时间（秒），过后进入 half-open
    circuit_breaker_half_open_max_calls: int = 1  # half-open 状态下允许的探测调用数

    # 阶段 3.2：API 限流配置
    rate_limit_http_capacity: int = 10  # HTTP 限流桶容量（按 IP）
    rate_limit_http_window_seconds: int = 60  # HTTP 限流时间窗口（秒）
    rate_limit_ws_capacity: int = 6  # WebSocket 限流桶容量（按 session）
    rate_limit_ws_window_seconds: int = 60  # WebSocket 限流时间窗口（秒）

    # 阶段 3.3：Provider 健康监控配置
    provider_health_check_interval_seconds: int = 60  # 健康 provider 的检查间隔（秒）
    provider_recovery_check_interval_seconds: int = 300  # unhealthy provider 的恢复探测间隔（秒）
    provider_unhealthy_threshold: int = 3  # 连续失败次数达此值才标记 error（避免单次抖动）

    # 阶段 4.3：MCP transport URL 白名单 + TLS 校验
    mcp_allowed_url_hosts: list[str] = ["localhost", "127.0.0.1"]  # 允许的 URL host 白名单
    mcp_force_tls: bool = False  # 生产模式强制 HTTPS/WSS（MAXMA_ENV=production 时建议设 True）
    mcp_allowed_url_ports: list[int] | None = None  # 允许的端口白名单，None=不限制

    # 阶段 4.4：MCP 调用速率限制
    mcp_rate_limit_per_minute: int = 60  # 每服务器每分钟最大调用数
    mcp_rate_limit_burst: int = 10  # 突发上限（令牌桶容量）
    mcp_rate_limit_enabled: bool = True  # 是否启用 MCP 限流

    model_config = {
        "env_file": str(ENV_FILE_PATH),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
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
