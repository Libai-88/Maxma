"""Provider 抽象基类与类型定义。"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, asdict, field
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel


@dataclass
class ProviderConfig:
    """单个 LLM 提供商的配置，对应 providers.yaml 中的一项。"""

    id: str
    provider_type: str  # "openai" — 目前仅此一种
    label: str
    api_key: str
    base_url: str
    models: list[str] = field(default_factory=list)
    enabled: bool = True
    context_window: int = 256_000
    # 阶段 3.3：优先级（数字越小优先级越高，0 = 最高），用于 fallback 排序
    priority: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    def to_safe_dict(self) -> dict:
        """返回脱敏后的配置字典，API Key 仅保留首尾各 4 位。"""
        d = asdict(self)
        key = d.get("api_key", "")
        if len(key) > 8:
            d["api_key"] = key[:4] + "****" + key[-4:]
        elif key:
            d["api_key"] = "****"
        return d


@dataclass
class HealthStatus:
    """提供商健康检查结果。

    阶段 3.3 新增 `degraded` 状态：介于 ok 和 error 之间，
    表示健康检查超时或部分失败，可作为 fallback 触发条件但不完全禁用。
    """

    status: Literal["ok", "degraded", "error"]
    latency_ms: float | None = None
    detail: str | None = None


class Provider(ABC):
    """所有 LLM 提供商必须实现的接口。

    阶段 3.3 增强：维护运行时健康状态（不持久化），供 ProviderManager
    的 fallback 链路查询。
    """

    def __init__(self, config: ProviderConfig):
        self.config = config
        # 阶段 3.3：运行时健康状态（未持久化，重启后重置为 None）
        self.health_status: HealthStatus | None = None
        self.last_check_time: float = 0.0
        self.consecutive_failures: int = 0

    @property
    def provider_name(self) -> str:
        return self.config.id

    @property
    def default_model(self) -> str:
        return self.config.models[0] if self.config.models else ""

    @property
    def available_models(self) -> list[str]:
        return self.config.models

    @property
    def is_healthy(self) -> bool:
        """是否健康（health_status 为 ok 或 None=未检查视为可用）。"""
        if self.health_status is None:
            return True
        return self.health_status.status == "ok"

    @property
    def is_unhealthy(self) -> bool:
        """是否不健康（health_status 为 error，应触发 fallback）。"""
        return self.health_status is not None and self.health_status.status == "error"

    @abstractmethod
    def create_llm(self, model: str, **kwargs) -> BaseChatModel:
        """根据指定模型名创建 LangChain ChatModel 实例。"""
        ...

    @abstractmethod
    async def check_health(self) -> HealthStatus:
        """验证提供商 API 连接是否正常。"""
        ...
