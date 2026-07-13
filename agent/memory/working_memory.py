"""工作记忆 Push 注入层 — 把 # now 块预注入到初始消息。

设计参考 Halo memory/DESIGN.md V3：
- memory.md 双层结构：# now（工作记忆，原地编辑）+ # History（时间线，只追加）
- Push 注入：触发前系统把 # now 块直接注入到初始消息，省掉 AI 每次调 memory_read
- 系统预插时间戳：保证时间格式统一

与 Maxma 现有 4 层记忆的关系：
- 不替换长期/情景/语义记忆
- 新增一个"工作记忆"层，用于自治任务的跨 run 状态保持
- 仅在自治模式下使用
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# 小文件阈值（行数），小于此值返回完整内容
_SMALL_FILE_THRESHOLD = 30


class WorkingMemoryStore:
    """工作记忆存储 — 管理 memory.md 文件。

    结构：
        # now          ← 工作记忆（原地编辑，结构稳定）
        ## State | 一行摘要
        ## [实体名]   ← 每个追踪对象
        ## Patterns   ← 学到的规律
        ## Errors      ← 失败教训

        # History      ← 时间线（只追加）
        ## YYYY-MM-DD-HHmm | 摘要
    """

    def __init__(self, path: Path | str):
        self._path = Path(path)

    def exists(self) -> bool:
        """文件是否存在。"""
        return self._path.exists()

    def ensure_created(self) -> None:
        """确保文件存在，不存在则创建空文件。

        创建空文件而非预设模板，让 AI 自行决定记忆结构。
        空文件视为"空记忆"——read_now_section 返回空字符串。
        """
        if not self._path.exists():
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text("", encoding="utf-8")
            logger.info("[working_memory] 创建工作记忆文件: %s", self._path)

    def read_content(self) -> str:
        """读取完整文件内容。"""
        if not self._path.exists():
            return ""
        return self._path.read_text(encoding="utf-8")

    def write_content(self, content: str) -> None:
        """写入完整内容。"""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(content, encoding="utf-8")

    def read_now_section(self, content: str | None = None) -> str:
        """读取 # now 块的内容。

        从第一个 `# now` 到下一个 `#` 级标题（或文件末尾）。
        可接受预读取的 content 参数避免二次 I/O。
        """
        if content is None:
            content = self.read_content()
        if not content:
            return ""

        # 找 # now（必须行首，避免匹配内容中的提及）
        now_match = re.search(r"^# now\b", content, re.MULTILINE)
        if not now_match:
            return ""
        now_idx = now_match.start()

        # 找下一个 # 级标题（以 # 开头但不是 ##）
        # 从 # now 之后搜索
        after_now = content[now_idx + 5:]  # 跳过 "# now"
        next_h1_idx = -1
        pos = 0
        for line in after_now.split("\n"):
            if line.startswith("# ") and not line.startswith("## "):
                next_h1_idx = pos
                break
            pos += len(line) + 1  # +1 for the newline

        if next_h1_idx == -1:
            return content[now_idx:]
        return content[now_idx:now_idx + 5 + next_h1_idx].strip()

    def build_snapshot(self) -> str:
        """构建 Push 注入快照。

        三种情况：
        - 文件不存在：返回创建引导
        - 小文件（≤30 行）：返回完整内容
        - 大文件（>30 行）：返回 # now 块 + # History 标题大纲

        Returns:
            注入到初始消息的快照文本
        """
        if not self._path.exists():
            return (
                f"## 工作记忆\n\n"
                f"文件 {self._path} 不存在。请用 Write 工具创建，"
                f"结构：# now（工作记忆）+ # History（时间线）。"
            )

        content = self.read_content()
        line_count = content.count("\n") + 1

        if line_count <= _SMALL_FILE_THRESHOLD:
            return f"## 工作记忆\n\n{content}"

        # 大文件：只返回 # now 块 + # History 标题大纲
        now_section = self.read_now_section(content)

        # 提取 # History 的标题大纲
        history_headings = []
        in_history = False
        for line in content.split("\n"):
            if line.startswith("# History"):
                in_history = True
                continue
            if in_history and line.startswith("# ") and not line.startswith("## "):
                break  # 下一个 # 级标题
            if in_history and line.startswith("## "):
                history_headings.append(line.strip())

        history_outline = "\n".join(history_headings[:20])  # 最多 20 条
        return (
            f"## 工作记忆\n\n"
            f"### Current State (auto-loaded):\n\n{now_section}\n\n"
            f"### History outline:\n{history_outline}\n"
        )

    def pre_insert_history_heading(self) -> None:
        """在 # History 顶部预插时间戳标题。

        格式：## YYYY-MM-DD-HHmm
        AI 只需在 | 后写语义摘要。
        """
        content = self.read_content()
        if not content:
            return

        timestamp = datetime.now().strftime("%Y-%m-%d-%H%M")
        new_heading = f"## {timestamp} | \n"

        # 找 # History 位置
        history_idx = content.find("# History")
        if history_idx == -1:
            # 没有 # History 块，追加
            content = content.rstrip() + "\n\n# History\n\n" + new_heading
        else:
            # 在 # History 标题之后插入
            # 找到 # History 行的末尾
            line_end = content.find("\n", history_idx)
            if line_end == -1:
                line_end = len(content)
            content = content[:line_end + 1] + "\n" + new_heading + content[line_end + 1:]

        self.write_content(content)
        logger.debug("[working_memory] 预插时间戳标题: %s", timestamp)
