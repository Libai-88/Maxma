# Google / Outlook 日历 MCP（只读配方）

用于读取会议、空闲时间和日程冲突。v1 只读；创建/修改/取消日程必须走用户审批，
默认不开放写工具。

## 目标边界

- 只读：列日历、查某天/某周事件、读事件详情、查空闲时间。
- 写：`create_event`、`update_event`、`delete_event`、`respond` 默认列入
  `blocked_tools`，不因为“顺手”自动接受邀请。
- 时区必须显式：日历事件与 Cowork 定时任务都使用 IANA 时区（如 `Asia/Shanghai`），
  不靠服务器本地时区猜。

## 配置步骤

1. 按所选日历 MCP 服务完成 OAuth，只授予 `calendar.readonly`。
2. 在 Maxma「扩展管理 → MCP」新增服务器：

```json
{
  "server_id": "calendar-readonly",
  "transport": "stdio",
  "command": "<Google 或 Outlook 日历 MCP 启动命令>",
  "args": ["<启动参数>"],
  "env": {
    "GOOGLE_OAUTH_CREDENTIALS": "<本机凭据文件路径>"
  },
  "allowed_tools": ["list_calendars", "list_events", "get_event", "find_free_slots"],
  "blocked_tools": ["create_event", "update_event", "delete_event", "respond"],
  "description": "日历只读资料"
}
```

3. 在 Cowork 项目设置里确认连接器状态；未配置时显示「未连接」。

## 验收

- 能列出本周事件并读到 start/end/timezone。
- 创建/修改/取消被拒绝。
- 周报任务只引用日历事实，不擅自替用户接受会议邀请。
