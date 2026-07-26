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
const GitStatusBubble = lazyBubble(() => import('./GitStatusBubble.vue'))
const GitDiffBubble = lazyBubble(() => import('./GitDiffBubble.vue'))

/**
 * 工具注册表：OMP 原生工具名 → 专属气泡组件
 *
 * 未注册的工具由 ToolCallCard 通用渲染兜底
 * （支持 kv/image/diff/json/markdown/code 六种输出类型自动检测）。
 */
const registry: Record<string, Component> = {
  /* OMP 原生工具 — eval (Python 执行) */
  'eval': PythonBubble,

  /* OMP 原生工具 — read/write/glob/grep (文件操作) */
  'read': FilesBubble,
  'write': FilesBubble,
  'glob': FilesBubble,
  'grep': FilesBubble,

  /* OMP 原生工具 — edit (文件编辑) */
  'edit': FileEditBubble,

  /* OMP 原生工具 — inspect_image (图片分析) */
  'inspect_image': ImageBubble,

  /* OMP 原生工具 — ask (询问用户) */
  'ask': AskUserBubble,

  /* OMP 原生工具 — memory 系列 */
  'memory_edit': MemoryBubble,
  'retain': MemoryBubble,
  'recall': MemoryBubble,
  'reflect': MemoryBubble,
}

export function getBubbleComponent(name: string): Component | null {
  if (registry[name]) return registry[name]
  return null
}

export function getRegisteredTools(): string[] {
  return Object.keys(registry)
}
