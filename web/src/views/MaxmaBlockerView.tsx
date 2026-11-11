import { useEffect, useState } from 'react'
import { Ban } from 'lucide-react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BlockerEntry } from '@/types'
import { createLogger } from '@/utils/logger'

const log = createLogger('MaxmaBlockerView')

/** 全局确认对话框的功能等价实现（原生 window.confirm，返回 Promise<boolean>）。 */
function confirmAction(
  options: { title?: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean } | string,
): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options
  const text = opts.title ? `${opts.title}\n\n${opts.message}` : opts.message
  return Promise.resolve(window.confirm(text))
}

const codeCls = 'rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs'
const strongCls = 'font-semibold text-foreground'

export default function MaxmaBlockerView() {
  const [showForm, setShowForm] = useState(false)
  const [entries, setEntries] = useState<BlockerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formPath, setFormPath] = useState('')
  const [formDesc, setFormDesc] = useState('')

  async function loadEntries() {
    setLoading(true)
    try {
      const res = await api.listBlockers()
      setEntries(Array.isArray(res.entries) ? res.entries : [])
    } catch (e) {
      log.error('加载拒止锚失败', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadEntries()
  }, [])

  function startAdd() {
    setFormPath('')
    setFormDesc('')
    setFormError('')
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
  }

  async function pickDir() {
    try {
      const res = await api.selectFolder()
      if (res.path) {
        setFormPath(res.path)
        setFormError('')
      }
    } catch {
      setFormError('选择目录失败')
    }
  }

  async function handleSave() {
    if (!formPath.trim()) return
    setSaving(true)
    setFormError('')
    try {
      await api.addBlocker({ path: formPath.trim(), description: formDesc.trim() })
      await loadEntries()
      setShowForm(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete(i: number) {
    const ok = await confirmAction({
      title: '解除拒止',
      message: `确定解除对此目录的拒止？\n${entries[i].path}\n\nMaxmaBlocker 标记文件将被删除。`,
      confirmText: '解除',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteBlocker(i)
      setEntries((prev) => prev.filter((_, idx) => idx !== i))
    } catch (e) {
      log.error('删除失败', e)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
        {!showForm ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold text-foreground">
                拒止锚 <span className="ml-1 text-sm font-normal text-muted-foreground">MaxmaBlocker</span>
              </h2>
              <Button onClick={startAdd}>添加</Button>
            </div>

            <details open className="overflow-hidden rounded-lg border border-border bg-card">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-foreground">
                什么是拒止锚？什么时候需要用到？
              </summary>
              <div className="space-y-2 px-4 pb-3 text-sm leading-relaxed text-muted-foreground">
                <p>
                  拒止锚（MaxmaBlocker）是 Maxma 的<strong className={strongCls}>执行阻断标记</strong>——在某个目录中放置一个名为 <code className={codeCls}>.maxma_blocker</code> 的标记文件后，AI 的文件类工具调用一旦指向该目录及其子目录，<strong className={strongCls}>会在执行开始前被拦下</strong>，拒绝原因会回给模型。
                </p>
                <p>
                  可以把它理解为 AI 的"禁区铁门"：会话权限模式决定"要不要先问你"，拒止锚决定"问了也不放行"——即使会话切到 <code className={codeCls}>auto</code>（不再弹确认），拒止锚照样拦截。
                </p>
                <p><strong className={strongCls}>典型使用场景</strong>：</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>🔒 <strong className={strongCls}>含敏感信息的财务 / 证件目录</strong>——银行流水、身份证扫描件、合同等，即使模型拿到了文件工具的批准也读不到。</li>
                  <li>📔 <strong className={strongCls}>私人日记 / 心理咨询笔记目录</strong>——属于绝对隐私，不应被 AI 工具触碰。</li>
                  <li>🔑 <strong className={strongCls}>密钥 / 凭证目录</strong>——<code className={codeCls}>.ssh</code>、<code className={codeCls}>.aws</code>、GPG 密钥等，避免任何 AI 误读。</li>
                  <li>🧪 <strong className={strongCls}>正在实验 / 不稳定的项目目录</strong>——避免 AI 误改或误读未完成的代码。</li>
                </ul>
                <p className="rounded-r-md border-l-4 border-primary bg-panel px-3 py-2 text-xs">
                  📋 拒止锚划定"绝对不能碰哪里"；除此之外没有预先放行清单——一次文件操作能不能落地，取决于会话权限模式（默认「每次确认」）。
                </p>
              </div>
            </details>

            <details className="overflow-hidden rounded-lg border border-border bg-card">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-muted-foreground">
                规则说明
              </summary>
              <div className="space-y-2 px-4 pb-3 text-sm leading-relaxed text-muted-foreground">
                <p>拒止锚是无条件生效的强制机制，任何会话权限模式都不得绕过：</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>在指定目录中创建 <code className={codeCls}>.maxma_blocker</code> 标记文件（无扩展名），AI 的文件类工具调用指向该目录或其子目录时，会在执行前被拦下。</li>
                  <li>检查时会从目标路径逐级向上查找，一旦发现任何父目录包含 <code className={codeCls}>.maxma_blocker</code> 文件即强制阻断。</li>
                  <li>拦截只终止这一次工具调用并把原因回给模型，整轮对话不中断；模型可自行改道，其余操作照常。</li>
                  <li>附件上传与路径检查（<code className={codeCls}>check-path-blocked</code>）同样会标记被阻断的路径；路径含 NUL 字节或无法解析时按"存在拒止锚"处理（fail-closed）。</li>
                </ul>
                <p className="rounded-md bg-panel px-3 py-2 text-xs">
                  除拒止锚外，文件访问的约束只剩会话权限模式的逐次确认（会话默认「每次确认」）；<code className={codeCls}>auto</code> 档不弹确认，此时拒止锚是仅存的文件拦截层。
                </p>
              </div>
            </details>

            {loading ? (
              <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">加载中...</div>
            ) : entries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
                <div className="mb-3 text-muted-foreground"><Ban className="mx-auto size-8" /></div>
                <h3 className="mb-2 text-base font-semibold text-foreground">还没有任何拒止锚</h3>
                <p className="mx-auto mb-4 max-w-md text-sm leading-relaxed text-muted-foreground">
                  当前没有放置任何拒止锚，AI 的文件操作只受会话权限模式的逐次确认约束（会话默认「每次确认」，<code className={codeCls}>auto</code> 档不弹确认）。如果有不希望 AI 触及的敏感目录（财务 / 私人笔记 / 密钥），点击下方添加拒止锚，将目录强制阻断。
                </p>
                <Button onClick={startAdd}>+ 添加拒止锚</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {entries.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
                    <div className="min-w-0 flex-1">
                      <div className="break-all font-mono text-sm text-foreground">{entry.path}</div>
                      {entry.description && <div className="mt-1 text-xs text-muted-foreground">{entry.description}</div>}
                    </div>
                    <Button variant="destructive" onClick={() => confirmDelete(i)}>删除</Button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-foreground">添加拒止锚</h2>
            <div className="flex max-w-xl flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">目录</label>
                <div className="flex gap-2">
                  <Input className="font-mono" value={formPath} onChange={(e) => setFormPath(e.target.value)} placeholder="输入或选择目录路径" />
                  <Button variant="outline" onClick={pickDir}>选择目录</Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-foreground">描述（可选）</label>
                <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="用途说明" />
              </div>
              {formError && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={cancelForm}>取消</Button>
                <Button disabled={saving || !formPath.trim()} onClick={handleSave}>
                  {saving ? '创建中...' : '创建拒止锚'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
