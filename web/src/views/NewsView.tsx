import { useEffect, useState } from 'react'
import { AlertTriangle, FileText, GitPullRequest, Tag } from 'lucide-react'
import { api } from '@/api'
import type { NewsEntry } from '@/types'
import { createLogger } from '@/utils/logger'

const log = createLogger('NewsView')

const TYPE_LABELS: Record<string, string> = {
  feat: '新功能',
  enhance: '增强',
  fix: '修复',
  refactor: '重构',
  docs: '文档',
}

function NewsCard({ entry }: { entry: NewsEntry }) {
  const paragraphs = entry.description
    .split('。')
    .filter(s => s.trim())
    .map(s => s.trim() + '。')
  return (
    <article className="bg-card border border-border rounded-lg p-5 flex flex-col gap-2.5 transition-colors hover:border-ring">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full bg-secondary text-muted-foreground whitespace-nowrap shrink-0">
            {TYPE_LABELS[entry.type] ?? entry.type}
          </span>
          <span className="text-[17px] font-bold text-foreground leading-tight truncate">
            {entry.en_title || entry.title}
          </span>
        </div>
        {entry.version && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-foreground text-background font-mono shrink-0">
            {entry.version}
          </span>
        )}
      </div>
      {entry.en_title && (
        <div className="text-[13px] text-muted-foreground -mt-0.5">{entry.title}</div>
      )}
      <div className="flex flex-col gap-1.5">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-[13px] text-muted-foreground leading-relaxed m-0">{p}</p>
        ))}
      </div>
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entry.tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-secondary text-muted-foreground font-mono">
              <Tag className="size-3" />{tag}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground font-mono">
          <GitPullRequest className="size-3" />#{entry.pr_number}
        </span>
      </div>
    </article>
  )
}

function SkeletonCard() {
  return (
    <div className="p-4 border border-border rounded-lg bg-card">
      <div className="h-[18px] w-3/5 mb-3 rounded bg-muted animate-pulse" />
      <div className="h-3 w-full mb-2 rounded bg-muted animate-pulse" />
      <div className="h-3 w-[70%] rounded bg-muted animate-pulse" />
    </div>
  )
}

export default function NewsView() {
  const [news, setNews] = useState<NewsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)

  async function loadNews() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await api.listNews()
      setNews(res.news.sort((a, b) => b.pr_number - a.pr_number))
    } catch (e) {
      log.error('加载更新动态失败', e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadNews() }, [])

  const timelineItems = (() => {
    const seen = new Set<string>()
    return news
      .filter(entry => {
        if (seen.has(entry.version)) return false
        seen.add(entry.version)
        return true
      })
      .map(entry => entry.version)
  })()

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between gap-4 mb-6">
        <h2 className="text-xl font-semibold text-foreground">更新动态</h2>
        {!loading && !loadError && (
          <span className="text-[13px] text-muted-foreground">共 {news.length} 条更新</span>
        )}
      </div>
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        <div className="flex flex-col gap-5">
          {loading ? (
            <div className="flex flex-col gap-5">
              {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center text-center py-10">
              <AlertTriangle className="size-6 text-muted-foreground mb-3" />
              <div className="font-semibold text-foreground mb-1.5">加载失败</div>
              <div className="text-sm text-muted-foreground leading-relaxed">
                无法获取更新动态，可能是后端未启动或网络异常。<br />
                <button
                  onClick={() => void loadNews()}
                  className="mt-3 px-4 py-1.5 text-sm border border-border rounded-lg bg-card text-foreground hover:border-ring transition-colors"
                >
                  重试
                </button>
              </div>
            </div>
          ) : news.length === 0 ? (
            <div className="flex flex-col items-center text-center py-10">
              <FileText className="size-6 text-muted-foreground mb-3" />
              <div className="font-semibold text-foreground mb-1.5">暂无更新动态</div>
              <div className="text-sm text-muted-foreground leading-relaxed">Maxma 新版本与功能更新会在这里展示。</div>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {news.map(entry => <NewsCard key={entry.id} entry={entry} />)}
            </div>
          )}
        </div>

        {timelineItems.length > 0 && (
          <div className="border border-border rounded-lg bg-card p-4">
            <div className="text-xs font-semibold text-muted-foreground mb-3">版本时间轴</div>
            <div className="flex flex-col gap-2">
              {timelineItems.map(version => (
                <div key={version} className="flex items-center gap-2 text-sm text-foreground">
                  <span className="size-1.5 rounded-full bg-primary shrink-0" />
                  {version}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
