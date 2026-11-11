import { useEffect, useRef, useState } from 'react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/common/Markdown'
import { showToast } from '@/lib/toast'

const USER_TEMPLATES = [
  {
    label: '通用用户档案',
    content: `# 关于我

- 称呼：你的称呼
- 身份：学生 / 上班族 / 开发者 / 自由职业者

## 偏好
- 回答风格：直接简洁 / 详细讲解 / 启发引导
- 语言：中文为主，关键术语可用英文
- 代码风格：注释完整、变量名清晰

## 我正在做的事
- （简述你的工作 / 学习 / 兴趣方向）

## 不要做
- 不要给我鸡汤
- 不要假设我用某个操作系统
`,
  },
  {
    label: '开发者档案',
    content: `# 关于我

- 称呼：你的称呼
- 身份：后端开发者，主用 Python / Go
- 工作环境：Windows + VS Code

## 偏好
- 回答要可直接运行的代码，不要省略 import
- 优先使用标准库，避免引入新依赖
- 给出代码前后简单解释思路

## 当前关注
- 分布式系统 / 数据库 / 性能优化

## 不要做
- 不要给我讲课式的长篇大论
- 不要假设我用 macOS
`,
  },
]

/** 用户档案（USER.md）：AI 每次对话自动读取，用来理解你是谁、偏好什么。 */
export default function UserView() {
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void api.request<{ content: string }>('/persona/user')
      .then((res) => { setContent(res.content ?? ''); setSaved(res.content ?? '') })
      .catch((e) => showToast('加载失败: ' + (e instanceof Error ? e.message : String(e)), 'error'))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await api.updatePersona('user', content)
      setSaved(content)
      showToast('已保存')
    } catch (e) {
      showToast('保存失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setSaving(false) }
  }

  return (
    <div className="app-scroll mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-5 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">用户</h2>
        <span className="text-xs uppercase tracking-widest text-muted-foreground">USER</span>
      </header>

      <div className="mb-4 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <p><strong className="text-foreground">USER.md</strong> 是你的「用户档案」，AI 在每次对话时会自动读取这里的内容，用来理解你是谁、喜欢什么、关心什么。写得越具体，AI 越能给你贴心的回答。建议写称呼/身份、偏好、兴趣与禁忌。留空也可以——AI 会基于对话逐步学习你。</p>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {USER_TEMPLATES.map((t) => (
          <Button key={t.label} variant="outline" size="xs" onClick={() => { setContent(t.content); editorRef.current?.focus() }}>{t.label}</Button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
      ) : (
        <>
          <textarea
            ref={editorRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            placeholder="编辑用户描述…"
            className="w-full rounded-xl border border-border bg-card p-4 font-mono text-[13px] leading-relaxed outline-none focus:border-ring"
            aria-label="用户档案编辑器"
          />
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{content === saved ? '与已保存版本一致' : '有未保存的修改'}</p>
            <Button size="sm" disabled={saving || content === saved} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
          {content && (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">预览渲染效果</summary>
              <div className="mt-3 rounded-xl border border-border bg-card p-4">
                <Markdown content={content} />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}
