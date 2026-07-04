"""Tool: git_push — 推送 Git 分支到远程仓库。"""

import subprocess
from pathlib import Path

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool


class GitPushInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    repo_path: str = Field(default="", description="仓库根目录路径（留空则使用当前工作目录）")
    remote: str = Field(default="origin", description="远程仓库名（默认 origin）")
    branch: str = Field(default="", description="要推送的分支名（留空则推送当前分支）")
    set_upstream: bool = Field(default=False, description="是否设置 upstream（-u 参数）")
    force: bool = Field(default=False, description="是否强制推送（--force，谨慎使用）")


@register_tool
class GitPushTool(ToolBase):
    name: str = "git_push"
    description: str = (
        "将本地分支推送到远程仓库。支持设置 upstream 和强制推送。"
        "[调用积极性: 当用户要求推送代码、同步到远程时主动调用]"
    )
    args_schema: type[BaseModel] = GitPushInput

    def _run(
        self,
        get_doc: bool = False,
        repo_path: str = "",
        remote: str = "origin",
        branch: str = "",
        set_upstream: bool = False,
        force: bool = False,
    ) -> str:
        if get_doc:
            return self._load_doc()

        cwd = repo_path.strip() if repo_path.strip() else None
        if cwd and not Path(cwd).is_dir():
            return format_error(f"目录不存在: {cwd}")

        cmd = ["git", "push"]
        if set_upstream:
            cmd.append("-u")
        if force:
            cmd.append("--force")
        cmd.append(remote.strip())
        if branch.strip():
            cmd.append(branch.strip())

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd=cwd, timeout=60,
                encoding="utf-8", errors="replace",
            )
        except FileNotFoundError:
            return format_error("未找到 git 命令，请确认已安装 Git")
        except subprocess.TimeoutExpired:
            return format_error("git push 超时（60s），请检查网络连接")
        except Exception as exc:
            return format_error(f"执行 git push 失败: {exc}")

        if result.returncode != 0:
            stderr = result.stderr.strip()
            if "Everything up-to-date" in stderr:
                return format_success({"message": "已经是最新，无需推送"})
            if "rejected" in stderr and "non-fast-forward" in stderr:
                return format_error(
                    "推送被拒绝（non-fast-forward）：远程有更新的提交。"
                    "请先 git pull 合并远程变更，或使用 force=true 强制推送（谨慎）"
                )
            return format_error(f"git push 失败: {stderr}")

        # 获取推送的目标分支
        target_branch = branch.strip() if branch.strip() else "当前分支"
        output = result.stdout.strip() or result.stderr.strip()

        return format_success({
            "message": f"已推送 {target_branch} 到 {remote.strip()}",
            "remote": remote.strip(),
            "branch": target_branch,
            "output": output,
        })
