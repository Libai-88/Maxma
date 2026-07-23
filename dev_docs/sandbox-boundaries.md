# 沙箱边界

> Maxma 的安全边界由 Python 后端、Bun sidecar、Tauri 进程管理和操作系统共同组成。不要把“sidecar 进程存在”当作完整的文件系统或网络沙箱。

## 文件系统

文件读写必须先经过 Maxma 的路径策略：

- `api/pi_bridge/security_adapter.py` 执行路径解析、白名单和 MaxmaBlocker 检查。
- 空白名单、解析失败、符号链接越界和 blocker 检查异常都按拒绝处理。
- `Path.resolve()` 后的真实路径必须仍位于允许目录内。
- MCP 和 sidecar 工具不能绕过 Maxma 的路径白名单。

具体规则见 [docs/security-contract.md](../docs/security-contract.md) 和 [path-whitelist.md](path-whitelist.md)。

## 工具执行

oh-my-pi 在 Bun sidecar 中执行内置工具和 Maxma TypeScript 工具。权限模式决定是否需要前端审批，但权限模式不能替代：

- 路径安全
- MCP 命令白名单
- Provider URL 校验
- 凭据保护
- 工具自身的参数和超时校验

用户配置的 MCP server 是外部进程或远端服务，接入前必须经过 `api/routes/mcp.py` 的配置校验。stdio 命令只能使用允许的命令集合。

## Python 执行

如果项目启用了 Python 执行能力，执行边界必须以当前工具实现和测试为准；文档不假定其提供完整 OS 隔离。Windows Job Object 主要用于进程生命周期和资源约束，不等同于受限 Token、网络防火墙或 ACL 隔离。

## 桌面进程

Tauri 使用 Windows Job Object 的 `KILL_ON_JOB_CLOSE` 清理后代进程，Python watchdog 作为兜底。该机制解决进程生命周期问题，不扩大 Agent 的文件访问权限。

## 修改要求

安全相关修改必须：

1. 先更新对应契约文档。
2. 保持 fail-closed 行为。
3. 增加或更新路径、权限、MCP 和进程边界测试。
4. 运行相关 Python 测试和桌面/sidecar smoke test。
