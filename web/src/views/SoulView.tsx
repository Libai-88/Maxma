import { useEffect, useState } from 'react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { Spinner } from '@/components/ui/spinner'
import { confirmAction } from '@/components/common/ConfirmDialog'
import { showToast } from '@/lib/toast'
import type { ListPersonasResponse } from '@/types/persona'
import { Plus, Trash2, Pencil, Check } from 'lucide-react'

interface PersonaSummary { id: string; name: string; active?: boolean }

/** 角色设定：人设列表 / 切换 / 新建 / 重命名 / 删除。 */
export default function SoulView() {
  const [personas, setPersonas] = useState<PersonaSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.listPersonas() as ListPersonasResponse & { personas?: PersonaSummary[] }
      setPersonas(res.personas ?? [])
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const switchPersona = async (id: string) => {
    try {
      await api.switchPersona(id)
      showToast('已切换人设')
      await load()
    } catch (e) {
      showToast('切换失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  const createPersona = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      await api.createPersona({ name })
      setNewName('')
      showToast('已创建人设')
      await load()
    } catch (e) {
      showToast('创建失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setCreating(false) }
  }

  const renamePersona = async (id: string) => {
    const name = renameValue.trim()
    if (!name) return
    try {
      await api.renamePersona(id, name)
      setRenaming(null)
      await load()
    } catch (e) {
      showToast('重命名失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  const deletePersona = async (id: string) => {
    if (!await confirmAction({ message: '确定删除该人设？此操作不可撤销。', danger: true, confirmText: '删除' })) return
    try {
      await api.deletePersona(id)
      await load()
    } catch (e) {
      showToast('删除失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  return (
    <div className="app-scroll mx-auto w-full max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h2 className="text-lg font-semibold">角色设定</h2>
        <p className="mt-1 text-sm text-muted-foreground">人设与语气主体。切换后对新会话生效。</p>
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            {personas.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className="min-w-0 flex-1">
                  {renaming === p.id ? (
                    <div className="flex items-center gap-2">
                      <Input className="h-7 w-48" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void renamePersona(p.id) }} autoFocus />
                      <Button variant="ghost" size="icon-sm" aria-label="确认重命名" onClick={() => void renamePersona(p.id)}><Check /></Button>
                    </div>
                  ) : (
                    <p className="truncate text-sm font-medium">
                      {p.name}
                      {p.active && <span className="ml-2 text-xs text-muted-foreground">当前</span>}
                    </p>
                  )}
                </div>
                {renaming !== p.id && (
                  <div className="flex items-center gap-1">
                    {!p.active && <Button variant="outline" size="sm" onClick={() => void switchPersona(p.id)}>切换</Button>}
                    <Button variant="ghost" size="icon-sm" aria-label="重命名" onClick={() => { setRenaming(p.id); setRenameValue(p.name) }}><Pencil /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label="删除人设" onClick={() => void deletePersona(p.id)}><Trash2 /></Button>
                  </div>
                )}
              </div>
            ))}
            {personas.length === 0 && (
              <Panel title="没有人设"><p className="text-sm text-muted-foreground">创建一个人设来定义 Maxma 的语气与性格。</p></Panel>
            )}
          </section>

          <section className="mt-6">
            <div className="flex items-center gap-2">
              <Input className="max-w-xs" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新人设名称"
                onKeyDown={(e) => { if (e.key === 'Enter') void createPersona() }} />
              <Button size="sm" disabled={creating || !newName.trim()} onClick={() => void createPersona()}>
                {creating ? <Spinner className="size-3" /> : <Plus />} 创建
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
