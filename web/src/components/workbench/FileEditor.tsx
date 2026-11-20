/**
 * FileEditor — 工作台文本编辑器（P2）。
 *
 * 只编辑工作区内的 UTF-8 文本。保存必须带回读取时的 base_hash：
 * 后端据此拒绝覆盖外部改动。编辑器本身不直接调 API，由 FilesPane
 * 统一处理 dirty 状态、保存与冲突。
 */

import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'

interface FileEditorProps {
  path: string
  name: string
  value: string
  autoFocus?: boolean
  onChange: (value: string) => void
  onSave: () => void
}

function languageFor(name: string) {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return javascript({ typescript: ext === 'ts' || ext === 'tsx', jsx: ext === 'tsx' || ext === 'jsx' })
  }
  if (ext === 'json') return json()
  if (['md', 'markdown'].includes(ext)) return markdown()
  if (['css', 'scss'].includes(ext)) return css()
  if (['html', 'htm'].includes(ext)) return html()
  if (ext === 'py') return python()
  return []
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
    fontSize: 'var(--text-caption, 12px)',
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono, monospace)', lineHeight: '1.6' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--foreground)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted-foreground)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--accent) 35%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 22%, transparent)',
  },
  '.cm-panels': { backgroundColor: 'var(--popover)', color: 'var(--foreground)', borderColor: 'var(--border)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklab, var(--primary) 25%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', color: 'var(--foreground)', border: '1px solid var(--border)' },
})

export function FileEditor({ path, name, value, autoFocus, onChange, onSave }: FileEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const suppressRef = useRef(false)
  const changeRef = useRef(onChange)
  const saveRef = useRef(onSave)
  const valueRef = useRef(value)

  changeRef.current = onChange
  saveRef.current = onSave
  valueRef.current = value

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                saveRef.current()
                return true
              },
            },
            { key: 'Mod-f', run: openSearchPanel, preventDefault: true },
          ]),
          languageFor(name),
          editorTheme,
          EditorView.contentAttributes.of({ 'aria-label': `编辑 ${path}`, spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || suppressRef.current) return
            changeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    if (autoFocus) view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 只在文件身份变化时重建；同一文件的增量编辑由下方同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, name, path])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    suppressRef.current = true
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    suppressRef.current = false
  }, [value])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-card/40" />
}
