import { useEffect, useState } from 'react'
import { Check, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

type ThemeId = 'light' | 'dark'

// Solid Glass 只有 light / dark 两态；沿用旧外观页的持久化键 `maxma.theme`，
// 保证升级后用户已保存的偏好不会丢失（COMPAT-STORAGE-001）。
const STORAGE_KEY = 'maxma.theme'
const DEFAULT_THEME: ThemeId = 'dark'

interface ThemeMeta {
  id: ThemeId
  name: string
  desc: string
}

const THEMES: ThemeMeta[] = [
  { id: 'light', name: '浅色', desc: '明亮通透的日光玻璃，适合白天与强光环境。' },
  { id: 'dark', name: '深色', desc: '烟熏深色玻璃，Maxma 默认，适合专注与夜间。' },
]

function readStoredTheme(): ThemeId {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function applyTheme(theme: ThemeId): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
}

function persistTheme(theme: ThemeId): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme)
  } catch {
    // 隐私模式 / 存储被禁用：改动仍在本次会话内生效，只是不持久化。
  }
}

export default function AppearanceView() {
  const [theme, setTheme] = useState<ThemeId>(readStoredTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function selectTheme(next: ThemeId) {
    setTheme(next)
    persistTheme(next)
    applyTheme(next)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">外观</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            在浅色与深色主题之间切换。改动立即生效并保存在本机。
          </p>
        </div>

        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
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
                    'group flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors',
                    active
                      ? 'border-primary bg-card shadow-sm'
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
      </div>
    </div>
  )
}
