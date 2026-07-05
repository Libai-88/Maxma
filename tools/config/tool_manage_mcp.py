"""Tool: manage_mcp — 通过自然语言管理 MCP 服务器配置。"""

import yaml
from pydantic import BaseModel, Field

from app_paths import MCP_CONFIG_PATH
from api.yaml_store import dump_yaml_atomic
from tools.base import ToolBase, format_error, format_success, register_tool
from tools.mcp_security import validate_stdio_command


class ManageMCPInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    action: str = Field(
        default="list",
        description="操作类型: list（列出所有服务器）、add（添加）、remove（删除）、enable（启用）、disable（停用）",
    )
    server_id: str = Field(default="", description="服务器 ID（add/remove/enable/disable 时必填）")
    transport: str = Field(default="stdio", description="传输方式: stdio / sse / streamable_http / websocket")
    description: str = Field(default="", description="服务器描述")
    command: str = Field(default="", description="stdio 模式的命令（如 npx, python, node）")
    args: str = Field(default="", description="命令参数，用 | 分隔（如 -y|@modelcontextprotocol/server-filesystem|D:/）")
    url: str = Field(default="", description="URL（sse/streamable_http/websocket 模式必填）")
    enabled: bool = Field(default=True, description="是否启用")


def _load_raw() -> list[dict]:
    if not MCP_CONFIG_PATH.exists():
        return []
    with open(MCP_CONFIG_PATH, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return raw.get("mcp_servers", []) or []


def _save_raw(servers: list[dict]) -> None:
    dump_yaml_atomic(MCP_CONFIG_PATH, {"mcp_servers": servers})


def _trigger_reload():
    """触发 MCP 热重载。"""
    from tools.mcp import trigger_reload
    trigger_reload()


@register_tool
class ManageMCPTool(ToolBase):
    name: str = "manage_mcp"
    description: str = (
        "管理 MCP 服务器配置：列出、添加、删除、启用、停用 MCP 服务器。"
        "修改后自动热重载，新工具立即可用。"
        "[调用积极性: 当用户要求添加/配置/管理外部工具或服务时主动调用]"
    )
    args_schema: type[BaseModel] = ManageMCPInput

    def _run(
        self,
        get_doc: bool = False,
        action: str = "list",
        server_id: str = "",
        transport: str = "stdio",
        description: str = "",
        command: str = "",
        args: str = "",
        url: str = "",
        enabled: bool = True,
    ) -> str:
        if get_doc:
            return self._load_doc()

        action = action.strip().lower()

        if action == "list":
            servers = _load_raw()
            if not servers:
                return format_success({"message": "当前没有配置任何 MCP 服务器", "servers": []})
            summary = []
            for s in servers:
                info = f"- {s.get('server_id', '?')} [{s.get('transport', '?')}] {'✓' if s.get('enabled', True) else '✗'}"
                desc = s.get("description", "")
                if desc:
                    info += f" {desc}"
                summary.append(info)
            return format_success({
                "message": f"共 {len(servers)} 个 MCP 服务器",
                "servers": servers,
                "summary": "\n".join(summary),
            })

        if action == "add":
            if not server_id:
                return format_error("server_id 不能为空")
            servers = _load_raw()
            # 检查重复
            for s in servers:
                if s.get("server_id") == server_id:
                    return format_error(f"服务器 '{server_id}' 已存在，请先删除旧的或换一个名字")

            t = transport.strip().lower()
            d: dict = {
                "server_id": server_id,
                "transport": t,
                "enabled": enabled,
                "description": description,
            }

            if t == "stdio":
                if not command:
                    return format_error("stdio 模式必须指定 command（如 npx, python）")
                error = validate_stdio_command(command)
                if error:
                    return format_error(error)
                d["command"] = command
                if args:
                    d["args"] = [a.strip() for a in args.split("|") if a.strip()]
            elif t in ("sse", "streamable_http", "websocket"):
                if not url:
                    return format_error(f"{t} 模式必须指定 url")
                d["url"] = url
            else:
                return format_error(f"不支持的 transport: {t}，仅支持 stdio/sse/streamable_http/websocket")

            servers.append(d)
            _save_raw(servers)
            _trigger_reload()
            return format_success({
                "message": f"已添加 MCP 服务器 '{server_id}'（{t}），已触发热重载",
                "server_id": server_id,
                "transport": t,
            })

        if action == "remove":
            if not server_id:
                return format_error("server_id 不能为空")
            servers = _load_raw()
            new_servers = [s for s in servers if s.get("server_id") != server_id]
            if len(new_servers) == len(servers):
                return format_error(f"服务器 '{server_id}' 不存在")
            _save_raw(new_servers)
            _trigger_reload()
            return format_success({
                "message": f"已删除 MCP 服务器 '{server_id}'，已触发热重载",
                "removed": server_id,
            })

        if action in ("enable", "disable"):
            if not server_id:
                return format_error("server_id 不能为空")
            target_enabled = action == "enable"
            servers = _load_raw()
            found = False
            for s in servers:
                if s.get("server_id") == server_id:
                    s["enabled"] = target_enabled
                    found = True
                    break
            if not found:
                return format_error(f"服务器 '{server_id}' 不存在")
            _save_raw(servers)
            _trigger_reload()
            state = "启用" if target_enabled else "停用"
            return format_success({
                "message": f"已{state} MCP 服务器 '{server_id}'，已触发热重载",
                "server_id": server_id,
                "enabled": target_enabled,
            })

        return format_error(f"未知操作: {action}，支持 list/add/remove/enable/disable")
