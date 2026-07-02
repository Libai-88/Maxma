# 测试清单

## Event Hooks

- 自动测试：`pytest tests/test_agent/test_hooks.py tests/test_api/test_event_hook_callback.py`
- 手动验证：在已配置 LLM Provider 的环境中创建 webhook hook，调用 `/api/event-hooks/{hook_id}/trigger` 后确认 `/api/event-hooks/history` 出现 `success` 或真实错误。
- 手动验证：未配置 LLM Provider 时触发 hook，确认历史状态为 `unsupported`，不再出现静默 skipped。

## Interaction Tools

- 自动测试：`pytest tests/test_web/test_tool_registry_ts.py`
- 手动验证：触发 `ask_user_confirm` 工具时，前端显示危险操作确认输入框，并且只有输入 `确认` 才能提交。
