"""Tool: project_info — 扫描并返回项目结构和技术栈信息。"""

from pathlib import Path

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success


class ProjectInfoInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    root_path: str = Field(
        default="",
        description="项目根目录路径（留空则使用当前工作目录或最近扫描的路径）",
    )
    detail: str = Field(
        default="summary",
        description="详细程度: summary（简洁摘要，~500 token）/ full（完整信息）",
    )


class ProjectInfoTool(ToolBase):
    name: str = "project_info"
    description: str = (
        "扫描项目目录，返回项目结构、技术栈、关键配置和统计信息。"
        "用于了解当前项目的技术背景和文件组织。"
        "[调用积极性: 当用户提到项目路径、询问项目结构、或需要在项目中工作时主动调用]"
    )
    args_schema: type[BaseModel] = ProjectInfoInput

    def _run(
        self,
        get_doc: bool = False,
        root_path: str = "",
        detail: str = "summary",
    ) -> str:
        if get_doc:
            return self._load_doc()

        from agent.project_scanner import scan_project

        root = root_path.strip() if root_path.strip() else "."
        root_p = Path(root)
        if not root_p.is_dir():
            return format_error(f"目录不存在: {root}")

        ctx = scan_project(root_p)

        if detail.strip().lower() == "full":
            return format_success({
                "root": ctx.root,
                "tree": ctx.tree,
                "tech_stack": ctx.tech_stack,
                "stats": ctx.stats,
                "key_files": list(ctx.key_files_content.keys()),
                "key_files_content": ctx.key_files_content,
            })
        else:
            prompt_text = ctx.to_prompt_text()
            return format_success({
                "root": ctx.root,
                "tech_stack": ctx.tech_stack,
                "stats": ctx.stats,
                "context": prompt_text,
            })
