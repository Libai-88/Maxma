/**
 * components/chat/ExtensionPromptDialog.tsx — pi 扩展的 ctx.ui 对话框（EXT-UI-001）。
 *
 * 渲染 `extension_ui_request` 里的四种对话框：select / confirm / input / editor。
 * 答复后调用方发 `extension_ui_response` 回给 kernel，兑现扩展那边的 Promise。
 *
 * ## 不复用 confirmAction 的原因
 *
 * `confirmAction` 是**本地** Promise：弹窗 → 用户点 → resolve。扩展对话框是
 * **远程**往返：弹窗 → 用户点 → 发 WS → 等扩展继续。两者不能共用一套 resolve。
 *
 * ## 超时
 *
 * 后端给了 `timeout`（毫秒）。到期前端自动收起并按官方默认值回填：
 * select/input/editor → cancelled（后端会映射成 undefined），confirm → false。
 * 这样扩展不会因为用户走开而永远挂着。
 */

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useExtensionUiStore, type ExtensionUiReply } from '@/stores/extensionUi'

export interface ExtensionPromptDialogProps {
  /** 把答复发给 kernel；未提供时对话框只做展示（无会话时的降级）。 */
  onReply: (id: string, reply: ExtensionUiReply) => void
}

/** 官方默认值：超时/取消时 select、input、editor 返回 undefined，confirm 返回 false。 */
function defaultReplyFor(method: string): ExtensionUiReply {
  return method === 'confirm' ? { confirmed: false } : { cancelled: true }
}

export function ExtensionPromptDialog({ onReply }: ExtensionPromptDialogProps) {
  const queue = useExtensionUiStore((s) => s.queue)
  const shift = useExtensionUiStore((s) => s.shift)
  const req = queue[0] ?? null

  const [value, setValue] = useState('')
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const repliedRef = useRef(false)

  // 换一条请求时重置本地输入与「已答复」标记
  useEffect(() => {
    setValue(req?.prefill ?? '')
    repliedRef.current = false
  }, [req?.id, req?.prefill])

  // 超时倒计时：到期自动按官方默认值回填
  useEffect(() => {
    if (!req?.timeout || req.timeout <= 0) {
      setSecondsLeft(null)
      return
    }
    const deadline = Date.now() + req.timeout
    setSecondsLeft(Math.ceil(req.timeout / 1000))
    const timer = setInterval(() => {
      const left = deadline - Date.now()
      if (left <= 0) {
        clearInterval(timer)
        if (!repliedRef.current) {
          repliedRef.current = true
          onReply(req.id, defaultReplyFor(req.method))
          shift()
        }
        return
      }
      setSecondsLeft(Math.ceil(left / 1000))
    }, 250)
    return () => clearInterval(timer)
  }, [req?.id, req?.timeout, req?.method, onReply, shift])

  if (!req) return null

  /** 答复并出队。`repliedRef` 防重复（点按钮与超时可能同时触发）。 */
  function reply(r: ExtensionUiReply): void {
    if (repliedRef.current) return
    repliedRef.current = true
    onReply(req!.id, r)
    shift()
  }

  const timeoutHint = secondsLeft !== null ? `${secondsLeft}s 后自动${req.method === 'confirm' ? '取消' : '关闭'}` : null

  return (
    <Dialog open onOpenChange={(open) => { if (!open) reply(defaultReplyFor(req.method)) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="break-words">{req.title}</DialogTitle>
          {req.message ? (
            <DialogDescription className="whitespace-pre-wrap break-words">{req.message}</DialogDescription>
          ) : null}
        </DialogHeader>

        {req.method === 'select' ? (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {(req.options ?? []).map((opt) => (
              <Button
                key={opt}
                variant="outline"
                className="h-auto justify-start whitespace-normal break-words px-3.5 py-2.5 text-left"
                onClick={() => reply({ value: opt })}
              >
                {opt}
              </Button>
            ))}
          </div>
        ) : null}

        {req.method === 'input' ? (
          <Input
            autoFocus
            value={value}
            placeholder={req.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') reply({ value }) }}
          />
        ) : null}

        {req.method === 'editor' ? (
          <Textarea
            autoFocus
            value={value}
            className="min-h-40"
            onChange={(e) => setValue(e.target.value)}
          />
        ) : null}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          {timeoutHint ? <span className="text-xs text-muted-foreground">{timeoutHint}</span> : <span />}
          <div className="flex gap-2">
            {req.method !== 'select' ? (
              <Button variant="ghost" onClick={() => reply(defaultReplyFor(req.method))}>取消</Button>
            ) : null}
            {req.method === 'confirm' ? (
              <>
                <Button variant="outline" onClick={() => reply({ confirmed: false })}>否</Button>
                <Button onClick={() => reply({ confirmed: true })}>是</Button>
              </>
            ) : null}
            {req.method === 'input' || req.method === 'editor' ? (
              <Button onClick={() => reply({ value })}>确定</Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
