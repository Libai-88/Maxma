/** 画布键盘/文件名的纯函数，从 DesignCanvasPane 拆出以控制主文件体量。 */

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable
    || Boolean(target.closest('button, a, [role="button"], [role="menuitem"], [role="menuitemradio"]'))
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '-').trim()
  return cleaned || '设计画布'
}
