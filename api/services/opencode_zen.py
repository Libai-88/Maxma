"""OpenCode Zen 免费模型集成服务。

OpenCode Zen（https://opencode.ai/zen/v1）是 OpenCode 官方提供的 OpenAI
兼容免费模型 API —— 无需信用卡、匿名可用（Bearer public），开箱即用。

本模块职责：
1. 将 `opencode-zen` 内置为 Maxma 默认供应商（匿名 key，开箱即用）；
2. 从官方 `GET /v1/models` 同步「免费模型」列表（id 以 `-free` 结尾的模型
   以及 `big-pickle` 等隐藏免费模型），并回写 providers.yaml；
3. 提供后台周期同步任务 + 手动同步端点，保证官方免费模型列表随时更新。

设计约束：
- 所有写操作在调用方持有 yaml_file_lock 的上下文中执行（锁不可重入，
  本模块内部绝不嵌套加锁）；
- 同步失败静默降级：保留现有 models，不破坏用户可用性；
- api_key 使用与 providers 路由一致的加密信封（encv1:）存储。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

# 与 providers 路由共享同一事实来源：providers 模块的 PROVIDERS_YAML_PATH
# 是模块级常量（测试通过 monkeypatch 重定向到临时文件），此处动态引用，
# 保证 ensure/sync 与 list/create 等端点操作同一个文件（含测试隔离）。
import api.routes.providers as _providers_mod

from api.routes.providers import (
    _encrypt_api_key,
    _find_provider,
    _load_providers,
    _save_providers,
)
from api.yaml_store import yaml_file_lock

logger = logging.getLogger(__name__)

# ── OpenCode Zen 官方端点 ────────────────────────────────────────────────
# 匿名共享 key `public`：无需注册即可调用，免费但受上游共享配额限流；
# 用户可在 UI 中替换为自己在 https://opencode.ai/auth 注册的 key（配额独立，更稳定）。
OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1"
OPENCODE_ZEN_ANON_API_KEY = "public"
OPENCODE_ZEN_PROVIDER_ID = "opencode-zen"
OPENCODE_ZEN_LABEL = "OpenCode Zen (免费)"

# 官方免费模型的判定规则：id 以 `-free` 结尾，或属于隐藏免费模型白名单。
_FREE_SUFFIX = "-free"
_FREE_HIDDEN_MODELS = frozenset({"big-pickle", "hy3-free"})

# 同步超时（秒）
_SYNC_TIMEOUT = 15.0
# 后台周期同步间隔（秒）：6 小时
_SYNC_INTERVAL_SECONDS = 6 * 3600
# 启动后首次同步延迟（秒）：让服务先就绪，避免启动竞态
_SYNC_FIRST_DELAY_SECONDS = 3.0

# 网络不可用时的兜底免费模型列表（OpenCode 官方 2026-08 在列模型）。
# 用于保证新用户首次启动（尚未成功同步）即可获得可用模型。
_FALLBACK_FREE_MODELS = [
    "deepseek-v4-flash-free",
    "mimo-v2.5-free",
    "nemotron-3-ultra-free",
    "north-mini-code-free",
    "laguna-s-2.1-free",
    "ling-3.0-flash-free",
    "big-pickle",
]

# 默认上下文窗口：免费模型多为 1M，但 ling-3.0-flash-free 仅 8K，
# 取 256K 作为全 provider 级安全值（避免超窗请求失败）。
_DEFAULT_CONTEXT_WINDOW = 262144


def is_free_model(model_id: str) -> bool:
    """判定模型 id 是否为 OpenCode Zen 官方免费模型。"""
    mid = str(model_id).strip()
    if not mid:
        return False
    return mid.endswith(_FREE_SUFFIX) or mid in _FREE_HIDDEN_MODELS


def _order_models(models: list[str]) -> list[str]:
    """稳定排序：deepseek-v4-flash-free 默认首位，其余按字母序（big-pickle 靠后）。"""
    prefer = ["deepseek-v4-flash-free", "mimo-v2.5-free"]
    head = [m for m in prefer if m in models]
    rest = sorted(m for m in models if m not in head)
    return head + rest


async def fetch_free_models() -> list[str]:
    """GET {base}/models 拉取模型列表，过滤出免费模型（去重保序）。

    网络异常 / HTTP 错误 / JSON 解析失败 → 返回空列表（由调用方降级）。
    """
    try:
        async with httpx.AsyncClient(
            timeout=_SYNC_TIMEOUT,
            follow_redirects=False,
        ) as client:
            resp = await client.get(
                f"{OPENCODE_ZEN_BASE_URL}/models",
                headers={"Authorization": f"Bearer {OPENCODE_ZEN_ANON_API_KEY}"},
            )
            if resp.status_code >= 300:
                logger.warning(
                    "[opencode-zen] models fetch HTTP %s (non-fatal)",
                    resp.status_code,
                )
                return []
            data = resp.json()
    except Exception:  # noqa: BLE001 — 网络错误统一降级，不影响可用性
        logger.warning("[opencode-zen] models fetch failed (non-fatal)", exc_info=True)
        return []

    models: list[str] = []
    if isinstance(data, dict):
        items = data.get("data")
        if isinstance(items, list):
            for m in items:
                if not isinstance(m, dict):
                    continue
                mid = m.get("id")
                if isinstance(mid, str) and is_free_model(mid) and mid not in models:
                    models.append(mid)
    return models


def build_provider_entry() -> dict[str, Any]:
    """构造 opencode-zen 默认供应商条目（幂等数据，不含加锁）。"""
    return {
        "id": OPENCODE_ZEN_PROVIDER_ID,
        "provider_type": "openai",
        "label": OPENCODE_ZEN_LABEL,
        # 匿名 key 也加密存储，与 providers 路由的凭据策略一致
        "api_key": _encrypt_api_key(OPENCODE_ZEN_ANON_API_KEY),
        "base_url": OPENCODE_ZEN_BASE_URL,
        "models": list(_FALLBACK_FREE_MODELS),
        "enabled": True,
        "context_window": _DEFAULT_CONTEXT_WINDOW,
        # 内置标记：后台同步只更新 models，不覆盖用户对 label/url/key 的修改
        "builtin": True,
    }


def ensure_opencode_zen_provider() -> dict[str, Any] | None:
    """幂等注入默认供应商（调用方负责持有锁）。

    - providers.yaml 已存在 opencode-zen → 原样返回（保留用户修改）；
    - 不存在 → 追加内置条目并落盘，返回新条目；
    - 落盘失败 → 返回 None（调用方自行处理，不抛异常阻断启动）。
    """
    with yaml_file_lock(_providers_mod.PROVIDERS_YAML_PATH):
        items = _load_providers()
        existing = _find_provider(items, OPENCODE_ZEN_PROVIDER_ID)
        if existing is not None:
            return existing
        provider = build_provider_entry()
        # 插入列表头：作为默认供应商（前端无历史选择时选中第一个 enabled provider）
        items.insert(0, provider)
        try:
            _save_providers(items)
        except Exception:  # noqa: BLE001 — 注入失败不阻断服务启动
            logger.exception("[opencode-zen] failed to persist default provider")
            return None
    logger.info("[opencode-zen] default provider injected (id=%s)", OPENCODE_ZEN_PROVIDER_ID)
    return provider


def _load_provider_models() -> list[str]:
    """读取当前 opencode-zen 的 models（无锁读取，调用方不须持锁）。"""
    items = _load_providers()
    target = _find_provider(items, OPENCODE_ZEN_PROVIDER_ID)
    models = target.get("models") if isinstance(target, dict) else None
    return list(models) if isinstance(models, list) else []


async def sync_opencode_zen_models() -> dict[str, Any]:
    """从官方同步免费模型列表到 providers.yaml。

    返回 {"synced": bool, "models": [...], "provider_id": str}：
    - 拉取失败 → synced=False，models 为当前保留列表；
    - 成功 → 官方免费模型替换现有列表（去重保序），synced=True。
    """
    remote = await fetch_free_models()
    if not remote:
        logger.info("[opencode-zen] sync skipped: no remote free models")
        return {"synced": False, "models": _load_provider_models(), "provider_id": OPENCODE_ZEN_PROVIDER_ID}

    # 排序：deepseek-v4-flash-free 保持默认首位，big-pickle 等隐藏免费模型靠后
    ordered = _order_models(remote)

    with yaml_file_lock(_providers_mod.PROVIDERS_YAML_PATH):
        items = _load_providers()
        target = _find_provider(items, OPENCODE_ZEN_PROVIDER_ID)
        if target is None:
            # 理论上 ensure 已注入；双保险：锁内直接补建
            target = build_provider_entry()
            items.append(target)
        target["models"] = ordered
        try:
            _save_providers(items)
        except Exception:  # noqa: BLE001 — 落盘失败保留内存态，不阻断
            logger.exception("[opencode-zen] sync persist failed")
            return {"synced": False, "models": list(ordered), "provider_id": OPENCODE_ZEN_PROVIDER_ID}
    logger.info("[opencode-zen] models synced: %d free models", len(ordered))
    return {"synced": True, "models": list(ordered), "provider_id": OPENCODE_ZEN_PROVIDER_ID}


# ── 后台周期同步任务 ──────────────────────────────────────────────────────


async def start_background_sync() -> asyncio.Task[None]:
    """启动后台周期同步任务（首次延迟 + 每 6 小时一次）。

    返回 task 句柄，供 lifespan shutdown 时取消。
    """
    task = asyncio.create_task(_background_sync_loop(), name="opencode-zen-sync")
    return task


async def _background_sync_loop() -> None:
    try:
        await asyncio.sleep(_SYNC_FIRST_DELAY_SECONDS)
        # 先确保默认供应商存在（即使 lifespan 中同步注入失败也兜底）
        ensure_opencode_zen_provider()
        while True:
            try:
                await sync_opencode_zen_models()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — 周期任务内兜底，避免任务静默死亡
                logger.exception("[opencode-zen] background sync iteration failed")
            await asyncio.sleep(_SYNC_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        logger.info("[opencode-zen] background sync stopped")
        raise
