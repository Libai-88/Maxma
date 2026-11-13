/**
 * components/chat/SessionTreeDialog.tsx — 会话树可视化（TREE-001/002/003）。
 *
 * ## 为什么需要
 *
 * pi 把会话存成 **append-only entry 树 + 活动 leaf**：`/tree` 在同一条分支里移动，
 * `/fork` 从某条消息分出新会话，离开分支时还能生成摘要。这是 pi 的核心能力，
 * 而 Maxma 此前只展示"当前分支的消息列表"——用户完全看不到这段对话分过哪些支。
 *
 * 这个对话框是壳该做的事：把树画出来，让用户能看见、能点、能分叉。
 *
 * ## 交互
 *
 * - 点节点：把 leaf 移到该处（`navigate_tree`），消息区随之变化
 * - 「从此分叉」：以该节点为起点新建会话（`fork_session`），切到新会话
 * - 当前 leaf 高亮
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitBranch, Loader2, RotateCcw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/api'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

export interface SessionTreeDialogProps {
  sessionId: string
  open: boolean
  onClose: () => void
  /** 树内导航完成后调用（通常是刷新消息列表）。 */
  onNavigated?: () => void
  /** 分叉成功后切到新会话。 */
  onForked?: (newSessionId: string) => void
}

interface TreeNode {
  id: string
  parentId: string | null
  type: string
  role: string | null
  preview: string
  timestamp: string | null
  label: string | null
  isLeaf: boolean
  children: TreeNode[]
}

/** 把树压成"根优先的深度优先序列"，带缩进层级——比递归渲染更好控滚动与键盘。 */
function flatten(nodes: TreeNode[], depth = 0, out: Array<{ node: TreeNode; depth: number }> = []) {
  for (const n of nodes) {
    out.push({ node: n, depth })
    flatten(n.children, depth + 1, out)
  }
  return out
}

export function SessionTreeDialog({ sessionId, open, onClose, onNavigated, onForked }: SessionTreeDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [leafId, setLeafId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.getSessionTree(sessionId)
      setNodes(data.tree as TreeNode[])
      setLeafId(data.leaf_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const rows = useMemo(() => flatten(nodes), [nodes])

  async function handleNavigate(node: TreeNode) {
    if (busyId) return
    if (node.id === leafId) {
      showToast('已经在这个位置了', 'info')
      return
    }
    setBusyId(node.id)
    try {
      await api.navigateTree(sessionId, node.id, false)
      setLeafId(node.id)
      showToast('已切换到该分支点', 'info')
      onNavigated?.()
      await load()
    } catch (e) {
      showToast(`切换失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }

  /** CTX-EDIT-001：把该条从未来模型上下文中移除（不删历史）。 */
  async function handleOmit(node: TreeNode) {
    if (busyId) return
    setBusyId(node.id)
    try {
      await api.editContext(sessionId, node.id, { omit: true })
      showToast('已从模型上下文中移除（历史仍保留）', 'info')
      onNavigated?.()
      await load()
    } catch (e) {
      showToast(`移除失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleFork(node: TreeNode) {
    if (busyId) return
    setBusyId(node.id)
    try {
      const res = await api.forkSession(sessionId, node.id)
      showToast('已从该点分出新会话', 'info')
      onForked?.(res.session_id)
      onClose()
    } catch (e) {
      showToast(`分叉失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>会话分支</DialogTitle>
          <DialogDescription>
            这段对话的所有分支。点一行切回该处继续，或从该点分出一个新会话——都不会删除已有内容。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            读取会话树…
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-destructive">读取失败：{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RotateCcw className="mr-1.5 size-3.5" /> 重试
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">这个会话还没有内容</p>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
            {rows.map(({ node, depth }) => (
              <div
                key={node.id}
                className={cn(
                  'group flex items-start gap-2 border-b border-border/60 px-3 py-2 last:border-b-0',
                  node.isLeaf ? 'bg-accent/40' : 'hover:bg-accent/20',
                )}
                style={{ paddingLeft: 12 + depth * 16 }}
              >
                <span className="mt-1 shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {node.role === 'user' ? '你' : node.role === 'assistant' ? 'AI' : '·'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs text-foreground">{node.preview}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                    {node.id.slice(0, 8)}
                    {node.label ? ` · ${node.label}` : ''}
                    {node.isLeaf ? ' · 当前位置' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={busyId !== null || node.isLeaf}
                    onClick={() => void handleNavigate(node)}
                    aria-label={`回到 ${node.id.slice(0, 8)}`}
                  >
                    {busyId === node.id ? <Loader2 className="size-3 animate-spin" /> : '回到这里'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={busyId !== null}
                    onClick={() => void handleFork(node)}
                    aria-label={`从 ${node.id.slice(0, 8)} 分叉`}
                  >
                    <GitBranch className="mr-1 size-3" /> 分叉
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={busyId !== null}
                    onClick={() => void handleOmit(node)}
                    aria-label={`把 ${node.id.slice(0, 8)} 从上下文移除`}
                    title="从模型未来的上下文中移除这一条；历史仍保留，界面不变"
                  >
                    移出上下文
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-muted-foreground">{rows.length} 个节点</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="mr-1 size-3.5" /> 关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
