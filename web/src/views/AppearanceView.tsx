import { useEffect, useState } from 'react'
import { Check, Maximize2, Minimize2, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { applyTheme, readStoredTheme, setTheme, type ThemeId } from '@/lib/theme'
import { readDensity, setDensity, type DensityId } from '@/lib/density'

interface ThemeMeta {
  id: ThemeId
  name: string
  desc: string
}

const THEMES: ThemeMeta[] = [
  { id: 'light', name: '浅色', desc: '明亮通透的日光玻璃，适合白天与强光环境。' },
  { id: 'dark', name: '深色', desc: '烟熏深色玻璃，Maxma 默认，适合专注与夜间。' },
]

interface DensityMeta {
  id: DensityId
  name: string
  desc: string
}

const DENSITIES: DensityMeta[] = [
  { id: 'comfortable', name: '舒适', desc: '导航行高与页面留白更松，适合长时间盯着看。' },
  { id: 'compact', name: '紧凑', desc: '同样的内容占用更少高度，适合小屏与并排窗口。' },
]

export default function AppearanceView() {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme)
  const [density, setDensityState] = useState<DensityId>(readDensity)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function selectTheme(next: ThemeId) {
    setTheme(next)
    setThemeState(next)
  }

  function selectDensity(next: DensityId) {
    setDensity(next)
    setDensityState(next)
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="flex flex-col mx-auto w-full max-w-3xl gap-4 p-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">外观</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            在浅色与深色主题之间切换。改动立即生效并保存在本机。
          </p>
        </div>

        <section className="rounded-lg bg-card p-4">
          <h3 className="text-base font-semibold text-foreground">主题</h3>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            Solid Glass 提供浅色与深色两种材质基调，选择后立即生效并保存在本机。
          </p>
          <div className="grid grid-cols-2 gap-3">
            {THEMES.map((t) => {
              const active = theme === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTheme(t.id)}
                  className={cn(
                    'group flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors duration-fast ease-standard',
                    active
                      // 选中态用主题自己的「the one state」：.glass-chosen 画的是
                      // 一块被点亮的玻璃。原来这里写 border-primary + bg-card，
                      // 而 .bg-card 会把 border-width 归零——那圈边框从来没被画出来过。
                      ? 'glass-chosen'
                      : 'border-border bg-panel hover:border-primary/40',
                  )}
                >
                  <div
                    className={cn(
                      'relative h-20 w-full overflow-hidden rounded-md border border-border',
                      t.id === 'dark' ? 'bg-foreground/10' : 'bg-muted',
                    )}
                  >
                    <span className="absolute left-0 top-0 h-full w-1/3 border-r border-border bg-card/40" />
                    <span className="absolute left-2 top-2 size-2.5 rounded-full bg-primary" />
                    <span className="absolute bottom-2 right-2 text-sm font-semibold text-foreground">Aa</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {t.id === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
                      {t.name}
                    </span>
                    {active && <Check className="size-4 text-primary" />}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{t.desc}</p>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-lg bg-card p-4">
          <h3 className="text-base font-semibold text-foreground">密度</h3>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            只调整纵向节奏（导航行高、页面留白、列表间距）。字号与控件尺寸不随之变化，
            所以「紧凑」不会牺牲可读性，也不会把点击区压到误触的程度。
          </p>
          <div className="grid grid-cols-2 gap-3">
            {DENSITIES.map((d) => {
              const active = density === d.id
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => selectDensity(d.id)}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors duration-fast ease-standard',
                    active ? 'glass-chosen' : 'border-border bg-panel hover:border-primary/40',
                  )}
                  aria-pressed={active}
                >
                  {/* 两行示意：行高差就是这档密度唯一的差别 */}
                  <div
                    className={cn(
                      'flex w-full flex-col justify-center overflow-hidden rounded-md border border-border bg-muted px-2',
                      d.id === 'compact' ? 'gap-1 py-1.5' : 'gap-2 py-2.5',
                    )}
                    aria-hidden="true"
                  >
                    <span className="h-1.5 w-full rounded-sm bg-foreground/25" />
                    <span className="h-1.5 w-2/3 rounded-sm bg-foreground/25" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {d.id === 'compact' ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                      {d.name}
                    </span>
                    {active && <Check className="size-4 text-primary" />}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{d.desc}</p>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
