/** client → server 消息类型白名单（api/ws_protocol.py WsMessageType）。 */
export const CLIENT_MESSAGE_TYPES = new Set([
  "ping",
  "chat",
  "cancel",
  "user_response",
  // EXT-UI-001：扩展对话框应答（select/confirm/input/editor）
  "extension_ui_response",
  "plan_response",
  "update_auto_approve",
  "set_plan_mode",
  "checkpoint_action",
  "goal_action",
  "artifact_action",
  "task_brief_answer",
  "task_brief_execute",
  "task_brief_cancel",
  "steer",
  "follow_up",
  "task_review",
  // 前端执行完画布命令后的回执（配合 kernel 的 canvas_command）
  "canvas_agent_result",
]);
