"""文档切块器 — 按 token 数切块 + 重叠。

使用简单的字符数近似 token 计数（中文 1 字 ≈ 1 token，英文 4 字符 ≈ 1 token）。
对于混合中英文内容，按字符数切块是最稳健的方案。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from memory.kb.document_loader import Document


@dataclass
class Chunk:
    """文档切块。"""

    id: str  # 切块 ID（唯一）
    text: str  # 切块文本
    source_doc_id: str  # 所属文档 ID
    source_filename: str  # 所属文档文件名
    source_path: str  # 所属文档路径/URL
    offset: int  # 在原文中的字符偏移
    length: int  # 切块长度（字符数）
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "text": self.text,
            "source_doc_id": self.source_doc_id,
            "source_filename": self.source_filename,
            "source_path": self.source_path,
            "offset": self.offset,
            "length": self.length,
            "metadata": self.metadata,
        }


def chunk_document(
    document: Document,
    chunk_size: int = 500,
    overlap: int = 50,
) -> list[Chunk]:
    """将文档按字符数切块。

    Args:
        document: 文档对象
        chunk_size: 每块最大字符数（默认 500）
        overlap: 相邻块的重叠字符数（默认 50）

    Returns:
        切块列表
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size 必须大于 0")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap 必须在 [0, chunk_size) 范围内")

    text = document.content
    if not text:
        return []

    chunks: list[Chunk] = []
    offset = 0

    while offset < len(text):
        end = min(offset + chunk_size, len(text))
        chunk_text = text[offset:end]

        # 尝试在句子/段落边界处切分（避免在词中间截断）
        if end < len(text):
            boundary = _find_boundary(chunk_text, min(chunk_text) if chunk_text else "")
            if boundary > chunk_size // 2:  # 确保不会切得太小
                chunk_text = chunk_text[:boundary].rstrip()
                end = offset + boundary

        if chunk_text.strip():  # 跳过空块
            chunk_id = f"chunk_{uuid.uuid4().hex[:12]}"
            chunks.append(
                Chunk(
                    id=chunk_id,
                    text=chunk_text,
                    source_doc_id=document.id,
                    source_filename=document.filename,
                    source_path=document.source,
                    offset=offset,
                    length=len(chunk_text),
                    metadata={
                        "doc_id": document.id,
                        "filename": document.filename,
                        "file_type": document.file_type,
                    },
                )
            )

        # 推进 offset：基于实际 end 位置减去 overlap，保证相邻块有重叠
        # 修复：原先用固定 step 推进，边界调整时会跳过 end 到 offset+step 之间的文本
        if end < len(text):
            next_offset = max(end - overlap, offset + 1)
        else:
            next_offset = end
        offset = next_offset

    return chunks


def _find_boundary(text: str, _hint: str = "") -> int:
    """在 text 中寻找最佳切分边界（句号/换行/空格）。

    返回边界位置（在 text 中的索引），如果找不到合适的边界则返回 len(text)。
    """
    # 优先在段落/换行处切分
    for marker in ("\n\n", "\n", "。", ". ", "！", "？", "；", "; "):
        pos = text.rfind(marker)
        if pos > len(text) // 2:
            return pos + len(marker)
    # 其次在空格处切分
    pos = text.rfind(" ")
    if pos > len(text) // 2:
        return pos + 1
    return len(text)
