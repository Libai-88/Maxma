"""Tool listing endpoint — returns available tools from OMP."""
from fastapi import APIRouter

router = APIRouter()

_BUILTIN_TOOLS = [
    {"name": "read", "label": "Read", "description": "读取文件内容", "category": "file", "builtin": True},
    {"name": "write", "label": "Write", "description": "写入文件", "category": "file", "builtin": True},
    {"name": "edit", "label": "Edit", "description": "编辑文件内容", "category": "file", "builtin": True},
    {"name": "glob", "label": "Glob", "description": "搜索文件", "category": "file", "builtin": True},
    {"name": "grep", "label": "Grep", "description": "文本搜索", "category": "file", "builtin": True},
    {"name": "bash", "label": "Bash", "description": "执行 shell 命令", "category": "code", "builtin": True},
    {"name": "eval", "label": "Eval", "description": "执行代码片段", "category": "code", "builtin": True},
    {"name": "lsp", "label": "LSP", "description": "代码语言服务", "category": "code", "builtin": True},
    {"name": "web_search", "label": "Web Search", "description": "搜索互联网", "category": "web", "builtin": True},
    {"name": "fetch", "label": "Fetch", "description": "获取 URL 内容", "category": "web", "builtin": True},
    {"name": "browser", "label": "Browser", "description": "浏览器自动化", "category": "web", "builtin": True},
    {"name": "gh", "label": "GitHub", "description": "GitHub CLI 操作", "category": "system", "builtin": True},
    {"name": "task", "label": "Task", "description": "DAG 子任务编排", "category": "system", "builtin": True},
    {"name": "ask", "label": "Ask User", "description": "向用户提问", "category": "interactive", "builtin": True},
    {"name": "recall", "label": "Recall", "description": "检索记忆", "category": "memory", "builtin": True},
    {"name": "reflect", "label": "Reflect", "description": "反思更新记忆", "category": "memory", "builtin": True},
    {"name": "retain", "label": "Retain", "description": "保留事实", "category": "memory", "builtin": True},
    {"name": "memory_edit", "label": "Memory Edit", "description": "编辑记忆", "category": "memory", "builtin": True},
    {"name": "debug", "label": "Debug", "description": "调试工具", "category": "code", "builtin": True},
]

_CUSTOM_TOOLS = [
    {"name": "get_current_weather", "label": "Weather", "description": "获取实时天气", "category": "web", "builtin": False},
    {"name": "holiday_calendar", "label": "Holiday Calendar", "description": "中国法定节假日", "category": "web", "builtin": False},
    {"name": "tarot", "label": "Tarot", "description": "塔罗牌占卜", "category": "fun", "builtin": False},
    {"name": "manage_skills", "label": "Manage Skills", "description": "管理技能包", "category": "config", "builtin": False},
    {"name": "manage_macros", "label": "Manage Macros", "description": "管理宏", "category": "config", "builtin": False},
    {"name": "manage_providers", "label": "Manage Providers", "description": "管理 Provider", "category": "config", "builtin": False},
    {"name": "manage_mcp", "label": "Manage MCP", "description": "管理 MCP 服务器", "category": "config", "builtin": False},
    {"name": "manage_env_vars", "label": "Manage Env Vars", "description": "管理环境变量", "category": "config", "builtin": False},
    {"name": "manage_whitelist", "label": "Manage Whitelist", "description": "管理路径白名单", "category": "config", "builtin": False},
]

@router.get("/tools")
async def list_tools():
    return _BUILTIN_TOOLS + _CUSTOM_TOOLS
