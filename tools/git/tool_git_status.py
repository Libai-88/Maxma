"""Tool: git_status — 查看 Git 仓库状态。"""

import subprocess
from pathlib import Path

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool


class GitStatusInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    repo_path: str = Field(default="", description="仓库根目录路径（留空则使用当前工作目录）")


@register_tool
class GitStatusTool(ToolBase):
    name: str = "git_status"
    description: str = (
        "查看 Git 仓库的工作目录状态：已暂存、未暂存、未跟踪的文件列表。"
        "[调用积极性: 当用户询问代码变更、仓库状态时主动调用]"
    )
    args_schema: type[BaseModel] = GitStatusInput

    def _run(self, get_doc: bool = False, repo_path: str = "") -> str:
        if get_doc:
            return self._load_doc()

        from tools.git._utils import validate_repo_path
        cwd, err = validate_repo_path(repo_path)
        if err:
            return format_error(err)

        try:
            result = subprocess.run(
                ["git", "status", "--porcelain", "-b"],
                capture_output=True, text=True, cwd=cwd, timeout=15,
                encoding="utf-8", errors="replace",
            )
        except FileNotFoundError:
            return format_error("未找到 git 命令，请确认已安装 Git")
        except subprocess.TimeoutExpired:
            return format_error("git status 超时")
        except Exception as exc:
            return format_error(f"执行 git status 失败: {exc}")

        if result.returncode != 0:
            return format_error(f"git status 失败: {result.stderr.strip()}")

        lines = result.stdout.splitlines()
        if not lines:
            return format_success({"message": "工作目录干净，没有变更", "files": []})

        branch_info = ""
        staged, unstaged, untracked = [], [], []

        for line in lines:
            if line.startswith("##"):
                branch_info = line[3:].strip()
                continue
            if len(line) < 3:
                continue
            xy = line[:2]
            filepath = line[3:]

            # 解析状态
            if xy[0] in ("A", "M", "D", "R", "C"):
                staged.append({"status": xy[0], "file": filepath})
            if xy[1] in ("A", "M", "D", "R", "C"):
                unstaged.append({"status": xy[1], "file": filepath})
            if xy == "??":
                untracked.append(filepath)

        status_map = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed", "C": "copied"}

        def _label(items):
            return [{"file": i["file"], "status": status_map.get(i["status"], i["status"])} for i in items]

        return format_success({
            "branch": branch_info,
            "staged": _label(staged),
            "unstaged": _label(unstaged),
            "untracked": untracked,
            "summary": f"分支: {branch_info} | 已暂存: {len(staged)} | 未暂存: {len(unstaged)} | 未跟踪: {len(untracked)}",
        })
