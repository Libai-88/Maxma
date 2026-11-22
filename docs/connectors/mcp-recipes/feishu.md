# 飞书 / Lark MCP（只读配方）

适用于已有飞书企业自建应用凭证，或使用组织提供的 MCP 服务。Maxma 不做原生 OAuth；
本配方只登记 MCP 服务器，不替用户申请权限。

## 目标边界

- 只读：文档搜索/读取、消息读取、日历读取。
- 写入（发消息、建文档、改日历）默认不允许；如确需，必须在 Maxma 审批里逐次确认。
- 令牌只放 MCP 进程环境变量，不写进 Cowork 项目文件或任务输入。

## 配置步骤

1. 在飞书开放平台创建企业自建应用，开通所需只读权限，发布并等待管理员审核。
2. 在 Maxma「扩展管理 → MCP」新增 stdio 或 streamable_http 服务器。以下字段名与
   `POST /api/mcp/servers` 一致：

```json
{
  "server_id": "feishu-readonly",
  "transport": "stdio",
  "command": "<你的飞书 MCP 启动命令>",
  "args": ["<启动参数>"],
  "env": {
    "FEISHU_APP_ID": "<app id>",
    "FEISHU_APP_SECRET": "<app secret>"
  },
  "allowed_tools": ["<只读工具名，例如 docx_search / docx_read / im_read>"],
  "blocked_tools": ["<发送消息、创建文档、删除等写工具>"],
  "description": "飞书只读资料"
}
```

3. 保存后到 Cowork「项目 → 设置 → 连接器」确认状态为「已连接」；未配置时必须显示
   「未连接」，不能显示成可用能力。
4. 在任务里引用飞书资料时，让 Agent 先搜索、再按 message/doc id 读取；把来源写进产物，
   不要凭记忆编造内容。

## 验收

- 只读工具可列出最近文档/消息。
- `allowed_tools` 生效，写工具调用被拒绝或要求审批。
- 断开配置后连接器状态立即回到「未连接」。
