"""Tool: git_log — 查看 Git 提交历史。"""

import subprocess
from pathlib import Path

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success


class GitLogInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    repo_path: str = Field(default="", description="仓库根目录路径（留空则使用当前工作目录）")
    count: int = Field(default=10, description="显示最近多少条提交（默认 10）")
    file_path: str = Field(default="", description="只显示指定文件的提交历史")
    oneline: bool = Field(default=True, description="是否使用简洁格式（一行一条）")


class GitLogTool(ToolBase):
    name: str = "git_log"
    description: str = (
        "查看 Git 提交历史记录。支持指定数量和文件范围。"
        "[调用积极性: 当用户询问提交历史、最近改了什么时主动调用]"
    )
    args_schema: type[BaseModel] = GitLogInput

    def _run(
        self,
        get_doc: bool = False,
        repo_path: str = "",
        count: int = 10,
        file_path: str = "",
        oneline: bool = True,
    ) -> str:
        if get_doc:
            return self._load_doc()

        cwd = repo_path.strip() if repo_path.strip() else None
        if cwd and not Path(cwd).is_dir():
            return format_error(f"目录不存在: {cwd}")

        count = max(1, min(count, 100))  # 限制 1-100

        cmd = ["git", "log"]
        if oneline:
            cmd.extend(["--oneline", "--no-decorate"])
        else:
            cmd.extend(["--format=%H %s (%an, %ar)"])
        cmd.extend(["-n", str(count)])
        if file_path.strip():
            cmd.extend(["--", file_path.strip()])

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd=cwd, timeout=15,
                encoding="utf-8", errors="replace",
            )
        except FileNotFoundError:
            return format_error("未找到 git 命令，请确认已安装 Git")
        except subprocess.TimeoutExpired:
            return format_error("git log 超时")
        except Exception as exc:
            return format_error(f"执行 git log 失败: {exc}")

        if result.returncode != 0:
            return format_error(f"git log 失败: {result.stderr.strip()}")

        log_text = result.stdout.strip()
        if not log_text:
            return format_success({"message": "没有找到提交记录", "commits": []})

        commits = []
        for line in log_text.splitlines():
            line = line.strip()
            if not line:
                continue
            if oneline:
                # 格式: abc1234 commit message
                parts = line.split(" ", 1)
                commit_hash = parts[0] if parts else ""
                message = parts[1] if len(parts) > 1 else ""
                commits.append({"hash": commit_hash, "message": message})
            else:
                # 格式: HASH message (author, time)
                commits.append({"raw": line})

        scope = f"文件 {file_path}" if file_path.strip() else "整个仓库"
        return format_success({
            "commits": commits,
            "count": len(commits),
            "scope": scope,
            "summary": f"{scope}最近 {len(commits)} 条提交",
        })
