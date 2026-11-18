# 扩展与技能开发

> 面向"想给 Maxma 加一个能力"的人。读完后你应该能：写出一个能被 pi 加载的扩展、
> 在界面上看见它、知道它为什么没加载、以及决定它该不该随包发布。

## 0. 先分清三种"加能力"的方式

| 方式 | 放哪 | 谁能用 | 随包吗 | 适合什么 |
| --- | --- | --- | --- | --- |
| **用户扩展**（pi extension） | `<agentDir>/extensions/<name>/index.ts` | 当前用户 | 否 | 个人工具、团队内部能力、试验中的功能 |
| **Maxma 内联扩展** | `bun-sidecar/src/kernel/extensions/*.ts` | 所有人 | 是 | 安全机制、审批、遥测、必须随包的能力 |
| **Skill** | `<cwd>/.agents/skills/<name>/SKILL.md`、`~/.agents/skills/…`、随包 `.maxma/skills/…` | 当前用户 / 所有人 | 随包的会 | **工作流**（怎么做事），不是代码能力 |

判断顺序：能用提示词和步骤解决 → 写 Skill；需要调用系统、访问网络、拦截工具 → 写扩展；
需要拦截所有人、不能关 → 内联扩展（改动要过安全评审）。

`agentDir` 默认是 `~/.pi/agent`，可用环境变量 `PI_CODING_AGENT_DIR` 覆盖；Maxma 的「扩展」页
会直接显示当前真实路径。

## 1. 五分钟起步

**在 Maxma 界面里**（便携包用户走这条）：

1. 打开「扩展 → 扩展」页，在"新建扩展"里填名字（如 `hello-tools`），点创建。
2. 页面会立刻探测一次：你的扩展出现在列表里，状态「已启用」且没有红色错误。
3. 新建一个对话，让模型调用 `hello_tools_hello`；或输入 `/hello-tools` 触发命令。

**在仓库里**（开发者）：

```bash
bun scripts/new-extension.mjs hello-tools
```

生成器与界面按钮用的是同一份模板（`bun-sidecar/src/kernel/extension-template.ts`），
不会出现"文档一个样、生成物另一个样"。

## 2. 加载规则（为什么"写了但没生效"）

- 扩展在**创建会话时**加载并绑定；改完文件后必须**新建会话**或点「重新探测」。
- 只认 `extensions/` 目录下的文件；子目录可以（`team/tool.ts`），id 是相对路径。
- 每个文件（或目录里的 `index.ts`）**必须 default 导出一个函数**：

```ts
export default function (pi: ExtensionAPI): void { /* 注册工具/命令/钩子 */ }
```

- 导出不是函数、顶层语法错误、依赖缺失，都会在「扩展」页以红色错误显示——**先看那里**，
  不要猜。

## 3. 注册工具

```ts
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "greet",                       // 模型看到的工具名：snake_case
    label: "打招呼",                      // 界面显示
    description: "返回一句问候。",          // 模型据此决定是否调用，写清"什么时候用"
    parameters: Type.Object({
      who: Type.Optional(Type.String({ description: "对象，默认 world" })),
    }),
    async execute(_toolCallId, params) {
      const who = (params.who ?? "").trim() || "world";
      return { content: [{ type: "text", text: `Hello, ${who}` }], details: { who } };
    },
  }));
}
```

要点：

- `parameters` 用 TypeBox（`Type.Object`），**不是** JSON Schema 字面量；可选参数用 `Type.Optional`。
- `execute` 必须返回 `{ content: [{ type: "text", text }], details }`；
  失败要"报错但不抛"时加 `isError: true`（会让模型看到错误结果）。
- `details` 只给界面/日志看，不会进模型上下文；别把大对象塞进 `content`。

## 4. 注册斜杠命令

```ts
pi.registerCommand("hello-tools", {
  description: "确认扩展已加载",
  handler: async (_args, ctx) => {
    ctx.ui.notify("hello-tools 已加载", "info");
  },
});
```

- 命令名会出现在输入框的 `/` 补全里；`handler(args: string, ctx)`，`args` 是命令后的整行。
- `ctx.ui` 提供 `select / confirm / input / notify / setStatus`；Maxma 的 Web 会话里
  `notify` 走的是会话内提示。

## 5. 事件钩子

```ts
pi.on("tool_call", async (event) => {
  if (event.toolName === "bash" && String(event.input?.command ?? "").includes("rm -rf")) {
    return { block: true, reason: "拒绝递归删除" };   // 单次调用被拒，理由回给模型
  }
  return undefined;
});
```

- 返回 `block: true` 只拦这一次调用，不会中断整轮；这是比"跑完再撤销"更安全的时机。
- 常用事件：`session_start`、`tool_call`、`tool_result`、`session_info_changed`。
  完整清单以 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
  的 `ExtensionAPI` 为准（版本升级后先回这里对一眼）。

## 6. 调试与排错

- **扩展页**：`GET /api/extensions` 显示最近一次真实加载结果；红色块是加载失败，
  黄色是警告。`POST /api/extensions/refresh`（按钮「重新探测」）会重新加载一遍，不建会话。
- **工具没出现**：先确认扩展是「已启用」；再看是不是当前会话在扩展写好之前创建的。
- **命令没出现**：确认命令名与目录名不同也不会冲突——命令名由你注册时决定。
- **改了没反应**：pi 有模块缓存，改文件后点「重新探测」会清缓存重载。
- **日志**：后端 stdout（`start.bat` 的窗口 / 便携包的启动控制台）。

常见错误对照：

| 现象 | 多半是 |
| --- | --- |
| `is not a function` / 扩展显示加载失败 | 忘了 `export default function`，或导出成对象 |
| 工具调用报参数校验失败 | `parameters` 写成了 JSON Schema，或必填字段没给默认值 |
| `Cannot find module 'typebox'` | 在仓库外手写文件、没走生成器；用界面创建即可 |
| 界面上看不到扩展 | 文件不在 `extensions/` 下，或后缀不是 `.ts/.js/.mjs` |

## 7. 随包 vs 不随包

- **用户扩展不进包**：便携包升级不会覆盖 `extensions/`，这是有意的（用户代码属于用户）。
- **内联扩展随包**：新增一个内联扩展要同时做四件事：
  1. 在 `bun-sidecar/src/kernel/extensions/` 新建模块；
  2. 在 `kernel/pi-session.ts` 的 `buildExtensionFactories()` 里装配；
  3. 把它加入 `scripts/check-core-coverage.sh` 的 **CORE** 名单（否则覆盖率闸门会判"未分类"）；
  4. 在 `bun-backend/src/routes/extensions.ts` 的 `PROTECTED_BUNDLED` 里登记
     （如果它属于安全机制，必须不可禁用）。
- 内联扩展一旦随包，就对所有用户生效；涉及拦截、审批、遥测时先读
  [security-contract.md](security-contract.md)。

## 8. 安全边界（写进代码也写进界面）

- 扩展以**当前会话的系统权限**运行；只安装你信任的代码。
- 「禁用」是把扩展排除出新会话（不注册 handler/tool），**不是沙箱**：
  模块顶层代码在加载期仍会被 import。
- 内置的审批 / 拒止 / 遥测扩展不可禁用（禁用审批 = 静默关掉审批门）。
- 扩展里不要硬编码密钥；需要凭据时走环境变量或 Maxma 的提供商配置。

## 9. 写一个 Skill（不需要代码）

```
~/.agents/skills/<name>/SKILL.md      # 用户级
<cwd>/.agents/skills/<name>/SKILL.md  # 项目级
.maxma/skills/<name>/SKILL.md         # 随包（改这里要走 PR）
```

```markdown
---
name: <与目录同名>
description: 一句话说清"什么时候用"，模型据此选择技能。
---

# 标题

## 工作方式
1. …
## 边界
- …
```

要求：`name` 与目录名一致；`description` 控制在 60 字内、写"场景"而不是"功能列表"；
正文给**可执行步骤**与**停止条件**，不要写成一篇文章。随包技能还要求：出现在
`build-desktop-portable.ps1` / `build-portable.bat` 的技能清单里，并通过
`bun-backend/tests/builtin-skills.test.ts` 的对账（frontmatter 名字等于目录名、
描述非空且 ≤90 字、至少两个小节、正文 ≥250 字）。新技能建议写到三个小节以上。

## 10. 交付前自查

- [ ] 扩展页显示「已启用」，没有红色错误
- [ ] 工具有 `description`，模型知道何时调用；参数都有说明
- [ ] 命令能触发，且只做一件小事
- [ ] 失败路径有返回（不静默吞错）
- [ ] 用户扩展：没有写死路径、密钥或用户数据
- [ ] 内联扩展：CORE 名单、`PROTECTED_BUNDLED`、测试三处都更新
- [ ] Skill：name/description/小节齐备，已加入两个打包清单
