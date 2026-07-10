"""Provider 管理器 — 按 id 索引 + 阶段 3.3 fallback 链路。

阶段 3.3 增强：
- iter_enabled() 按 priority 排序（数字越小优先级越高）
- get_healthy() 跳过 health_status == error 的 provider
- get_fallback(exclude_ids) 返回下一个可用 provider
- mark_unhealthy/mark_healthy 状态标记
"""

import logging
import threading
import time
from collections.abc import Iterator
from typing import Any, Optional

from api.providers import HealthStatus, Provider, ProviderConfig
from api.providers.store import ProviderConfigStore

logger = logging.getLogger(__name__)


def is_retryable_provider_error(error: BaseException) -> bool:
    """Return whether a failed model request can safely be retried elsewhere.

    Provider fallback is deliberately limited to transport failures and transient
    upstream responses.  Local validation/programming errors must remain visible
    to the caller instead of being hidden behind an unrelated provider.
    """
    if isinstance(error, (TimeoutError, ConnectionError, OSError)):
        return True

    status_code = getattr(error, "status_code", None)
    if status_code is None:
        response = getattr(error, "response", None)
        status_code = getattr(response, "status_code", None)
    if isinstance(status_code, int):
        return status_code in {408, 409, 425, 429} or status_code >= 500

    # Keep this dependency-free: OpenAI and httpx expose different exception
    # types across supported versions, but their transient transport errors use
    # stable class names.
    error_name = type(error).__name__
    if error_name in {
        "APIConnectionError",
        "APITimeoutError",
        "RateLimitError",
        "ServiceUnavailableError",
        "InternalServerError",
        "ConnectError",
        "ReadTimeout",
        "WriteTimeout",
        "PoolTimeout",
    }:
        return True

    cause = error.__cause__ or error.__context__
    return bool(cause and cause is not error and is_retryable_provider_error(cause))


class ProviderManager:
    """管理所有已注册的 Provider，支持按 id 查找、批量遍历和 fallback。

    阶段 3.3：新增健康状态管理和 fallback 链路。健康状态使用 threading.Lock
    保护（与 ErrorRecoveryManager 一致），与 Provider 自身的 health_status
    字段读写同步。
    """

    def __init__(self, store: ProviderConfigStore):
        self._store = store
        self._providers: dict[str, Provider] = {}
        self._lock = threading.Lock()  # 保护健康状态读写

    # ── 生命周期 ────────────────────────────────────────

    def load_all(self) -> None:
        """从 store 加载所有 enabled provider 并创建实例。

        线程安全：在锁内重建 _providers，避免与 get_healthy/get_fallback 竞争。
        """
        new_providers: dict[str, Provider] = {}
        for config in self._store.load_all():
            if config.enabled:
                provider = self._build_provider(config)
                new_providers[config.id] = provider
        with self._lock:
            self._providers.clear()
            self._providers.update(new_providers)

    def reload(self) -> None:
        """重新加载 YAML 配置。"""
        self.load_all()

    # ── 查询 ────────────────────────────────────────────

    def get(self, provider_id: str) -> Provider:
        """按 id 获取 provider，不存在则抛 KeyError。"""
        provider = self._providers.get(provider_id)
        if provider is None:
            msg = f"Provider '{provider_id}' not found or not enabled"
            raise KeyError(msg)
        return provider

    def iter_enabled(self) -> Iterator[Provider]:
        """遍历所有 enabled provider，按 priority 升序排序。

        阶段 3.3：priority 数字越小优先级越高，相同 priority 保持插入顺序。
        线程安全：在锁内快照列表，避免迭代时 load_all() 修改字典。
        """
        with self._lock:
            providers = list(self._providers.values())
        # 稳定排序：相同 priority 保持插入顺序
        providers.sort(key=lambda p: p.config.priority)
        return iter(providers)

    def iter_all(self) -> Iterator[Provider]:
        """遍历所有 provider（不排序，原始顺序）。"""
        return iter(self._providers.values())

    def has(self, provider_id: str) -> bool:
        return provider_id in self._providers

    @property
    def count(self) -> int:
        return len(self._providers)

    # ── 阶段 3.3：健康状态 + fallback 链路 ──────────────────

    def get_healthy(self) -> Optional[Provider]:
        """返回优先级最高的健康 provider（跳过 health_status == error）。

        health_status 为 None（未检查）或 ok 的 provider 视为可用。
        全部 unhealthy 时返回 None。
        线程安全：在锁内读取 health_status，避免与 mark_unhealthy/mark_healthy 竞争。
        """
        with self._lock:
            providers = sorted(self._providers.values(), key=lambda p: p.config.priority)
            for provider in providers:
                if not provider.is_unhealthy:
                    return provider
        return None

    def get_fallback(self, exclude_ids: Optional[set[str]] = None) -> Optional[Provider]:
        """返回下一个可用的 fallback provider。

        按 priority 升序遍历，跳过：
        - exclude_ids 中的 provider（已失败的）
        - health_status == error 的 provider

        Returns:
            下一个可用的 Provider；全部不可用时返回 None
        线程安全：在锁内读取 health_status，避免与 mark_unhealthy/mark_healthy 竞争。
        """
        exclude = exclude_ids or set()
        with self._lock:
            providers = sorted(self._providers.values(), key=lambda p: p.config.priority)
            for provider in providers:
                if provider.config.id in exclude:
                    continue
                if provider.is_unhealthy:
                    continue
                return provider
        return None

    def find_provider_for_llm(self, llm: Any) -> Optional[Provider]:
        """Best-effort mapping from a configured ChatModel to its provider.

        A provider is identified by the model name and, when exposed by the
        LangChain client, its base URL.  A model-only match is accepted only when
        it is unique, so an ambiguous model name can never mark the wrong
        provider unhealthy.
        """
        model_name = self._llm_attribute_text(llm, "model_name", "model")
        base_url = self._llm_attribute_text(
            llm, "openai_api_base", "base_url", "api_base"
        )
        if not model_name:
            return None

        normalized_base_url = self._normalize_base_url(base_url)
        with self._lock:
            candidates = [
                provider
                for provider in self._providers.values()
                if model_name in provider.available_models
            ]
            if normalized_base_url:
                for provider in candidates:
                    if self._normalize_base_url(provider.config.base_url) == normalized_base_url:
                        return provider
            if len(candidates) == 1:
                return candidates[0]
        return None

    @staticmethod
    def _llm_attribute_text(llm: Any, *names: str) -> str:
        for name in names:
            value = getattr(llm, name, None)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    @staticmethod
    def _normalize_base_url(value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip().rstrip("/").lower()

    def mark_unhealthy(self, provider_id: str, detail: str = "") -> None:
        """标记 provider 为不健康状态（health_status=error）。

        递增 consecutive_failures 计数，供 fallback 决策使用。
        """
        with self._lock:
            provider = self._providers.get(provider_id)
            if provider is None:
                return
            provider.health_status = HealthStatus(
                status="error",
                detail=detail or "marked unhealthy by caller",
            )
            provider.last_check_time = time.time()
            provider.consecutive_failures += 1
            logger.warning(
                "[provider] %s 标记为 unhealthy（连续失败 %d 次）: %s",
                provider_id,
                provider.consecutive_failures,
                detail[:100],
            )

    def mark_healthy(self, provider_id: str, latency_ms: float | None = None) -> None:
        """标记 provider 为健康状态（health_status=ok），重置失败计数。"""
        with self._lock:
            provider = self._providers.get(provider_id)
            if provider is None:
                return
            provider.health_status = HealthStatus(
                status="ok",
                latency_ms=latency_ms,
            )
            provider.last_check_time = time.time()
            provider.consecutive_failures = 0
            logger.info("[provider] %s 标记为 healthy", provider_id)

    def mark_degraded(self, provider_id: str, detail: str = "") -> None:
        """标记 provider 为降级状态（health_status=degraded）。

        degraded 不完全禁用，但优先级降低（仍可被 get_healthy 选中，
        但 get_fallback 会优先选择 healthy 的）。
        """
        with self._lock:
            provider = self._providers.get(provider_id)
            if provider is None:
                return
            provider.health_status = HealthStatus(
                status="degraded",
                detail=detail,
            )
            provider.last_check_time = time.time()
            logger.info("[provider] %s 标记为 degraded: %s", provider_id, detail[:100])

    def get_health_status(self, provider_id: str) -> Optional[HealthStatus]:
        """获取 provider 的健康状态（None 表示未检查）。"""
        with self._lock:
            provider = self._providers.get(provider_id)
            return provider.health_status if provider else None

    def get_failure_snapshot(self, provider_id: str) -> tuple[int, Optional[HealthStatus]]:
        """原子读取 (consecutive_failures, health_status)。

        修复 Bug 1.5：health_monitor 原先在锁外分两次读取这两个字段，可能读到
        mark_unhealthy/mark_healthy 调用过程中的中间状态（如 failures 已递增但
        health_status 尚未更新）。现在在同一个锁内返回一致的快照。

        Returns:
            (consecutive_failures, health_status)；provider 不存在时返回 (0, None)。
        """
        with self._lock:
            provider = self._providers.get(provider_id)
            if provider is None:
                return 0, None
            return provider.consecutive_failures, provider.health_status

    def get_all_health_status(self) -> dict[str, dict]:
        """获取所有 provider 的健康状态摘要（用于监控/前端展示）。"""
        with self._lock:
            result = {}
            for pid, provider in self._providers.items():
                hs = provider.health_status
                result[pid] = {
                    "status": hs.status if hs else "unknown",
                    "latency_ms": hs.latency_ms if hs else None,
                    "detail": hs.detail if hs else None,
                    "last_check_time": provider.last_check_time,
                    "consecutive_failures": provider.consecutive_failures,
                    "priority": provider.config.priority,
                }
            return result

    # ── 配置 CRUD（委托 store 并同步缓存）────────────────

    def list_configs(self) -> list[ProviderConfig]:
        """返回所有配置（不论 enabled 与否）。"""
        return self._store.load_all()

    def get_config(self, provider_id: str) -> ProviderConfig | None:
        """按 id 查找配置。"""
        return self._store.get(provider_id)

    def save_config(self, config: ProviderConfig) -> None:
        """保存配置并在加载缓冲。"""
        self._store.save(config)
        self.load_all()

    def delete_config(self, provider_id: str) -> bool:
        """删除配置并在加载缓冲。"""
        result = self._store.delete(provider_id)
        if result:
            self.load_all()
        return result

    # ── Provider 工厂 ──────────────────────────────────

    @staticmethod
    def _build_provider(config: ProviderConfig) -> Provider:
        if config.provider_type == "openai":
            from api.providers.openai_provider import OpenAIProvider

            return OpenAIProvider(config)
        msg = f"Unknown provider type: {config.provider_type}"
        raise ValueError(msg)
