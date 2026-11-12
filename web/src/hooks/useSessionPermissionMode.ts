import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api'
import { useChatStore } from '@/stores/chat'
import { showToast } from '@/lib/toast'
import type { PermissionMode } from '@/types'

/**
 * 权限模式四档（单份前端真值）。
 *
 * 与 `bun-sidecar/src/kernel/pi-contract.ts` 的 `MAXMA_PERMISSION_MODES`
 * 逐字对账（`bun-backend/tests/permission-mode-contract.test.ts`）。
 * 顺序 = UI 展示顺序（限制由强到弱）。
 *
 * 唯一真相源是**通道状态** `permissionMode`（内核每次真正写入都会广播
 * `permission_mode_updated`，PERM-ANNOUNCE-001）；GET 只用于首次填充，
 * 迟到响应不得回退已宣告的档位。
 */
export const MODE_ORDER: PermissionMode[] = ['read_only', 'ask', 'operate', 'auto']

export const MODE_LABELS: Record<PermissionMode, string> = {
  read_only: '只读（仅读取与查询）',
  ask: '逐次确认',
  operate: '执行前确认',
  auto: '自动执行（免确认）',
}

/** 组合框里用的短标签（长标签留给设置面板）。 */
export const MODE_SHORT_LABELS: Record<PermissionMode, string> = {
  read_only: '只读',
  ask: '逐次确认',
  operate: '执行前确认',
  auto: '自动执行',
}

export interface UseSessionPermissionModeResult {
  current: PermissionMode | null
  modes: PermissionMode[]
  busy: boolean
  available: PermissionMode[]
  change: (mode: PermissionMode) => Promise<boolean>
}

export function useSessionPermissionMode(sessionId: string | undefined): UseSessionPermissionModeResult {
  const [available, setAvailable] = useState<PermissionMode[]>([])
  const [local, setLocal] = useState<PermissionMode | null>(null)
  const [busy, setBusy] = useState(false)
  // 订阅通道里内核宣告的档位（切换会话/广播到达都会重渲染）
  const announced = useChatStore((s) => (sessionId ? s.getChannel(sessionId).permissionMode : null))

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void api.getSessionPermissionMode(sessionId)
      .then((res) => {
        if (cancelled) return
        setAvailable((res.available_permission_modes ?? []).filter((m): m is PermissionMode => MODE_ORDER.includes(m)))
        // PERM-LATE-GET：只填充、不回退——若内核已宣告档位则忽略迟到响应。
        if (!useChatStore.getState().getChannel(sessionId).permissionMode) {
          setLocal(res.permission_mode)
        }
      })
      .catch(() => { if (!cancelled) setAvailable([]) })
    return () => { cancelled = true }
  }, [sessionId])

  const change = useCallback(async (mode: PermissionMode) => {
    if (!sessionId || busy) return false
    setBusy(true)
    try {
      const res = await api.setSessionPermissionMode(sessionId, mode)
      // 服务端回执即真值；广播事件到达后 announced 接管（两者一致）。
      useChatStore.getState().getChannel(sessionId).permissionMode = res.permission_mode
      useChatStore.getState().bump()
      setLocal(res.permission_mode)
      return true
    } catch (e) {
      showToast('切换权限模式失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }, [sessionId, busy])

  const modes = available.length > 0 ? MODE_ORDER.filter((m) => available.includes(m)) : MODE_ORDER
  return { current: announced ?? local, modes, busy, available, change }
}