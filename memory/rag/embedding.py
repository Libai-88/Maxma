"""ONNX Runtime 嵌入引擎（不依赖 torch / sentence-transformers）。

架构：
- 用 ``transformers.AutoTokenizer`` 做 tokenization
- 用 ``onnxruntime.InferenceSession`` 做 ONNX 推理
- 手动实现 mean pooling + L2 normalize（不依赖 torch tensor）

懒加载策略：
- 首次调用 ``get_embedding_engine()`` 时创建引擎对象（不加载模型）
- 首次调用 ``embed()`` 时从 HuggingFace 下载/加载模型
- 若 onnxruntime / transformers 未安装，返回 None，调用方回退到 bigram Jaccard

模型选择：
- 默认 ``paraphrase-multilingual-MiniLM-L12-v2``（多语言，CPU 友好，384 维）
- HuggingFace 官方仓库已预置 ``onnx/model.onnx``，无需在线导出
- 打包模式可通过 ``embedding_model_local_path`` 指定预置模型路径，避免在线下载

体积优化：
- 不依赖 torch（省 ~468 MB）、sentence-transformers（省 ~3.6 MB）
- 不依赖 scipy / scikit-learn（sentence-transformers 的传递依赖，省 ~120 MB）
- 仅依赖 onnxruntime + transformers + huggingface-hub + numpy（均为 chromadb 已有依赖）
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import TYPE_CHECKING

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    pass

# 全局单例
_engine: "EmbeddingEngine | None" = None
# 是否已尝试初始化（避免重复尝试）
_tried_init: bool = False
_init_lock = threading.Lock()  # 保护单例初始化（修复 Bug 1.2 竞态）


class EmbeddingEngine:
    """ONNX Runtime 嵌入引擎。

    模型在首次 ``embed()`` 调用时懒加载。
    """

    def __init__(self, model_name: str, local_path: str | None = None):
        self._model_name = model_name
        self._local_path = local_path
        self._session = None  # onnxruntime.InferenceSession，懒加载
        self._tokenizer = None
        self._np = None
        self._input_names: list[str] | None = None

    def _ensure_model(self) -> None:
        """首次调用时加载模型。"""
        if self._session is not None:
            return
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        self._np = np

        # 阶段 5.3：优先级：显式配置 > 打包预置 > 在线下载
        if self._local_path and Path(self._local_path).exists():
            model_dir = Path(self._local_path)
        else:
            # 打包模式：尝试使用 RUNTIME_DIR 下的预置模型
            from app_paths import ONNX_MODEL_PATH, _is_frozen
            if _is_frozen() and ONNX_MODEL_PATH.exists():
                model_dir = ONNX_MODEL_PATH
                logger.info("[rag] 使用打包预置 ONNX 模型: %s", model_dir)
            else:
                model_dir = self._download_model()

        # 定位 ONNX 模型文件
        onnx_file = self._find_onnx_file(model_dir)
        if onnx_file is None:
            onnx_file = self._export_onnx(model_dir)

        logger.info("[rag] loading ONNX embedding model: %s", onnx_file)
        self._tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
        self._session = ort.InferenceSession(
            str(onnx_file), providers=["CPUExecutionProvider"]
        )
        self._input_names = [inp.name for inp in self._session.get_inputs()]

    def _download_model(self) -> Path:
        """从 HuggingFace 下载模型（仅必要文件）。"""
        from huggingface_hub import snapshot_download

        logger.info("[rag] downloading embedding model from HuggingFace: %s", self._model_name)
        local_dir = snapshot_download(
            repo_id=self._model_name,
            allow_patterns=[
                "config.json",
                "tokenizer.json",
                "tokenizer_config.json",
                "vocab.txt",
                "onnx/*",
            ],
        )
        return Path(local_dir)

    @staticmethod
    def _find_onnx_file(model_dir: Path) -> Path | None:
        """在模型目录中查找已导出的 ONNX 文件。"""
        # 常见路径：onnx/model.onnx, model.onnx
        candidates = [
            model_dir / "onnx" / "model.onnx",
            model_dir / "model.onnx",
        ]
        for c in candidates:
            if c.exists():
                return c
        # 兜底：递归查找第一个 .onnx 文件
        onnx_files = sorted(model_dir.rglob("*.onnx"))
        return onnx_files[0] if onnx_files else None

    @staticmethod
    def _export_onnx(model_dir: Path) -> Path:
        """用 optimum 导出 ONNX 模型（需要 optimum[onnxruntime]，可能需要 torch）。

        仅当模型仓库未预置 ONNX 文件时调用。paraphrase-multilingual-MiniLM-L12-v2
        官方仓库已有 onnx/model.onnx，正常情况下不会触发此方法。
        """
        try:
            from optimum.onnxruntime import ORTModelForFeatureExtraction
        except ImportError as e:
            raise RuntimeError(
                "模型未预置 ONNX 文件且 optimum 未安装。"
                "安装导出工具: pip install 'optimum[onnxruntime]'"
            ) from e

        logger.warning("[rag] exporting ONNX model (may take a moment)...")
        model = ORTModelForFeatureExtraction.from_pretrained(str(model_dir), export=True)
        onnx_dir = model_dir / "onnx"
        onnx_dir.mkdir(exist_ok=True)
        model.save_pretrained(str(onnx_dir))
        onnx_file = onnx_dir / "model.onnx"
        if not onnx_file.exists():
            raise RuntimeError(f"ONNX 导出失败：{onnx_file} 不存在")
        return onnx_file

    def embed(self, texts: list[str]) -> list[list[float]]:
        """生成文本嵌入向量（L2 归一化，便于余弦相似度计算）。

        Args:
            texts: 待嵌入的文本列表

        Returns:
            嵌入向量列表，每个向量维度取决于模型（默认 384 维）
        """
        if not texts:
            return []
        self._ensure_model()
        np = self._np

        # Tokenize（return_tensors="np" 不依赖 torch）
        encoded = self._tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="np",
        )
        # 只保留 ONNX 模型声明的输入（部分模型不需要 token_type_ids）
        inputs = {k: v for k, v in encoded.items() if k in self._input_names}

        # ONNX 推理
        outputs = self._session.run(None, inputs)
        token_embeddings = outputs[0]  # (batch, seq_len, hidden)

        # Mean pooling（按 attention_mask 加权平均）
        attention_mask = inputs["attention_mask"].astype(np.float32)
        mask = attention_mask[..., None]  # (batch, seq_len, 1)
        sum_embeddings = (token_embeddings * mask).sum(axis=1)  # (batch, hidden)
        sum_mask = mask.sum(axis=1)  # (batch, 1)
        embeddings = sum_embeddings / np.maximum(sum_mask, 1e-9)

        # L2 归一化（余弦相似度 = 归一化向量的点积）
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings / np.maximum(norms, 1e-12)

        return embeddings.tolist()


def get_embedding_engine() -> EmbeddingEngine | None:
    """获取全局 EmbeddingEngine 单例。

    若 onnxruntime / transformers 未安装或初始化失败，返回 None，
    调用方应回退到基于关键词的相似度计算（bigram Jaccard）。

    线程安全：通过 _init_lock 保证仅初始化一次（修复 Bug 1.2 单例竞态）。

    Returns:
        EmbeddingEngine 实例，或 None（依赖不可用）
    """
    global _engine, _tried_init
    # 双重检查：已初始化则直接返回，避免每次都抢锁
    if _engine is not None or _tried_init:
        return _engine
    with _init_lock:
        # 二次检查：可能在等锁期间已被其他线程初始化
        if _engine is not None or _tried_init:
            return _engine
        _tried_init = True
        # 检查依赖是否安装
        try:
            import onnxruntime  # noqa: F401
            import transformers  # noqa: F401
        except ImportError:
            logger.warning(
                "[rag] onnxruntime/transformers 未安装，find_similar 将回退到 bigram Jaccard。"
                " 安装依赖: pip install onnxruntime transformers"
            )
            return None
        # 初始化引擎
        try:
            from config.settings import get_settings

            settings = get_settings()
            _engine = EmbeddingEngine(
                model_name=settings.embedding_model_name,
                local_path=settings.embedding_model_local_path or None,
            )
            logger.info(
                "[rag] embedding engine ready (model=%s, backend=onnxruntime)",
                settings.embedding_model_name,
            )
            return _engine
        except Exception as e:
            logger.warning("[rag] embedding engine init failed: %s", e)
            return None


def reset_embedding_engine() -> None:
    """重置引擎单例（仅用于测试）。

    线程安全：在 _init_lock 内重置，避免与正在进行的初始化竞争。
    """
    global _engine, _tried_init
    with _init_lock:
        _engine = None
        _tried_init = False
