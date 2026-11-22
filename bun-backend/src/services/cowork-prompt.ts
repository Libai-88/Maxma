/**
 * Cowork 任务提示词。只描述任务层约束，不重写现有 Chat/Workbench/Code 人格。
 */

import type { CoworkTask } from "./cowork-store";

function parseInputs(task: CoworkTask): Record<string, unknown> {
  try {
    const parsed = JSON.parse(task.inputs_json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function buildProjectSection(task: CoworkTask): string {
  const inputs = parseInputs(task);
  const project = inputs.project && typeof inputs.project === "object" && !Array.isArray(inputs.project)
    ? inputs.project as Record<string, unknown>
    : null;
  const assets = Array.isArray(inputs.assets) ? inputs.assets : [];
  const lines: string[] = [];
  if (project) {
    const title = typeof project.title === "string" ? project.title : "";
    const instructions = typeof project.instructions === "string" ? project.instructions.trim() : "";
    const templates = Array.isArray(project.templates) ? project.templates.map(String).filter(Boolean) : [];
    lines.push("## 项目上下文");
    if (title) lines.push(`- 项目：${title}`);
    if (instructions) lines.push(`- 项目指令（必须遵守）：\n${instructions}`);
    if (templates.length > 0) lines.push(`- 默认模板：${templates.join("、")}`);
  }
  if (assets.length > 0) {
    const paths = assets.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const path = (item as Record<string, unknown>).path;
      const label = (item as Record<string, unknown>).label;
      return typeof path === "string" ? [`- ${typeof label === "string" ? label : path}：${path}`] : [];
    });
    if (paths.length > 0) {
      lines.push("## 项目输入资产（只读）");
      lines.push(...paths.slice(0, 50));
    }
  }
  return lines.length > 0 ? `\n${lines.join("\n")}\n` : "";
}

export function buildCoworkPrompt(task: CoworkTask, opts: { resume?: boolean; checkpoint?: string } = {}): string {
  const resumeLine = opts.resume
    ? `\n这是恢复执行。已有步骤和产物会保留；已完成步骤不要重复，先读取任务步骤与 staging 目录里的现有文件。\n`
    : "\n";

  return `你是 Maxma 的 Cowork 任务执行器。用户已经给出目标、工作区和 staging 目录。

## 任务
- 标题：${task.title}
- 目标：${task.objective}
${buildProjectSection(task)}
## 路径边界（硬约束）
- 源工作区：${task.workspace_root}
  - 只读。你可以读取用户资料，但绝对不要写、覆盖、删除源工作区里的任何文件。
  - 需要修改源文件时，先说明原因并等待用户在任务审批里确认；不要用 write/edit/write_office_file/edit_office_file 直接改源文件。
- staging 输出目录：${task.staging_root}
  - 所有新产物只能写到这个目录下；写文件时传绝对路径（例如 ${task.staging_root}\\report.docx）。
  - 不要把聊天回复当成交付物；交付物必须是 staging 里真实存在的文件。

## 工作方式
1. 第一轮只做计划：调用 submit_plan 提交 3–8 步计划，计划里写清每步的输入、产物文件名和验收方式。计划没被批准前不要写产物。
2. 计划批准后按步骤执行。每完成/开始/失败一步，调用 cowork_update_steps 更新该步状态；不要把未执行的步骤标成 completed。
3. 优先复用工作区里的资料；没有依据的内容明确标注“需用户补充”，不要编造事实。
4. 输出格式优先用可编辑文件：
   - Word：write_office_file，扩展名 .docx，content 为结构化 Markdown 文本。
   - Excel：write_office_file，扩展名 .xlsx，rows 为二维数组；可用 sheets。
   - PPTX：write_office_file，扩展名 .pptx。优先传 slides：[{title, subtitle?, bullets?, body?}]，第一张是封面，其余是标题+正文；也可以用 content 传 Markdown（# 封面，## 分页，- 要点）。生成的是原生可编辑文本框，不是图片。
   - Markdown/CSV/TXT：write_office_file 或 write。
5. 需要迭代已有 Office 产物时，先用 read_office_file 读回真实内容（PPTX 会按页返回文本）；不要凭记忆猜文件内容。
   - 只改用户选中的段落/幻灯片文本/单元格时，用 edit_office_file 精确替换（DOCX/PPTX 传唯一 find + replace，XLSX 传 sheet/cell/value），保留其余内容和版式。
   - 需要整体改写时才用 write_office_file，并显式传 overwrite=true；每次覆盖都会生成新版本，旧版本字节会保留。
6. 最后用简短文字列出产物绝对路径、每份产物的用途和未完成项。用户会在任务详情里验收。

## 安全
- 不运行 bash/powershell；本会话不提供这些工具。
- 不读取与任务无关的凭据、密钥、浏览器配置。
- 拒绝把源工作区路径当作输出路径。${resumeLine}`;
}

export function buildCoworkResumePrompt(task: CoworkTask, steps: string[], checkpoint: string): string {
  const stepText = steps.length > 0 ? steps.map((step, index) => `${index + 1}. ${step}`).join("\n") : "（没有可读步骤）";
  return `继续执行任务「${task.title}」。

已完成/已有步骤：
${stepText}

上次 checkpoint：
${checkpoint || "{}"}

要求：
- 先读取 staging 里已有产物，避免重复生成或覆盖未确认版本。
- 已完成的步骤不要重做；从第一个未完成步骤继续。
- 如果状态不确定，先调用 cowork_update_steps 把真实状态标清楚，再继续。
- 仍然遵守源工作区只读、产物只写 staging 的边界。`;
}
