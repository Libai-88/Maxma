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

/**
 * 工具输出内容块：**可判别联合**，不是"一个 type 字段取两个值 + 一堆可选字段"。
 *
 * 旧的摊平写法 `{ type: "text" | "image"; text?; data?; mimeType? }` 结构上比引擎
 * 要求的 `TextContent | ImageContent` 宽——它能构造出 `{type:"text", data:...}`
 * 这种引擎不认的对象，所以 `tsc` 报 `'"text" | "image"' is not assignable to '"image"'`。
 * 该报错是真实的形状缺陷，不是噪音；收紧后所有工具体（只产出 text 块）依旧成立。
 * 本文件保持零引擎依赖：这里声明的是 Maxma 自己的形状，与引擎结构等价即可。
 */
export type MaxmaToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** 工具执行结果（OMP/pi 共同形状：模型可见 content + UI/日志用 details）。 */
export interface MaxmaToolResult {
  content: MaxmaToolContent[];
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
