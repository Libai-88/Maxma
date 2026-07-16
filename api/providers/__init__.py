"""
Provider 抽象基类与类型定义 — STUB（已弃用）。

Provider 管理已迁移至 OMP ModelRegistry（oh-my-pi Bun sidecar）。
此模块仅保留类型定义以兼容遗留测试导入。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, asdict, field
from typing import Literal


@dataclass
class ProviderConfig:
    """单个 LLM 提供商的配置。已弃用 — OMP ModelRegistry 管理。"""
    id: str
    provider_type: str = "openai"
    label: str = ""
    api_key: str = ""
    base_url: str = ""
    models: list[str] = field(default_factory=list)
    enabled: bool = True
    context_window: int = 256_000
    priority: int = 0
    capabilities: list[str] = field(default_factory=list)
    cost_tier: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    def to_safe_dict(self) -> dict:
        d = asdict(self)
        key = d.get("api_key", "")
        if len(key) > 8:
            d["api_key"] = key[:4] + "****" + key[-4:]
        elif key:
            d["api_key"] = "****"
        return d


@dataclass
class HealthStatus:
    """提供商健康检查结果。已弃用。"""
    status: Literal["ok", "degraded", "error"]
    latency_ms: float | None = None
    detail: str | None = None


class Provider(ABC):
    """所有 LLM 提供商必须实现的接口。已弃用。"""

    def __init__(self, config: ProviderConfig):
        self.config = config
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
        if self.health_status is None:
            return True
        return self.health_status.status == "ok"

    @property
    def is_unhealthy(self) -> bool:
        return self.health_status is not None and self.health_status.status == "error"

    @abstractmethod
    def create_llm(self, model: str, **kwargs):
        """已弃用。OMP ModelRegistry 管理 LLM 创建。"""
        ...

    @abstractmethod
    async def check_health(self) -> HealthStatus:
        """已弃用。"""
        ...
