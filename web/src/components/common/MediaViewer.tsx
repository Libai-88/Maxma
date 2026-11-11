import { create } from 'zustand'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

export interface MediaItem { src: string; alt?: string }

interface MediaState {
  items: MediaItem[]
  currentIndex: number
  open: (list: MediaItem[], startIndex?: number) => void
  close: () => void
  next: () => void
  prev: () => void
}

export const useMediaViewer = create<MediaState>((set, get) => ({
  items: [],
  currentIndex: -1,
  open: (list, startIndex = 0) => {
    if (!list.length) return
    set({ items: list, currentIndex: Math.max(0, Math.min(startIndex, list.length - 1)) })
  },
  close: () => set({ currentIndex: -1 }),
  next: () => {
    const { currentIndex, items } = get()
    if (currentIndex < items.length - 1) set({ currentIndex: currentIndex + 1 })
  },
  prev: () => {
    const { currentIndex } = get()
    if (currentIndex > 0) set({ currentIndex: currentIndex - 1 })
  },
}))

export function MediaViewer() {
  const { items, currentIndex, close, next, prev } = useMediaViewer()
  const isOpen = currentIndex >= 0
  const current = isOpen ? items[currentIndex] : null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-w-[92vw] border-border bg-popover p-3">
        <DialogTitle className="sr-only">媒体预览</DialogTitle>
        {current && (
          <div className="relative flex flex-col items-center gap-3">
            <img src={current.src} alt={current.alt || '媒体预览'} className="max-h-[78vh] max-w-full rounded-lg object-contain" />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon-sm" onClick={prev} disabled={currentIndex <= 0} aria-label="上一张"><ChevronLeft /></Button>
              <span className="min-w-16 text-center text-xs text-muted-foreground">{currentIndex + 1} / {items.length}</span>
              <Button variant="outline" size="icon-sm" onClick={next} disabled={currentIndex >= items.length - 1} aria-label="下一张"><ChevronRight /></Button>
              <Button variant="ghost" size="icon-sm" onClick={close} aria-label="关闭"><X /></Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
