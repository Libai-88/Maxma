"""Tool: git_commit — 提交 Git 变更。"""

import subprocess
from pathlib import Path

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool
from tools.git._utils import validate_git_arg, validate_repo_path
import logging
logger = logging.getLogger(__name__)


# 敏感文件模式 — 提交前需要警告
_SENSITIVE_PATTERNS = [
    ".env", ".env.", "credentials", "secrets.",
    ".pem", ".key", ".p12", ".pfx",
    ".sqlite", ".db",
    "id_rsa", "id_ed25519",
]


def _check_sensitive_files(files: list[str]) -> list[str]:
    """检查文件列表中是否包含敏感文件，返回匹配到的敏感文件名。"""
    found = []
    for f in files:
        fname = f.lower().replace("\\", "/")
        for pattern in _SENSITIVE_PATTERNS:
            if pattern in fname:
                found.append(f)
                break
    return found


class GitCommitInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    repo_path: str = Field(default="", description="仓库根目录路径（留空则使用当前工作目录）")
    message: str = Field(default="", description="提交信息（commit message）")
    files: str = Field(
        default="",
        description="要暂存的文件，用 | 分隔（如 src/main.py|src/utils.py）。留空则暂存所有变更（git add -A）",
    )
    allow_empty: bool = Field(default=False, description="是否允许空提交（--allow-empty）")
    skip_sensitive_check: bool = Field(default=False, description="跳过敏感文件检测（不推荐）")


@register_tool
class GitCommitTool(ToolBase):
    name: str = "git_commit"
    description: str = (
        "将变更提交到 Git 仓库：暂存指定文件并创建 commit。"
        "自动检测敏感文件（.env、密钥等）并在提交前警告。"
        "[调用积极性: 当用户要求提交代码、保存变更时主动调用]"
    )
    args_schema: type[BaseModel] = GitCommitInput

    def _run(
        self,
        get_doc: bool = False,
        repo_path: str = "",
        message: str = "",
        files: str = "",
        allow_empty: bool = False,
        skip_sensitive_check: bool = False,
    ) -> str:
        if get_doc:
            return self._load_doc()

        cwd, err = validate_repo_path(repo_path) if repo_path.strip() else (None, None)
        if err:
            return format_error(err)

        if not message.strip():
            return format_error("提交信息（message）不能为空")

        message_clean, err = validate_git_arg(message, "message")
        if err:
            return format_error(err)

        # 1. 暂存文件
        if files.strip():
            file_list = []
            for f in files.split("|"):
                f_clean, f_err = validate_git_arg(f, "files")
                if f_err:
                    return format_error(f_err)
                if f_clean:
                    file_list.append(f_clean)
            add_cmd = ["git", "add"] + file_list
        else:
            file_list = []
            add_cmd = ["git", "add", "-A"]

        try:
            add_result = subprocess.run(
                add_cmd, capture_output=True, text=True, cwd=cwd, timeout=30,
                encoding="utf-8", errors="replace",
            )
        except FileNotFoundError:
            return format_error("未找到 git 命令，请确认已安装 Git")
        except subprocess.TimeoutExpired:
            return format_error("git add 超时")
        except Exception as exc:
            return format_error(f"执行 git add 失败: {exc}")

        if add_result.returncode != 0:
            return format_error(f"git add 失败: {add_result.stderr.strip()}")

        # 2. 敏感文件检测
        if not skip_sensitive_check:
            # 获取已暂存的文件列表
            try:
                staged_result = subprocess.run(
                    ["git", "diff", "--cached", "--name-only"],
                    capture_output=True, text=True, cwd=cwd, timeout=10,
                    encoding="utf-8", errors="replace",
                )
                staged_files = [f.strip() for f in staged_result.stdout.splitlines() if f.strip()]
            except Exception:
                staged_files = []

            sensitive = _check_sensitive_files(staged_files)
            if sensitive:
                return format_error(
                    f"检测到敏感文件: {', '.join(sensitive)}\n"
                    f"这些文件可能包含密钥或私密数据。如果确认要提交，"
                    f"请设置 skip_sensitive_check=true 重试。"
                )

        # 3. 提交
        commit_cmd = ["git", "commit", "-m", message_clean]
        if allow_empty:
            commit_cmd.append("--allow-empty")

        try:
            commit_result = subprocess.run(
                commit_cmd, capture_output=True, text=True, cwd=cwd, timeout=30,
                encoding="utf-8", errors="replace",
            )
        except subprocess.TimeoutExpired:
            return format_error("git commit 超时")
        except Exception as exc:
            return format_error(f"执行 git commit 失败: {exc}")

        if commit_result.returncode != 0:
            stderr = commit_result.stderr.strip()
            if "nothing to commit" in stderr:
                return format_success({"message": "没有需要提交的变更"})
            return format_error(f"git commit 失败: {stderr}")

        # 提取 commit hash
        try:
            hash_result = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, cwd=cwd, timeout=5,
                encoding="utf-8", errors="replace",
            )
            commit_hash = hash_result.stdout.strip()
        except Exception:
            commit_hash = "unknown"

        return format_success({
            "message": f"已提交: {commit_hash} — {message_clean}",
            "commit_hash": commit_hash,
            "commit_message": message_clean,
            "files_staged": file_list if file_list else "all",
        })
