/**
 * Workbench Pane 注册表（唯一入口）。
 *
 * tab 顺序、中文名、运行环境依赖、keep-alive 策略和组件加载器都只在这里
 * 声明。WorkbenchHost 只负责布局、宽度和挂载策略，不再手写 tab 清单或
 * `activeTab === ...` 分支；测试直接覆盖这里的纯函数，防止“UI 说有、
 * 运行时没有”的死入口回潮。
 *
 * 组件用动态 import 声明，首次访问才加载：CodeMirror、浏览器面板不会
 * 挤进 ChatView 首屏 chunk。
 */

import type { ComponentType } from 'react'
import {
  FolderClosed,
  GitCompareArrows,
  Globe2,
  LayoutGrid,
  ListChecks,
  Sparkles,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'

import type { WorkbenchPaneProps } from './paneProps'
import type { WorkbenchTab } from '@/types/workbench'

export type WorkbenchPaneComponent = ComponentType<WorkbenchPaneProps>
export type WorkbenchPaneGroup = 'conversation' | 'workspace' | 'browse'

export interface WorkbenchPaneGroupMeta {
  id: WorkbenchPaneGroup
  label: string
}

export const WORKBENCH_PANE_GROUPS: readonly WorkbenchPaneGroupMeta[] = [
  { id: 'conversation', label: '对话' },
  { id: 'workspace', label: '工作区' },
  { id: 'browse', label: '网页' },
] as const

export interface WorkbenchPaneMeta {
  id: WorkbenchTab
  label: string
  /** 面板在选择器里的用途分组；宿主不再手写第二份层级。 */
  group: WorkbenchPaneGroup
  /** 一句话说明，展开目录时帮助用户判断该打开哪个面板。 */
  summary: string
  icon: LucideIcon
  /** `desktop` 需要 preload 的文件/命令桥；`browser` 还需要原生浏览器桥。 */
  requires: 'none' | 'desktop' | 'browser'
  /** 挂载后是否保留状态。编辑器草稿、命令输出必须保活。 */
  keepAlive: boolean
  /** Pane 内容容器的滚动/内边距策略；宿主不再按 tab 写分支。 */
  bodyClassName: string
  /** 首次访问时才执行的组件加载器（代码分割）。 */
  load: () => Promise<{ default: WorkbenchPaneComponent }>
}

export const WORKBENCH_PANES: readonly WorkbenchPaneMeta[] = [
  {
    id: 'reasoning',
    label: '推理',
    group: 'conversation',
    summary: '查看思考过程与工具时间线',
    icon: Sparkles,
    requires: 'none',
    keepAlive: true,
    bodyClassName: 'overflow-y-auto scrollbar-thin p-2',
    load: () => import('./ReasoningPane').then((module) => ({ default: module.ReasoningPane })),
  },
  {
    id: 'canvas',
    label: '画布',
    group: 'conversation',
    summary: '固定代码、表格与结果卡片',
    icon: LayoutGrid,
    requires: 'none',
    keepAlive: true,
    bodyClassName: 'overflow-y-auto scrollbar-thin p-2',
    load: () => import('./CanvasPane').then((module) => ({ default: module.CanvasPane })),
  },
  {
    id: 'files',
    label: '文件',
    group: 'workspace',
    summary: '浏览、编辑并保存工作区文件',
    icon: FolderClosed,
    requires: 'desktop',
    keepAlive: true,
    bodyClassName: 'overflow-hidden p-2',
    load: () => import('./FilesPane').then((module) => ({ default: module.FilesPane })),
  },
  {
    id: 'changes',
    label: '变更',
    group: 'workspace',
    summary: '审阅 diff，暂存并提交',
    icon: GitCompareArrows,
    requires: 'desktop',
    keepAlive: true,
    bodyClassName: 'overflow-hidden p-2',
    load: () => import('./ChangesPane').then((module) => ({ default: module.ChangesPane })),
  },
  {
    id: 'commands',
    label: '命令',
    group: 'workspace',
    summary: '运行命令并查看输出',
    icon: SquareTerminal,
    requires: 'desktop',
    keepAlive: true,
    bodyClassName: 'overflow-hidden p-2',
    load: () => import('./CommandPane').then((module) => ({ default: module.CommandPane })),
  },
  {
    id: 'browser',
    label: '浏览器',
    group: 'browse',
    summary: '隔离会话打开网页，交给 Agent',
    icon: Globe2,
    requires: 'browser',
    keepAlive: true,
    bodyClassName: 'overflow-hidden',
    load: () => import('./BrowserPane').then((module) => ({ default: module.BrowserPane })),
  },
  {
    id: 'tasks',
    label: '任务',
    group: 'conversation',
    summary: '跟踪目标、计划与进度',
    icon: ListChecks,
    requires: 'none',
    keepAlive: true,
    bodyClassName: 'overflow-y-auto scrollbar-thin p-2',
    load: () => import('./TasksPane').then((module) => ({ default: module.TasksPane })),
  },
] as const

export const WORKBENCH_PANE_LABELS = Object.fromEntries(
  WORKBENCH_PANES.map((pane) => [pane.id, pane.label]),
) as Record<WorkbenchTab, string>

export interface WorkbenchBridgeAvailability {
  /** `window.maxmaDesktop.pickPath` 等文件/命令桥。 */
  desktop: boolean
  /** `window.maxmaDesktop.browser` 原生浏览器桥。 */
  browser: boolean
}

/** 按真实运行时桥生成可用 tab；纯 Web 形态不出现任何死入口。 */
export function availableWorkbenchTabs(bridge: WorkbenchBridgeAvailability): WorkbenchTab[] {
  return WORKBENCH_PANES.filter((pane) => {
    if (pane.requires === 'desktop') return bridge.desktop
    if (pane.requires === 'browser') return bridge.desktop && bridge.browser
    return true
  }).map((pane) => pane.id)
}

/** 按用途分组，供“展开面板”选择器直接渲染；不把全部入口横排堆在标题下。 */
export function groupedWorkbenchPanes(tabs: readonly WorkbenchTab[]): Array<
  WorkbenchPaneGroupMeta & { panes: WorkbenchPaneMeta[] }
> {
  return WORKBENCH_PANE_GROUPS.flatMap((group) => {
    const panes = WORKBENCH_PANES.filter((pane) => pane.group === group.id && tabs.includes(pane.id))
    return panes.length ? [{ ...group, panes }] : []
  })
}

/**
 * 解析当前会话该显示的 tab。持久化的 activeTab 可能来自旧版本或被删掉的
 * 能力（例如浏览器桥未注入），此时回到推理，而不是渲染空壳。
 */
export function resolveWorkbenchTab(
  tabs: readonly WorkbenchTab[],
  preferred: WorkbenchTab | undefined,
): WorkbenchTab {
  if (preferred && tabs.includes(preferred)) return preferred
  return tabs[0] ?? 'reasoning'
}

/** 只增不减的已访问集合；用于 Pane keep-alive，重复切换不会重复挂载。 */
export function rememberVisitedPane(
  visited: readonly WorkbenchTab[],
  active: WorkbenchTab,
): WorkbenchTab[] {
  return visited.includes(active) ? [...visited] : [...visited, active]
}
