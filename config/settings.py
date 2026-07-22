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

    # 服务端口（开发/本地运行）
    maxma_api_port: int = 8000
    maxma_web_port: int = 5173

    # LLM 调用超时（秒）。到达超时后放弃当前调用，防止 provider 卡死导致前端无限"思考中"。
    llm_invoke_timeout: int = 120
    # 单轮对话整体超时（秒），覆盖所有工具调用+LLM 调用的总时长。
    turn_timeout: int = 600

    # Bun 可执行文件路径（默认 "bun" 依赖 PATH 解析；Windows 需确保 bun.exe 在 PATH 中，
    # 或通过 .env 文件设置 MAXMA_BUN_PATH 环境变量指定全路径）
    sidecar_bun_path: str = "bun"

    # 权限模式功能开关。关闭时（默认）所有会话强制 ask 语义并由 sidecar 自动批准工具调用，
    # 保留旧行为；开启后 sidecar 按 permission_mode 分流（auto/operate 自动批准，
    # ask/read_only 走前端审批确认）。
    permission_modes_enabled: bool = False

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
