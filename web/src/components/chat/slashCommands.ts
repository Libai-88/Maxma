/** 斜杠命令执行器（React 版）：把 /命令 分发给既有操作。
 *
 * 返回值是给用户的
 * 可见反馈（成功/失败原因），由 `ChatInput` 的提示条展示。 */
import { api } from '@/api'
import { useChatStore, invalidateTurnsCache } from '@/stores/chat'
import { SLASH_COMMANDS } from '@/components/chat/ChatInput'

export interface SlashContext {
  sessionId: string
  isStreaming: boolean
  privateMode: boolean
  autoApprove: boolean
  planMode: boolean
  setPrivateMode: (v: boolean) => void
  setAutoApprove: (v: boolean) => void
  setPlanMode: (v: boolean) => void
  sendPlanMode: (enabled: boolean) => boolean
  sendGoalAction: (action: 'set' | 'replace' | 'pause' | 'resume' | 'drop', objective?: string, tokenBudget?: number) => boolean
  sendCheckpointAction: (action: 'save' | 'restore', goal?: string) => boolean
  removeTurns: (n: number) => void
  retryLast: () => void
}

export async function runSlashCommand(name: string, args: string, ctx: SlashContext): Promise<string | void> {
  const sid = ctx.sessionId
  switch (name) {
    case 'help': {
      const lines = ['可用斜杠命令：', ...SLASH_COMMANDS.map((c) => `· ${c.usage ?? '/' + c.name} — ${c.description}`)]
      const ch = useChatStore.getState().getChannel(sid)
      ch.turns.push({
        id: `slash-help-${Date.now()}`,
        userMessage: '',
        refs: [],
        events: [{ kind: 'system', detail: 'slash_help', content: lines.join('\n'), timestamp: Date.now() }],
        memoryEvents: [],
        finalAnswer: null,
      })
      useChatStore.getState().bump()
      return
    }
    case 'plan': {
      const next = !ctx.planMode
      if (!ctx.sendPlanMode(next)) return '计划模式切换失败：连接未就绪'
      ctx.setPlanMode(next)
      return next ? '已开启计划模式：Agent 将先规划后执行' : '已关闭计划模式'
    }
    case 'goal': {
      const sub = args.split(/\s+/)[0]?.toLowerCase()
      if (sub === 'pause' || sub === 'resume' || sub === 'drop') {
        if (!ctx.sendGoalAction(sub)) return '目标操作失败：连接未就绪'
        return sub === 'pause' ? '目标已暂停' : sub === 'resume' ? '目标已恢复' : '目标已放弃'
      }
      if (!args.trim()) return '用法：/goal <目标>（或 /goal pause|resume|drop）'
      if (!ctx.sendGoalAction('set', args.trim())) return '目标设置失败：连接未就绪'
      return '目标已设定，Agent 将朝目标推进'
    }
    case 'checkpoint': {
      const action = args.trim().toLowerCase() === 'restore' ? 'restore' : 'save'
      if (!ctx.sendCheckpointAction(action)) return '请求失败：连接未就绪'
      return action === 'save' ? '已请求创建检查点，将在下一轮执行' : '已请求回到最近检查点，将在下一轮执行'
    }
    case 'undo': {
      if (ctx.isStreaming) return '正在生成回复，请等待完成后撤回'
      try {
        const result = await api.undoMessages(sid, 1)
        if ((result.deleted_count ?? 0) > 0) { ctx.removeTurns(1); return '已撤回上一轮' }
        return '没有可撤回的对话'
      } catch (e) { return '撤回失败：' + (e instanceof Error ? e.message : String(e)) }
    }
    case 'retry': { ctx.retryLast(); return }
    case 'compact': {
      try {
        const result = await api.compactSession(sid, 20)
        return result.removed_count > 0 ? `上下文已压缩：移除 ${result.removed_count} 条消息` : '上下文无需压缩'
      } catch (e) { return '压缩失败：' + (e instanceof Error ? e.message : String(e)) }
    }
    case 'clear': {
      try { await api.clearSessionMessages(sid) } catch (e) { return '清空失败：' + (e instanceof Error ? e.message : String(e)) }
      const target = useChatStore.getState().getChannel(sid)
      target.turns.splice(0, target.turns.length)
      target.currentTurn = null
      target.error = null
      target.errorCategory = null
      target.errorTraceId = null
      target.errorDiagnostic = null
      useChatStore.getState().removeTurnsFromStorage(sid)
      invalidateTurnsCache(sid)
      useChatStore.getState().bump()
      return '会话已清空'
    }
    case 'private': {
      const next = !ctx.privateMode
      ctx.setPrivateMode(next)
      return next ? '已开启私密模式' : '已关闭私密模式'
    }
    case 'auto': {
      const next = !ctx.autoApprove
      ctx.setAutoApprove(next)
      return next ? '已开启自动执行' : '已切换为逐次确认'
    }
    default:
      return `未知命令：/${name}（输入 /help 查看全部命令）`
  }
}