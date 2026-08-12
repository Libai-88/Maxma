/**
 * useSlashCommands — / 斜杠命令状态机与注册表（GAP-CMD-001）。
 *
 * 主流 Agent 应用（Claude Code / Cursor 等）以 / 命令统一管理进阶操作；
 * Maxma 的进阶功能此前分散在会话菜单/设置页各处，学习成本高。本模块把
 * 全部进阶操作收敛为统一命令体系，输入 / 即弹出命令面板。
 *
 * 与 useAutocomplete（# 工具补全）平行：触发互斥（/ 激活时关闭 # 面板，
 * 反之亦然），键盘导航（Tab/方向键/Enter/Esc）与执行语义一致。
 */
import { ref, computed, type Ref } from 'vue'

export interface SlashCommandDef {
  name: string
  description: string
  /** 用法提示（面板副标题显示） */
  usage?: string
}

export interface SlashCommandState {
  /** 面板是否可见 */
  visible: boolean
  /** 过滤文本（/ 之后到光标的输入） */
  filterText: string
  /** 命令片段起始位置（用于执行后从输入中移除） */
  triggerPos: number
  activeIndex: number
  position: { x: number; y: number }
}

/** 统一命令注册表 —— 所有进阶功能在此声明，与既有实现（WS/REST/前端状态）映射 */
export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'help', description: '显示全部斜杠命令', usage: '/help' },
  { name: 'plan', description: '切换计划模式（先规划后执行）', usage: '/plan' },
  { name: 'goal', description: '设置/替换目标；子命令 pause/resume/drop', usage: '/goal <目标> | pause | resume | drop' },
  { name: 'checkpoint', description: '创建检查点；restore 回到检查点', usage: '/checkpoint [restore]' },
  { name: 'undo', description: '撤回上一轮对话', usage: '/undo' },
  { name: 'retry', description: '重试最后一轮', usage: '/retry' },
  { name: 'compact', description: '压缩上下文历史', usage: '/compact' },
  { name: 'clear', description: '清空当前会话消息', usage: '/clear' },
  { name: 'private', description: '切换私密模式', usage: '/private' },
  { name: 'auto', description: '切换自动执行（免确认）', usage: '/auto' },
]

/** 解析命令输入：/goal 完成周报 → { name: 'goal', args: '完成周报' } */
export function parseSlashInput(text: string): { name: string; args: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const body = trimmed.slice(1)
  const spaceIdx = body.indexOf(' ')
  const name = (spaceIdx >= 0 ? body.slice(0, spaceIdx) : body).toLowerCase()
  const args = spaceIdx >= 0 ? body.slice(spaceIdx + 1).trim() : ''
  if (!name) return null
  return { name, args }
}

export interface UseSlashCommandsOptions {
  text: Ref<string>
  textareaRef: Ref<HTMLTextAreaElement | null>
  /** 执行回调（由 ChatView 注入全部既有 handler 分发） */
  run: (name: string, args: string) => Promise<string | void>
  /** # 工具补全激活时由调用方关闭本面板（互斥） */
  onExclusiveActive?: () => void
}

export function useSlashCommands(options: UseSlashCommandsOptions) {
  const { text, textareaRef, run } = options

  const visible = ref(false)
  const filterText = ref('')
  const triggerPos = ref(-1)
  const activeIndex = ref(0)
  const position = ref({ x: 0, y: 0 })

  const filtered = computed(() => {
    const lower = filterText.value.toLowerCase()
    if (!lower) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter(c => c.name.toLowerCase().startsWith(lower))
  })

  function calcCursorPixelPos(textarea: HTMLTextAreaElement, pos: number): { x: number; y: number } {
    const style = getComputedStyle(textarea)
    const mirror = document.createElement('div')
    mirror.style.cssText = `
      position: fixed; top: 0; left: -9999px; visibility: hidden; white-space: pre-wrap;
      word-wrap: break-word; overflow-wrap: break-word;
      font: ${style.font}; font-size: ${style.fontSize};
      letter-spacing: ${style.letterSpacing};
      width: ${textarea.clientWidth}px;
      padding: ${style.padding};
    `
    mirror.textContent = textarea.value.slice(0, pos) + '.'
    document.body.appendChild(mirror)
    const textareaRect = textarea.getBoundingClientRect()
    const lines = mirror.textContent!.split('\n')
    const lastLine = lines[lines.length - 1]
    const x = textareaRect.left + Math.min(lastLine.length * 8, textareaRect.width - 40)
    const y = textareaRect.top + (lines.length - 1) * 20 + 24
    document.body.removeChild(mirror)
    return { x, y }
  }

  /** 检测 / 触发（行首或空白后），与 # 工具补全互斥由调用方协调 */
  function detect(textarea: HTMLTextAreaElement, value: string): boolean {
    const cursorPos = textarea.selectionStart
    const before = value.slice(0, cursorPos)
    const idx = before.lastIndexOf('/')
    if (idx === -1) {
      close()
      return false
    }
    const charBefore = idx === 0 ? ' ' : before[idx - 1]
    // 行首 / 空白后的 / 才是命令；URL（http://）等不触发
    if (/\s/.test(charBefore) && !/^\/(\/|\/)/.test(before.slice(idx))) {
      visible.value = true
      // 过滤文本只取命令名部分（空格后为参数，不参与命令匹配）
      filterText.value = before.slice(idx + 1).split(' ')[0]
      triggerPos.value = idx
      activeIndex.value = 0
      position.value = calcCursorPixelPos(textarea, cursorPos)
      return true
    }
    if (visible.value && !/\s/.test(charBefore)) {
      filterText.value = before.slice(idx + 1).split(' ')[0]
      triggerPos.value = idx
      return true
    }
    close()
    return false
  }

  function close() {
    visible.value = false
    filterText.value = ''
    triggerPos.value = -1
  }

  /** 从输入中移除命令片段 */
  function stripCommand() {
    const el = textareaRef.value
    const cursorPos = el?.selectionStart ?? text.value.length
    if (triggerPos.value >= 0) {
      text.value = text.value.slice(0, triggerPos.value) + text.value.slice(cursorPos)
    }
  }

  /**
   * 执行命令：面板选中项决定命令名，输入片段解析出参数（支持
   * "/goal 完成周报" 直接回车——命令名匹配 goal、参数为完整目标文本）。
   * 返回执行反馈文案（空串表示无反馈）。
   */
  async function execute(): Promise<string> {
    const el = textareaRef.value
    const cursorPos = el?.selectionStart ?? text.value.length
    const fullSegment = text.value.slice(triggerPos.value, cursorPos)
    const parsed = parseSlashInput(fullSegment)
    if (!parsed) {
      close()
      return ''
    }
    // 面板选中（或过滤唯一）的命令名优先；参数始终来自输入片段
    const picked = filtered.value[Math.min(activeIndex.value, filtered.value.length - 1)]
    const name = picked?.name ?? parsed.name
    const args = parsed.args
    stripCommand()
    close()
    try {
      const feedback = await run(name, args)
      return feedback ?? ''
    } catch {
      return ''
    }
  }

  /** 处理键盘事件。返回 true 表示已消费。 */
  function handleKeydown(e: KeyboardEvent): boolean {
    if (!visible.value) return false
    const len = filtered.value.length
    if (e.key === 'Tab') {
      e.preventDefault()
      if (len > 0) void execute()
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex.value = ((activeIndex.value - 1) % len + len) % len
      return true
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex.value = (activeIndex.value + 1) % len
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return true
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (len > 0) void execute()
      return true
    }
    return false
  }

  return {
    visible,
    filterText,
    triggerPos,
    activeIndex,
    position,
    filtered,
    detect,
    close,
    handleKeydown,
    execute,
  }
}

export type SlashCommandsController = ReturnType<typeof useSlashCommands>
