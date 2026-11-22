# Gmail / Outlook 邮件 MCP（只读配方）

适用于已有的 Google Workspace 或 Microsoft 365 账号。Maxma 不保存 OAuth 令牌；
令牌由对应 MCP 进程管理，Maxma 只登记服务器与工具白名单。

## 目标边界

- 只读：搜索邮件、读取邮件正文与附件列表、列线程。
- 不提供发送、删除、归档、移动邮件；`send`/`delete`/`trash` 必须在 `blocked_tools` 中。
- 附件下载到任务 staging 前，先检查文件类型与大小，不执行宏或脚本。

## 配置步骤

1. 按所选邮件 MCP 服务的说明完成 OAuth（通常在本机浏览器点一次授权）。
2. 在 Maxma「扩展管理 → MCP」新增服务器。`POST /api/mcp/servers` 的形状：

```json
{
  "server_id": "mail-readonly",
  "transport": "stdio",
  "command": "<Gmail 或 Outlook MCP 启动命令>",
  "args": ["<启动参数>"],
  "env": {
    "GOOGLE_OAUTH_CREDENTIALS": "<本机凭据文件路径>"
  },
  "allowed_tools": ["search", "read", "list_threads", "get_attachment_meta"],
  "blocked_tools": ["send", "delete", "trash", "modify_labels", "move"],
  "description": "邮件只读资料"
}
```

3. Outlook 版本把 `GOOGLE_OAUTH_CREDENTIALS` 换成对应服务的凭据变量；不要同时启用两套写工具。
4. 在 Cowork「项目 → 设置 → 连接器」确认「MCP 服务器」显示已连接。

## 验收

- 能按发件人/日期/关键词搜索并读取一封邮件。
- 发送与删除工具被拒绝。
- 摘录邮件内容到产物时保留发件人、日期与 subject，注明“来自邮件”。
