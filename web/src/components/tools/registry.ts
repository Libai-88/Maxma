import { defineAsyncComponent, type Component } from 'vue'

type BubbleLoader = () => Promise<{ default: Component }>

function lazyBubble(loader: BubbleLoader): Component {
  return defineAsyncComponent({
    loader,
    suspensible: false,
  })
}

const PythonBubble = lazyBubble(() => import('./PythonBubble.vue'))
const FilesBubble = lazyBubble(() => import('./FilesBubble.vue'))
const FileEditBubble = lazyBubble(() => import('./FileEditBubble.vue'))
const ImageBubble = lazyBubble(() => import('./ImageBubble.vue'))
const AskUserBubble = lazyBubble(() => import('./AskUserBubble.vue'))
const MemoryBubble = lazyBubble(() => import('./MemoryBubble.vue'))
const BrowserBubble = lazyBubble(() => import('./BrowserBubble.vue'))
const SearchBubble = lazyBubble(() => import('./SearchBubble.vue'))
const TodoBubble = lazyBubble(() => import('./TodoBubble.vue'))
const GenericOutputBubble = lazyBubble(() => import('./GenericOutputBubble.vue'))

/**
 * 工具注册表：工具名 → 专属气泡组件。
 *
 * 名字来源分三层，本表同时服务这三层（缺一层就会掉气泡，见下）：
 *
 * 1. **当前引擎（pi，@earendil-works/pi-coding-agent 0.99.0）内置工具** —— 7 个，
 *    取自 `bun-sidecar/src/kernel/pi-session.ts:35` 的 `MAXMA_DEFAULT_PI_TOOLS`：
 *      read, bash, edit, write, grep, find, ls
 *    （pi 包本身还支持第 8 个 `powershell`，Maxma 默认未启用，见同文件 allToolNames。）
 *
 * 2. **Maxma 自定义工具** —— 6 个注册给 pi 的 customTools（`bun-sidecar/src/tools/*.ts`）
 *    加 1 个计划工具（`bun-sidecar/src/kernel/plan.ts:84`）：
 *      remember_memory, search_memories, get_sticker, list_rules,
 *      read_office_file, write_office_file, submit_plan
 *
 * 3. **上一代引擎（OMP）专有工具名 + MCP 可能同名工具** —— 本表保留了大量 OMP 时代的条目。
 *    其中 lsp/debug/inspect_image/ask/browser/github/web_search/todo/eval/glob 等名字
 *    同样可能被用户配置的 MCP 服务器（api/data/mcp_servers.yaml）暴露，删除映射会让
 *    今天显示正常的气泡退化成通用卡片 —— 那是功能回归，故一律保留。
 *
 * 未在本表登记的工具名 → getBubbleComponent 返回 null → ToolBubbleRouter 落回
 * ToolCallCard 通用卡片（标题仍能用 displayNames 显示中文，但版式为兜底卡）。
 */
const registry: Record<string, Component> = {
  // === 专用气泡 ===

  /* eval (Python 执行) */
  'eval': PythonBubble,

  /* read/write/glob/grep (文件操作) */
  'read': FilesBubble,
  'write': FilesBubble,
  'glob': FilesBubble,
  'grep': FilesBubble,

  /* edit (文件编辑) — diff 视图 */
  'edit': FileEditBubble,

  /* inspect_image (图片分析) */
  'inspect_image': ImageBubble,

  /* ask (询问用户) */
  'ask': AskUserBubble,

  /* memory 系列 — memory_edit/retain/recall/reflect 为上一代引擎（OMP）专有，
   * pi 引擎下不产生；保留是为兼容 MCP 同名工具与历史转录回放。
   * Maxma 的对应物是下面两个自定义工具。 */
  'memory_edit': MemoryBubble,
  'retain': MemoryBubble,
  'recall': MemoryBubble,
  'reflect': MemoryBubble,

  /* Maxma 自定义记忆工具（bun-sidecar/src/tools/remember-memory.ts、memory.ts）。
   * 复用 MemoryBubble：其 toolData 无 items/message 时降级为直接展示 output 文本，
   * 与这两个工具的纯文本返回形态相符。 */
  'remember_memory': MemoryBubble,
  'search_memories': MemoryBubble,

  /* browser (网页浏览) */
  'browser': BrowserBubble,

  /* web_search / search_tool_bm25 (搜索) */
  'web_search': SearchBubble,
  'search_tool_bm25': SearchBubble,

  /* todo (待办管理) */
  'todo': TodoBubble,

  // === 通用输出气泡 ===
  /* 这些工具以文本/JSON 输出为主，GenericOutputBubble 提供代码块渲染 */

  'bash': GenericOutputBubble,
  /* pi 内置的文件查找/目录列举：pi 的 find/ls 只回传 truncation 类 details，
   * 没有 FilesBubble 依赖的 operation 字段，故走文本渲染而非文件卡片。 */
  'find': GenericOutputBubble,
  'ls': GenericOutputBubble,

  /* Maxma 自定义工具（bun-sidecar/src/tools/*.ts、kernel/plan.ts） */
  'get_sticker': GenericOutputBubble,
  'list_rules': GenericOutputBubble,
  'read_office_file': GenericOutputBubble,
  'write_office_file': GenericOutputBubble,
  /* submit_plan 的审批 UI 走独立 PlanCard（plan_proposed 事件）；
   * 本条只负责把这次工具调用本身渲染成文本气泡，而非兜底卡片。 */
  'submit_plan': GenericOutputBubble,

  /* ↓ 以下条目源自上一代引擎（OMP）：pi 引擎下不产生这些工具名；
   *   保留映射是为兼容 MCP 同名工具（api/data/mcp_servers.yaml 由用户自配，
   *   工具名不受 Maxma 控制）与历史会话转录的回放，勿当作死代码删除。 */
  'launch': GenericOutputBubble,
  'ssh': GenericOutputBubble,
  'github': GenericOutputBubble,
  'lsp': GenericOutputBubble,
  'debug': GenericOutputBubble,
  'ast_grep': GenericOutputBubble,
  'ast_edit': GenericOutputBubble,
  'task': GenericOutputBubble,
  'job': GenericOutputBubble,
  'learn': GenericOutputBubble,
  'manage_skill': GenericOutputBubble,
  'checkpoint': GenericOutputBubble,
  'rewind': GenericOutputBubble,
  'irc': GenericOutputBubble,
  'resolve': GenericOutputBubble,
  'yield': GenericOutputBubble,
}

export function getBubbleComponent(name: string): Component | null {
  // 必须按**自有属性**判定：registry 是对象字面量，旧写法 `registry[name] ?? null`
  // 会命中 Object.prototype 上的继承键——MCP 服务器只要暴露名为 constructor / toString /
  // valueOf / __proto__ 的工具，组件位就会被塞进一个原型函数而不是合法组件
  // （defineAsyncComponent 位置上的 Object 函数会被 Vue 当组件渲染）。
  // tsconfig target/lib = ES2022，Object.hasOwn 可用。
  return Object.hasOwn(registry, name) ? registry[name] : null
}

export function getRegisteredTools(): string[] {
  return Object.keys(registry)
}
