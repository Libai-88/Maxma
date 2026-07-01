"""Tool: git_branch — Git 分支管理。"""

import subprocess
from pathlib import Path

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success


class GitBranchInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    repo_path: str = Field(default="", description="仓库根目录路径（留空则使用当前工作目录）")
    action: str = Field(
        default="list",
        description="操作类型: list（列出分支）、create（创建）、switch（切换）、delete（删除）",
    )
    branch_name: str = Field(default="", description="分支名（create/switch/delete 时必填）")
    create_from: str = Field(default="", description="创建分支时指定起点（commit/分支/tag），留空则从当前 HEAD 创建")


class GitBranchTool(ToolBase):
    name: str = "git_branch"
    description: str = (
        "管理 Git 分支：列出、创建、切换、删除分支。"
        "[调用积极性: 当用户要求管理分支、切换分支时主动调用]"
    )
    args_schema: type[BaseModel] = GitBranchInput

    def _run(
        self,
        get_doc: bool = False,
        repo_path: str = "",
        action: str = "list",
        branch_name: str = "",
        create_from: str = "",
    ) -> str:
        if get_doc:
            return self._load_doc()

        cwd = repo_path.strip() if repo_path.strip() else None
        if cwd and not Path(cwd).is_dir():
            return format_error(f"目录不存在: {cwd}")

        action = action.strip().lower()

        # ── list ──
        if action == "list":
            try:
                result = subprocess.run(
                    ["git", "branch", "--list", "--no-color"],
                    capture_output=True, text=True, cwd=cwd, timeout=10,
                    encoding="utf-8", errors="replace",
                )
            except FileNotFoundError:
                return format_error("未找到 git 命令，请确认已安装 Git")
            except subprocess.TimeoutExpired:
                return format_error("git branch 超时")
            except Exception as exc:
                return format_error(f"执行 git branch 失败: {exc}")

            if result.returncode != 0:
                return format_error(f"git branch 失败: {result.stderr.strip()}")

            branches = []
            current = ""
            for line in result.stdout.splitlines():
                line = line.strip()
                if not line:
                    continue
                if line.startswith("* "):
                    current = line[2:].strip()
                    branches.append({"name": current, "current": True})
                else:
                    branches.append({"name": line, "current": False})

            return format_success({
                "branches": branches,
                "current": current,
                "summary": f"共 {len(branches)} 个分支，当前: {current}",
            })

        # ── create ──
        if action == "create":
            if not branch_name.strip():
                return format_error("branch_name 不能为空")
            cmd = ["git", "branch", branch_name.strip()]
            if create_from.strip():
                cmd.append(create_from.strip())

            try:
                result = subprocess.run(
                    cmd, capture_output=True, text=True, cwd=cwd, timeout=10,
                    encoding="utf-8", errors="replace",
                )
            except FileNotFoundError:
                return format_error("未找到 git 命令，请确认已安装 Git")
            except subprocess.TimeoutExpired:
                return format_error("git branch 超时")
            except Exception as exc:
                return format_error(f"执行 git branch 失败: {exc}")

            if result.returncode != 0:
                return format_error(f"创建分支失败: {result.stderr.strip()}")

            return format_success({
                "message": f"已创建分支 '{branch_name.strip()}'",
                "branch": branch_name.strip(),
            })

        # ── switch ──
        if action == "switch":
            if not branch_name.strip():
                return format_error("branch_name 不能为空")
            try:
                result = subprocess.run(
                    ["git", "checkout", branch_name.strip()],
                    capture_output=True, text=True, cwd=cwd, timeout=15,
                    encoding="utf-8", errors="replace",
                )
            except FileNotFoundError:
                return format_error("未找到 git 命令，请确认已安装 Git")
            except subprocess.TimeoutExpired:
                return format_error("git checkout 超时")
            except Exception as exc:
                return format_error(f"执行 git checkout 失败: {exc}")

            if result.returncode != 0:
                return format_error(f"切换分支失败: {result.stderr.strip()}")

            return format_success({
                "message": f"已切换到分支 '{branch_name.strip()}'",
                "branch": branch_name.strip(),
            })

        # ── delete ──
        if action == "delete":
            if not branch_name.strip():
                return format_error("branch_name 不能为空")
            try:
                result = subprocess.run(
                    ["git", "branch", "-d", branch_name.strip()],
                    capture_output=True, text=True, cwd=cwd, timeout=10,
                    encoding="utf-8", errors="replace",
                )
            except FileNotFoundError:
                return format_error("未找到 git 命令，请确认已安装 Git")
            except subprocess.TimeoutExpired:
                return format_error("git branch 超时")
            except Exception as exc:
                return format_error(f"执行 git branch -d 失败: {exc}")

            if result.returncode != 0:
                stderr = result.stderr.strip()
                if "not fully merged" in stderr:
                    return format_error(
                        f"分支 '{branch_name.strip()}' 未完全合并。"
                        f"如确认要强制删除，请手动执行 git branch -D {branch_name.strip()}"
                    )
                return format_error(f"删除分支失败: {stderr}")

            return format_success({
                "message": f"已删除分支 '{branch_name.strip()}'",
                "branch": branch_name.strip(),
            })

        return format_error(f"未知操作: {action}，支持 list/create/switch/delete")
