"""Tool: file_read — 读取文件内容。"""

import os

from pydantic import BaseModel, Field

from tools.base import ToolBase, check_path_access, format_error, format_success, register_tool

# 修复：无大小限制 → 读取 100MB 日志文件会撑爆 LLM 上下文窗口且消耗大量内存。
# 1MB 上限对大多数代码/配置文件足够；超大文件应提示用户用 file_search 精确查找。
MAX_READ_SIZE = 1 * 1024 * 1024  # 1 MB


class FileReadInput(BaseModel):
    get_doc: bool = Field(
        default=False, description="设为 true 以获取使用说明和领域知识"
    )
    file_path: str = Field(default="", description="文件绝对路径")


@register_tool
class FileReadTool(ToolBase):
    name: str = "file_read"
    description: str = (
        "读取文件内容并返回完整文本（上限 1MB，超出部分截断）。"
        "[调用积极性: 可自由看情况调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = FileReadInput

    def _run(self, get_doc: bool = False, file_path: str = "") -> str:
        if get_doc:
            return self._load_doc()
        if not file_path:
            return format_error("读取文件需要提供 file_path")

        err = check_path_access(file_path)
        if err:
            return format_error(err)

        if not os.path.exists(file_path):
            return format_error(f"文件不存在: {file_path}")
        if not os.path.isfile(file_path):
            return format_error(f"路径不是文件: {file_path}")

        st = os.stat(file_path)
        # 修复：先检查文件大小，避免读取超大文件导致内存溢出
        if st.st_size > MAX_READ_SIZE:
            # 读取前 MAX_READ_SIZE 字节并提示截断
            try:
                with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                    data = f.read(MAX_READ_SIZE)
            except (OSError, UnicodeDecodeError) as e:
                return format_error(f"读取文件失败: {e}")
            return format_success({
                "content": data,
                "file_path": os.path.abspath(file_path),
                "file_info": {
                    "size": st.st_size,
                    "path": os.path.abspath(file_path),
                    "truncated": True,
                    "truncated_at": MAX_READ_SIZE,
                    "notice": f"文件超过 {MAX_READ_SIZE} 字节，已截断。如需查看后续内容请用 file_search 精确定位。",
                },
            })

        # 修复：二进制文件用 utf-8 严格模式会 UnicodeDecodeError
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = f.read()
        except UnicodeDecodeError:
            return format_error(
                f"文件 {file_path} 不是有效的 UTF-8 文本文件（可能是二进制文件），"
                f"无法读取。请确认文件类型。"
            )
        except OSError as e:
            return format_error(f"读取文件失败: {e}")

        return format_success({
            "content": data,
            "file_path": os.path.abspath(file_path),
            "file_info": {"size": st.st_size, "path": os.path.abspath(file_path)},
        })
