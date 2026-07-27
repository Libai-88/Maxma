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
 * 工具注册表：OMP 原生工具名 → 专属气泡组件
 *
 * 覆盖全部 31 个 OMP 内置工具（BUILTIN_TOOL_NAMES）：
 *   read, bash, launch, edit, ast_grep, ast_edit, ask, debug, eval,
 *   ssh, github, glob, grep, lsp, inspect_image, browser, checkpoint,
 *   rewind, task, job, irc, todo, web_search, search_tool_bm25, write,
 *   memory_edit, retain, recall, reflect, learn, manage_skill
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

  /* memory 系列 */
  'memory_edit': MemoryBubble,
  'retain': MemoryBubble,
  'recall': MemoryBubble,
  'reflect': MemoryBubble,

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
  return registry[name] ?? null
}

export function getRegisteredTools(): string[] {
  return Object.keys(registry)
}
