/**
 * kernel/extension-template.ts — 新建用户扩展的脚手架（单一真源）。
 *
 * 为什么要有这个文件：pi 的扩展机制本身很完整，但"从零写一个"要同时知道
 * 目录位置、默认导出形状、defineTool/TypeBox 的用法、注册命令的签名、以及
 * 改完怎么让 Maxma 重新探测。这些散在 pi 的 README 与我们的多处代码里，
 * 结果就是新插件开发只能靠猜。
 *
 * 这里只做两件事：名字合法性校验 + 渲染出可直接运行的 index.ts/README。
 * 三个消费方共用同一份文本，避免"文档一个样、生成器另一个样"：
 *   - `scripts/new-extension.mjs`（仓库内开发者）
 *   - `POST /api/extensions/scaffold`（便携包用户，没有仓库也能用）
 *   - `tests/extension-template.test.ts`（渲染结果真的能加载并注册工具）
 */

/** 扩展目录名：小写字母开头，只允许 a-z0-9 与连字符，2–32 字符。 */
const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function isValidExtensionName(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length >= 2 && raw.length <= 32 && NAME_RE.test(raw);
}

/** 由目录名派生一个合法的工具名（LLM 侧工具名只认 snake_case）。 */
export function toolNameFor(name: string): string {
  return `${name.replace(/-/g, "_")}_hello`;
}

export interface ExtensionTemplateOptions {
  name: string;
  /** 目标目录（展示在文件头注释里，方便用户回头找）。 */
  dir?: string;
}

/** 渲染 `index.ts`。生成的是**能跑**的扩展：注册一个工具 + 一个斜杠命令。 */
export function renderExtensionIndex({ name, dir }: ExtensionTemplateOptions): string {
  const tool = toolNameFor(name);
  const where = dir ?? `<扩展目录>/${name}`;
  return `/**
 * Maxma 用户扩展：${name}
 *
 * 位置：${where}/index.ts
 * 加载：pi 在**下一次新建会话**时读取它；改完在 Maxma 里点
 *       「扩展 → 重新探测」即可看到加载结果与错误。
 *
 * 约定：本文件必须 default 导出一个函数 (pi) => void，
 *       工具/命令/事件钩子都在函数体里注册。
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function ${name.replace(/-/g, "_")}Extension(pi: ExtensionAPI): void {
  // ① 注册一个工具：模型能看到 name / description / parameters。
  //    换成你自己的能力时，保留 execute 的返回形状即可：
  //    { content: [{ type: "text", text }], details }。
  pi.registerTool(
    defineTool({
      name: "${tool}",
      label: "${name} 示例工具",
      description: "返回一句问候。用来确认扩展已被 pi 加载；可以替换成你自己的工具。",
      parameters: Type.Object({
        who: Type.Optional(Type.String({ description: "要问候的对象，默认 world" })),
      }),
      async execute(_toolCallId, params) {
        const who = (params.who ?? "").trim() || "world";
        return {
          content: [{ type: "text", text: "Hello, " + who + " —— 来自 ${name} 扩展。" }],
          details: { who },
        };
      },
    }),
  );

  // ② 注册一个斜杠命令：输入框里打 /${name} 触发。
  pi.registerCommand("${name}", {
    description: "确认 ${name} 扩展已加载",
    handler: async (_args, ctx) => {
      ctx.ui.notify("${name} 扩展已加载（目录见「扩展」页）", "info");
    },
  });

  // ③ 想拦截工具调用时，用事件钩子（示例，按需打开）：
  //
  //   pi.on("tool_call", async (event) => {
  //     if (event.toolName === "bash" && String(event.input?.command ?? "").includes("rm -rf")) {
  //       return { block: true, reason: "拒绝递归删除" };
  //     }
  //     return undefined;
  //   });
}
`;
}

/** 渲染同目录的 README.md（三步上手，避免"生成完不知道下一步"）。 */
export function renderExtensionReadme({ name }: ExtensionTemplateOptions): string {
  const tool = toolNameFor(name);
  return `# ${name}

Maxma 用户扩展。由内置脚手架生成，可直接运行。

## 三步上手

1. 改 \`index.ts\`：
   - 工具在 \`pi.registerTool(defineTool({ ... }))\` 里，参数用 TypeBox 的 \`Type.Object\`；
   - 命令在 \`pi.registerCommand("${name}", { handler })\` 里。
2. 在 Maxma「扩展」页点 **重新探测**，确认本扩展处于「已启用」且没有加载错误。
3. 新建一个对话，让模型调用 \`${tool}\`；或直接输入 \`/${name}\` 触发命令。

## 边界

- 扩展与当前会话同权限运行，只放你信任的代码。
- 禁用是「不参与新会话」，不是沙箱：模块顶层代码在加载期仍会被 import。
- 目录位于 pi 的 \`extensions/\` 下，升级 Maxma 不会动它。
`;
}

export interface ExtensionScaffoldFiles {
  index: string;
  readme: string;
}

export function renderExtensionScaffold(options: ExtensionTemplateOptions): ExtensionScaffoldFiles {
  if (!isValidExtensionName(options.name)) throw new Error(`扩展名不合法：${String(options.name)}`);
  return {
    index: renderExtensionIndex(options),
    readme: renderExtensionReadme(options),
  };
}
