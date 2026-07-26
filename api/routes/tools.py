"""Tool listing endpoint — returns available OMP native tools."""
from fastapi import APIRouter

router = APIRouter()

_BUILTIN_TOOLS = [
    # File
    {"name": "read", "label": "Read", "description": "读取文件内容", "category": "file", "builtin": True},
    {"name": "write", "label": "Write", "description": "写入文件", "category": "file", "builtin": True},
    {"name": "edit", "label": "Edit", "description": "编辑文件内容", "category": "file", "builtin": True},
    {"name": "glob", "label": "Glob", "description": "搜索文件", "category": "file", "builtin": True},
    {"name": "grep", "label": "Grep", "description": "文本搜索", "category": "file", "builtin": True},
    # Code
    {"name": "bash", "label": "Bash", "description": "执行 shell 命令", "category": "code", "builtin": True},
    {"name": "eval", "label": "Eval", "description": "执行代码片段", "category": "code", "builtin": True},
    {"name": "lsp", "label": "LSP", "description": "代码语言服务", "category": "code", "builtin": True},
    {"name": "debug", "label": "Debug", "description": "调试工具", "category": "code", "builtin": True},
    {"name": "ast_grep", "label": "AST Grep", "description": "AST 语法搜索", "category": "code", "builtin": True},
    {"name": "ast_edit", "label": "AST Edit", "description": "AST 语法编辑", "category": "code", "builtin": True},
    # Web
    {"name": "web_search", "label": "Web Search", "description": "搜索互联网", "category": "web", "builtin": True},
    {"name": "browser", "label": "Browser", "description": "浏览器自动化", "category": "web", "builtin": True},
    # System
    {"name": "github", "label": "GitHub", "description": "GitHub CLI 操作", "category": "system", "builtin": True},
    {"name": "task", "label": "Task", "description": "DAG 子任务编排", "category": "system", "builtin": True},
    {"name": "job", "label": "Job", "description": "异步作业管理", "category": "system", "builtin": True},
    {"name": "ssh", "label": "SSH", "description": "SSH 远程连接", "category": "system", "builtin": True},
    {"name": "launch", "label": "Launch", "description": "启动应用", "category": "system", "builtin": True},
    {"name": "checkpoint", "label": "Checkpoint", "description": "创建检查点", "category": "system", "builtin": True},
    {"name": "rewind", "label": "Rewind", "description": "回退到检查点", "category": "system", "builtin": True},
    {"name": "irc", "label": "IRC", "description": "多 agent 通信", "category": "system", "builtin": True},
    # Interactive
    {"name": "ask", "label": "Ask User", "description": "向用户提问", "category": "interactive", "builtin": True},
    {"name": "todo", "label": "Todo", "description": "待办管理", "category": "interactive", "builtin": True},
    {"name": "inspect_image", "label": "Inspect Image", "description": "图片分析", "category": "interactive", "builtin": True},
    # Memory
    {"name": "recall", "label": "Recall", "description": "检索记忆", "category": "memory", "builtin": True},
    {"name": "reflect", "label": "Reflect", "description": "反思更新记忆", "category": "memory", "builtin": True},
    {"name": "retain", "label": "Retain", "description": "保留事实", "category": "memory", "builtin": True},
    {"name": "memory_edit", "label": "Memory Edit", "description": "编辑记忆", "category": "memory", "builtin": True},
    # Skills
    {"name": "manage_skill", "label": "Manage Skill", "description": "管理技能包", "category": "skills", "builtin": True},
    {"name": "learn", "label": "Learn", "description": "学习", "category": "skills", "builtin": True},
]

@router.get("/tools")
async def list_tools():
    return _BUILTIN_TOOLS
