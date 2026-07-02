"""Provider 配置的 YAML 文件存储。"""

import logging
from pathlib import Path

from app_paths import PROJECT_ROOT
from api.providers import ProviderConfig
from api.yaml_store import dump_yaml_atomic, load_yaml, yaml_file_lock
from tools.crypto import decrypt_value, encrypt_value, is_encrypted


logger = logging.getLogger(__name__)


class ProviderConfigStore:
    """读写 providers.yaml，对 api_key 做落盘加密。"""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load_all(self) -> list[ProviderConfig]:
        """返回所有配置（不论 enabled 与否）。"""
        with yaml_file_lock(self.path):
            return self._load_all_unlocked()

    def get(self, provider_id: str) -> ProviderConfig | None:
        """按 id 查找配置。"""
        for c in self.load_all():
            if c.id == provider_id:
                return c
        return None

    def save(self, config: ProviderConfig) -> None:
        """新增或更新配置（按 id 匹配）。"""
        with yaml_file_lock(self.path):
            all_configs = self._load_all_unlocked()
            for i, c in enumerate(all_configs):
                if c.id == config.id:
                    all_configs[i] = config
                    break
            else:
                all_configs.append(config)
            self._write_all_unlocked(all_configs)

    def delete(self, provider_id: str) -> bool:
        """删除配置。返回是否实际删除了项目。"""
        with yaml_file_lock(self.path):
            all_configs = self._load_all_unlocked()
            filtered = [c for c in all_configs if c.id != provider_id]
            if len(filtered) == len(all_configs):
                return False
            self._write_all_unlocked(filtered)
            return True

    def _load_all_unlocked(self) -> list[ProviderConfig]:
        if not self.path.exists():
            return []
        raw = load_yaml(self.path, default={}) or {}
        providers = raw.get("providers", []) if isinstance(raw, dict) else []
        return [self._deserialize_config(item) for item in providers]

    def _write_all_unlocked(self, configs: list[ProviderConfig]) -> None:
        data = {"providers": [self._serialize_config(c) for c in configs]}
        dump_yaml_atomic(self.path, data)

    @property
    def is_empty(self) -> bool:
        return not self.path.exists() or not self.load_all()

    def migrate_from_legacy_root_yaml(self) -> bool:
        """将旧版根目录 providers.yaml 迁移到当前数据目录。"""
        legacy_path = PROJECT_ROOT / "providers.yaml"
        if self.path.exists() or not legacy_path.exists():
            return False

        with yaml_file_lock(legacy_path):
            raw = load_yaml(legacy_path, default={}) or {}
        providers = raw.get("providers", []) if isinstance(raw, dict) else []
        if not providers:
            return False

        configs = [ProviderConfig(**item) for item in providers]
        with yaml_file_lock(self.path):
            self._write_all_unlocked(configs)
        return True

    def has_legacy_root_conflict(self) -> bool:
        """根目录旧 providers.yaml 与当前生效配置不一致时返回 True。"""
        legacy_path = PROJECT_ROOT / "providers.yaml"
        if not legacy_path.exists() or not self.path.exists():
            return False
        with yaml_file_lock(legacy_path):
            legacy_raw = load_yaml(legacy_path, default={}) or {}
        with yaml_file_lock(self.path):
            current_raw = load_yaml(self.path, default={}) or {}
        return self._normalize_raw_data(legacy_raw) != self._normalize_raw_data(current_raw)

    def migrate_from_env(self) -> ProviderConfig | None:
        """首次启动时从 .env 读取 DeepSeek 配置写入 YAML（向后兼容）。"""
        import os

        api_key = os.getenv("DEEPSEEK_API_KEY", "")
        if not api_key:
            return None

        base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
        model_name = os.getenv("MODEL_NAME", "deepseek-v4-flash")
        context_window_str = os.getenv("MODEL_CONTEXT_WINDOW", "256000")

        config = ProviderConfig(
            id="deepseek-main",
            provider_type="openai",
            label="DeepSeek",
            api_key=api_key,
            base_url=base_url,
            models=[model_name],
            enabled=True,
            context_window=int(context_window_str),
        )
        self.save(config)
        return config

    def _serialize_config(self, config: ProviderConfig) -> dict:
        data = config.to_dict()
        api_key = data.get("api_key", "")
        if api_key:
            data["api_key"] = encrypt_value(api_key)
        return data

    def _deserialize_config(self, item: dict) -> ProviderConfig:
        data = dict(item)
        api_key = data.get("api_key", "")
        if api_key:
            decrypted = decrypt_value(api_key)
            if is_encrypted(api_key) and not decrypted:
                logger.warning("Failed to decrypt provider api_key for provider_id=%s", data.get("id", ""))
            else:
                data["api_key"] = decrypted
        return ProviderConfig(**data)

    def _normalize_raw_data(self, raw: dict) -> dict:
        providers = raw.get("providers", []) if isinstance(raw, dict) else []
        normalized = []
        for item in providers:
            data = dict(item)
            api_key = data.get("api_key", "")
            if is_encrypted(api_key):
                decrypted = decrypt_value(api_key)
                data["api_key"] = decrypted or api_key
            normalized.append(data)
        return {"providers": normalized}
