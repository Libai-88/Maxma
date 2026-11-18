import { useCallback, useEffect, useState } from 'react'
import { attachScrollFade } from './scrollFade'

/**
 * 把滚动容器的边缘状态接到 DOM 上（`data-fade-top` / `data-fade-bottom`），
 * 配合 index.css 里的 `.scroll-fade` 规则渲染渐隐。
 *
 * 用法：`const scrollRef = useScrollFade(); <div ref={scrollRef} className="... scroll-fade">`
 * 注意 `ref` 在挂载前是空的，首帧不会有遮罩——这正好符合「没滚动就不该渐隐」。
 */
export function useScrollFade<T extends HTMLElement = HTMLDivElement>() {
  const [el, setEl] = useState<T | null>(null)
  const ref = useCallback((node: T | null) => setEl(node), [])

  useEffect(() => {
    if (!el) return
    return attachScrollFade(el)
  }, [el])

  return ref
}
