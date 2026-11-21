/**
 * DesignCanvasPane — 真正的设计画布入口。
 *
 * 结构：顶部项目/画板预设，左侧工具轨，中间 Konva 画板，右侧图层/属性浮层，
 * 底部缩放；旧资料卡片收进可折叠抽屉。所有改动都回写 useDesignCanvas，
 * 导出 PNG 或把图发回对话输入框。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Download,
  Frame,
  Layers,
  Maximize2,
  Redo2,
  Send,
  SlidersHorizontal,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  Check,
  Loader2,
  FolderOpen,
  LayoutTemplate,
  FileCode2,
  Upload,
  MessageSquarePlus,
} from 'lucide-react'

import type { WorkbenchPaneProps } from '../paneProps'
import type { CanvasTool, CanvasView, DesignElement, DesignImageElement } from '@/types/designCanvas'
import { CanvasStage, type CanvasStageHandle } from './CanvasStage'
import { TOOLS, RailButton } from './DesignCanvasRail'
import { CanvasInspector } from './CanvasInspector'
import { CanvasLayers } from './CanvasLayers'
import { CanvasCardsDrawer } from './CanvasCardsDrawer'
import {
  ARTBOARD_PRESETS,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  computeFitView,
  findArtboardPreset,
} from './canvasModel'
import { useDesignCanvas } from './useDesignCanvas'
import { registerDesignCanvasAgent } from './designCanvasAgentBridge'
import { createDesignAsset, useDesignImages } from './useDesignImages'
import { CANVAS_TEMPLATES, exportDesignSvg, importDesignSvg } from './canvasSvg'
import { loadDesignAsset } from './designCanvasStorage'
import { isEditableTarget, safeFileName } from './designCanvasHelpers'
import { normalizeContextItem } from '@/context/contextItems'
import { emitContextItem } from '@/context/contextBus'
import type { DesignProject } from '@/types/designCanvas'

type SidePanel = 'layers' | 'inspector' | null

export function DesignCanvasPane({
  isOpen,
  activeTab,
  sessionId,
  cards,
  onArtifactAction,
  onRemoveCard,
}: WorkbenchPaneProps) {
  const canvas = useDesignCanvas(sessionId)
  const project = canvas.project
  const images = useDesignImages(project)
  const stageRef = useRef<CanvasStageHandle>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const stageHostRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replaceTargetRef = useRef<string | null>(null)
  const fittedRef = useRef('')
  const canvasRef = useRef(canvas)
  canvasRef.current = canvas

  const [tool, setTool] = useState<CanvasTool>('select')
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, scale: 1 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [panel, setPanel] = useState<SidePanel>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedElement = project && canvas.selectedId
    ? project.elements.find((element) => element.id === canvas.selectedId) ?? null
    : null
  const preset = project ? findArtboardPreset(project.artboard.width, project.artboard.height) : null
  const canvasReady = project !== null

  useEffect(() => {
    if (!canvasReady) return
    return registerDesignCanvasAgent(sessionId ?? 'global', {
      getProject: () => canvasRef.current.project,
      getSelectedId: () => canvasRef.current.selectedId,
      commitProject: (recipe) => canvasRef.current.commitProject(recipe),
      select: (id) => canvasRef.current.select(id),
      exportPng: () => stageRef.current?.exportPng() ?? Promise.reject(new Error('画布尚未就绪')),
    })
  }, [canvasReady, sessionId])

  useEffect(() => {
    setNameDraft(project?.name ?? '')
  }, [project?.name])

  useEffect(() => {
    const node = stageHostRef.current
    if (!node) return
    const measure = () => {
      const rect = node.getBoundingClientRect()
      const width = Math.max(0, Math.floor(rect.width))
      const height = Math.max(0, Math.floor(rect.height))
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [canvasReady])

  useEffect(() => {
    if (!project || size.width < 16 || size.height < 16) return
    const key = `${sessionId ?? 'global'}:${project.artboard.width}x${project.artboard.height}`
    if (fittedRef.current === key) return
    fittedRef.current = key
    setView(computeFitView(project.artboard, size.width, size.height, 28))
  }, [project, sessionId, size.width, size.height])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  const fitToScreen = useCallback(() => {
    if (!project || size.width < 16 || size.height < 16) return
    setView(computeFitView(project.artboard, size.width, size.height, 28))
  }, [project, size.width, size.height])

  const zoomTo = useCallback((nextScale: number) => {
    setView((current) => {
      const scale = Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, nextScale))
      if (scale === current.scale) return current
      const centerX = size.width / 2
      const centerY = size.height / 2
      return {
        scale,
        x: centerX - (centerX - current.x) * (scale / current.scale),
        y: centerY - (centerY - current.y) * (scale / current.scale),
      }
    })
  }, [size.width, size.height])

  const switchPanel = (next: SidePanel) => {
    setPanel((current) => (current === next ? null : next))
    setDrawerOpen(false)
  }

  const openImagePicker = (replaceId?: string) => {
    replaceTargetRef.current = replaceId ?? null
    fileInputRef.current?.click()
  }

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const all = Array.from(files)
    const list = all.filter((file) => file.type.startsWith('image/'))
    if (list.length === 0) return
    const replaceId = replaceTargetRef.current
    replaceTargetRef.current = null
    setBusy(true)
    try {
      const svgFiles = list.filter((file) => file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml')
      if (svgFiles.length > 0) {
        if (replaceId) {
          setNotice('替换图片只接受位图；SVG 请用“导入 SVG”追加到画板')
          return
        }
        let imported = 0
        let skipped = 0
        for (const file of svgFiles) {
          const parsed = importDesignSvg(await file.text())
          if (parsed.elements.length === 0) {
            skipped += parsed.warnings.length || 1
            continue
          }
          const artboard = canvasRef.current.project?.artboard
          const scale = Math.min(
            (artboard?.width ?? parsed.width) / parsed.width,
            (artboard?.height ?? parsed.height) / parsed.height,
            1,
          )
          const mapped = parsed.elements.map((element) => {
            const next = {
              ...element,
              x: Math.round(element.x * scale),
              y: Math.round(element.y * scale),
              width: Math.max(1, Math.round(element.width * scale)),
              height: Math.max(1, Math.round(element.height * scale)),
            }
            if (next.type === 'text') next.fontSize = Math.max(6, Math.round(next.fontSize * scale))
            return next
          })
          canvas.commitProject((current) => ({
            ...current,
            elements: [...current.elements, ...mapped].slice(0, 200),
            updatedAt: Date.now(),
          }))
          imported += mapped.length
          skipped += parsed.warnings.length
        }
        setNotice(`已导入 SVG：${imported} 个元素${skipped > 0 ? `，跳过 ${skipped} 个不支持项` : ''}`)
        setTool('select')
        return
      }
      if (replaceId) {
        const asset = await createDesignAsset(list[0])
        if (asset) canvas.replaceElementImage(replaceId, asset)
        setNotice('已替换图片')
        return
      }
      let added = 0
      for (const file of list) {
        const asset = await createDesignAsset(file)
        if (!asset) continue
        canvas.addImage(asset)
        added += 1
      }
      if (added > 0) {
        setNotice(`已放入 ${added} 张图片`)
        setTool('select')
      } else {
        setNotice('图片读取失败，请换一张')
      }
    } catch {
      setNotice('图片读取失败，请换一张')
    } finally {
      setBusy(false)
    }
  }, [canvas])

  const handleTool = (next: CanvasTool) => {
    if (next === 'image') {
      openImagePicker()
      return
    }
    setTool(next)
  }

  const updateSelected = (patch: Partial<DesignElement>) => {
    if (!selectedElement) return
    canvas.updateElement(selectedElement.id, patch)
  }

  const alignSelected = (alignment: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    if (!project || !selectedElement) return
    const patch: Partial<DesignElement> = {}
    if (alignment === 'left') patch.x = 0
    if (alignment === 'hcenter') patch.x = Math.round((project.artboard.width - selectedElement.width) / 2)
    if (alignment === 'right') patch.x = Math.round(project.artboard.width - selectedElement.width)
    if (alignment === 'top') patch.y = 0
    if (alignment === 'vcenter') patch.y = Math.round((project.artboard.height - selectedElement.height) / 2)
    if (alignment === 'bottom') patch.y = Math.round(project.artboard.height - selectedElement.height)
    updateSelected(patch)
  }

  const buildExportDataUrl = useCallback(async () => {
    if (!stageRef.current) throw new Error('画布尚未就绪')
    return stageRef.current.exportPng()
  }, [])

  const handleExport = async () => {
    setBusy(true)
    try {
      const dataUrl = await buildExportDataUrl()
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `${safeFileName(project?.name ?? '设计画布')}.png`
      link.click()
      setNotice('已导出 PNG')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  const handleExportSvg = async () => {
    if (!project) return
    setBusy(true)
    try {
      const assets = new Map<string, Awaited<ReturnType<typeof loadDesignAsset>>>()
      await Promise.all(project.elements
        .filter((element) => element.type === 'image')
        .map(async (element) => {
          const asset = await loadDesignAsset(element.assetId)
          if (asset) assets.set(element.assetId, asset)
        }))
      const svg = exportDesignSvg(project, Array.from(assets.values()).filter((asset): asset is NonNullable<typeof asset> => asset !== null))
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${safeFileName(project.name)}.svg`
      link.click()
      URL.revokeObjectURL(url)
      setNotice('已导出 SVG（文本与矢量元素可继续编辑）')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'SVG 导出失败')
    } finally {
      setBusy(false)
    }
  }

  const applyTemplate = (template: typeof CANVAS_TEMPLATES[number]) => {
    const next: DesignProject = {
      ...template.project,
      name: template.project.name,
      elements: template.project.elements.map((element) => ({ ...element })),
      updatedAt: Date.now(),
    }
    canvas.commitProject(() => next)
    setTemplateOpen(false)
    setNotice(`已应用模板：${template.name}`)
  }

  /** C5：把当前选中元素作为上下文引用送进对话（不导出整张图）。 */
  const referenceSelected = () => {
    if (!selectedElement) {
      setNotice('先在画布上选中一个元素')
      return
    }
    const lines = [
      `元素：${selectedElement.name}（${selectedElement.type}）`,
      `位置：x=${Math.round(selectedElement.x)} y=${Math.round(selectedElement.y)} 尺寸=${Math.round(selectedElement.width)}×${Math.round(selectedElement.height)}`,
    ]
    if (selectedElement.type === 'text') {
      lines.push(`文本：${selectedElement.text}`)
      lines.push(`字号：${selectedElement.fontSize} 字重：${selectedElement.fontWeight} 对齐：${selectedElement.align}`)
    } else if (selectedElement.type === 'image') {
      lines.push(`图片：${selectedElement.alt || selectedElement.assetId} 适配：${selectedElement.fit}`)
    } else {
      lines.push(`填充：${selectedElement.fill} 描边：${selectedElement.stroke} 圆角：${selectedElement.radius}`)
    }
    const item = normalizeContextItem({
      kind: 'canvas-element',
      label: `画布 · ${selectedElement.name}`,
      text: lines.join('\n'),
      meta: {
        画板: `${project?.artboard.width ?? 0}×${project?.artboard.height ?? 0}`,
        元素: selectedElement.id,
        项目: project?.name ?? '设计画布',
      },
    }, sessionId ?? '')
    if (item) {
      emitContextItem(item)
      setNotice(`已引用画布元素「${selectedElement.name}」`)
    }
  }

  const handleSendToChat = async () => {
    setBusy(true)
    try {
      const dataUrl = await buildExportDataUrl()
      window.dispatchEvent(new CustomEvent('maxma:add-image-ref', {
        detail: {
          dataUrl,
          label: `${safeFileName(project?.name ?? '设计画布')}.png`,
          sessionId,
        },
      }))
      setNotice('已发到对话输入框')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '发送失败')
    } finally {
      setBusy(false)
    }
  }

  const placeCard = (card: { title: string; content: string }) => {
    canvas.addCardText(card.content, card.title)
    setDrawerOpen(false)
    setPanel('inspector')
  }

  useEffect(() => {
    if (!isOpen || activeTab !== 'canvas') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) canvas.redo()
        else canvas.undo()
        return
      }
      if (event.key === 'Escape') {
        if (presetOpen) setPresetOpen(false)
        else if (templateOpen) setTemplateOpen(false)
        else if (drawerOpen) setDrawerOpen(false)
        else if (panel) setPanel(null)
        else canvas.select(null)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedElement || selectedElement.locked) return
        event.preventDefault()
        canvas.removeElement(selectedElement.id)
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        setTool('pan')
        return
      }
      const entry = TOOLS.find((item) => item.key.toLowerCase() === key)
      if (entry) {
        event.preventDefault()
        if (entry.id === 'image') openImagePicker()
        else setTool(entry.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, activeTab, presetOpen, templateOpen, drawerOpen, panel, selectedElement, canvas])

  const toolMeta = useMemo(() => TOOLS.find((item) => item.id === tool) ?? TOOLS[0], [tool])

  if (!project) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center gap-2 text-caption text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        正在打开设计画布…
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
      data-design-canvas="true"
      data-project-name={project.name}
      data-element-count={project.elements.length}
      data-selected-id={canvas.selectedId ?? ''}
      data-selected-x={selectedElement ? Math.round(selectedElement.x) : ''}
      data-selected-y={selectedElement ? Math.round(selectedElement.y) : ''}
      data-tool={tool}
      data-artboard-width={project.artboard.width}
      data-artboard-height={project.artboard.height}
      data-view-x={view.x}
      data-view-y={view.y}
      data-view-scale={view.scale}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.svg"
        multiple
        className="hidden"
        aria-label="导入画布图片或 SVG"
        onChange={(event) => {
          const files = event.target.files
          if (files) void handleFiles(files)
          event.target.value = ''
        }}
      />

      <header className="relative z-10 flex shrink-0 items-center gap-1 border-b border-border/70 bg-background/80 px-2 py-1.5">
        <Frame className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          value={nameDraft}
          onChange={(event) => {
            setNameDraft(event.target.value)
            canvas.setProjectName(event.target.value)
          }}
          onBlur={(event) => {
            const raw = event.currentTarget.value.trim().slice(0, 80) || '未命名设计'
            canvas.setProjectName(raw)
            setNameDraft(raw)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              setNameDraft(project.name)
              event.currentTarget.blur()
            }
          }}
          aria-label="设计项目名称"
          className="h-7 min-w-0 flex-1 rounded-md ring-1 ring-transparent bg-transparent px-1 text-ui font-medium text-foreground outline-none duration-fast focus:ring-border/70 focus:bg-background/70"
        />
        <button
          type="button"
          aria-haspopup="menu"
          aria-label="画板尺寸预设"
          aria-expanded={presetOpen}
          onClick={() => setPresetOpen((open) => !open)}
          className="inline-flex h-7 max-w-[124px] shrink-0 items-center gap-1 rounded-md ring-1 ring-border/60 px-1.5 text-caption text-muted-foreground duration-fast hover:bg-muted/50 hover:text-foreground"
        >
          <span className="truncate">{preset?.label ?? `${project.artboard.width}×${project.artboard.height}`}</span>
          <ChevronDown className={`size-3 shrink-0 duration-fast ${presetOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <RailButton label="导入图片或 SVG" disabled={busy} onClick={() => openImagePicker()}>
          <Upload className="size-3.5" />
        </RailButton>
        <RailButton label="导出 SVG" disabled={busy} onClick={() => { void handleExportSvg() }}>
          <FileCode2 className="size-3.5" />
        </RailButton>
        <RailButton label="套用模板" disabled={busy} onClick={() => { setTemplateOpen((open) => !open); setPresetOpen(false) }}>
          <LayoutTemplate className="size-3.5" />
        </RailButton>
        <RailButton label="引用选中元素到对话" disabled={!selectedElement} onClick={referenceSelected}>
          <MessageSquarePlus className="size-3.5" />
        </RailButton>
        <RailButton label="撤销" disabled={!canvas.canUndo} onClick={canvas.undo}><Undo2 className="size-3.5" /></RailButton>
        <RailButton label="重做" disabled={!canvas.canRedo} onClick={canvas.redo}><Redo2 className="size-3.5" /></RailButton>
        <RailButton label="导出 PNG" disabled={busy} onClick={() => { void handleExport() }}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        </RailButton>
        <RailButton label="发到对话" disabled={busy} onClick={() => { void handleSendToChat() }}>
          <Send className="size-3.5" />
        </RailButton>

        {presetOpen && (
          <>
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setPresetOpen(false)} />
            <div
              role="menu"
              aria-label="画板尺寸预设"
              className="elev-3 absolute left-2 right-2 top-full z-50 mt-1 overflow-hidden rounded-xl ring-1 ring-border bg-popover p-1"
            >
              {ARTBOARD_PRESETS.map((item) => {
                const active = item.width === project.artboard.width && item.height === project.artboard.height
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      canvas.applyPreset(item)
                      setPresetOpen(false)
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left duration-fast ${
                      active ? 'bg-secondary text-secondary-foreground' : 'hover:bg-accent/60'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-caption font-medium">{item.label}</span>
                      <span className="mt-0.5 block text-caption text-muted-foreground">{item.hint}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-caption tabular-nums text-muted-foreground">
                      {item.width}×{item.height}
                      {active && <Check className="size-3.5" aria-hidden="true" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
        {templateOpen && (
          <>
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setTemplateOpen(false)} />
            <div
              role="menu"
              aria-label="画布模板"
              className="elev-3 absolute left-2 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl ring-1 ring-border bg-popover p-1"
            >
              <p className="px-2 pb-1 pt-1 text-caption text-muted-foreground">内置模板 · 应用后会替换当前画板内容，可用撤销恢复</p>
              {CANVAS_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  role="menuitem"
                  onClick={() => applyTemplate(template)}
                  className="flex w-full flex-col items-start rounded-md px-2 py-2 text-left duration-fast hover:bg-accent/60"
                >
                  <span className="text-caption font-medium">{template.name}</span>
                  <span className="mt-0.5 text-caption text-muted-foreground">{template.description}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </header>

      <div ref={hostRef} className="relative min-h-0 flex-1 overflow-hidden bg-muted/30">
        <div ref={stageHostRef} className="absolute inset-y-0 left-11 right-11">
          <CanvasStage
            ref={stageRef}
            project={project}
            images={images}
            width={size.width}
            height={size.height}
            view={view}
            tool={tool}
            selectedId={canvas.selectedId}
            onViewChange={setView}
            onSelect={canvas.select}
            onBeginHistory={canvas.beginHistory}
            onUpdateElement={canvas.updateElement}
            onAddText={canvas.addTextAt}
            onAddShape={canvas.addShape}
            onFiles={handleFiles}
          />
        </div>

        <div className="elev-2 absolute left-2 top-2 z-10 flex flex-col gap-1 rounded-lg ring-1 ring-border/70 bg-background/90 p-1">
          {TOOLS.map((item) => {
            const Icon = item.icon
            return (
              <RailButton
                key={item.id}
                label={`${item.label}（${item.key}）`}
                active={tool === item.id}
                onClick={() => handleTool(item.id)}
              >
                <Icon className="size-3.5" />
              </RailButton>
            )
          })}
        </div>

        <div className="elev-2 absolute right-2 top-2 z-10 flex flex-col gap-1 rounded-lg ring-1 ring-border/70 bg-background/90 p-1">
          <RailButton label="图层" active={panel === 'layers'} onClick={() => switchPanel('layers')}>
            <Layers className="size-3.5" />
          </RailButton>
          <RailButton label="属性" active={panel === 'inspector'} onClick={() => switchPanel('inspector')}>
            <SlidersHorizontal className="size-3.5" />
          </RailButton>
          <button
            type="button"
            aria-label={`资料卡片${cards.length ? `（${cards.length}）` : ''}`}
            title="资料卡片"
            onClick={() => {
              setDrawerOpen((open) => !open)
              setPanel(null)
            }}
            className={`elev-1 relative inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground duration-fast ${
              drawerOpen ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/60 bg-background/90 hover:bg-muted/50 hover:text-foreground'
            }`}
          >
            <FolderOpen className="size-3.5" />
            {cards.length > 0 && (
              <span className="absolute -right-1 -top-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-caption text-primary-foreground">
                {cards.length > 9 ? '9+' : cards.length}
              </span>
            )}
          </button>
        </div>

        <div className="elev-1 absolute bottom-2 right-2 z-10 flex items-center gap-0.5 rounded-md ring-1 ring-border/70 bg-background/90 px-1 py-0.5">
          <button
            type="button"
            aria-label="缩小"
            onClick={() => zoomTo(view.scale * 0.85)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground duration-fast hover:bg-muted/50 hover:text-foreground"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <button
            type="button"
            title="适应画布"
            onClick={fitToScreen}
            className="h-6 min-w-11 rounded px-1 text-caption tabular-nums text-muted-foreground duration-fast hover:bg-muted/50 hover:text-foreground"
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            aria-label="放大"
            onClick={() => zoomTo(view.scale * 1.18)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground duration-fast hover:bg-muted/50 hover:text-foreground"
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="适应画布"
            onClick={fitToScreen}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground duration-fast hover:bg-muted/50 hover:text-foreground"
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-2 left-14 z-10 max-w-[60%] rounded bg-background/80 px-1.5 py-1 text-caption text-muted-foreground">
          {toolMeta.hint}
          <span className="mx-1 text-border">·</span>
          {project.artboard.width}×{project.artboard.height}
        </div>

        {busy && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/40">
            <span className="elev-2 inline-flex items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 text-caption text-foreground">
              <Loader2 className="size-3.5 animate-spin" /> 处理中…
            </span>
          </div>
        )}

        {notice && (
          <div role="status" className="elev-2 absolute left-1/2 top-12 z-30 -translate-x-1/2 rounded-full border border-border bg-popover px-3 py-1.5 text-caption text-popover-foreground">
            {notice}
          </div>
        )}

        {panel && (
          <aside className="elev-3 absolute inset-y-0 right-0 z-20 flex w-[min(264px,82%)] flex-col border-l border-border bg-background">
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-2 py-1.5">
              <span className="text-caption font-medium text-foreground">{panel === 'layers' ? '图层' : '属性'}</span>
              <button
                type="button"
                aria-label="关闭侧栏"
                onClick={() => setPanel(null)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {panel === 'layers' ? (
                <CanvasLayers
                  project={project}
                  selectedId={canvas.selectedId}
                  onSelect={canvas.select}
                  onToggleHidden={(id) => {
                    const element = project.elements.find((item) => item.id === id)
                    if (element) canvas.updateElement(id, { hidden: !element.hidden })
                  }}
                  onToggleLocked={(id) => {
                    const element = project.elements.find((item) => item.id === id)
                    if (element) canvas.updateElement(id, { locked: !element.locked })
                  }}
                  onReorder={(id, direction) => canvas.reorder(id, direction === 'forward' ? 'up' : 'down')}
                />
              ) : (
                <CanvasInspector
                  element={selectedElement}
                  artboard={project.artboard}
                  elementCount={project.elements.length}
                  onPatch={updateSelected}
                  onArtboardBackground={canvas.setArtboardBackground}
                  onAlign={alignSelected}
                  onDelete={() => {
                    if (selectedElement) canvas.removeElement(selectedElement.id)
                  }}
                  onDuplicate={() => {
                    if (selectedElement) canvas.duplicateElement(selectedElement.id)
                  }}
                  onToggleHidden={() => {
                    if (selectedElement) canvas.updateElement(selectedElement.id, { hidden: !selectedElement.hidden })
                  }}
                  onToggleLocked={() => {
                    if (selectedElement) canvas.updateElement(selectedElement.id, { locked: !selectedElement.locked })
                  }}
                  onForward={() => {
                    if (selectedElement) canvas.reorder(selectedElement.id, 'up')
                  }}
                  onBackward={() => {
                    if (selectedElement) canvas.reorder(selectedElement.id, 'down')
                  }}
                  onReplaceImage={selectedElement?.type === 'image'
                    ? () => openImagePicker((selectedElement as DesignImageElement).id)
                    : undefined}
                />
              )}
            </div>
          </aside>
        )}

        <CanvasCardsDrawer
          open={drawerOpen}
          cards={cards}
          onClose={() => setDrawerOpen(false)}
          onArtifactAction={onArtifactAction}
          onRemoveCard={onRemoveCard}
          onPlaceCard={placeCard}
        />
      </div>
    </div>
  )
}
