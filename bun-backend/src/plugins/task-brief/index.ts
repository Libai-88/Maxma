import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type TaskBriefRisk = "low" | "medium" | "high";

export type TaskBriefResult =
  | { status: "clarify"; summary: string; questions: string[]; missing: string[]; confidence: number; riskLevel: TaskBriefRisk }
  | { status: "ready"; summary: string; executionPrompt: string; assumptions: string[]; confidence: number; riskLevel: TaskBriefRisk };

export interface TaskBriefInput {
  originalRequest: string;
  answers: string[];
}

const SYSTEM_PROMPT = `你是 Maxma 的需求澄清插件。你的工作仅限于理解用户请求、询问影响执行的关键信息，并在对齐后编写真正交给执行 Agent 的任务指令。你没有工具权限，不执行任务。

规则：
- 不要追问已明确的信息、无关身份或动机；只有缺失信息会实质改变结果、范围或风险时才提问。
- 一轮最多提出 3 个问题，按“目标 / 范围与对象 / 约束与验收”优先级选择。每个问题必须能直接填写，避免“请详细描述”“还有什么要求”这类泛问。
- 每个问题都要说明缺失信息会影响什么，并在括号中给出 2—4 个可选值或具体示例；例如“希望输出成什么形式（表格、清单、邮件或代码）？”。
- 对购买、发送、删除等有外部影响或难以撤销的行动，必须澄清关键目标、对象、范围、预算/时间和确认条件。
- 仅根据用户提供的内容和明确标注的假设撰写执行指令。不要编造事实、文件内容、偏好或承诺。
- 对话达到足以执行的颗粒度后，输出精炼、可执行的任务指令，包含目标、范围、约束、验收标准与交付形式中适用的部分。保留用户原始意图，不添加未经确认的工作。
- 必须只返回一个 JSON 对象，不使用 Markdown 代码围栏。confidence 是 0 到 1 的主观执行准备度；risk_level 只能是 low、medium、high。格式：
  提问时：{"status":"clarify","summary":"对需求的简短理解","questions":["问题"],"missing":["缺失信息及其影响"],"confidence":0.45,"risk_level":"medium"}
  准备执行时：{"status":"ready","summary":"已对齐的任务摘要","executionPrompt":"交给执行 Agent 的完整指令","assumptions":["用户明确允许的默认假设"],"confidence":0.9,"risk_level":"low"}`;

function responseText(content: Array<{ type: string; text?: string }>): string {
  return content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("").trim();
}

function parseResult(raw: string): TaskBriefResult {
  const normalized = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(normalized) as Record<string, unknown>;
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 1200) : "";
  const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.5;
  const riskLevel: TaskBriefRisk = parsed.risk_level === "high" || parsed.risk_level === "medium" ? parsed.risk_level : "low";
  if (parsed.status === "clarify") {
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, 3)
      : [];
    const missing = Array.isArray(parsed.missing)
      ? parsed.missing.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, 5)
      : [];
    if (questions.length > 0) return { status: "clarify", summary, questions, missing, confidence, riskLevel };
  }
  if (parsed.status === "ready" && typeof parsed.executionPrompt === "string" && parsed.executionPrompt.trim()) {
    const assumptions = Array.isArray(parsed.assumptions)
      ? parsed.assumptions.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, 8)
      : [];
    return { status: "ready", summary, executionPrompt: parsed.executionPrompt.trim().slice(0, 20_000), assumptions, confidence, riskLevel };
  }
  throw new Error("需求澄清模型返回了无效结构");
}

export async function createTaskBrief(
  input: TaskBriefInput,
  model: Model<Api>,
  runtime: Pick<ModelRuntime, "completeSimple">,
): Promise<TaskBriefResult> {
  const request = [
    `用户原始请求：\n${input.originalRequest.slice(0, 12_000)}`,
    ...(input.answers.length ? [`用户补充信息：\n${input.answers.map((answer, index) => `${index + 1}. ${answer.slice(0, 4000)}`).join("\n")}`] : []),
  ].join("\n\n");
  const response = await runtime.completeSimple(
    model,
    { systemPrompt: SYSTEM_PROMPT, messages: [{ role: "user", content: request, timestamp: Date.now() }] },
    { temperature: 0.2, maxTokens: 1200 },
  );
  const raw = responseText(response.content);
  if (!raw) throw new Error("需求澄清模型没有返回内容");
  return parseResult(raw);
}
