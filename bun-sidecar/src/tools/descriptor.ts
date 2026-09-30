/**
 * tools/descriptor.ts — Maxma 自有工具描述符（OMP 依赖解除，§6.3.1）。
 *
 * 工具实现（src/tools/*）只依赖本描述符——零 OMP/pi import。两端各自适配：
 *   - OMP 路径：session-bridge 经 tools/index.ts 的 cast 使用（切换期，cutover 删除）
 *   - pi  路径：kernel/tools.ts → 官方 defineTool（TypeBox parameters + annotations）
 *
 * 字段语义与 OMP/pi 共同交集对齐：
 *   - parameters 为「plain JSON Schema 对象」——Maxma 约定（见 tools/index.ts
 *     rememberSchema 注释：zod v3/v4 混装会泄漏内部字段到请求体）
 *   - approval: "read" | "write" —— pi 侧映射为官方 annotations
 *     （read → readOnlyHint: true；write → readOnlyHint: false）
 */

/** 工具执行结果（OMP/pi 共同形状：模型可见 content + UI/日志用 details）。 */
export interface MaxmaToolResult {
  content: Array<{ type: "text" | "image"; text?: string; data?: string; mimeType?: string }>;
  details?: unknown;
}

export interface MaxmaToolDescriptor {
  /** 工具名（LLM 调用标识）。 */
  name: string;
  /** 人类可读标签（UI 展示）。 */
  label: string;
  /** LLM 描述。 */
  description: string;
  /** 参数 schema：plain JSON Schema 对象（Maxma 约定，见上）。 */
  parameters: Record<string, unknown>;
  /** 审批倾向：read（只读）/ write（有写入副作用）。 */
  approval: "read" | "write";
  /** 执行体。返回 Promise<MaxmaToolResult>。 */
  execute(toolCallId: string, params: Record<string, unknown>): Promise<MaxmaToolResult>;
}
