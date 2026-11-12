import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '@/stores/session'
import { useChat } from '@/hooks/useChat'
import { Markdown } from '@/components/common/Markdown'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

/** 独立轻量聊天页（/quick-chat.html），与主应用共享 Pinia→zustand store、主题与后端 API。 */
export function QuickChatView() {
  const { sessions, sessionId, initIfNeeded, createSession, switchSession } = useSessionStore()
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [inputText, setInputText] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const creatingRef = useRef(false)

  const chat = useChat(selectedSessionId)
  // error/errorTraceId 是后端 error 事件的「人话原因 + 追踪号」。主窗口渲染它，
  // 而这里此前只渲染 turn.finalAnswer → 失败轮只剩一句「（发生错误，回复未完成）」，
  // 用户看不到模型/额度/网络到底出了什么，也没法反馈 trace。
  const { turns, currentTurn, isStreaming, send, cancel, error, errorTraceId, dismissError } = chat

  // 同步 store 里的会话切换（含子会话 created / done 后切回父会话）
  useEffect(() => {
    if (sessionId && sessionId !== selectedSessionId) setSelectedSessionId(sessionId)
  }, [sessionId, selectedSessionId])

  const mergedTurns = [...turns, ...(currentTurn ? [currentTurn] : [])]
  const showTyping = isStreaming && !currentTurn?.finalAnswer

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [mergedTurns.length, isStreaming])

  useEffect(() => {
    void initIfNeeded().then((ok) => {
      if (!ok) setGlobalError('会话初始化失败，请检查后端服务后重试')
      else if (sessions.length) setSelectedSessionId(sessions[0].session_id)
    })
    textareaRef.current?.focus()
    const onError = (e: Event) => setGlobalError((e as CustomEvent<{ message?: string }>).detail?.message || '发生了意外错误')
    window.addEventListener('maxma:error', onError)
    return () => window.removeEventListener('maxma:error', onError)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onSend = () => {
    const text = inputText.trim()
    if (!text || isStreaming) return
    const sent = send(text, [])
    if (!sent) { setGlobalError('消息发送失败：WebSocket 连接已断开，请重试'); return }
    setInputText('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSend()
    }
  }

  const createNewSession = async () => {
    if (creatingRef.current) return
    creatingRef.current = true
    try {
      await createSession()
      setSelectedSessionId(useSessionStore.getState().sessionId)
    } finally { creatingRef.current = false }
  }

  const closeWindow = () => { window.close(); setDismissed(true) }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="size-5 rounded-md bg-foreground/85" aria-hidden="true" />
        <span className="text-sm font-medium">Quick Chat</span>
        {!dismissed && <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={closeWindow} aria-label="关闭窗口"><X /></Button>}
      </header>

      {dismissed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center" role="status">
          <p className="text-sm">Quick Chat 已收起</p>
          <p className="max-w-xs text-xs text-muted-foreground">彻底关闭请点标签页或窗口自带的 ✕；重新打开请访问 /quick-chat.html</p>
          <Button variant="outline" size="sm" onClick={() => setDismissed(false)}>返回对话</Button>
        </div>
      ) : (
        <>
          {globalError && (
            <div role="alert" className="cursor-pointer border-b border-border bg-destructive/10 px-3 py-2.5 text-xs text-destructive" onClick={() => setGlobalError('')}>{globalError}</div>
          )}
          <div ref={messagesRef} className="flex flex-col flex-1 gap-3 overflow-y-auto p-4">
            {mergedTurns.length === 0 && (
              <div className="pt-16 text-center text-sm text-muted-foreground">
                <p>快速提问，不中断主窗口工作</p>
                <p className="mt-1 text-xs">本页是独立页面，与主窗口共用同一后端与会话</p>
              </div>
            )}
            {mergedTurns.map((turn) => (
              <div key={turn.id} className="flex flex-col gap-2">
                <div className="ml-auto max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">{turn.userMessage}</div>
                {turn.finalAnswer && (
                  <div className="max-w-[85%] rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm">
                    <Markdown content={turn.finalAnswer} />
                  </div>
                )}
                {error && turn.id === mergedTurns[mergedTurns.length - 1]?.id && (
                  <div role="alert" className="flex flex-col max-w-[85%] gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
                    <button type="button" className="text-left" onClick={() => dismissError()}>{error}</button>
                    {errorTraceId && <p className="break-all font-mono text-[10px] opacity-80">trace: {errorTraceId}</p>}
                  </div>
                )}
              </div>
            ))}
            {showTyping && (
              <div className="flex gap-1 px-2" aria-label="正在生成">
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border p-3">
            <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-3">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={isStreaming}
                maxLength={100000}
                placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
                className="max-h-40 min-h-10 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {isStreaming && <Button variant="outline" size="sm" onClick={cancel}>停止</Button>}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <select
                value={selectedSessionId}
                onChange={(e) => { setSelectedSessionId(e.target.value); switchSession(e.target.value) }}
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2.5 text-xs outline-none"
                aria-label="选择会话"
              >
                {sessions.map((s) => <option key={s.session_id} value={s.session_id}>{s.const_name || s.session_id.slice(0, 8)}</option>)}
              </select>
              <Button variant="outline" size="icon-sm" onClick={() => void createNewSession()} aria-label="新会话">+</Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
