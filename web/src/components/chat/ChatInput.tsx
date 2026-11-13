import { useEffect, useMemo, useRef, useState } from 'react'
import { Composer, ComposerFooter, ComposerFooterEnd, ComposerPick } from '@/components/ui/composer'
import { Button } from '@/components/ui/button'
import type { ModelInfo } from '@/types/chat'
import type { ParsedRef } from '@/utils/references'
import type { ThinkPathId } from '@/utils/thinkPath'
import { safeCopyText } from '@/lib/clipboard'
import { api } from '@/api'
import { MODE_SHORT_LABELS, useSessionPermissionMode } from '@/hooks/useSessionPermissionMode'
import { Paperclip, X, FileText, FolderOpen, Link2, Sticker, Mic } from 'lucide-react'
import { StickerPicker, type Sticker as StickerItem } from '@/components/chat/StickerPicker'
import { useChatStore } from '@/stores/chat'
import { THINKING_LEVELS, thinkingLevelLabel } from '@/utils/thinkingLevels'

export interface SlashCommandDef {
  name: string
  description: string
  usage?: string
  /** PROMPT-TPL-001：来源标记。`template` = pi 发现的提示词模板（非本地命令）。 */
  source?: 'local' | 'template'
}

/** 与旧 useSlashCommands.ts 同一份清单（执行器在 ChatView）。 */
export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'help', description: '显示全部斜杠命令', usage: '/help' },
  { name: 'plan', description: '切换计划模式（先规划后执行）', usage: '/plan' },
  { name: 'goal', description: '设置/替换目标；子命令 pause/resume/drop', usage: '/goal <目标> | pause | resume | drop' },
  { name: 'checkpoint', description: '创建检查点；restore 回到检查点', usage: '/checkpoint [restore]' },
  { name: 'undo', description: '撤回上一轮对话', usage: '/undo' },
  { name: 'retry', description: '重试最后一轮', usage: '/retry' },
  { name: 'compact', description: '压缩上下文历史', usage: '/compact' },
  { name: 'abort-compact', description: '取消正在进行的上下文压缩', usage: '/abort-compact' },
  { name: 'clear', description: '清空当前会话消息', usage: '/clear' },
  { name: 'private', description: '切换私密模式', usage: '/private' },
  { name: 'auto', description: '切换自动执行（免确认）', usage: '/auto' },
]

export interface ChatInputProps {
  /** 当前会话（权限模式切换需要它；未提供时不渲染权限选择器）。 */
  sessionId?: string
  isStreaming: boolean
  connected: boolean
  canSend: boolean
  models: ModelInfo[]
  initialProviderId?: string
  initialModelName?: string
  onSend: (text: string, refs: ParsedRef[], providerId?: string, modelName?: string, thinkPathId?: ThinkPathId, clientMsgId?: string) => boolean
  onStop: () => void
  onModelChange?: (providerId: string, modelName: string) => void
  onSlashCommand?: (name: string, args: string) => Promise<string | void>
  reconnectExhausted?: boolean
  onReconnect?: () => void
}

export function ChatInput(props: ChatInputProps) {
  const { sessionId, isStreaming, connected, canSend, models, initialProviderId, initialModelName, onSend, onStop, onModelChange, onSlashCommand, reconnectExhausted, onReconnect } = props
  const permission = useSessionPermissionMode(sessionId)
  const [text, setText] = useState('')
  const [refs, setRefs] = useState<ParsedRef[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachMenu, setAttachMenu] = useState(false)
  const [stickerOpen, setStickerOpen] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const [providerId, setProviderId] = useState(initialProviderId || models[0]?.provider || '')
  const [modelName, setModelName] = useState(initialModelName || models[0]?.name || '')
  const [atOpen, setAtOpen] = useState(false)
  const [atFilter, setAtFilter] = useState('')
  const [tools, setTools] = useState<Array<{ name: string; label?: string; description?: string }>>([])
  const toolsRequested = useRef(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashActive, setSlashActive] = useState(0)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!providerId && models[0]) setProviderId(models[0].provider)
    if (!modelName && models[0]) setModelName(models[0].name)
  }, [models, providerId, modelName])

  useEffect(() => {
    const onSet = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (typeof detail === 'string') setText(detail)
    }
    window.addEventListener('maxma:set-composer', onSet)
    return () => { window.removeEventListener('maxma:set-composer', onSet) }
  }, [])

  // Composer 的内部 textarea 才是真实输入焦点；这里用事件桥接聚焦请求。
  useEffect(() => {
    const onFocus = () => {
      const el = document.querySelector<HTMLTextAreaElement>('[data-slot="composer"] textarea')
      el?.focus()
    }
    window.addEventListener('maxma:focus-composer', onFocus)
    return () => window.removeEventListener('maxma:focus-composer', onFocus)
  }, [])

  const openAtMenu = async (filter: string) => {
    setAtOpen(true)
    setAtFilter(filter)
    // 只请求一次：逐字输入 @xxx 时不再重复打 /tools
    if (!toolsRequested.current) {
      toolsRequested.current = true
      try { setTools((await api.listTools()) ?? []) } catch { toolsRequested.current = false }
    }
  }

  const atMatches = useMemo(() => {
    const q = atFilter.toLowerCase()
    return tools.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 8)
  }, [tools, atFilter])

  const insertToolMention = (name: string) => {
    setText((prev) => prev.replace(/@\S*$/, `@${name} `))
    setAtOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-slot="composer"] textarea')?.focus())
  }

  // PROMPT-TPL-001：pi 发现的提示词模板也进补全列表。
  // 本地 10 条是 Maxma 自己的命令；模板来自 `~/.pi/agent/prompts/*.md`，
  // 由引擎分发（见 slashCommands.ts 的 default 分支）。此前用户放了模板也看不见。
  // THINK-PICK-001：思考档位直接放在输入框底部——此前只有「设置 → 推理预算」
  // 能改，聊天时想调要跳两层菜单。
  const thinkingLevel = useChatStore((s) => s.thinkingLevel)
  const setThinkingLevel = useChatStore((s) => s.setThinkingLevel)
  const [thinkingOptions, setThinkingOptions] = useState<string[] | null>(null)

  const [templates, setTemplates] = useState<SlashCommandDef[]>([])
  useEffect(() => {
    if (!sessionId) return
    let alive = true
    void api.getPromptTemplates(sessionId)
      .then((res) => {
        if (!alive) return
        setTemplates((res.templates ?? []).map((t) => ({
          name: t.name,
          description: t.description || '提示词模板',
          usage: t.argument_hint ? `/${t.name} ${t.argument_hint}` : `/${t.name}`,
          source: 'template' as const,
        })))
      })
      .catch(() => { /* 会话未就绪时静默：模板是增强项，不该阻断输入 */ })
    return () => { alive = false }
  }, [sessionId])

  // STATE-001：pi 的会话状态。`routed_model` 只在虚拟模型被选中且已有成功应答时非空。
  // 每轮结束后刷新一次——路由结果是"最近一次成功应答"的物理模型，跑完才准。
  const [routedModel, setRoutedModel] = useState<{ provider: string; id: string; name: string } | null>(null)
  useEffect(() => {
    if (!sessionId || isStreaming) return
    let alive = true
    void api.getSessionState(sessionId)
      .then((st) => { if (alive) setRoutedModel(st.routed_model ?? null) })
      .catch(() => { /* 会话未就绪时静默：这是展示增强，不该阻断输入 */ })
    return () => { alive = false }
  }, [sessionId, isStreaming])

  // 当前模型**实际支持**的档位（pi 按模型裁剪）。拿不到时不限制——宁可不限，
  // 也不要凭空隐藏用户能用的档位。
  //
  // ⚠️ 依赖里必须有 isStreaming：会话的模型是 chat-ws 按**每条消息的**
  // provider/model 现切的（`record.session.setModel`），首屏挂载时后端还用着
  // 建会话时的默认模型。只在 sessionId 变化时取，会拿到"上一个模型"的档位表
  // （实测：默认会话是 gpt-4o，只有 off；换成免费推理模型后仍显示 off）。
  // 每轮结束后重取一次即可对齐。
  useEffect(() => {
    if (!sessionId || isStreaming) return
    let alive = true
    void api.getThinkingLevels(sessionId)
      .then((r) => { if (alive) setThinkingOptions(r.available) })
      .catch(() => { /* 静默：这是增强项 */ })
    return () => { alive = false }
  }, [sessionId, isStreaming])

  const slashMatches = useMemo(() => {
    // 只按第一个词过滤：`/goal 完成周报` 仍应命中 goal（参数不算过滤文本）
    const q = slashFilter.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const localNames = new Set(SLASH_COMMANDS.map((c) => c.name))
    // 本地命令优先，模板里同名的跳过（避免一条命令出现两次）。
    const extra = templates.filter((t) => !localNames.has(t.name))
    return [...SLASH_COMMANDS, ...extra].filter((c) => c.name.startsWith(q))
  }, [slashFilter, templates])

  const runSlash = async (name: string, args: string) => {
    setSlashOpen(false)
    setSlashFilter('')
    setText('')
    if (!onSlashCommand) return
    const feedback = await onSlashCommand(name, args)
    if (typeof feedback === 'string' && feedback) setNotice(feedback)
  }

  const addFileRefs = async (kind: 'file' | 'folder') => {
    setAttachMenu(false)
    try {
      const res = kind === 'file' ? await api.selectFile('file') : await api.selectFolder()
      const picked = res as unknown as { path?: string; paths?: string[] }
      const paths = picked.paths ?? (picked.path ? [picked.path] : [])
      if (!paths.length) return
      setRefs((prev) => [...prev, ...paths.map((p) => ({
        type: kind === 'file' ? 'file' : 'folder',
        label: p.split(/[\\/]/).pop() || p,
        path: p,
      } as ParsedRef))])
    } catch (e) {
      setNotice(`${kind === 'file' ? '文件' : '文件夹'}选择失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const addLinkRef = () => {
    const url = linkValue.trim()
    if (!url) return
    try {
      const parsed = new URL(url)
      setRefs((prev) => [...prev, { type: 'web_link', label: parsed.hostname, url: parsed.toString(), domain: parsed.hostname } as ParsedRef])
      setLinkValue(''); setLinkMode(false)
    } catch { setNotice('链接格式无效，请填写完整的 http(s) 地址') }
  }

  const insertSticker = (sticker: StickerItem) => {
    setText((prev) => (prev ? `${prev} <sticker:${sticker.path}>` : `<sticker:${sticker.path}>`))
    setStickerOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-slot="composer"] textarea')?.focus())
  }

  /** 语音输入（Web Speech API 听写，零付费 API）。 */
  const toggleDictation = () => {
    type Rec = new () => {
      lang: string; interimResults: boolean; continuous: boolean
      onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void
      onend: () => void; onerror: () => void
      start: () => void; stop: () => void
    }
    const w = window as unknown as { SpeechRecognition?: Rec; webkitSpeechRecognition?: Rec }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) { setNotice('当前环境不支持语音输入'); return }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }
    const rec = new Ctor()
    rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = false
    rec.onresult = (e) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript
      if (text) setText((prev) => (prev ? `${prev} ${text}` : text))
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => { setListening(false); setNotice('语音识别失败，请检查麦克风权限') }
    recognitionRef.current = rec
    try { rec.start(); setListening(true) } catch { setNotice('无法启动语音输入') }
  }

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const res = await api.uploadImage(file)
        setRefs((prev) => [...prev, {
          type: 'image',
          label: res.filename,
          path: res.path,
          preview: URL.createObjectURL(file),
        } as ParsedRef])
      }
    } catch (e) {
      setNotice('附件上传失败：' + (e instanceof Error ? e.message : String(e)))
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const submit = () => {
    const value = text.trim()
    if (!value) return
    // `/name args`：命中已知命令就带参数执行；未命中的 `/xxx` 才作为普通消息发出。
    const cmdMatch = value.match(/^\/([A-Za-z_-]+)(?:\s+([\s\S]*))?$/)
    if (cmdMatch && SLASH_COMMANDS.some((c) => c.name === cmdMatch[1])) {
      void runSlash(cmdMatch[1], cmdMatch[2] ?? '')
      return
    }
    if (slashOpen && slashMatches[slashActive]) {
      void runSlash(slashMatches[slashActive].name, '')
      return
    }
    if (!connected) {
      setNotice('连接尚未就绪，消息没有发出——请稍候或点「重连」')
      return
    }
    if (!canSend) {
      setNotice('尚未选择模型，消息没有发出')
      return
    }
    if (!providerId || !modelName) {
      // 列表暂时为空时仍允许用上次选中的模型发送；两者都缺失才提示
      setNotice('没有可用的模型，消息没有发出——请先在「模型」里添加渠道')
      return
    }
    const sent = onSend(value, refs, providerId || undefined, modelName || undefined)
    if (sent) { setText(''); setNotice(''); setRefs([]); setAtOpen(false) }
    else setNotice('消息发送失败，请检查连接后重试')
  }

  const modelOptions = useMemo(
    () => models.map((m) => ({ value: `${m.provider}::${m.name}` as string, label: m.displayName || m.name, hint: m.providerLabel })),
    [models],
  )
  const modelKey = providerId && modelName ? `${providerId}::${modelName}` : (modelOptions[0]?.value ?? '')

  return (
    <div className="shrink-0 px-4 pb-4">
      {notice && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{notice}</span>
          <div className="flex items-center gap-2">
            <button className="text-foreground hover:underline" onClick={() => { void safeCopyText(notice) }}>复制</button>
            <button className="hover:text-foreground" onClick={() => setNotice('')} aria-label="关闭提示">✕</button>
          </div>
        </div>
      )}
      {reconnectExhausted && (
        <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
          <span>连接已断开且自动重连失败</span>
          <button className="underline" onClick={onReconnect}>手动重连</button>
        </div>
      )}
      <div className="relative mx-auto max-w-3xl">
        {attachMenu && (
          <div role="menu" aria-label="附件类型" className="absolute bottom-full left-0 z-30 mb-2 w-44 rounded-xl border border-border bg-popover p-2 shadow-lg">
            {[
              { key: 'image', icon: Paperclip, label: '图片', run: () => { setAttachMenu(false); fileRef.current?.click() } },
              { key: 'file', icon: FileText, label: '文件', run: () => void addFileRefs('file') },
              { key: 'folder', icon: FolderOpen, label: '文件夹', run: () => void addFileRefs('folder') },
              { key: 'link', icon: Link2, label: '链接', run: () => { setAttachMenu(false); setLinkMode(true) } },
              { key: 'sticker', icon: Sticker, label: '表情', run: () => { setAttachMenu(false); setStickerOpen(true) } },
            ].map(({ key, icon: Icon, label, run }) => (
              <button key={key} type="button" role="menuitem" onClick={run} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-accent/60">
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
        )}
        {stickerOpen && <StickerPicker onSelect={insertSticker} onClose={() => setStickerOpen(false)} />}
        {linkMode && (
          <div className="absolute bottom-full left-0 z-30 mb-2 flex w-full max-w-md items-center gap-2 rounded-xl border border-border bg-popover p-3 shadow-lg">
            <input
              autoFocus
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addLinkRef(); if (e.key === 'Escape') setLinkMode(false) }}
              placeholder="粘贴链接，例如 https://example.com/a"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2.5 text-xs outline-none"
              aria-label="链接地址"
            />
            <Button size="sm" onClick={addLinkRef}>添加</Button>
            <Button variant="ghost" size="icon-sm" aria-label="取消添加链接" onClick={() => setLinkMode(false)}><X /></Button>
          </div>
        )}
        {atOpen && atMatches.length > 0 && (
          <div role="listbox" aria-label="工具提及" className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-lg">
            {atMatches.map((t) => (
              <button
                key={t.name}
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-accent/50"
                onClick={() => insertToolMention(t.name)}
              >
                <span className="font-mono text-xs">@{t.name}</span>
                <span className="truncate text-muted-foreground">{t.label || t.description || ''}</span>
              </button>
            ))}
          </div>
        )}
        {slashOpen && slashMatches.length > 0 && (
          <div role="listbox" aria-label="斜杠命令" className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-lg">
            {slashMatches.map((c, i) => (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={i === slashActive}
                className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-accent/50 aria-selected:bg-accent"
                onMouseEnter={() => setSlashActive(i)}
                onClick={() => void runSlash(c.name, '')}
              >
                <span className="font-mono text-xs">/{c.name}</span>
                <span className="truncate text-muted-foreground">{c.description}</span>
                {c.source === 'template' ? (
                  <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">模板</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        <Composer
          value={text}
          onValueChange={(next) => {
            setText(next)
            if (next.startsWith('/')) {
              setSlashOpen(true)
              setSlashFilter(next.slice(1))
              setSlashActive(0)
            } else if (slashOpen) {
              setSlashOpen(false)
            }
            // @ 工具提及：光标前是 @ 开头的片段时打开补全
            const at = next.match(/@(\S*)$/)
            if (at) void openAtMenu(at[1])
            else if (atOpen) setAtOpen(false)
          }}
          onSubmit={submit}
          onStop={onStop}
          running={isStreaming}
          canSubmit={canSend && connected && text.trim().length > 0}
          placeholder={connected ? '输入消息… (Enter 发送，Shift+Enter 换行，/ 唤起命令)' : '连接已断开…'}
          className="bg-card"
          textareaProps={{ 'aria-label': '消息输入框', id: 'composer-textarea' }}
          leading={
            <>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onPickFiles(e.target.files)} aria-label="添加附件" />
              <button
                type="button"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
                onClick={() => setAttachMenu((v) => !v)}
                disabled={uploading || isStreaming}
                aria-label="添加附件：文件、文件夹、图片、链接或表情"
                title="添加附件"
              >
                <Paperclip className="size-4" />
              </button>
              <button
                type="button"
                className={listening ? 'flex size-7 shrink-0 items-center justify-center rounded-md text-foreground' : 'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'}
                onClick={toggleDictation}
                disabled={isStreaming}
                aria-pressed={listening}
                aria-label={listening ? '停止语音输入' : '语音输入'}
                title="语音输入（Web Speech）"
              >
                <Mic className="size-4" />
              </button>
            </>
          }
          tags={refs.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground">
              {r.label}
              <button type="button" onClick={() => setRefs((prev) => prev.filter((_, j) => j !== i))} aria-label={`移除 ${r.label}`} className="hover:text-foreground"><X className="size-3" /></button>
            </span>
          ))}
        />
        <ComposerFooter>
          <ComposerPick
            label="模型"
            value={modelKey}
            options={modelOptions}
            onValueChange={(v) => {
              const [pid, name] = v.split('::')
              if (pid && name) { setProviderId(pid); setModelName(name); onModelChange?.(pid, name) }
            }}
          />
          {/* THINK-PICK-001：思考档位。只列当前模型支持的档位；当前值若不在
              支持集里也保留一项并标注，避免选择器显示空白。 */}
          <ComposerPick
            label="思考"
            value={thinkingLevel}
            options={(() => {
              const supported: string[] = thinkingOptions ?? THINKING_LEVELS.map((l) => l.value)
              const opts: { value: string; label: string }[] = THINKING_LEVELS
                .filter((l) => supported.includes(l.value))
                .map((l) => ({ value: l.value as string, label: l.label as string }))
              if (!opts.some((o) => o.value === thinkingLevel)) {
                opts.push({ value: thinkingLevel, label: `${thinkingLevelLabel(thinkingLevel)}（当前模型不支持）` })
              }
              return opts
            })()}
            onValueChange={(v) => setThinkingLevel(v)}
          />
          {/* STATE-001：虚拟模型被选中时，显示**实际应答的物理模型**。
              不显示的话，用户永远不知道自动路由把他发给了谁。 */}
          {routedModel && routedModel.id !== modelName ? (
            <span
              className="shrink-0 text-[11px] text-muted-foreground"
              title={`自动路由：实际由 ${routedModel.provider}/${routedModel.id} 应答`}
            >
              → {routedModel.name || routedModel.id}
            </span>
          ) : null}
          {sessionId && (
            <ComposerPick
              label="权限"
              value={permission.current ?? 'ask'}
              options={permission.modes.map((mode) => ({ value: mode, label: MODE_SHORT_LABELS[mode] }))}
              onValueChange={(v) => void permission.change(v as Parameters<typeof permission.change>[0])}
            />
          )}
          {!connected && <span className="text-[11px] text-muted-foreground">WS 未连接</span>}
          <ComposerFooterEnd>
            <span className="text-[11px] text-muted-foreground">输入 / 唤起命令</span>
          </ComposerFooterEnd>
        </ComposerFooter>
      </div>
    </div>
  )
}
