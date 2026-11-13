import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Check, Copy, Pencil, Pin, RefreshCw, Volume2, Square, MessageSquareQuote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Reasoning } from '@/components/ui/reasoning'
import { StepGroup, type Step } from '@/components/ui/tool-steps'
import { AskCard } from '@/components/ui/ask-card'
import { TaskNotice, type Notice } from '@/components/ui/task-notice'
import { DotLoader } from '@/components/ui/dot-loader'
import { StatusGlyph, type Activity } from '@/components/ui/status-glyph'
import { Markdown } from '@/components/common/Markdown'
import { safeCopyText } from '@/lib/clipboard'
import { useTtsRuntime, stopSpeaking, speakText } from '@/hooks/useTts'
import type { ChatTurn, ToolCall, TurnEvent, AskUserInteraction, TurnUsage } from '@/types'
import type { ParsedRef } from '@/utils/references'
import { cn } from '@/lib/utils'
import { toolDisplayName } from '@/components/tools/_shared/displayNames'
import { InlineStickers } from '@/components/common/InlineStickers'
import { Sticker } from '@/components/common/Sticker'

export interface ChatWindowProps {
  turns: ChatTurn[]
  currentTurn: ChatTurn | null
  isStreaming: boolean
  connected: boolean
  error: string | null
  errorCategory: 'user_error' | 'tool_error' | 'system_error' | 'rate_limit' | 'cancelled' | null
  errorTraceId: string | null
  errorDiagnostic: Record<string, unknown> | null
  privateMode?: boolean
  onAction: (payload: { action: string; data?: unknown }) => void
  onRetry: () => void
  onDismissError: () => void
  onCite: (ref: ParsedRef) => void
  onPin: (payload: { type: 'code' | 'table' | 'summary'; title: string; content: string; sourceTool?: string }) => void
  onPlanRespond?: (payload: unknown) => void
}

/** 工具名 → 人类可读的一行（Solid Glass：说清做了什么，而不是工具名+参数）。 */
function stepLabel(name: string, input: string): string {
  let parsed: unknown = input
  try { parsed = JSON.parse(input) } catch { /* plain text input */ }
  const obj = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  const path = typeof obj.file_path === 'string' ? obj.file_path : typeof obj.path === 'string' ? obj.path : typeof obj.notebook_path === 'string' ? obj.notebook_path : ''
  const short = path ? path.split(/[\\/]/).pop() : ''
  const cmd = typeof obj.command === 'string' ? obj.command : ''
  const query = typeof obj.pattern === 'string' ? obj.pattern : typeof obj.query === 'string' ? obj.query : ''
  const base = toolDisplayName(name)
  if (name === 'read' || name === 'ls' || name === 'edit' || name === 'write') {
    return short ? `${base} ${short}` : base
  }
  if (name === 'bash') return cmd ? `运行 ${cmd.slice(0, 60)}` : base
  if (name === 'grep' || name === 'find' || name === 'glob' || name === 'web_search' || name === 'tavily_search') {
    return query ? `${base} ${query.slice(0, 40)}` : base
  }
  return base
}

function toolToStep(tc: ToolCall, turnId: string, index: number): Step {
  const step: Step = {
    id: `${turnId}-${index}`,
    label: stepLabel(tc.name, tc.input),
    status: tc.status,
    detail: tc.input || undefined,
    detailLabel: '调用参数',
    // NEST-001：子调用缩进显示，让"这次工具是上面那个工具内部发起的"可见。
    ...(tc.parentCallId ? { nested: true } : {}),
  }
  if (tc.status === 'error') {
    step.error = tc.output ?? '工具执行失败'
  } else if (tc.output != null) {
    // diff 内容（file_edit / write 的统一补丁）走 DiffView
    const data = tc.toolData as { diff?: string; patch?: string } | undefined
    const patch = data?.diff ?? data?.patch
    if (patch) { step.patch = patch; step.output = undefined }
    else step.output = tc.output
  } else if (tc.partialResult) {
    step.output = tc.partialResult
  }
  return step
}

function activityOf(events: TurnEvent[]): Activity {
  const running = events.find((e) => e.kind === 'tool' && e.status === 'running') as ToolCall | undefined
  if (!running) return 'thinking'
  const n = running.name
  if (n === 'grep' || n === 'find' || n === 'glob' || n === 'web_search' || n === 'tavily_search') return 'searching'
  if (n === 'bash' || n === 'python' || n === 'run_python') return 'running'
  if (n === 'edit' || n === 'write') return 'writing'
  return 'running'
}

/** ask_user 五种交互模式 → AskCard / 审批卡。 */
function AskUserBlock({ interaction, onAction }: { interaction: AskUserInteraction; onAction: ChatWindowProps['onAction'] }) {
  if (interaction.mode === 'approval') {
    const responded = interaction.responded
    return (
      <div className="glass-panel rounded-md px-3.5 py-3">
        <p className="text-[11.5px] text-status-interrupted">需要你的确认{interaction.risk_level ? ` · 风险 ${interaction.risk_level === 'high' ? '高' : interaction.risk_level === 'medium' ? '中' : '低'}` : ''}</p>
        <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap">{interaction.question}</p>
        {interaction.code && <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">{interaction.code}</pre>}
        {interaction.tool_input && (
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">{JSON.stringify(interaction.tool_input, null, 2)}</pre>
        )}
        {responded ? (
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5" /> {responded === 'yes' ? '已批准' : '已拒绝'}</p>
        ) : interaction.submitted ? (
          <p className="mt-2 text-xs text-muted-foreground">已提交，等待结果…</p>
        ) : (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => onAction({ action: 'user_response', data: { interactionId: interaction.interactionId, response: 'yes' } })}>批准</Button>
            <Button size="sm" variant="outline" title="批准这次，并把本会话切到自动执行（不再逐次询问）" onClick={() => onAction({ action: 'approve_and_auto', data: { interactionId: interaction.interactionId } })}>批准并自动执行</Button>
            <Button size="sm" variant="destructive" onClick={() => onAction({ action: 'user_response', data: { interactionId: interaction.interactionId, response: 'no' } })}>拒绝</Button>
          </div>
        )}
      </div>
    )
  }
  const options = interaction.options.map((o) => typeof o === 'string' ? o : o.label)
  const multi = interaction.mode === 'multi_choice'
  if (multi) {
    return <MultiChoiceCard interaction={interaction} options={options} onAction={onAction} />
  }
  const disabled = interaction.submitted || interaction.responded != null
  return (
    <AskCard
      question={interaction.question}
      options={disabled ? [] : options}
      eyebrow={interaction.mode === 'confirm' ? '请确认' : '需要你的回答'}
      onAnswer={disabled ? undefined : (option) => onAction({ action: 'user_response', data: { interactionId: interaction.interactionId, response: option } })}
    />
  )
}

function MultiChoiceCard({ interaction, options, onAction }: { interaction: AskUserInteraction; options: string[]; onAction: ChatWindowProps['onAction'] }) {
  const [picked, setPicked] = useState<string[]>([])
  const disabled = interaction.submitted || interaction.responded != null
  return (
    <div className="glass-panel rounded-md px-3.5 py-3">
      <p className="text-[11.5px] text-status-interrupted">可多选</p>
      <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap">{interaction.question}</p>
      <div className="mt-2.5 flex flex-col gap-2">
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={picked.includes(o)} disabled={disabled} onChange={(e) => setPicked((p) => e.target.checked ? [...p, o] : p.filter((x) => x !== o))} />
            {o}
          </label>
        ))}
      </div>
      {!disabled && (
        <Button size="sm" className="mt-2.5" disabled={picked.length === 0} onClick={() => onAction({ action: 'user_response', data: { interactionId: interaction.interactionId, response: picked } })}>
          提交
        </Button>
      )}
    </div>
  )
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={() => { void safeCopyText(text).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }) }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}

function TurnBlock({ turn, isLast, onAction, onCite, onPin }: {
  turn: ChatTurn
  isLast: boolean
  onAction: ChatWindowProps['onAction']
  onCite: ChatWindowProps['onCite']
  onPin: ChatWindowProps['onPin']
}) {
  const speaking = useTtsRuntime((s) => s.speaking)
  const steps = turn.events
    .filter((e): e is ToolCall => e.kind === 'tool')
    .map((tc, i) => toolToStep(tc, turn.id, i))
  const askBlocks = turn.events.filter((e) => e.kind === 'tool' && e.interaction) as ToolCall[]
  const systemNotes: Notice[] = turn.events
    .filter((e): e is Extract<TurnEvent, { kind: 'system' }> => e.kind === 'system')
    .map((e, i) => ({
      id: `${turn.id}-sys-${i}`,
      title: e.content,
      status: e.detail === 'retry_start' || e.detail === 'context_compressing' ? 'failed' : 'completed',
    }))
  const thinkingEvents = turn.events.filter((e): e is Extract<TurnEvent, { kind: 'thinking' }> => e.kind === 'thinking')
  const thinkings = thinkingEvents.filter((e) => !e.consumed && !e.becameAnswer && e.tokens)
  // 非推理模型的流式回复复用 becameAnswer 的 thinking block：它就是答案正文。
  const streamingAnswer = !turn.finalAnswer
    ? thinkingEvents.filter((e) => e.becameAnswer).map((e) => e.tokens).join('')
    : ''
  const answerText = turn.finalAnswer ?? (streamingAnswer || null)
  const planCard = turn.planCard

  return (
    <article className="group/turn flex flex-col gap-2" aria-label={turn.userMessage ? '对话轮次' : undefined}>
      {turn.userMessage && (
        <div className="flex items-start justify-end gap-2">
          <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
            <InlineStickers text={turn.userMessage} />
          </div>
        </div>
      )}

      {thinkings.map((t, i) => (
        <Reasoning key={i} thinking={!t.done} label={`思考${t.elapsed ? ` · ${t.elapsed}s` : ''}`} defaultOpen={false}>{t.tokens}</Reasoning>
      ))}

      {steps.length > 0 && (
        <div className="max-w-full">
          <StepGroup steps={steps} defaultOpen={steps.some((s) => s.status === 'running')} summary={steps.some((s) => s.status === 'running') ? `正在执行 ${steps.filter((s) => s.status !== 'done').length} 步` : `执行了 ${steps.length} 步`} labels={{ detail: '调用参数', output: '输出', error: '错误' }} />
        </div>
      )}

      {askBlocks.map((tc) => tc.interaction && (
        <AskUserBlock key={tc.interaction.interactionId} interaction={tc.interaction} onAction={onAction} />
      ))}

      {systemNotes.length > 0 && <TaskNotice notices={systemNotes} />}

      {planCard && (
        <div className="glass-panel rounded-md px-3.5 py-3">
          <p className="text-[11.5px] text-status-interrupted">执行计划 · {planCard.status === 'approved' ? '已完成' : planCard.status === 'running' ? '执行中' : planCard.status === 'pending' ? '待确认' : planCard.status}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px]">
            {planCard.steps.map((st, i) => (
              <li key={i} className={cn(planCard.stepStatuses?.[String(i)] === 'done' && 'text-muted-foreground line-through')}>
                {typeof st === 'string' ? st : (st as { description?: string }).description ?? JSON.stringify(st)}
              </li>
            ))}
          </ol>
          {planCard.planText && <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">{planCard.planText}</pre>}
        </div>
      )}

      {turn.memoryEvents && turn.memoryEvents.length > 0 && (
        <TaskNotice notices={turn.memoryEvents.map((m, i) => ({ id: `${turn.id}-mem-${i}`, title: `记忆：${m.name}`, status: m.status === 'error' ? 'failed' : 'completed', note: m.status === 'running' ? '处理中' : undefined }))} />
      )}

      {answerText && (
        <div className="group/answer flex max-w-[92%] flex-col gap-2 rounded-xl rounded-bl-sm border border-border bg-card px-4 py-3">
          <div className="text-sm leading-relaxed">
            <Markdown content={answerText} />
          </div>
          {turn.stickerUrl && <Sticker src={turn.stickerUrl} className="mt-1" />}
          {turn.usage && <TurnUsageLine usage={turn.usage} />}
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/answer:opacity-100 focus-within:opacity-100">
            <CopyButton text={answerText} />
            <Button
              variant="ghost" size="icon-sm" aria-label={speaking ? '停止朗读' : '朗读回复'}
              onClick={() => { if (speaking) stopSpeaking(); else void speakText(answerText) }}
            >
              {speaking ? <Square /> : <Volume2 />}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="引用选中" onClick={() => onCite({ type: 'selection', label: '对话引用', preview: answerText } as ParsedRef)}>
              <MessageSquareQuote />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="置顶到工作台" onClick={() => onPin({ type: 'summary', title: turn.userMessage.slice(0, 30) || '回复', content: answerText })}>
              <Pin />
            </Button>
            {isLast && (
              <>
                <Button variant="ghost" size="icon-sm" aria-label="重新生成" onClick={() => onAction({ action: 'regenerate', data: { index: -1 } })}><RefreshCw /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="编辑并重发" onClick={() => onAction({ action: 'edit_resend', data: { index: -1 } })}><Pencil /></Button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function fmtTokens(n: number | null): string {
  if (n === null) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/**
 * 每轮用量脚注（pi 的 `llm_usage` / `answer.usage` 派生）。
 *
 * pi 会在每次模型请求结束时给出 input/output/cacheRead/cacheWrite 与耗时；
 * fallback 或多步轮次会有多次请求，这里按轮累加（耗时取最后一次，那是产出
 * 最终回答的那次）。缓存预热单独标出——它真实读取缓存，但不进命中率。
 */
function TurnUsageLine({ usage }: { usage: TurnUsage }) {
  const parts: string[] = []
  if (usage.inputTokens !== null || usage.outputTokens !== null) {
    parts.push(`↑${fmtTokens(usage.inputTokens)} ↓${fmtTokens(usage.outputTokens)}`)
  }
  if (usage.cacheReadTokens !== null && usage.cacheReadTokens > 0) parts.push(`缓存读 ${fmtTokens(usage.cacheReadTokens)}`)
  if (usage.durationMs !== null) {
    parts.push(usage.durationMs < 1000 ? `${Math.round(usage.durationMs)}ms` : `${(usage.durationMs / 1000).toFixed(1)}s`)
  }
  if (usage.requests > 1) parts.push(`${usage.requests} 次请求`)
  if (usage.warmCalls > 0) parts.push(`预热 ${usage.warmCalls} 次`)
  if (usage.cacheStatus === 'unknown') parts.push('缓存未观测')
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground/80"
      title={[usage.provider, usage.model].filter(Boolean).join(' / ') || undefined}
    >
      {usage.model && <span className="truncate max-w-[16ch]">{usage.model}</span>}
      {parts.map((p) => <span key={p}>{p}</span>)}
    </div>
  )
}

/** 对话窗口：轮次渲染 + 错误横幅 + 自动滚动/跳到最新。 */
export function ChatWindow(props: ChatWindowProps) {
  const { turns, currentTurn, isStreaming, connected, error, errorCategory, errorTraceId, onAction, onRetry, onDismissError, onCite, onPin } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const [tick, setTick] = useState(0)
  const merged = useMemo(() => [...turns, ...(currentTurn ? [currentTurn] : [])], [turns, currentTurn])

  // 流式跟随：仅当用户停在底部时自动滚
  useEffect(() => {
    const el = scrollRef.current
    if (el && pinned) el.scrollTop = el.scrollHeight
  }, [merged.length, currentTurn?.events.length, currentTurn?.finalAnswer, pinned, tick])

  useEffect(() => {
    if (!isStreaming) return
    const t = setInterval(() => setTick((v) => v + 1), 500)
    return () => clearInterval(t)
  }, [isStreaming])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  const jumpToLatest = () => {
    const el = scrollRef.current
    if (el) { el.scrollTop = el.scrollHeight; setPinned(true) }
  }

  const errCls = errorCategory === 'rate_limit'
    ? 'border-destructive/40 bg-destructive/10 text-destructive'
    : 'border-destructive/40 bg-destructive/10 text-destructive'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="app-scroll px-4 py-4" role="log" aria-label="对话消息">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {merged.map((turn, i) => (
            <TurnBlock key={turn.id} turn={turn} isLast={i === merged.length - 1} onAction={onAction} onCite={onCite} onPin={onPin} />
          ))}
          {isStreaming && !currentTurn?.finalAnswer && (
            <div className="flex items-center gap-2 text-muted-foreground" aria-label="正在生成">
              <StatusGlyph activity={activityOf(currentTurn?.events ?? [])} className="size-4" />
              <DotLoader />
            </div>
          )}
        </div>
      </div>

      {!pinned && (
        <Button variant="outline" size="icon-sm" className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-lg" onClick={jumpToLatest} aria-label="跳到最新">
          <ArrowDown />
        </Button>
      )}

      {error && (
        <div role="alert" className={cn('mx-4 mb-3 flex items-start justify-between gap-3 rounded-xl border p-4 text-sm', errCls)}>
          <div className="min-w-0">
            <p>{error}</p>
            {errorTraceId && <p className="mt-1 font-mono text-[11px] opacity-70">trace: {errorTraceId}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>
            <Button variant="ghost" size="icon-sm" aria-label="关闭错误" onClick={onDismissError}>✕</Button>
          </div>
        </div>
      )}
      {!connected && !error && (
        <div className="mx-4 mb-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs text-muted-foreground" role="status">
          连接已断开，正在重连…
        </div>
      )}
    </div>
  )
}
