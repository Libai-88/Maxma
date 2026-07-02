"""Tool: git_pr — 使用 GitHub CLI 创建 Pull Request。"""

import subprocess
from pathlib import Path

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success
import logging
logger = logging.getLogger(__name__)



class GitPRInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    repo_path: str = Field(default="", description="仓库根目录路径（留空则使用当前工作目录）")
    title: str = Field(default="", description="PR 标题（留空则自动生成）")
    body: str = Field(default="", description="PR 描述（留空则自动生成）")
    base: str = Field(default="", description="目标分支（默认 main 或 master）")
    draft: bool = Field(default=False, description="是否创建为草稿 PR")


class GitPRTool(ToolBase):
    name: str = "git_pr"
    description: str = (
        "使用 GitHub CLI（gh）创建 Pull Request。需要已安装 gh 并登录。"
        "[调用积极性: 当用户要求创建 PR、发起合并请求时主动调用]"
    )
    args_schema: type[BaseModel] = GitPRInput

    def _run(
        self,
        get_doc: bool = False,
        repo_path: str = "",
        title: str = "",
        body: str = "",
        base: str = "",
        draft: bool = False,
    ) -> str:
        if get_doc:
            return self._load_doc()

        cwd = repo_path.strip() if repo_path.strip() else None
        if cwd and not Path(cwd).is_dir():
            return format_error(f"目录不存在: {cwd}")

        # 检查 gh CLI 是否可用
        try:
            check = subprocess.run(
                ["gh", "--version"],
                capture_output=True, text=True, timeout=5,
                encoding="utf-8", errors="replace",
            )
            if check.returncode != 0:
                return format_error("未安装 GitHub CLI（gh）。请先安装: https://cli.github.com/")
        except FileNotFoundError:
            return format_error(
                "未找到 gh 命令。GitHub CLI 未安装。\n"
                "安装方法: winget install GitHub.cli 或访问 https://cli.github.com/"
            )
        except Exception:
            pass  # 版本检查失败不阻塞

        # 检查 gh 是否已登录
        try:
            auth = subprocess.run(
                ["gh", "auth", "status"],
                capture_output=True, text=True, cwd=cwd, timeout=10,
                encoding="utf-8", errors="replace",
            )
            if auth.returncode != 0:
                return format_error(
                    "GitHub CLI 未登录。请先运行: gh auth login"
                )
        except Exception:
            pass  # 认证检查失败不阻塞

        # 自动检测目标分支
        if not base.strip():
            base = self._detect_default_branch(cwd)

        # 构建 gh pr create 命令
        cmd = ["gh", "pr", "create"]
        if title.strip():
            cmd.extend(["--title", title.strip()])
        else:
            # 让 gh 自动从 commit 生成标题
            pass
        if body.strip():
            cmd.extend(["--body", body.strip()])
        if base.strip():
            cmd.extend(["--base", base.strip()])
        if draft:
            cmd.append("--draft")

        # 如果没有提供 title，让 gh 交互式生成（fill）
        if not title.strip():
            cmd.append("--fill")

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, cwd=cwd, timeout=30,
                encoding="utf-8", errors="replace",
            )
        except subprocess.TimeoutExpired:
            return format_error("gh pr create 超时")
        except Exception as exc:
            return format_error(f"执行 gh pr create 失败: {exc}")

        if result.returncode != 0:
            stderr = result.stderr.strip()
            if "no commits between" in stderr:
                return format_error("当前分支和目标分支之间没有差异，无法创建 PR")
            if "already exists" in stderr:
                return format_error("当前分支已经有一个打开的 PR")
            return format_error(f"创建 PR 失败: {stderr}")

        pr_url = result.stdout.strip()
        return format_success({
            "message": f"PR 已创建: {pr_url}",
            "url": pr_url,
            "title": title.strip() if title.strip() else "(auto-generated)",
            "base": base.strip(),
            "draft": draft,
        })

    def _detect_default_branch(self, cwd: str | None) -> str:
        """尝试检测仓库的默认分支（main 或 master）。"""
        try:
            result = subprocess.run(
                ["git", "remote", "show", "origin"],
                capture_output=True, text=True, cwd=cwd, timeout=10,
                encoding="utf-8", errors="replace",
            )
            for line in result.stdout.splitlines():
                if "HEAD branch" in line:
                    return line.split(":")[-1].strip()
        except Exception:
            pass
        # 回退：检查 main 是否存在
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--verify", "main"],
                capture_output=True, text=True, cwd=cwd, timeout=5,
                encoding="utf-8", errors="replace",
            )
            if result.returncode == 0:
                return "main"
        except Exception:
            pass
        return "master"
