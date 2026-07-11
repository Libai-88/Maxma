import { defineAsyncComponent, type Component } from 'vue'

type BubbleLoader = () => Promise<{ default: Component }>

function lazyBubble(loader: BubbleLoader): Component {
  return defineAsyncComponent({
    loader,
    suspensible: false,
  })
}

const TodoBubble = lazyBubble(() => import('./TodoBubble.vue'))
const TaskTrackerBubble = lazyBubble(() => import('./TaskTrackerBubble.vue'))
const PythonBubble = lazyBubble(() => import('./PythonBubble.vue'))
const FilesBubble = lazyBubble(() => import('./FilesBubble.vue'))
const FileEditBubble = lazyBubble(() => import('./FileEditBubble.vue'))
const TarotBubble = lazyBubble(() => import('./TarotBubble.vue'))
const MapBubble = lazyBubble(() => import('./MapBubble.vue'))
const WeatherBubble = lazyBubble(() => import('./WeatherBubble.vue'))
const HolidayBubble = lazyBubble(() => import('./HolidayBubble.vue'))
const ImageBubble = lazyBubble(() => import('./ImageBubble.vue'))
const TavilySearchBubble = lazyBubble(() => import('./TavilySearchBubble.vue'))
const TavilyExtractBubble = lazyBubble(() => import('./TavilyExtractBubble.vue'))
const AskUserBubble = lazyBubble(() => import('./AskUserBubble.vue'))
const MemoryBubble = lazyBubble(() => import('./MemoryBubble.vue'))
const GitStatusBubble = lazyBubble(() => import('./GitStatusBubble.vue'))
const GitDiffBubble = lazyBubble(() => import('./GitDiffBubble.vue'))

/** 工具注册表：tool_name → 专属气泡组件 */
const registry: Record<string, Component> = {
  'todo_add': TodoBubble,
  'todo_list': TodoBubble,
  'todo_complete': TodoBubble,
  'todo_uncomplete': TodoBubble,
  'todo_delete': TodoBubble,
  'todo_update': TodoBubble,
  'todo_query': TodoBubble,
  'todo_list_projects': TodoBubble,
  'todo_add_quick': TodoBubble,
  'todo_list_sections': TodoBubble,
  'todo_list_labels': TodoBubble,
  'task_tracker': TaskTrackerBubble,
  'run_python': PythonBubble,
  'file_read': FilesBubble,
  'file_write': FilesBubble,
  'file_manage': FilesBubble,
  'file_search': FilesBubble,
  'file_edit': FileEditBubble,
  'tarot': TarotBubble,
  'nearby_search': MapBubble,
  'fuzzy_address_search': MapBubble,
  'geocode_address': MapBubble,
  'get_transit_route': MapBubble,
  'get_cycling_route': MapBubble,
  'get_current_weather': WeatherBubble,
  'holiday_calendar': HolidayBubble,
  'analyze_image': ImageBubble,
  'tavily_search': TavilySearchBubble,
  'tavily_extract': TavilyExtractBubble,
  'ask_user_for_info': AskUserBubble,
  'ask_user_qa': AskUserBubble,
  'ask_user_single_choice': AskUserBubble,
  'ask_user_multi_choice': AskUserBubble,
  'ask_user_confirm': AskUserBubble,

  /* Memory */
  'list_memories': MemoryBubble,
  'read_memories': MemoryBubble,
  'create_memory': MemoryBubble,
  'update_memory': MemoryBubble,
  'delete_memory': MemoryBubble,
  'merge_memories': MemoryBubble,

  /* Git */
  'git_status': GitStatusBubble,
  'git_commit': GitStatusBubble,
  'git_branch': GitStatusBubble,
  'git_push': GitStatusBubble,
  'git_pr': GitStatusBubble,
  'git_log': GitStatusBubble,
  'git_diff': GitDiffBubble,
}

export function getBubbleComponent(name: string): Component | null {
  if (registry[name]) return registry[name]
  return null
}

export function getRegisteredTools(): string[] {
  return Object.keys(registry)
}
