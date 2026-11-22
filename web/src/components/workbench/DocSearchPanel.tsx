/** 文件面板的文档内容检索条：输入、索引状态与命中列表（M3 拆分）。 */
import { FileSearch, RefreshCw, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DocIndexRootStatus, DocSearchHit } from '@/types/workspace'

interface DocSearchPanelProps {
  query: string
  onQueryChange: (value: string) => void
  searching: boolean
  onSearch: () => void
  onClose: () => void
  hits: DocSearchHit[]
  onOpenHit: (hit: DocSearchHit) => void
  status: DocIndexRootStatus | null
}

export function DocSearchPanel({
  query,
  onQueryChange,
  searching,
  onSearch,
  onClose,
  hits,
  onOpenHit,
  status,
}: DocSearchPanelProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索文档内容，例如 热导率 或 marker-page-4"
            className="h-7 pl-7 text-caption"
            onKeyDown={(event) => { if (event.key === 'Enter') onSearch() }}
            aria-label="文档内容检索关键词"
          />
        </div>
        <Button size="sm" variant="outline" disabled={searching || !query.trim()} onClick={onSearch}>
          {searching ? <RefreshCw className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          检索
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="关闭文档检索" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      {status?.status === 'ready' && (
        <p className="text-micro text-muted-foreground">
          索引 {status.fileCount} 文件 / {status.chunkCount} 块
          {status.unsupportedCount > 0 ? ` · ${status.unsupportedCount} 个扫描件未识别` : ''}
        </p>
      )}
      {status && status.status !== 'ready' && (
        <p className="text-micro text-muted-foreground">还没有可用索引；先点文档索引按钮建一次。</p>
      )}
      {hits.length > 0 && (
        <ul className="max-h-44 overflow-y-auto rounded-md border border-border bg-card/40">
          {hits.map((hit) => (
            <li key={`${hit.chunkId}-${hit.path}`} className="border-b border-border/60 last:border-b-0">
              <button type="button" className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-accent/40" onClick={() => onOpenHit(hit)} title={hit.path}>
                <FileSearch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-caption font-medium text-foreground">{hit.relPath}</span>
                    {hit.locatorLabel && <span className="shrink-0 rounded-sm border border-border bg-panel px-2 py-1.5 text-micro text-muted-foreground">{hit.locatorLabel}</span>}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-micro text-muted-foreground">{hit.snippet}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
