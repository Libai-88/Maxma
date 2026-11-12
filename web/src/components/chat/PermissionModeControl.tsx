import { Button } from '@/components/ui/button'
import { MODE_LABELS, useSessionPermissionMode } from '@/hooks/useSessionPermissionMode'

/**
 * 权限模式四档（标签定义已抽到 hooks/useSessionPermissionMode.ts，这里只渲染）。
 *
 * 与 `bun-sidecar/src/kernel/pi-contract.ts` 的 `MAXMA_PERMISSION_MODES`
 * 逐字对账（`bun-backend/tests/permission-mode-contract.test.ts`）。
 * 顺序 = UI 展示顺序（限制由强到弱）。
 *
 * 唯一真相源是**通道状态** `permissionMode`（内核每次真正写入都会广播
 * `permission_mode_updated`，PERM-ANNOUNCE-001）；GET 只用于首次填充，
 * 迟到响应不得回退已宣告的档位。
 */
export function PermissionModeControl({ sessionId }: { sessionId: string }) {
  const { current, modes, busy, available, change } = useSessionPermissionMode(sessionId)
  const disabled = available.length === 0

  return (
    <div className="flex flex-col gap-1.5">
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
