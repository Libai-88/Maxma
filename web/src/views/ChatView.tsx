import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { PermissionModeControl } from '@/components/chat/PermissionModeControl'
import { runSlashCommand } from '@/components/chat/slashCommands'
import { SteeringWindow } from '@/components/chat/SteeringWindow'
import { TaskReviewWindow } from '@/components/chat/TaskReviewWindow'
import { ExtensionPromptDialog } from '@/components/chat/ExtensionPromptDialog'
import { SessionTreeDialog } from '@/components/chat/SessionTreeDialog'
import { ContextRing } from '@/components/ui/context-ring'
import { Switch } from '@/components/ui/switch'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { SessionTabs } from '@/components/chat/SessionTabs'
import { ChatInput } from '@/components/chat/ChatInput'
import { WelcomeScreen } from '@/components/chat/WelcomeScreen'
import { WorkbenchHost } from '@/components/workbench/WorkbenchHost'
import type { ModelInfo } from '@/types/chat'
import { useChat } from '@/hooks/useChat'
import { useChatStore } from '@/stores/chat'
import { useSessionStore } from '@/stores/session'
import { useProviderStore } from '@/stores/provider'
import { usePersonaStore } from '@/stores/persona'
import { useWorkbenchStore } from '@/stores/workbench'
import { api } from '@/api'
import { safeGetItem, safeSetItem } from '@/lib/storage'
import { showToast } from '@/lib/toast'
import type { ParsedRef } from '@/utils/references'
import type { ThinkPathId } from '@/utils/thinkPath'
import { Settings2, PanelRight, AlertTriangle, RotateCcw, GitBranch } from 'lucide-react'

const SELECTED_PROVIDER_KEY = 'maxma_selected_provider'
const SELECTED_MODEL_KEY = 'maxma_selected_model'

export default function ChatView() {
  const sessionId = useSessionStore((s) => s.sessionId)
  const sessions = useSessionStore((s) => s.sessions)
  const switchSession = useSessionStore((s) => s.switchSession)
  const refreshSessions = useSessionStore((s) => s.refreshSessions)
  const { hasProviders, loaded: providerLoaded, loadProviders } = useProviderStore()
  const availableModels = useChatStore((s) => s.availableModels)
  const fetchAvailableModels = useChatStore((s) => s.fetchAvailableModels)
  const markSessionView = useChatStore((s) => s.markSessionView)
  const channels = useChatStore((s) => s.channels)
  const chatVersion = useChatStore((s) => s.version)
  void chatVersion
  const workbench = useWorkbenchStore()

  const chat = useChat(sessionId)
  const {
    connected, isStreaming, turns, currentTurn, error, errorCategory, errorTraceId, errorDiagnostic,
    failedTurnIndex, taskTrackerData, send, cancel, answerTaskBrief, executeTaskBrief, cancelTaskBrief,
    sendCollaborationMessage, sendTaskReview, sendUserResponse, sendExtensionUiResponse, sendArtifactAction, sendPlanResponse,
    removeTurns, dismissError, privateMode, setPrivateMode, autoApprove, setAutoApprove,
    reconnectExhausted, reconnect, goalState, contextUsage,
    sendPlanMode, sendCheckpointAction, sendGoalAction, reloadTurnsFromBackend, queuedMessages,
  } = chat

  const [providerLoadFailed, setProviderLoadFailed] = useState(false)
  const [providerRetrying, setProviderRetrying] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  /** 会话重命名草稿：打开菜单时用当前名字回填（没有名字就是空，不是 id）。 */
  const [nameDraft, setNameDraft] = useState('')
  const currentSession = sessions.find((s) => s.session_id === sessionId)

  const saveSessionName = async () => {
    if (!sessionId) return
    try {
      const r = await api.setSessionName(sessionId, nameDraft.trim())
      await refreshSessions()
      showToast(r.name ? `已命名为「${r.name}」` : '已清除会话名，标题退回首条消息', 'info')
    } catch (e) {
      showToast(`重命名失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }
  const [treeOpen, setTreeOpen] = useState(false)
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false)
  const [taskBriefAnswer, setTaskBriefAnswer] = useState('')
  const [taskBriefPrompt, setTaskBriefPrompt] = useState('')
  const [taskReviewFeedback, setTaskReviewFeedback] = useState('')
  const [planMode, setPlanMode] = useState(false)
  const [quotes, setQuotes] = useState<Array<{ label: string; preview: string }>>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const regenInFlight = useRef(false)
  const undoInFlight = useRef(false)

  const channel = channels.get(sessionId)
  const taskBrief = channel?.taskBrief ?? null
  const taskReview = channel?.taskReview ?? null
  const hasMessages = turns.length > 0 || !!currentTurn
  const noUsableModels = providerLoaded && availableModels.length === 0
  const isSubagent = sessions.some((s) => s.session_id === sessionId && s.is_subagent)
  const allTurns = useMemo(() => [...turns, ...(currentTurn ? [currentTurn] : [])], [turns, currentTurn])

  // 会话级 presence：切页后仍能看到流式任务状态反馈
  useEffect(() => {
    if (sessionId) markSessionView(sessionId, true)
    return () => { if (sessionId) markSessionView(sessionId, false) }
  }, [sessionId, markSessionView])

  const loadProvidersWithStatus = async () => {
    await loadProviders()
    setProviderLoadFailed(!useProviderStore.getState().loaded && useProviderStore.getState().allProviders.length === 0)
  }

  useEffect(() => {
    void usePersonaStore.getState().fetchProfile()
    void loadProvidersWithStatus().then(() => void fetchAvailableModels())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const retryLoadProviders = async () => {
    if (providerRetrying) return
    setProviderRetrying(true)
    try {
      await loadProvidersWithStatus()
      await fetchAvailableModels()
    } finally { setProviderRetrying(false) }
  }

  // 任务对齐状态切换时重置输入
  useEffect(() => {
    setTaskBriefAnswer('')
    if (taskBrief?.status === 'ready') setTaskBriefPrompt(taskBrief.executionPrompt ?? '')
  }, [taskBrief])

  // 全局快捷键：Ctrl/Cmd+K 私密模式、Esc 停止生成、Ctrl/Cmd+L 聚焦输入框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPrivateMode(!privateMode) }
      else if (e.key === 'Escape' && isStreaming) cancel()
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); window.dispatchEvent(new CustomEvent('maxma:focus-composer')) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [privateMode, setPrivateMode, isStreaming, cancel])

  const onModelChange = (providerId: string, modelName: string) => {
    safeSetItem(SELECTED_PROVIDER_KEY, providerId)
    safeSetItem(SELECTED_MODEL_KEY, modelName)
  }

  const onSend = (text: string, refs: ParsedRef[], providerId?: string, modelName?: string, thinkPathId?: ThinkPathId, clientMsgId?: string): boolean => {
    // 选区引用作为 refs 的一部分发出（与旧 ChatView 一致）；发送成功才清空。
    const quoteRefs = quotes.map((q) => ({ type: 'selection', label: q.label, preview: q.preview }) as ParsedRef)
    const sent = send(text, [...refs, ...quoteRefs], providerId, modelName, thinkPathId, clientMsgId)
    if (sent) setQuotes([])
    return sent
  }

  const onSlashCommand = (name: string, args: string) => runSlashCommand(name, args, {
    sessionId, isStreaming, privateMode, autoApprove, planMode,
    setPrivateMode, setAutoApprove, setPlanMode: setPlanMode,
    sendPlanMode, sendGoalAction, sendCheckpointAction, removeTurns,
    retryLast: handleRetryLast,
    // EXT-UI-001 / PROMPT-TPL-001：未登记的命令透传给引擎（扩展命令 / prompt templates）
    sendRaw: (text: string) => send(text),
  })

  const handleQuickStart = (message: string) => {
    window.dispatchEvent(new CustomEvent('maxma:set-composer', { detail: message }))
    window.dispatchEvent(new CustomEvent('maxma:focus-composer'))
  }

  const markInteractionSubmitted = (interactionId: string) => {
    if (!interactionId) return
    for (const ch of channels.values()) {
      for (const turn of [ch.currentTurn, ...ch.turns]) {
        if (!turn) continue
        for (const ev of turn.events) {
          if (ev.kind === 'tool' && ev.interaction?.interactionId === interactionId) ev.interaction.submitted = true
        }
      }
    }
    useChatStore.getState().bump()
  }

  const markInteractionResponded = (interactionId: string, responded: 'yes' | 'no') => {
    for (const ch of channels.values()) {
      for (const turn of [ch.currentTurn, ...ch.turns]) {
        if (!turn) continue
        for (const ev of turn.events) {
          if (ev.kind === 'tool' && ev.interaction?.interactionId === interactionId) ev.interaction.responded = responded
        }
      }
    }
    useChatStore.getState().bump()
  }

  const handleUndo = async () => {
    if (undoInFlight.current) return
    if (isStreaming) { showToast('正在生成回复，请等待本轮完成后撤回', 'warning'); return }
    undoInFlight.current = true
    try {
      const result = await api.undoMessages(sessionId, 1)
      if (result.deleted_count > 0) removeTurns(1)
      else showToast('没有可撤回的消息', 'warning')
    } catch (e) {
      showToast('撤回失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { undoInFlight.current = false }
  }

  const removeRoundsAndResend = async (index: number, resend: boolean) => {
    if (regenInFlight.current || undoInFlight.current) return
    if (isStreaming) { showToast('正在生成回复，请等待本轮完成后重试', 'warning'); return }
    const ch = channels.get(sessionId)
    if (!ch || index < 0 || index >= ch.turns.length) return
    const message = ch.turns[index].userMessage
    if (!message) return
    const roundsToRemove = ch.turns.length - index
    if (roundsToRemove > 100) { showToast('对话过长，无法重新生成该轮（最多撤回 100 轮）', 'error'); return }
    regenInFlight.current = true
    try {
      const result = await api.undoMessages(sessionId, roundsToRemove)
      if (result.deleted_count <= 0) { showToast('重新生成失败：无法撤回该轮对话', 'error'); return }
      removeTurns(roundsToRemove)
      if (resend) {
        if (!onSend(message, [])) showToast('暂时无法发送，请等待连接完成后再试', 'error')
      } else {
        window.dispatchEvent(new CustomEvent('maxma:set-composer', { detail: message }))
        window.dispatchEvent(new CustomEvent('maxma:focus-composer'))
      }
    } catch (e) {
      showToast(`操作失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally { regenInFlight.current = false }
  }

  const handleRetryLast = () => {
    if (isStreaming) { showToast('正在生成回复，请等待完成后重试', 'warning'); return }
    const ch = channels.get(sessionId)
    const failedTurn = failedTurnIndex != null ? ch?.turns[failedTurnIndex] : undefined
    const message = failedTurn?.userMessage ?? ch?.turns[ch.turns.length - 1]?.userMessage
    if (!message) { showToast('没有可重试的消息', 'warning'); return }
    if (!onSend(message, [])) showToast('暂时无法发送，请等待连接完成后再试', 'error')
  }

  const handleToolAction = (payload: { action: string; data?: unknown }) => {
    if (payload.action === 'user_response') {
      const d = payload.data as { interactionId: string; response: string | string[] }
      if (sendUserResponse(d.interactionId, d.response)) {
        markInteractionSubmitted(d.interactionId)
        const resp = Array.isArray(d.response) ? d.response[0] : d.response
        if (resp === 'yes' || resp === 'no') markInteractionResponded(d.interactionId, resp)
      }
    } else if (payload.action === 'approve_and_auto') {
      const d = payload.data as { interactionId: string }
      if (!sendUserResponse(d.interactionId, 'yes')) { showToast('连接已断开，无法批准', 'error'); return }
      markInteractionSubmitted(d.interactionId)
      markInteractionResponded(d.interactionId, 'yes')
      // 本会话切到自动执行：内核广播 permission_mode_updated，选择器随之收敛
      void api.setSessionPermissionMode(sessionId, 'auto')
        .then((res) => {
          const ch = useChatStore.getState().getChannel(sessionId)
          if (ch) { ch.permissionMode = res.permission_mode; useChatStore.getState().bump() }
          showToast('已切换到自动执行（本会话）')
        })
        .catch((e) => showToast('切换权限模式失败: ' + (e instanceof Error ? e.message : String(e)), 'error'))
    } else if (payload.action === 'set_ask_submitted') {
      markInteractionSubmitted((payload.data as { interactionId: string }).interactionId)
    } else if (payload.action === 'set_responded') {
      const d = payload.data as { interactionId: string; responded: 'yes' | 'no' }
      markInteractionResponded(d.interactionId, d.responded)
    } else if (payload.action === 'undo') {
      void handleUndo()
    } else if (payload.action === 'regenerate') {
      void removeRoundsAndResend((payload.data as { index: number }).index, true)
    } else if (payload.action === 'edit_resend') {
      void removeRoundsAndResend((payload.data as { index: number }).index, false)
    } else if (payload.action === 'plan_respond') {
      const d = payload.data as { planId: string; action: 'approve' | 'modify' | 'reject'; modifiedPlan?: string }
      sendPlanResponse(d.planId, d.action, d.modifiedPlan)
    }
  }

  const handlePin = (payload: { type: 'code' | 'table' | 'summary'; title: string; content: string; sourceTool?: string }) => workbench.addCard(payload)

  const handleArtifactAction = (payload: { artifactId: string; actionId: string; token: string }) => {
    if (sendArtifactAction(payload.artifactId, payload.actionId, payload.token)) {
      workbench.markArtifactActionSubmitted(payload.artifactId, payload.actionId)
    }
  }

  const submitTaskBriefAnswer = () => {
    const answer = taskBriefAnswer.trim()
    if (answer && answerTaskBrief(answer)) setTaskBriefAnswer('')
  }
  const sendCollaboration = (mode: 'steer' | 'follow_up', message: string): boolean => {
    const text = message.trim()
    if (!text) return false
    return sendCollaborationMessage(mode, text)
  }
  const acceptTask = () => { if (sendTaskReview('accept')) setTaskReviewFeedback('') }
  const reviseTask = () => {
    const feedback = taskReviewFeedback.trim()
    if (feedback && sendTaskReview('revise', feedback)) setTaskReviewFeedback('')
  }

  // ── 无 provider / 无模型引导 ──
  if (providerLoadFailed) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl bg-card p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 size-6 text-muted-foreground" />
          <h3 className="text-base font-semibold">无法加载模型配置</h3>
          <p className="mt-2 text-sm text-muted-foreground">后端服务可能未就绪，请稍后重试。</p>
          <Button className="mt-4" disabled={providerRetrying} onClick={() => void retryLoadProviders()}>
            {providerRetrying ? <Spinner className="mr-2" /> : <RotateCcw className="mr-2" />} 重试
          </Button>
        </div>
      </div>
    )
  }

  if (!hasProviders || noUsableModels) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl bg-card p-7">
          <Settings2 className="mb-4 size-7 text-muted-foreground" />
          <h3 className="text-lg font-semibold">{noUsableModels ? '还差一步即可开始' : '开始使用 Maxma'}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {noUsableModels ? '已找到模型提供商，但还没有可选择的模型。请在模型设置中拉取或填写模型 ID。' : 'Maxma 已内置免费模型通道，无需 API Key；也支持云端服务和本地模型。'}
          </p>
          <ol className="flex flex-col mt-5 gap-3">
            {[
              '点击下方按钮进入「模型 MODELS」设置页',
              '优先选择内置免费模型；也可以选择 DeepSeek、Qwen 或 OpenAI 等外部服务',
              '云端服务填入 API Key；Ollama 等本地服务无需 Key，保存后拉取模型',
            ].map((text, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-caption font-medium tabular-nums">{i + 1}</span>
                <span className="text-muted-foreground">{text}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex gap-2">
            <Button render={<Link to="/providers" />}>前往模型设置</Button>
            <Button variant="outline" render={<Link to="/help" />}>了解更多</Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">内置免费模型无需 API Key；Ollama 适合完全离线运行。</p>
        </div>
      </div>
    )
  }

  const models: ModelInfo[] = availableModels

  return (
    <div ref={rootRef} className="relative flex h-full flex-col">
      <SessionTabs />
      <ChatHeader>
        {contextWindowOf(contextUsage).window > 0 && (
          <ContextRing
            used={contextWindowOf(contextUsage).used}
            window={contextWindowOf(contextUsage).window}
            title="上下文窗口"
            note="这段对话占用的窗口比例；快满时会压缩较早的轮次。"
            freeLabel="剩余"
          />
        )}
        {planMode && <span className="rounded-md border border-border px-2.5 py-1.5 text-caption text-muted-foreground">计划模式</span>}
        <Button variant="ghost" size="icon-sm" aria-label="工作台" aria-expanded={workbench.isOpen} onClick={() => workbench.toggle()}><PanelRight /></Button>
        <div className="relative">
          <Button variant="ghost" size="icon-sm" aria-label="更多会话操作" aria-expanded={moreMenuOpen} onClick={() => { setMoreMenuOpen((v) => !v); setNameDraft(currentSession?.name ?? '') }}>···</Button>
          {moreMenuOpen && (
            <div role="menu" aria-label="更多会话操作" className="absolute right-0 top-9 z-40 w-72 rounded-xl bg-popover p-4">
              <p className="mb-2 text-meta font-medium">会话设置</p>
              {/* 会话名此前只有 API、没有入口：每个会话的标题都是「会话 e941c2cb」。 */}
              <label className="mb-1 block text-caption text-muted-foreground" htmlFor="session-name-input">会话名称</label>
              <div className="mb-1 flex items-center gap-1.5">
                <Input
                  id="session-name-input"
                  value={nameDraft}
                  maxLength={80}
                  placeholder={currentSession?.preview?.slice(0, 20) || '给它起个名字'}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveSessionName() } }}
                  className="h-8 min-w-0 flex-1 text-ui"
                  disabled={!sessionId}
                />
                <Button variant="outline" size="sm" className="h-8 shrink-0" disabled={!sessionId} onClick={() => void saveSessionName()}>保存</Button>
              </div>
              <p className="mb-3 text-caption text-muted-foreground">留空即清除；没设名字时标题取首条消息。</p>
              <p className="mb-3 text-caption text-muted-foreground">输入 <code className="rounded bg-muted px-1.5 py-1.5">/</code> 查看全部命令（如 /goal、/plan、/undo）</p>
              {goalState?.goal && (
                <p className="mb-2 text-meta text-muted-foreground">
                  目标：{goalState.goal.objective}
                  <span className="ml-1 opacity-70">（{goalState.goal.status === 'active' ? '进行中' : goalState.goal.status === 'paused' ? '已暂停' : goalState.goal.status === 'complete' ? '已完成' : goalState.goal.status}）</span>
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mb-2 w-full justify-start"
                onClick={() => { setMoreMenuOpen(false); setTreeOpen(true) }}
                disabled={!sessionId}
              >
                <GitBranch className="mr-1.5 size-3.5" /> 会话分支
                <span className="ml-auto text-xs text-muted-foreground">查看 / 分叉</span>
              </Button>
              {/* RELOAD-001：装了新技能/扩展、放了新提示词模板后，不必重建会话。 */}
              <Button
                variant="outline"
                size="sm"
                className="mb-2 w-full justify-start"
                disabled={!sessionId}
                onClick={async () => {
                  if (!sessionId) return
                  try {
                    const r = await api.reloadSessionResources(sessionId)
                    showToast(`已重新加载：${r.templates} 个模板、${r.tools} 个工具`, 'info')
                    setMoreMenuOpen(false)
                  } catch (e) {
                    showToast(`重载失败：${e instanceof Error ? e.message : String(e)}`, 'error')
                  }
                }}
              >
                <RotateCcw className="mr-1.5 size-3.5" /> 重新加载技能与模板
              </Button>
              <Button variant="outline" size="sm" className="mb-2 w-full justify-start" onClick={() => setModelSettingsOpen((v) => !v)}>
                模型参数 <span className="ml-auto text-xs text-muted-foreground">{modelSettingsOpen ? '收起' : '展开'}</span>
              </Button>
              {modelSettingsOpen && <ModelSettings />}
              {taskTrackerData && <div className="mb-2 rounded-lg border border-border p-3 text-xs text-muted-foreground">任务状态：{JSON.stringify(taskTrackerData).slice(0, 120)}</div>}
              <div className="flex items-center justify-between px-1 py-1.5 text-sm">
                <span>自动执行（免确认）</span>
                <Switch checked={autoApprove} onCheckedChange={setAutoApprove} aria-label="自动执行" />
              </div>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setPrivateMode(!privateMode)}>
                私密模式 <span className="ml-auto">{privateMode ? '开' : '关'}</span>
              </Button>
              <div className="mt-2 border-t border-border pt-2">
                <PermissionModeControl sessionId={sessionId} />
              </div>
            </div>
          )}
        </div>
      </ChatHeader>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {hasMessages ? (
            <ChatWindow
              turns={turns}
              currentTurn={currentTurn}
              isStreaming={isStreaming}
              connected={connected}
              error={error}
              errorCategory={errorCategory}
              errorTraceId={errorTraceId}
              errorDiagnostic={errorDiagnostic}
              privateMode={privateMode}
              onAction={handleToolAction}
              onRetry={handleRetryLast}
              onDismissError={dismissError}
              onCite={(ref) => {
                const sel = window.getSelection()?.toString().trim()
                const preview = sel || ref.label
                if (!preview) return
                setQuotes((q) => (q.some((x) => x.preview === preview) ? q : [...q, { label: `引用 ${q.length + 1}`, preview }]))
              }}
              onPin={handlePin}
            />
          ) : <WelcomeScreen onStart={handleQuickStart} />}

          {taskBrief && (
            <section aria-live="polite" className="mx-4 mb-3 rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <div><span className="text-caption uppercase tracking-widest text-muted-foreground">执行前确认</span><strong className="block text-sm">把任务说清楚，Agent 才能一次做对</strong></div>
                <Button variant="ghost" size="sm" onClick={cancelTaskBrief}>取消</Button>
              </div>
              {taskBrief.status === 'thinking' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> 正在提取目标、约束和验收标准…</p>}
              {taskBrief.status === 'clarify' && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">当前执行准备度 {Math.round((taskBrief.confidence ?? 0.5) * 100)}%</p>
                  <ol className="list-decimal space-y-1 pl-5 text-sm">{taskBrief.questions?.map((q: string, i: number) => <li key={i}>{q}</li>)}</ol>
                  <textarea value={taskBriefAnswer} onChange={(e) => setTaskBriefAnswer(e.target.value)} rows={4} maxLength={4000} placeholder="按问题编号回答即可，也可以写成一段话" className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none" />
                  <Button size="sm" disabled={!taskBriefAnswer.trim()} onClick={submitTaskBriefAnswer}>继续对齐 →</Button>
                </div>
              )}
              {taskBrief.status === 'ready' && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">执行准备度 {Math.round((taskBrief.confidence ?? 0.9) * 100)}%</p>
                  <textarea value={taskBriefPrompt} onChange={(e) => setTaskBriefPrompt(e.target.value)} rows={6} maxLength={20000} className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none" />
                  <Button size="sm" disabled={!taskBriefPrompt.trim()} onClick={() => executeTaskBrief(taskBriefPrompt.trim())}>确认并开始执行 →</Button>
                </div>
              )}
              {taskBrief.status === 'fallback' && (
                <div className="flex flex-col gap-2"><p className="text-sm text-destructive">需求对齐暂不可用：{taskBrief.error || '模型没有生成有效指令'}</p><Button size="sm" onClick={() => executeTaskBrief(undefined, true)}>使用原始请求执行</Button></div>
              )}
            </section>
          )}

          {isSubagent
            ? <div className="border-t border-border p-3 text-center text-xs text-muted-foreground">🔒 子 Agent 会话 — 只读</div>
            : (
              <ChatInput
                sessionId={sessionId}
                isStreaming={isStreaming}
                connected={connected}
                // 模型列表可能暂时为空（provider 刷新/插件重载），但已选中的
                // provider/model 仍可发送；真正缺模型由 ChatInput 给出明确提示。
                canSend={connected}
                models={models}
                initialProviderId={safeGetItem(SELECTED_PROVIDER_KEY) || ''}
                initialModelName={safeGetItem(SELECTED_MODEL_KEY) || ''}
                onSend={onSend}
                onStop={() => { if (!cancel()) window.dispatchEvent(new CustomEvent('maxma:error', { detail: { message: '连接已断开，无法停止当前任务' } })) }}
                onModelChange={onModelChange}
                onSlashCommand={onSlashCommand}
                reconnectExhausted={reconnectExhausted}
                onReconnect={reconnect}
              />
            )}
        </div>

        <WorkbenchHost isOpen={workbench.isOpen} onArtifactAction={handleArtifactAction} allTurns={allTurns} sessionId={sessionId} taskTrackerData={taskTrackerData} goalState={goalState} />

        {/* 实时纠偏：悬浮小窗（只在流式进行中出现，可拖动/收起/关闭） */}
        <SteeringWindow
          visible={isStreaming}
          onSteer={(message) => sendCollaboration('steer', message)}
          onFollowUp={(message) => sendCollaboration('follow_up', message)}
          queued={queuedMessages}
        />

        {/* 完成后验收：悬浮小窗。回答结束即出现并**一直保持悬浮**，直到
            用户接受或提交修订；不再内联占消息区与输入框之间的高度。 */}
        <TaskReviewWindow
          turnId={taskReview?.turnId ?? null}
          feedback={taskReviewFeedback}
          onFeedbackChange={setTaskReviewFeedback}
          onRevise={reviseTask}
          onAccept={acceptTask}
        />

        {/* EXT-UI-001：pi 扩展的 ctx.ui 对话框。全局模态——不属于某一轮对话，
            所以挂在这里而不是 ChatWindow 里（回合切换不该把它清掉）。 */}
        <ExtensionPromptDialog onReply={sendExtensionUiResponse} />

        {/* TREE-001..003：pi 的会话树。切回某处后刷新消息；分叉后切到新会话。 */}
        <SessionTreeDialog
          sessionId={sessionId ?? ''}
          open={treeOpen}
          onClose={() => setTreeOpen(false)}
          onNavigated={() => void reloadTurnsFromBackend()}
          onForked={(newId) => { setTreeOpen(false); void switchSession(newId) }}
        />
      </div>
    </div>
  )
}

/** 模型参数面板（chat store 的 currentModel / maxTokens / thinkingEnabled 等）。 */
function ModelSettings() {
  const { currentModel, maxTokens, thinkingEnabled, setMaxTokens, toggleThinking } = useChatStore()
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-xs">
      <p className="text-muted-foreground">当前模型：{currentModel || '默认'}</p>
      <label className="block">输出上限
        <input type="number" min={1} value={maxTokens ?? 0} onChange={(e) => setMaxTokens(Number(e.target.value))} className="mt-1 w-full rounded border border-border bg-background px-3 py-2.5" />
      </label>
      <label className="flex items-center gap-2">思考模式
        <input type="checkbox" checked={thinkingEnabled} onChange={() => toggleThinking(!thinkingEnabled)} />
      </label>
    </div>
  )
}

/** 上下文用量取值归一：WS payload 是 snake_case、store 通道是 camelCase，两种都接。 */
function contextWindowOf(usage: unknown): { used: number; window: number } {
  const u = (usage ?? {}) as Record<string, unknown>
  const num = (a: unknown, b: unknown) => {
    const v = typeof a === 'number' ? a : typeof b === 'number' ? b : 0
    return Number.isFinite(v) ? v : 0
  }
  return {
    used: num(u.estimated_tokens, u.estimatedTokens),
    window: num(u.max_tokens, u.maxTokens),
  }
}
