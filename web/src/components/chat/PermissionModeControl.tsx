import { useEffect, useState } from 'react'
import { api } from '@/api'
import { useChatStore } from '@/stores/chat'
import { Button } from '@/components/ui/button'
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
const MODE_ORDER: PermissionMode[] = ['read_only', 'ask', 'operate', 'auto']

const MODE_LABELS: Record<PermissionMode, string> = {
  read_only: '只读（仅读取与查询）',
  ask: '逐次确认',
  operate: '执行前确认',
  auto: '自动执行（免确认）',
}

export function PermissionModeControl({ sessionId }: { sessionId: string }) {
  const [available, setAvailable] = useState<PermissionMode[]>([])
  const [busy, setBusy] = useState(false)
  const announced = useChatStore((s) => s.getChannel(sessionId).permissionMode)
  const [local, setLocal] = useState<PermissionMode | null>(null)
  const current = announced ?? local

  useEffect(() => {
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

  const change = async (mode: PermissionMode) => {
    if (busy || mode === current) return
    setBusy(true)
    try {
      const res = await api.setSessionPermissionMode(sessionId, mode)
      // 服务端回执即真值；广播事件到达后 announced 接管（两者一致）。
      useChatStore.getState().getChannel(sessionId).permissionMode = res.permission_mode
      useChatStore.getState().bump()
      setLocal(res.permission_mode)
    } catch (e) {
      showToast('切换权限模式失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setBusy(false) }
  }

  const modes = available.length > 0 ? MODE_ORDER.filter((m) => available.includes(m)) : MODE_ORDER
  const disabled = available.length === 0

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">权限模式</p>
      <div role="radiogroup" aria-label="权限模式" className="flex flex-col gap-1">
        {modes.map((mode) => (
          <Button
            key={mode}
            role="radio"
            aria-checked={current === mode}
            variant={current === mode ? 'secondary' : 'ghost'}
            size="sm"
            disabled={busy || disabled}
            className="w-full justify-start text-[12px]"
            onClick={() => void change(mode)}
          >
            {MODE_LABELS[mode]}
            {current === mode && <span className="ml-auto text-[10px] text-muted-foreground">当前</span>}
          </Button>
        ))}
      </div>
      {disabled && <p className="text-[11px] text-muted-foreground">服务端未提供可用档位</p>}
    </div>
  )
}