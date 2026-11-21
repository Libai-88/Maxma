/** 对话前的行为偏好上下文注入，从 chat-ws 拆出以控制路由文件体量。 */
import { getEvolutionContext, learnFromUserMessage } from "../evolution-ledger";

/** 行为偏好：只在已有请求路径上做确定性规则提炼与按需检索，不额外调用模型。 */
export function enrichWithEvolutionContext(message: string, sessionId: string, turnId: string): string {
  try {
    learnFromUserMessage(message, sessionId, turnId);
    return `${message}${getEvolutionContext(message)}`;
  } catch (error) {
    console.warn(`[evolution] context unavailable: ${String(error)}`);
    return message;
  }
}
