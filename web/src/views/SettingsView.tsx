import { useEffect, useState } from 'react'
import { api, type SubAgentConfig, type TtsConfig } from '@/api'
import { useChatStore } from '@/stores/chat'
import { useSessionStore } from '@/stores/session'
import { THINKING_LEVELS } from '@/utils/thinkingLevels'
import { Panel } from '@/components/ui/panel'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { showToast } from '@/lib/toast'
import { Spinner } from '@/components/ui/spinner'
import { confirmAction } from '@/components/common/ConfirmDialog'

type Settings = Record<string, unknown>



// 只列**登记表里 consumer 非 none** 的键（拨动必须真的生效）。
// 其余遗留键（compaction.strategy / retry.modelFallback / advisor.* / async.* /
// bash.autoBackground.* / vault.enabled …）登记为 consumer:"none"，面板不得出现。
const SECTIONS = [
  { key: 'compaction', label: '上下文管理' },
  { key: 'model', label: '模型行为' },
  { key: 'images', label: '图片' },
  { key: 'retry', label: '容错' },
  { key: 'interaction', label: '交互' },
  { key: 'reasoning', label: '推理预算' },
  { key: 'memory', label: '记忆' },
  { key: 'skills', label: '技能包' },
  { key: 'voice', label: '语音' },
  { key: 'maintenance', label: '维护' },
  { key: 'subagent', label: '子 Agent' },
]

export default function SettingsView() {
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [panelLoadError, setPanelLoadError] = useState('')
  const [activeSection, setActiveSection] = useState('compaction')
  const [subagent, setSubAgent] = useState<SubAgentConfig>({ enabled: false, max_concurrent: 4, timeout_seconds: 300 })
  const [tts, setTts] = useState<TtsConfig>({ enabled: false, provider: 'system', voice: '', speed: 1.0, pitch: 1.0, auto_read: false })
  const [logs, setLogs] = useState<{ files: Array<{ name: string; size_mb: number }>; count: number; total_mb: number; logs_dir: string } | null>(null)
  const [logsBusy, setLogsBusy] = useState<'load' | 'export' | 'clear' | 'restart' | null>(null)

  // THINKING-CAP-001：当前模型**实际支持**的思考档位（pi 按模型裁剪）。
  // 不支持时引擎会静默钳到最接近的值，界面上不标注就等于让用户选了个假的。
  const sessionId = useSessionStore((s) => s.sessionId)
  const [availableLevels, setAvailableLevels] = useState<string[] | null>(null)
  useEffect(() => {
    if (!sessionId) return
    let alive = true
    void api.getThinkingLevels(sessionId)
      .then((r) => { if (alive) setAvailableLevels(r.available) })
      .catch(() => { /* 拿不到就不标注：宁可不标，也不要标错 */ })
    return () => { alive = false }
  }, [sessionId])

  const thinkingLevel = useChatStore((s) => s.thinkingLevel)
  const setThinkingLevel = useChatStore((s) => s.setThinkingLevel)
  const maxTokens = useChatStore((s) => s.maxTokens)
  const setMaxTokens = useChatStore((s) => s.setMaxTokens)
  const temperature = useChatStore((s) => s.temperature)
  const setTemperature = useChatStore((s) => s.setTemperature)

  const loadSettings = async () => {
    setLoading(true)
    setLoadError('')
    try {
      setSettings((await api.getSettings()) as Settings)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  useEffect(() => {
    void loadSettings()
    void api.getSubAgentConfig().then(setSubAgent).catch(() => setPanelLoadError('子代理面板配置读取失败'))
    void api.getTtsConfig().then(setTts).catch(() => setPanelLoadError('语音面板配置读取失败'))
  }, [])

  const set = (key: string, value: unknown) => {
    setSettings((s) => ({ ...s, [key]: value }))
    void api.setSetting(key, value).catch((e) => showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`, 'error'))
  }

  const toggle = (key: string) => set(key, settings[key] !== true)

  const num = (key: string, fallback: number) => Number(settings[key] ?? fallback)

  const loadLogs = async () => {
    setLogsBusy('load')
    try { setLogs(await api.getLogFiles()) } catch (e) {
      showToast('读取日志列表失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setLogsBusy(null) }
  }

  const exportErrorLog = async () => {
    setLogsBusy('export')
    try {
      const text = await api.getErrorLogText()
      // 浏览器下载：与旧 AppSettingsMenu 同行为（Electron sandbox 下也可用）
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `maxma-error-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`
      a.click()
      URL.revokeObjectURL(url)
      showToast('已导出错误日志')
    } catch (e) {
      showToast('导出失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setLogsBusy(null) }
  }

  const clearOldLogs = async () => {
    if (!await confirmAction({ message: '清理旧日志轮转文件（保留当前日志）？', confirmText: '清理' })) return
    setLogsBusy('clear')
    try {
      const res = await api.clearOldLogs()
      showToast(`已清理 ${res.deleted_count} 个文件，释放 ${res.freed_mb.toFixed(1)} MB`)
      await loadLogs()
    } catch (e) {
      showToast('清理失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setLogsBusy(null) }
  }

  const restartBackend = async () => {
    if (!await confirmAction({ message: '重启后端服务？当前对话会短暂中断，页面将自动重连。', danger: true, confirmText: '重启' })) return
    setLogsBusy('restart')
    try {
      await api.restart()
      showToast('已发送重启指令，等待服务恢复…')
      // 轮询健康检查后刷新页面
      const started = Date.now()
      const timer = setInterval(async () => {
        try {
          const res = await fetch('/api/health')
          if (res.ok) { clearInterval(timer); window.location.reload() }
        } catch { /* 重启中 */ }
        if (Date.now() - started > 60000) { clearInterval(timer); showToast('重启超时，请手动刷新页面', 'error') }
      }, 1500)
    } catch (e) {
      showToast('重启失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
      setLogsBusy(null)
    }
  }

  const Row = ({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  )

  const Slider = ({ k, min, max, step = 1, fallback, suffix }: { k: string; min: number; max: number; step?: number; fallback: number; suffix?: string }) => (
    <div className="flex items-center gap-2">
      <Input type="number" min={min} max={max} step={step} className="w-24" value={String(num(k, fallback))}
        onChange={(e) => set(k, Number((e.target as HTMLInputElement).value))} aria-label={k} />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  )

  return (
    <div className="app-scroll mx-auto w-full max-w-2xl px-6 py-8">
      <header className="mb-6"><h2 className="text-lg font-semibold">设置</h2></header>

      {panelLoadError && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs text-muted-foreground">
          <span>{panelLoadError}</span>
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>重试面板</Button>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">正在读取设置…</div>
      ) : loadError ? (
        <div className="py-16 text-center">
          <p className="text-sm text-destructive">加载失败: {loadError}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadSettings()}>重试</Button>
        </div>
      ) : (
        <>
          <Tabs value={activeSection} onValueChange={setActiveSection}>
            <TabsList className="mb-5 flex-wrap">
              {SECTIONS.map((s) => <TabsTrigger key={s.key} value={s.key}>{s.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>

          <Panel title="上下文管理" className={activeSection === 'compaction' ? '' : 'hidden'}>
            <Row label="启用上下文压缩" desc="当对话过长时自动压缩历史消息，保留结论与关键事实。">
              <Switch checked={settings['compaction.enabled'] !== false} onCheckedChange={() => toggle('compaction.enabled')} aria-label="启用上下文压缩" />
            </Row>
            {/* SETTINGS-VIS-001：这三个键 pi 一直有（默认 16384 / 20000），
                但 Maxma 此前没登记也没暴露，用户只能手改 settings.json。 */}
            <Row label="压缩触发余量" desc="上下文剩余量低于该值就开始压缩。调大=更早压缩、更安全；调小=省更多原文。">
              <Slider k="compaction.reserveTokens" min={2000} max={64000} step={1000} fallback={16384} suffix=" token" />
            </Row>
            <Row label="压缩后保留" desc="压缩时原样保留的近期内容量。调大=保留更多上下文，但更费 token。">
              <Slider k="compaction.keepRecentTokens" min={2000} max={80000} step={1000} fallback={20000} suffix=" token" />
            </Row>
            <Row label="分支摘要不询问" desc="切换分支时直接按默认行为处理，不弹「是否总结离开的分支」。">
              <Switch checked={settings['branchSummary.skipPrompt'] === true} onCheckedChange={() => toggle('branchSummary.skipPrompt')} aria-label="分支摘要不询问" />
            </Row>
          </Panel>

          <Panel title="模型行为" className={activeSection === 'model' ? '' : 'hidden'}>
            <Row label="缓存预热" desc="在跑或空闲时保持模型侧提示缓存的热度，减少重复计费。仅全局生效。">
              <select className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm" aria-label="缓存预热"
                value={String(settings['cacheWarming'] ?? 'streaming')} onChange={(e) => set('cacheWarming', e.target.value)}>
                <option value="streaming">运行中预热</option>
                <option value="idle">空闲也预热</option>
                <option value="off">关闭</option>
              </select>
            </Row>
            <Row label="默认思考档位" desc="新会话使用的推理强度。已有会话不受影响。">
              <select className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm" aria-label="默认思考档位"
                value={String(settings['defaultThinkingLevel'] ?? 'medium')} onChange={(e) => set('defaultThinkingLevel', e.target.value)}>
                <option value="off">关闭</option>
                <option value="minimal">最简</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="xhigh">很高</option>
                <option value="max">最大</option>
              </select>
            </Row>
            <Row label="隐藏思考过程" desc="不展示模型的推理块，只显示最终回答。">
              <Switch checked={settings['hideThinkingBlock'] === true} onCheckedChange={() => toggle('hideThinkingBlock')} aria-label="隐藏思考过程" />
            </Row>
          </Panel>

          <Panel title="图片" className={activeSection === 'images' ? '' : 'hidden'}>
            <Row label="自动缩放" desc="发送前把大图缩到 2000×2000 以内，避免超出模型限制。">
              <Switch checked={settings['images.autoResize'] !== false} onCheckedChange={() => toggle('images.autoResize')} aria-label="图片自动缩放" />
            </Row>
            <Row label="禁止发送图片" desc="开启后图片不会随消息发给模型（仍可留在本地对话里）。">
              <Switch checked={settings['images.blockImages'] === true} onCheckedChange={() => toggle('images.blockImages')} aria-label="禁止发送图片" />
            </Row>
          </Panel>

          <Panel title="容错" className={activeSection === 'retry' ? '' : 'hidden'}>
            <Row label="自动重试" desc="调用失败时自动重试。">
              <Switch checked={settings['retry.enabled'] === true} onCheckedChange={() => toggle('retry.enabled')} aria-label="自动重试" />
            </Row>
            <Row label="最大重试次数">
              <Slider k="retry.maxRetries" min={1} max={10} fallback={3} suffix="次" />
            </Row>
            <Row label="基础退避" desc="指数退避的起始间隔。">
              <Slider k="retry.baseDelayMs" min={100} max={5000} step={100} fallback={1000} suffix="ms" />
            </Row>
          </Panel>

          <Panel title="交互" className={activeSection === 'interaction' ? '' : 'hidden'}>
            <Field>
              <FieldLabel>转向模式</FieldLabel>
              <FieldDescription>连续发送多条消息时的处理方式。</FieldDescription>
              <select className="mt-1 w-56 rounded-lg border border-border bg-background px-3 py-2.5 text-sm" aria-label="转向模式"
                value={String(settings['steeringMode'] ?? 'all')} onChange={(e) => set('steeringMode', e.target.value)}>
                <option value="all">全部接受</option>
                <option value="one-at-a-time">逐条处理</option>
              </select>
            </Field>
            <Field>
              <FieldLabel>追补模式</FieldLabel>
              <FieldDescription>轮次进行中发出的补充要求如何处理。</FieldDescription>
              <select className="mt-1 w-56 rounded-lg border border-border bg-background px-3 py-2.5 text-sm" aria-label="追补模式"
                value={String(settings['followUpMode'] ?? 'queue')} onChange={(e) => set('followUpMode', e.target.value)}>
                <option value="queue">排入下一步</option>
                <option value="steer">立即调整</option>
              </select>
            </Field>
          </Panel>

          <Panel title="推理预算" className={activeSection === 'reasoning' ? '' : 'hidden'}>
            <Row
              label="思考档位"
              desc={
                availableLevels
                  ? `当前模型支持：${availableLevels.join(' / ')}。不支持的档位会被引擎钳到最接近的值。`
                  : '影响 send 时的 thinking 参数（引擎侧预算）。'
              }
            >
              <select className="w-32 rounded-lg border border-border bg-background px-3 py-2.5 text-sm" aria-label="思考档位"
                value={thinkingLevel} onChange={(e) => setThinkingLevel(e.target.value)}>
                {THINKING_LEVELS.map((l) => {
                  // 引擎没报告可用档位时不标注（宁可不标也不要标错）；
                  // 报告了就把不支持的标出来，避免用户选一个会被静默钳掉的档位。
                  const unsupported = availableLevels !== null && !availableLevels.includes(l.value)
                  return (
                    <option key={l.value} value={l.value}>
                      {l.label}{unsupported ? '（当前模型不支持）' : ''}
                    </option>
                  )
                })}
              </select>
            </Row>
            <Row label="输出上限" desc="单轮 max_tokens（本地发送参数）。">
              <input type="number" min={1} value={maxTokens} onChange={(e) => setMaxTokens(Number((e.target as HTMLInputElement).value))}
                className="w-28 rounded-lg border border-border bg-background px-3 py-2.5 text-sm" aria-label="输出上限" />
            </Row>
            <Row label="温度" desc="0 更确定，1 更多样。">
              <input type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(Number((e.target as HTMLInputElement).value))}
                className="w-24 rounded-lg border border-border bg-background px-3 py-2.5 text-sm" aria-label="温度" />
            </Row>
            <Row label="思考预算 · 极简">
              <Slider k="thinkingBudgets.minimal" min={0} max={32000} step={512} fallback={1024} suffix="tokens" />
            </Row>
            <Row label="思考预算 · 低">
              <Slider k="thinkingBudgets.low" min={0} max={64000} step={512} fallback={4096} suffix="tokens" />
            </Row>
            <Row label="思考预算 · 中">
              <Slider k="thinkingBudgets.medium" min={0} max={128000} step={1024} fallback={16384} suffix="tokens" />
            </Row>
            <Row label="思考预算 · 高">
              <Slider k="thinkingBudgets.high" min={0} max={256000} step={1024} fallback={32768} suffix="tokens" />
            </Row>
          </Panel>

          <Panel title="记忆" className={activeSection === 'memory' ? '' : 'hidden'}>
            <Row label="闲置回顾" desc="对话闲置一段时间后自动生成简短进展总结（消耗少量额外 token）。">
              <Switch checked={settings['recap.enabled'] === true} onCheckedChange={() => toggle('recap.enabled')} aria-label="闲置回顾" />
            </Row>
            <Row label="闲置阈值" desc="多久没有交互算「闲置」。">
              <Slider k="recap.idleSeconds" min={30} max={3600} step={30} fallback={300} suffix="秒" />
            </Row>
          </Panel>

          <Panel title="技能包" className={activeSection === 'skills' ? '' : 'hidden'}>
            <Row label="启用技能" desc="从随包与用户目录加载 Agent 技能。">
              <Switch checked={settings['skills.enabled'] !== false} onCheckedChange={() => toggle('skills.enabled')} aria-label="启用技能" />
            </Row>
          </Panel>

          <Panel title="语音" className={activeSection === 'voice' ? '' : 'hidden'}>
            <Row label="语音朗读" desc="使用系统语音朗读回复。">
              <Switch checked={tts.enabled} onCheckedChange={(v) => { setTts({ ...tts, enabled: v }); void api.updateTtsConfig({ ...tts, enabled: v }) }} aria-label="语音朗读" />
            </Row>
            <Row label="自动朗读回复" desc="每轮完成后自动朗读。">
              <Switch checked={tts.auto_read} onCheckedChange={(v) => { setTts({ ...tts, auto_read: v }); void api.updateTtsConfig({ ...tts, auto_read: v }) }} aria-label="自动朗读回复" />
            </Row>
          </Panel>

          <Panel title="维护" className={activeSection === 'maintenance' ? '' : 'hidden'}>
            <Row label="错误日志" desc="导出后端最近收集的异常（诊断用）。">
              <Button variant="outline" size="sm" disabled={logsBusy !== null} onClick={() => void exportErrorLog()}>
                {logsBusy === 'export' ? <Spinner className="size-3" /> : null} 导出
              </Button>
            </Row>
            <Row label="日志文件" desc={logs ? `${logs.count} 个文件，共 ${logs.total_mb.toFixed(1)} MB` : '查看日志目录与占用'}>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={logsBusy !== null} onClick={() => void loadLogs()}>
                  {logsBusy === 'load' ? <Spinner className="size-3" /> : null} 刷新列表
                </Button>
                <Button variant="outline" size="sm" disabled={logsBusy !== null} onClick={() => void clearOldLogs()}>
                  {logsBusy === 'clear' ? <Spinner className="size-3" /> : null} 清理旧日志
                </Button>
              </div>
            </Row>
            {logs && (
              <div className="flex flex-col mt-1 gap-1.5 rounded-lg border border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
                <p className="truncate font-mono">{logs.logs_dir}</p>
                {logs.files.slice(0, 8).map((f) => (
                  <p key={f.name} className="flex justify-between gap-2"><span className="truncate font-mono">{f.name}</span><span>{f.size_mb.toFixed(2)} MB</span></p>
                ))}
                {logs.files.length === 0 && <p>（目录为空）</p>}
              </div>
            )}
            <Row label="重启后端" desc="配置或引擎异常时重启服务；页面会自动重连。">
              <Button variant="destructive" size="sm" disabled={logsBusy !== null} onClick={() => void restartBackend()}>
                {logsBusy === 'restart' ? <Spinner className="size-3" /> : null} 重启
              </Button>
            </Row>
          </Panel>

          <Panel title="子 Agent" className={activeSection === 'subagent' ? '' : 'hidden'}>
            <p className="mb-2 text-xs text-muted-foreground">
              子 Agent 由 pi 的 SDK 进程内会话实现（每次委派独立上下文，只读文件 + 执行命令，不能再委派）。
              开启后模型会获得 <code className="font-mono">subagent</code> 工具；改动对新建会话生效。
            </p>
            <Row label="启用子 Agent" desc="开启后模型可把独立子任务并行委派出去。">
              <Switch checked={subagent.enabled} onCheckedChange={(v) => { setSubAgent({ ...subagent, enabled: v }); void api.updateSubAgentConfig({ ...subagent, enabled: v }) }} aria-label="启用子 Agent" />
            </Row>
            <Row label="最大并行" desc="1–8。超过的任务排队执行。">
              <input
                type="number" min={1} max={8} value={subagent.max_concurrent}
                onChange={(e) => setSubAgent({ ...subagent, max_concurrent: Number(e.target.value) })}
                onBlur={() => void api.updateSubAgentConfig(subagent)}
                className="w-20 rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:border-ring"
                aria-label="最大并行"
              />
            </Row>
            <Row label="单任务超时（秒）" desc="30–1800。超时的子任务按失败返回给父会话。">
              <input
                type="number" min={30} max={1800} value={subagent.timeout_seconds}
                onChange={(e) => setSubAgent({ ...subagent, timeout_seconds: Number(e.target.value) })}
                onBlur={() => void api.updateSubAgentConfig(subagent)}
                className="w-24 rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus-visible:border-ring"
                aria-label="单任务超时"
              />
            </Row>
          </Panel>
        </>
      )}
    </div>
  )
}