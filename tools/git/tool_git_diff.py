"""Tool: git_diff — 查看 Git 文件差异。"""

import subprocess
from pathlib import Path

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool


class GitDiffInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    repo_path: str = Field(default="", description="仓库根目录路径（留空则使用当前工作目录）")
    file_path: str = Field(default="", description="指定文件路径（留空则显示所有变更）")
    staged: bool = Field(default=False, description="是否查看已暂存的 diff（git diff --cached）")
    commit: str = Field(default="", description="对比的 commit（如 HEAD~1 或某个 commit hash）")


@register_tool
class GitDiffTool(ToolBase):
    name: str = "git_diff"
    description: str = (
        "查看 Git 仓库中文件的差异（unified diff 格式）。"
        "可查看未暂存、已暂存或指定 commit 之间的差异。"
        "[调用积极性: 当用户询问代码改了什么、查看变更详情时主动调用]"
    )
    args_schema: type[BaseModel] = GitDiffInput

    def _run(
        self,
        get_doc: bool = False,
        repo_path: str = "",
        file_path: str = "",
        staged: bool = False,
        commit: str = "",
    ) -> str:
        if get_doc:
            return self._load_doc()

        cwd = repo_path.strip() if repo_path.strip() else None
        if cwd and not Path(cwd).is_dir():
            return format_error(f"目录不存在: {cwd}")

        cmd = ["git", "diff"]
        if staged:
            cmd.append("--cached")
        if commit:
            cmd.append(commit)
        if file_path.strip():
            cmd.append("--")
            cmd.append(file_path.strip())

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd=cwd, timeout=30,
                encoding="utf-8", errors="replace",
            )
        except FileNotFoundError:
            return format_error("未找到 git 命令，请确认已安装 Git")
        except subprocess.TimeoutExpired:
            return format_error("git diff 超时")
        except Exception as exc:
            return format_error(f"执行 git diff 失败: {exc}")

        if result.returncode != 0:
            return format_error(f"git diff 失败: {result.stderr.strip()}")

        diff_text = result.stdout
        if not diff_text.strip():
            scope = f"文件 {file_path}" if file_path.strip() else "所有文件"
            mode = "已暂存" if staged else "未暂存"
            return format_success({"message": f"{scope}没有{mode}的差异", "diff": ""})

        # 统计变更文件数
        files_changed = diff_text.count("diff --git")
        additions = sum(1 for line in diff_text.splitlines() if line.startswith("+") and not line.startswith("+++"))
        deletions = sum(1 for line in diff_text.splitlines() if line.startswith("-") and not line.startswith("---"))

        return format_success({
            "diff": diff_text,
            "files_changed": files_changed,
            "additions": additions,
            "deletions": deletions,
            "summary": f"{files_changed} 个文件变更, +{additions} -{deletions} 行",
        })
