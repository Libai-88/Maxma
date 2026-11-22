/**
 * Cowork 桌面通知：只在应用在后台时发系统通知，前台由活动流/任务详情就地展示。
 * 事件 id 去重，避免 SSE 回放或断线重连重复弹同一条。
 */

import type { CoworkEvent } from '@/types/cowork'

const ENABLED_KEY = 'maxma.cowork.notify'
const SEEN_KEY = 'maxma.cowork.notified'

const NOTIFY_TYPES: Record<string, (event: CoworkEvent) => { title: string; body: string }> = {
  'cowork.approval.requested': (event) => ({
    title: '任务需要你的批准',
    body: String(event.payload?.question ?? event.payload?.tool_name ?? '打开 Maxma 查看待审批操作。'),
  }),
  'cowork.run.completed': (event) => ({
    title: '任务等待验收',
    body: String(event.payload?.message ?? '运行完成，产物可以验收。'),
  }),
  'cowork.run.failed': (event) => ({
    title: '任务失败',
    body: String(event.payload?.error ?? '打开 Maxma 查看失败原因。'),
  }),
  'cowork.schedule.triggered': () => ({
    title: '定时任务已启动',
    body: '到点触发一次；应用关闭时不会运行。',
  }),
  'cowork.schedule.failed': (event) => ({
    title: '定时任务触发失败',
    body: String(event.payload?.error ?? '打开 Maxma 查看调度记录。'),
  }),
}

export function notifyEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setNotifyEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? 'on' : 'off')
  } catch {
    // 隐私模式下 localStorage 可能不可用；不影响任务本身。
  }
}

function seenIds(): number[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch {
    return []
  }
}

function remember(id: number): void {
  try {
    const next = [...seenIds().filter((item) => item !== id), id].slice(-300)
    localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  } catch {
    // 去重失败只会多一次通知，不阻断。
  }
}

export function maybeNotifyCowork(event: CoworkEvent): void {
  if (!notifyEnabled()) return
  const build = NOTIFY_TYPES[event.type]
  if (!build) return
  if (seenIds().includes(event.id)) return
  remember(event.id)
  const createdAt = Date.parse(event.created_at ?? '')
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > 5 * 60_000) return
  if (!document.hidden && document.hasFocus()) return
  const bridge = window.maxmaDesktop?.notify
  if (!bridge) return
  const payload = build(event)
  void bridge(payload).catch(() => {
    // 系统通知被系统设置拒绝时不打扰任务流。
  })
}

/** 测试/诊断用：查看哪些事件类型会触发通知。 */
export const COWORK_NOTIFY_EVENT_TYPES = Object.keys(NOTIFY_TYPES)
