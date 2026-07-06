"""KB 索引器 — 文档加载 → 切块 → embedding → vector_store.upsert。

所有操作均为 best-effort：向量库不可用时记录日志但不抛异常。
文档元数据存储在 JSON 文件中，用于跟踪已索引的文档列表。
"""

from __future__ import annotations

import json
import logging
import portalocker
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app_paths import API_DATA_DIR, KB_DIR
from memory.kb.chunker import Chunk, chunk_document
from memory.kb.document_loader import Document, load_document, load_text_from_url

logger = logging.getLogger(__name__)

# 文档元数据存储路径
KB_DOC_META_PATH = API_DATA_DIR / "kb_documents.json"


class KBIndexer:
    """知识库索引器。

    负责：
    - 加载文档（txt/md/pdf/docx/csv/json/url）
    - 切块
    - 生成 embedding 并写入 chromadb knowledge_base collection
    - 维护文档元数据 JSON（doc_id → 文档信息 + chunk_ids 列表）
    """

    def __init__(
        self,
        meta_path: str | Path = KB_DOC_META_PATH,
        chunk_size: int = 500,
        overlap: int = 50,
    ):
        self._meta_path = Path(meta_path)
        self._lock_path = Path(str(meta_path) + ".lock")
        self._chunk_size = chunk_size
        self._overlap = overlap

    def index_file(
        self,
        file_path: str | Path,
        doc_id: Optional[str] = None,
    ) -> dict:
        """索引一个本地文件。

        Args:
            file_path: 文件路径
            doc_id: 可选文档 ID（默认文件名 stem）

        Returns:
            索引结果 {"doc_id": ..., "chunks": ..., "status": ...}

        Raises:
            ValueError: 文件不存在或解析失败
        """
        document = load_document(file_path, doc_id=doc_id)
        return self._index_document(document)

    def index_text(
        self,
        content: str,
        doc_id: str,
        filename: str = "",
        source: str = "",
        metadata: Optional[dict] = None,
    ) -> dict:
        """索引一段纯文本。

        Args:
            content: 文本内容
            doc_id: 文档 ID
            filename: 文件名（用于展示）
            source: 来源标识
            metadata: 额外元数据

        Returns:
            索引结果
        """
        if not content.strip():
            raise ValueError("内容为空")

        document = Document(
            id=doc_id,
            content=content,
            source=source or doc_id,
            filename=filename or doc_id,
            file_type="text",
            size=len(content.encode("utf-8")),
            metadata=metadata or {},
        )
        return self._index_document(document)

    def index_url(
        self,
        url: str,
        markdown: str,
        doc_id: Optional[str] = None,
    ) -> dict:
        """索引从 URL 提取的 Markdown 文本。

        Args:
            url: 原始 URL
            markdown: 提取的 Markdown 文本
            doc_id: 可选文档 ID

        Returns:
            索引结果
        """
        document = load_text_from_url(url, markdown)
        if doc_id:
            document.id = doc_id
        return self._index_document(document)

    def delete_document(self, doc_id: str) -> bool:
        """删除文档及其所有切块（包括原始文件）。

        Args:
            doc_id: 文档 ID

        Returns:
            是否成功删除（False 表示文档不存在）
        """
        with portalocker.Lock(self._lock_path, timeout=5):
            meta = self._read_meta()
            if doc_id not in meta:
                return False

            doc_info = meta[doc_id]
            chunk_ids = doc_info.get("chunk_ids", [])

            # 从向量库删除
            try:
                from memory.rag.vector_store import COLLECTION_KB, get_vector_store

                store = get_vector_store()
                if store is not None and chunk_ids:
                    store.delete(collection=COLLECTION_KB, ids=chunk_ids)
            except Exception as e:
                logger.warning("[kb] 从向量库删除 %s 的切块失败: %s", doc_id, e)

            # 删除原始文件（仅当文件在 KB_DIR 内时，防止路径穿越）
            source_path = doc_info.get("source", "")
            if source_path:
                try:
                    file_path = Path(source_path)
                    # 安全检查：只删除 KB_DIR 内的文件
                    if file_path.exists() and KB_DIR in file_path.resolve().parents:
                        file_path.unlink()
                except (OSError, ValueError) as e:
                    logger.warning("[kb] 删除原始文件 %s 失败: %s", source_path, e)

            # 从元数据删除
            meta.pop(doc_id, None)
            self._write_meta(meta)

        logger.info("[kb] deleted document %s (%d chunks)", doc_id, len(chunk_ids))
        return True

    def list_documents(self) -> list[dict]:
        """列出所有已索引文档。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            meta = self._read_meta()
        # 按创建时间倒序
        results = list(meta.values())
        results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return results

    def get_document(self, doc_id: str) -> Optional[dict]:
        """获取单个文档元数据。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            meta = self._read_meta()
        return meta.get(doc_id)

    def _index_document(self, document: Document) -> dict:
        """核心索引逻辑：切块 → embedding → upsert → 更新元数据。

        修复 Bug 4.1：原先存在两段独立的 portalocker.Lock（删除旧切块 / 写入新元数据），
        中间的切块与 embedding 不持锁，期间其他请求可能写入 meta 文件，导致后一段锁
        内读到的 meta 已过期，覆盖前者的写入（TOCTOU）。现在改为单段锁覆盖「读 meta
        → 删除旧切块 → 写新 meta」，中间无锁阶段只做切块与 embedding 计算（无副作用）。
        """
        # ── 阶段 1：无锁计算（切块 + embedding 生成 chunk_ids）──
        # 切块
        chunks = chunk_document(
            document,
            chunk_size=self._chunk_size,
            overlap=self._overlap,
        )

        if not chunks:
            return {
                "doc_id": document.id,
                "chunks": 0,
                "status": "empty",
                "message": "文档切块后为空",
            }

        # 生成 embedding 并写入向量库
        chunk_ids = []
        indexed_count = 0
        index_error: str | None = None  # 记录索引失败原因，传播给调用方
        try:
            from memory.rag.embedding import get_embedding_engine
            from memory.rag.vector_store import COLLECTION_KB, get_vector_store

            engine = get_embedding_engine()
            store = get_vector_store()

            if engine is not None and store is not None:
                # 分批 embedding（避免大文档一次性占用过多内存）
                batch_size = 32
                for i in range(0, len(chunks), batch_size):
                    batch = chunks[i : i + batch_size]
                    texts = [c.text for c in batch]
                    embeddings = engine.embed(texts)
                    if len(embeddings) != len(batch):
                        logger.warning(
                            "[kb] embedding 数量不匹配: %d != %d",
                            len(embeddings), len(batch),
                        )
                        continue

                    batch_ids = [c.id for c in batch]
                    # chromadb metadata 值必须是标量（str/int/float/bool/None），
                    # 不能是嵌套 dict。Chunk.to_dict() 返回的 "metadata" 字段是 dict，
                    # 直接传给 chromadb 会抛 "Expected metadata value to be a str, int, ..."
                    # 因此这里手动构造扁平化的 metadata。
                    batch_metas = [
                        {
                            "doc_id": c.source_doc_id,
                            "filename": c.source_filename,
                            "source_path": c.source_path,
                            "offset": c.offset,
                            "length": c.length,
                        }
                        for c in batch
                    ]
                    store.upsert(
                        collection=COLLECTION_KB,
                        ids=batch_ids,
                        embeddings=embeddings,
                        documents=texts,
                        metadatas=batch_metas,
                    )
                    chunk_ids.extend(batch_ids)
                    indexed_count += len(batch)
            else:
                # 明确记录哪个引擎不可用，便于排查
                index_error = (
                    f"embedding engine={'available' if engine else 'UNAVAILABLE'}, "
                    f"vector store={'available' if store else 'UNAVAILABLE'}"
                )
                logger.warning("[kb] 向量库或 embedding 引擎不可用，仅记录元数据: %s", index_error)
        except Exception as e:
            index_error = str(e)
            logger.warning("[kb] 索引 %s 到向量库失败: %s", document.id, e)

        # 修复 Bug 5.3：使用 timezone-aware datetime，避免 naive 时间戳与其他时区时间比较出错
        doc_meta = {
            "doc_id": document.id,
            "filename": document.filename,
            "source": document.source,
            "file_type": document.file_type,
            "size": document.size,
            "chunk_count": len(chunks),
            "indexed_chunk_count": indexed_count,
            "chunk_ids": chunk_ids,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "metadata": document.metadata,
            # 记录索引失败原因，便于排查（None 表示无错误）
            "index_error": index_error,
        }

        # ── 阶段 2：单段锁覆盖「读 meta → 删除旧切块 → 写新 meta」──
        # 修复 Bug 4.1：消除两段锁之间的 TOCTOU 窗口
        with portalocker.Lock(self._lock_path, timeout=5):
            meta = self._read_meta()
            # 删除同 ID 的旧文档切块（重新索引场景）
            if document.id in meta:
                old_chunk_ids = meta[document.id].get("chunk_ids", [])
                if old_chunk_ids:
                    try:
                        from memory.rag.vector_store import COLLECTION_KB, get_vector_store

                        store = get_vector_store()
                        if store is not None:
                            store.delete(collection=COLLECTION_KB, ids=old_chunk_ids)
                    except Exception as e:
                        logger.warning(
                            "[kb] 重新索引 %s 时删除旧切块失败: %s", document.id, e
                        )
            # 写入新元数据（基于持锁期间读到的最新 meta，不会覆盖他人写入）
            meta[document.id] = doc_meta
            self._write_meta(meta)

        logger.info(
            "[kb] indexed %s: %d chunks (%d indexed to vector store)",
            document.id, len(chunks), indexed_count,
        )
        return {
            "doc_id": document.id,
            "filename": document.filename,
            "chunks": len(chunks),
            "indexed": indexed_count,
            "status": "ok" if indexed_count > 0 else "metadata_only",
            # 当索引失败时，明确告知 agent 原因，避免误以为添加成功
            "warning": (
                f"向量索引失败（{index_error}），文档已保存但无法被语义检索。"
                "请检查 ONNX 模型或 chromadb 是否可用。"
            ) if (indexed_count == 0 and index_error) else None,
        }

    def _read_meta(self) -> dict:
        """读取文档元数据。"""
        if not self._meta_path.exists():
            return {}
        try:
            return json.loads(self._meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("[kb] 读取元数据失败: %s", e)
            return {}

    def _write_meta(self, meta: dict) -> None:
        """写入文档元数据。"""
        self._meta_path.parent.mkdir(parents=True, exist_ok=True)
        self._meta_path.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
