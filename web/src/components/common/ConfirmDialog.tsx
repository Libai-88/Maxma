import { create } from 'zustand'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmState {
  visible: boolean
  options: ConfirmOptions
  resolve: ((ok: boolean) => void) | null
  show: (options: ConfirmOptions | string) => Promise<boolean>
  respond: (ok: boolean) => void
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  visible: false,
  options: { message: '' },
  resolve: null,
  show: (options) => {
    const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options
    const prev = get().resolve
    if (prev) prev(false)
    const { promise, resolve } = Promise.withResolvers<boolean>()
    set({ options: opts, visible: true, resolve })
    return promise
  },
  respond: (ok: boolean) => {
    const resolve = get().resolve
    set({ visible: false, resolve: null })
    resolve?.(ok)
  },
}))

/** 替代 window.confirm：const ok = await confirmAction({ message: '确定删除？', danger: true }) */
export function confirmAction(options: ConfirmOptions | string): Promise<boolean> {
  return useConfirmStore.getState().show(options)
}

export function ConfirmDialog() {
  const visible = useConfirmStore((s) => s.visible)
  const options = useConfirmStore((s) => s.options)
  const respond = useConfirmStore((s) => s.respond)

  return (
    <AlertDialog open={visible} onOpenChange={(open) => { if (!open) respond(false) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options.title || '请确认'}</AlertDialogTitle>
          <AlertDialogDescription>{options.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => respond(false)}>{options.cancelText || '取消'}</AlertDialogCancel>
          <AlertDialogAction onClick={() => respond(true)} className={options.danger ? 'bg-destructive text-destructive-foreground' : undefined}>
            {options.confirmText || '确定'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
