import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown, renderMarkdownRaw } from '@/utils/markdown'
import { safeCopyText } from '@/lib/clipboard'
import { useMediaViewer } from '@/components/common/MediaViewer'

/**
 * Markdown 渲染（markdown-it + KaTeX + task lists）。
 *
 * 两条增强与旧 `RenderMarkdown.vue` 对齐，都在 DOM 层完成（消毒器会剥离
 * `<button>`，因此复制按钮不能进 markdown 字符串）：
 *  - 每个代码块包一层 `.md-code`，注入语言标签与「复制」按钮（事件委托）；
 *  - 点击图片打开全屏媒体查看器（同容器内图片可左右切换）。
 */
export function Markdown({ content, className, raw = false }: { content: string; className?: string; raw?: boolean }) {
  const html = useMemo(() => (raw ? renderMarkdownRaw(content) : renderMarkdown(content)), [content, raw])
  const ref = useRef<HTMLDivElement>(null)
  const openMedia = useMediaViewer((s) => s.open)

  // 每次渲染后装饰代码块（幂等：已包过的跳过）
  useEffect(() => {
    const root = ref.current
    if (!root) return
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.parentElement?.classList.contains('md-code')) return
      if (!pre.querySelector('code')) return
      const wrap = document.createElement('div')
      wrap.className = 'md-code'
      const codeEl = pre.querySelector('code')
      const langMatch = /language-([\w+-]+)/.exec(codeEl?.className ?? '')
      if (langMatch) {
        const label = document.createElement('span')
        label.className = 'md-code-lang'
        label.textContent = langMatch[1]!
        wrap.append(label)
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'md-code-copy'
      btn.textContent = '复制'
      pre.replaceWith(wrap)
      wrap.append(btn, pre)
    })
  }, [html])

  const onClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement

    // 代码复制（事件委托：流式重渲染后无需重复绑定）
    const copyBtn = target.closest('.md-code-copy') as HTMLElement | null
    if (copyBtn) {
      const code = copyBtn.closest('.md-code')?.querySelector('pre code')
      if (!code) return
      const ok = await safeCopyText(code.textContent ?? '')
      copyBtn.textContent = ok ? '已复制' : '复制失败'
      copyBtn.classList.toggle('is-done', ok)
      copyBtn.classList.toggle('is-failed', !ok)
      setTimeout(() => {
        copyBtn.textContent = '复制'
        copyBtn.classList.remove('is-done', 'is-failed')
      }, 1600)
      return
    }

    // 图片 → 全屏查看（同容器图片可切换）
    if (target.tagName === 'IMG') {
      e.preventDefault()
      const img = target as HTMLImageElement
      const container = img.closest('.markdown-body')
      const all = container ? Array.from(container.querySelectorAll('img')) : [img]
      const items = all.map((im) => ({ src: (im as HTMLImageElement).src, alt: (im as HTMLImageElement).alt }))
      openMedia(items, all.indexOf(img))
    }
  }

  return (
    <div
      ref={ref}
      className={['markdown-body', className].filter(Boolean).join(' ')}
      onClick={(e) => void onClick(e)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}