"""Tool listing endpoint — returns available OMP native tools."""
from fastapi import APIRouter

router = APIRouter()

# TOOL-LIST-ACCURACY-001：清单必须与运行时事实一致——
# 1) 移除 OMP 原生记忆工具 recall/reflect/retain/memory_edit：编译包不含
#    fastembed/onnxruntime，sidecar 将 memory.backend 钉死为 "off"，这 4 个
#    工具在运行时不会被注册（模型 schema 中不存在、调用必失败）。此前清单
#    宣称 31 个工具、其中 4 个不可用，CapabilitiesView 展示与事实不符。
# 2) 补充 Maxma 自定义工具（remember_memory/search_memories/get_sticker/
#    list_rules/list_automations）：真实可用却不在清单里。
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
    # Skills
    {"name": "manage_skill", "label": "Manage Skill", "description": "管理技能包", "category": "skills", "builtin": True},
    # LEARN-GHOST-001：learn 已移除宣告——OMP 注册门控要求 memory.backend ∈
    # {hindsight, mnemopi, local}，而 sidecar 钉死 "off"（compiled 不含
    # fastembed/onnxruntime），该工具运行时永不注册，宣告与事实不符。
    # ── Maxma 自定义工具（真实可用，sidecar customTools 全量注册）──
    {"name": "remember_memory", "label": "Remember Memory", "description": "记住一条长期记忆（用户明确要求时）", "category": "memory", "builtin": True, "source": "custom"},
    {"name": "search_memories", "label": "Search Memories", "description": "检索长期记忆", "category": "memory", "builtin": True, "source": "custom"},
    {"name": "get_sticker", "label": "Get Sticker", "description": "获取内置贴纸", "category": "fun", "builtin": True, "source": "custom"},
    {"name": "list_rules", "label": "List Rules", "description": "查询质量规则", "category": "system", "builtin": True, "source": "custom"},
    {"name": "list_automations", "label": "List Automations", "description": "查询自动化任务", "category": "system", "builtin": True, "source": "custom"},
]

@router.get("/tools")
async def list_tools():
    return _BUILTIN_TOOLS
