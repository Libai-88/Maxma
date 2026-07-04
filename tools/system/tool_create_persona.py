"""Tool: create_persona — 创建新人格文件。"""

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool


class CreatePersonaInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    name: str = Field(
        default="",
        description="人格名称（中文或英文），将创建 SOUL.{name}.md 文件",
    )
    description: str = Field(
        default="",
        description="人格的简要描述（1-2 句话），用于 frontmatter 和列表展示",
    )
    tools: str = Field(
        default="",
        description=(
            "可选，逗号分隔的可用工具列表。"
            "留空表示不限制（使用全部工具）。"
            "例如: 'file_read, file_write, run_python, ask_user_qa'"
        ),
    )
    memory: str = Field(
        default="shared",
        description="记忆模式: 'shared'（共享记忆）或 'persona'（独立记忆分区）",
    )


@register_tool
class CreatePersonaTool(ToolBase):
    name: str = "create_persona"
    description: str = (
        "创建新的 Agent 人格。生成 SOUL.{name}.md 文件，"
        "可配置专属工具集和独立记忆分区。"
        "[调用积极性: 用户要求创建新人格时调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = CreatePersonaInput

    def _run(
        self,
        get_doc: bool = False,
        name: str = "",
        description: str = "",
        tools: str = "",
        memory: str = "shared",
    ) -> str:
        if get_doc:
            return self._load_doc()
        if not name:
            return format_error("name 不能为空")

        # 安全校验：拒绝路径分隔符和特殊字符
        import re
        if not re.match(r'^[\w\u4e00-\u9fff\-]+$', name.strip()):
            return format_error("name 只能包含字母、数字、中文、下划线和连字符")
        if ".." in name or "/" in name or "\\" in name:
            return format_error("name 不能包含路径分隔符")

        from app_paths import PERSONAS_DATA_DIR

        # 生成文件名
        safe_name = name.strip().replace(" ", "_")
        filename = f"SOUL.{safe_name}.md"
        filepath = PERSONAS_DATA_DIR / filename

        # 检查是否已存在
        if filepath.exists():
            return format_error(f"人格文件 {filename} 已存在，请选择其他名称")

        # 构建 frontmatter
        fm_lines = ["---"]
        if description:
            fm_lines.append(f'description: "{description}"')
        if tools:
            fm_lines.append(f"tools: {tools}")
        if memory and memory != "shared":
            fm_lines.append(f"memory: {memory}")
        fm_lines.append("---")
        fm_lines.append("")

        # 构建模板内容
        content_lines = [
            f"# {name}",
            "",
            f"## 角色定义",
            f"你是 **{name}**。{description or '一个独特的 Agent 人格。'}",
            "",
            "## 性格特征",
            "（请在此处描述人格的性格特征、说话风格、行为模式等）",
            "",
            "## 说话风格",
            "（请在此处描述人格的语言风格、常用词汇、语气特点等）",
            "",
        ]

        full_content = "\n".join(fm_lines + content_lines)

        # 写入文件
        try:
            filepath.write_text(full_content, encoding="utf-8")
        except Exception as e:
            return format_error(f"创建人格文件失败: {e}")

        # 如果配置了独立记忆，创建空的记忆文件
        if memory == "persona":
            persona_id = filepath.stem
            memory_path = PERSONAS_DATA_DIR / f"memory_{persona_id}.yaml"
            if not memory_path.exists():
                memory_path.write_text("{}\n", encoding="utf-8")

        return format_success({
            "file": filename,
            "path": str(filepath),
            "memory_mode": memory,
            "tools": tools or "(全部)",
            "message": (
                f"已创建人格文件 {filename}。"
                f"记忆模式: {'独立' if memory == 'persona' else '共享'}。"
                f"请在文件中补充性格和说话风格的详细描述。"
            ),
        })
