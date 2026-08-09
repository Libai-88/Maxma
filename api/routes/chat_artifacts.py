"""chat_artifacts.py — Agent 工具输出 → InteractiveArtifact 负载合成。

从 chat.py 拆分（S2-4）：文件路径提取与 artifact payload 构建独立可测。
"""

import base64
import hashlib
import json
import os
import re

# 写类工具集合——其输出可能包含文件路径，需要合成 artifact
_FILE_WRITING_TOOLS = frozenset({"write", "edit", "create"})

# body 字符上限（前端 isInteractiveArtifact 限制 4000）
_MAX_ARTIFACT_BODY = 2000


def _extract_file_path_from_output(output: str) -> str | None:
    """从工具输出字符串中提取文件路径。

    侧边栏将工具结果序列化为 JSON，格式如：
      {"content":[{"type":"text","text":"Successfully wrote 13 bytes to /path/to/file.txt"}],"details":{}}
    此函数尝试解析 JSON 并提取文件路径。
    """
    text = output
    # 尝试解析 JSON
    try:
        data = json.loads(output)
        if isinstance(data, dict):
            # 从 content 块提取文本
            content = data.get("content", [])
            if isinstance(content, list):
                texts = [
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                if texts:
                    text = " ".join(texts)
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    # 匹配 "to /path/to/file" 或 "Edited /path/to/file" 中的路径
    for pattern in (
        r'(?:to|at|:)\s*(/[^\s,.;!?\'"]+)',   # Unix 绝对路径
        r'(?:to|at|:)\s*([A-Za-z]:\\[^\s,.;!?\'"]+)',  # Windows 绝对路径
    ):
        for match in re.finditer(pattern, text, re.IGNORECASE):
            path = match.group(1).strip().rstrip(".,;:!?\"'")
            if os.path.isfile(path):
                return os.path.normpath(path)

    # 兜底：扫描输出中所有存在的文件路径
    for word in text.split():
        word = word.strip().rstrip(".,;:!?\"'")
        if os.path.isfile(word):
            return os.path.normpath(word)

    return None


def _build_artifact_payload(file_path: str) -> dict | None:
    """读取文件并构建 InteractiveArtifact 负载。

    返回符合前端 InteractiveArtifact 类型的 dict，若文件不可读则返回 None。
    """
    if not os.path.isfile(file_path):
        return None
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except (OSError, PermissionError):
        return None

    file_id = hashlib.md5(file_path.encode("utf-8")).hexdigest()  # 32 字符 hex
    filename = os.path.basename(file_path)
    token = base64.b64encode(file_path.encode("utf-8")).decode("ascii")

    # 截断并 sanitize body（不包含 HTML 标签）
    preview = content[:_MAX_ARTIFACT_BODY]
    if len(content) > _MAX_ARTIFACT_BODY:
        preview += "\n\n... (内容已截断)"
    preview = preview.replace("<", "&lt;").replace(">", "&gt;")

    return {
        "version": 1,
        "id": file_id,
        "type": "choice",
        "title": filename,
        "body": preview,
        "actions": [
            {"id": "preview", "label": "预览", "token": token, "style": "primary"},
            {"id": "open", "label": "打开", "token": token, "style": "secondary"},
        ],
    }
