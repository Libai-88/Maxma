import { cn } from '@/lib/utils'

/**
 * 空态。之前每个视图各写一行灰字（有的居中、有的左对齐、有的带图标），
 * 一屏空白里只有一句话，看起来像页面坏了。这里把「空」写成一件有形状的事：
 * 一个安静的图标位、一句它是什么、一句你能做什么。
 *
 * 这不是装饰：空态最容易让人以为程序出错，所以它必须回答"下一步在哪"。
 */
export function EmptyState({ icon, title, hint, action, className }: {
  icon?: React.ReactNode
  title: string
  hint?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center', className)}>
      {icon && (
        <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="text-body font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-xs text-meta text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  )
}
