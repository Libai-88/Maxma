/**
 * CanvasStage — Konva 驱动的设计画板。
 *
 * 画板是世界坐标原点：Stage 的 x/y/scale 只负责视口平移缩放。
 * 元素拖动、按参考线吸附、Transformer 缩放/旋转都在这里完成；
 * 最终几何写回项目状态，由 useDesignCanvas 维护撤销栈。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent as ReactDragEvent } from 'react'
import { Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'

import type { CanvasTool, CanvasView, DesignElement, DesignProject, DesignTextElement } from '@/types/designCanvas'
import {
  CANVAS_FONT_STACKS,
  DESIGN_ANCHOR_FILL,
  DESIGN_ANCHOR_STROKE,
  DESIGN_BOARD_SHADOW,
  DESIGN_DRAFT_FILL,
  DESIGN_GUIDE_COLOR,
  DESIGN_IMAGE_PLACEHOLDER,
  DESIGN_IMAGE_PLACEHOLDER_STROKE,
  DESIGN_SELECTION_COLOR,
  ELEMENT_MIN_SIZE,
  computeFitView,
  snapElementRect,
} from './canvasModel'

export interface CanvasStageHandle {
  exportPng: () => Promise<string>
}

export interface CanvasStageProps {
  project: DesignProject
  images: Record<string, HTMLImageElement>
  width: number
  height: number
  view: CanvasView
  tool: CanvasTool
  selectedId: string | null
  onViewChange: (view: CanvasView) => void
  onSelect: (id: string | null) => void
  onBeginHistory: () => void
  onUpdateElement: (id: string, patch: Partial<DesignElement>, options?: { history?: boolean }) => void
  onAddText: (x: number, y: number) => void
  onAddShape: (type: 'rect' | 'ellipse' | 'line', x: number, y: number, width: number, height: number) => void
  onFiles: (files: FileList) => void
}

interface DraftRect {
  x: number
  y: number
  width: number
  height: number
}

interface EditBox {
  x: number
  y: number
  width: number
  height: number
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function coverCrop(image: HTMLImageElement, frameWidth: number, frameHeight: number): { x: number; y: number; width: number; height: number } {
  const imageWidth = image.naturalWidth || image.width
  const imageHeight = image.naturalHeight || image.height
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight)
  const width = frameWidth / scale
  const height = frameHeight / scale
  return {
    x: (imageWidth - width) / 2,
    y: (imageHeight - height) / 2,
    width,
    height,
  }
}

function nodeRect(element: DesignElement, node: Konva.Node): { x: number; y: number } {
  return element.type === 'ellipse'
    ? { x: node.x() - element.width / 2, y: node.y() - element.height / 2 }
    : { x: node.x(), y: node.y() }
}

function normalizeDraft(startX: number, startY: number, currentX: number, currentY: number): DraftRect {
  return {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  }
}

export const CanvasStage = forwardRef<CanvasStageHandle, CanvasStageProps>(function CanvasStage({
  project,
  images,
  width,
  height,
  view,
  tool,
  selectedId,
  onViewChange,
  onSelect,
  onBeginHistory,
  onUpdateElement,
  onAddText,
  onAddShape,
  onFiles,
}, ref) {
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map())
  const draftStartRef = useRef<{ x: number; y: number } | null>(null)
  const draftRef = useRef<DraftRect | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cancelEditingRef = useRef(false)
  const [draft, setDraft] = useState<DraftRect | null>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [editBox, setEditBox] = useState<EditBox | null>(null)
  const drawing = draft !== null

  const registerNode = useCallback((id: string, node: Konva.Node | null) => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }, [])

  const findElement = useCallback((id: string): DesignElement | undefined => (
    project.elements.find((element) => element.id === id)
  ), [project.elements])

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) return
    const element = selectedId ? findElement(selectedId) : undefined
    const node = selectedId && element && !element.hidden && !element.locked && tool === 'select' && !editingId
      ? nodeRefs.current.get(selectedId)
      : null
    transformer.nodes(node ? [node] : [])
    transformer.visible(Boolean(node))
    transformer.getLayer()?.batchDraw()
  }, [selectedId, tool, editingId, project.elements, findElement])

  useEffect(() => {
    if (!editingId) {
      setEditBox(null)
      return
    }
    const element = findElement(editingId)
    const node = nodeRefs.current.get(editingId)
    if (!element || element.type !== 'text' || !node) {
      setEditingId(null)
      return
    }
    const position = node.getAbsolutePosition()
    setEditBox({
      x: position.x,
      y: position.y,
      width: element.width * view.scale,
      height: element.height * view.scale,
    })
  }, [editingId, findElement, view])

  useEffect(() => {
    if (!editingId) return
    const textarea = textareaRef.current
    textarea?.focus()
    textarea?.select()
  }, [editingId])

  useEffect(() => {
    if (tool !== 'select' && editingId) {
      setEditingId(null)
    }
  }, [tool, editingId])

  useEffect(() => {
    if (!drawing) return
    const finish = () => {
      const start = draftStartRef.current
      const rect = draftRef.current
      if (!start || !rect) {
        setDraft(null)
        draftRef.current = null
        draftStartRef.current = null
        return
      }
      const activeTool = tool === 'rect' || tool === 'ellipse' || tool === 'line' ? tool : 'rect'
      if (activeTool === 'line') {
        onAddShape('line', start.x, start.y, Math.max(32, rect.width), 4)
      } else if (rect.width < ELEMENT_MIN_SIZE && rect.height < ELEMENT_MIN_SIZE) {
        onAddShape(activeTool, start.x, start.y, 240, 140)
      } else {
        onAddShape(activeTool, rect.x, rect.y, Math.max(ELEMENT_MIN_SIZE, rect.width), Math.max(ELEMENT_MIN_SIZE, rect.height))
      }
      setDraft(null)
      draftRef.current = null
      draftStartRef.current = null
    }
    window.addEventListener('pointerup', finish, { once: true })
    return () => window.removeEventListener('pointerup', finish)
  }, [drawing, tool, onAddShape])

  const selectElement = (event: KonvaEventObject<MouseEvent>, id: string) => {
    if (tool !== 'select') return
    event.cancelBubble = true
    onSelect(id)
  }

  const startEditing = (event: KonvaEventObject<MouseEvent>, element: DesignTextElement) => {
    if (tool !== 'select' || element.locked) return
    event.cancelBubble = true
    onSelect(element.id)
    cancelEditingRef.current = false
    setEditingId(element.id)
    setEditingText(element.text)
  }

  const commitEditing = () => {
    if (!editingId) return
    if (cancelEditingRef.current) {
      cancelEditingRef.current = false
      setEditingId(null)
      return
    }
    onUpdateElement(editingId, { text: editingText })
    setEditingId(null)
  }

  const handleDragStart = (id: string) => {
    onBeginHistory()
    onSelect(id)
  }

  const handleDragMove = (event: KonvaEventObject<DragEvent>, element: DesignElement) => {
    const node = event.target
    const raw = nodeRect(element, node)
    const snapped = snapElementRect(
      { ...raw, width: element.width, height: element.height },
      project.artboard,
      project.elements.filter((item) => item.id !== element.id),
      8 / view.scale,
    )
    node.position(element.type === 'ellipse'
      ? { x: snapped.x + element.width / 2, y: snapped.y + element.height / 2 }
      : { x: snapped.x, y: snapped.y })
    setGuides((previous) => (
      previous.x === snapped.guides.x && previous.y === snapped.guides.y ? previous : snapped.guides
    ))
  }

  const handleDragEnd = (event: KonvaEventObject<DragEvent>, element: DesignElement) => {
    const raw = nodeRect(element, event.target)
    onUpdateElement(element.id, { x: Math.round(raw.x), y: Math.round(raw.y) }, { history: false })
    setGuides({})
  }

  const handleTransformEnd = (element: DesignElement) => {
    const node = nodeRefs.current.get(element.id)
    if (!node) return
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    const width = Math.max(ELEMENT_MIN_SIZE, Math.round(element.width * scaleX))
    const height = Math.max(element.type === 'line' ? 1 : ELEMENT_MIN_SIZE, Math.round(element.height * scaleY))
    const x = element.type === 'ellipse' ? Math.round(node.x() - width / 2) : Math.round(node.x())
    const y = element.type === 'ellipse' ? Math.round(node.y() - height / 2) : Math.round(node.y())
    onUpdateElement(element.id, {
      x,
      y,
      width,
      height,
      rotation: Math.round(node.rotation() * 10) / 10,
    }, { history: false })
  }

  const handleStageDown = (event: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current
    if (!stage) return
    const targetName = event.target.name?.() ?? ''
    if (tool === 'select') {
      if (event.target === stage || targetName === 'artboard') onSelect(null)
      return
    }
    if (targetName !== 'artboard') return
    const point = stage.getRelativePointerPosition()
    if (!point) return
    if (tool === 'text') {
      onAddText(Math.round(point.x), Math.round(point.y))
      return
    }
    if (tool === 'image') return
    const start = { x: Math.round(point.x), y: Math.round(point.y) }
    draftStartRef.current = start
    draftRef.current = { ...start, width: 0, height: 0 }
    setDraft({ ...start, width: 0, height: 0 })
  }

  const handleStageMove = () => {
    const stage = stageRef.current
    const start = draftStartRef.current
    if (!stage || !start || !drawing) return
    const point = stage.getRelativePointerPosition()
    if (!point) return
    const rect = normalizeDraft(start.x, start.y, point.x, point.y)
    draftRef.current = rect
    setDraft(rect)
  }

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    if (event.evt.ctrlKey || event.evt.metaKey) {
      const world = {
        x: (pointer.x - view.x) / view.scale,
        y: (pointer.y - view.y) / view.scale,
      }
      const nextScale = Math.min(4, Math.max(0.05, view.scale * (event.evt.deltaY > 0 ? 0.9 : 1.1)))
      onViewChange({
        x: pointer.x - world.x * nextScale,
        y: pointer.y - world.y * nextScale,
        scale: nextScale,
      })
      return
    }
    onViewChange({
      x: view.x - event.evt.deltaX,
      y: view.y - event.evt.deltaY,
      scale: view.scale,
    })
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length) {
      event.preventDefault()
      const transfer = new DataTransfer()
      files.forEach((file) => transfer.items.add(file))
      onFiles(transfer.files)
    }
  }

  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      const stage = stageRef.current
      if (!stage) throw new Error('画布尚未就绪')
      const transformer = transformerRef.current
      const previous = { x: stage.x(), y: stage.y(), scaleX: stage.scaleX(), scaleY: stage.scaleY() }
      const transformerWasVisible = transformer?.visible() ?? false
      const fit = computeFitView(project.artboard, width, height, 0)
      transformer?.visible(false)
      stage.scale({ x: fit.scale, y: fit.scale })
      stage.position({ x: fit.x, y: fit.y })
      stage.batchDraw()
      await nextFrame()
      try {
        return stage.toDataURL({
          x: fit.x,
          y: fit.y,
          width: project.artboard.width * fit.scale,
          height: project.artboard.height * fit.scale,
          pixelRatio: 1 / fit.scale,
          mimeType: 'image/png',
        })
      } finally {
        stage.scale({ x: previous.scaleX, y: previous.scaleY })
        stage.position({ x: previous.x, y: previous.y })
        transformer?.visible(transformerWasVisible)
        stage.batchDraw()
        await nextFrame()
      }
    },
  }), [project.artboard, width, height])

  const baseProps = (element: DesignElement) => ({
    ref: (node: Konva.Node | null) => registerNode(element.id, node),
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    opacity: element.opacity,
    visible: !element.hidden,
    draggable: tool === 'select' && !element.locked,
    listening: tool === 'select' && !element.hidden,
    onMouseDown: (event: KonvaEventObject<MouseEvent>) => selectElement(event, element.id),
    onDragStart: () => handleDragStart(element.id),
    onDragMove: (event: KonvaEventObject<DragEvent>) => handleDragMove(event, element),
    onDragEnd: (event: KonvaEventObject<DragEvent>) => handleDragEnd(event, element),
  })

  const renderElement = (element: DesignElement) => {
    if (element.type === 'text') {
      return (
        <Text
          key={element.id}
          {...baseProps(element)}
          width={element.width}
          height={element.height}
          text={element.text}
          fontSize={element.fontSize}
          fontFamily={CANVAS_FONT_STACKS[element.fontFamily]}
          fontStyle={element.fontWeight >= 600 ? 'bold' : 'normal'}
          fill={element.color}
          align={element.align}
          lineHeight={element.lineHeight}
          letterSpacing={element.letterSpacing}
          wrap="word"
          visible={!element.hidden && editingId !== element.id}
          onDblClick={(event) => startEditing(event, element)}
        />
      )
    }

    if (element.type === 'image') {
      const image = images[element.assetId]
      if (!image) {
        return (
          <Group key={element.id} {...baseProps(element)}>
            <Rect
              width={element.width}
              height={element.height}
              fill={DESIGN_IMAGE_PLACEHOLDER}
              stroke={DESIGN_IMAGE_PLACEHOLDER_STROKE}
              strokeWidth={1}
              cornerRadius={element.radius}
              dash={[6, 4]}
            />
            <Text
              width={element.width}
              height={element.height}
              text="图片未加载"
              align="center"
              verticalAlign="middle"
              fontSize={Math.max(10, Math.min(18, element.width / 12))}
              fill={DESIGN_IMAGE_PLACEHOLDER_STROKE}
              listening={false}
            />
          </Group>
        )
      }
      return (
        <KonvaImage
          key={element.id}
          {...baseProps(element)}
          width={element.width}
          height={element.height}
          image={image}
          crop={coverCrop(image, element.width, element.height)}
          cornerRadius={element.radius}
        />
      )
    }

    if (element.type === 'ellipse') {
      return (
        <Ellipse
          key={element.id}
          {...baseProps(element)}
          x={element.x + element.width / 2}
          y={element.y + element.height / 2}
          radiusX={element.width / 2}
          radiusY={element.height / 2}
          fill={element.fill === 'transparent' ? undefined : element.fill}
          stroke={element.stroke === 'transparent' ? undefined : element.stroke}
          strokeWidth={element.strokeWidth}
        />
      )
    }

    if (element.type === 'line') {
      return (
        <Line
          key={element.id}
          {...baseProps(element)}
          points={[0, 0, element.width, 0]}
          stroke={element.stroke}
          strokeWidth={Math.max(1, element.strokeWidth)}
          hitStrokeWidth={12}
        />
      )
    }

    return (
      <Rect
        key={element.id}
        {...baseProps(element)}
        width={element.width}
        height={element.height}
        fill={element.fill === 'transparent' ? undefined : element.fill}
        stroke={element.stroke === 'transparent' ? undefined : element.stroke}
        strokeWidth={element.strokeWidth}
        cornerRadius={element.radius}
      />
    )
  }

  const selectedElement = selectedId ? findElement(selectedId) : undefined
  const editingElement = editingId ? findElement(editingId) : undefined
  const cursorClass = tool === 'pan'
    ? 'cursor-grab active:cursor-grabbing'
    : tool === 'select'
      ? 'cursor-default'
      : 'cursor-crosshair'

  return (
    <div
      className={`absolute inset-0 touch-none outline-none ${cursorClass}`}
      tabIndex={0}
      role="application"
      aria-label="设计画布"
      data-design-stage="true"
      onDrop={handleDrop}
      onDragOver={(event) => event.preventDefault()}
      onPaste={handlePaste}
    >
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={tool === 'pan'}
        onDragEnd={(event) => onViewChange({ x: event.target.x(), y: event.target.y(), scale: view.scale })}
        onMouseDown={handleStageDown}
        onMouseMove={handleStageMove}
        onWheel={handleWheel}
      >
        <Layer>
          <Rect
            name="artboard"
            x={0}
            y={0}
            width={project.artboard.width}
            height={project.artboard.height}
            fill={project.artboard.background}
            shadowColor={DESIGN_BOARD_SHADOW}
            shadowBlur={36}
            shadowOffsetY={18}
            shadowOpacity={0.7}
          />
          <Group clipX={0} clipY={0} clipWidth={project.artboard.width} clipHeight={project.artboard.height}>
            {project.elements.map(renderElement)}
          </Group>

          {guides.x !== undefined && (
            <Line
              points={[guides.x, 0, guides.x, project.artboard.height]}
              stroke={DESIGN_GUIDE_COLOR}
              strokeWidth={1 / view.scale}
              dash={[8 / view.scale, 6 / view.scale]}
              listening={false}
            />
          )}
          {guides.y !== undefined && (
            <Line
              points={[0, guides.y, project.artboard.width, guides.y]}
              stroke={DESIGN_GUIDE_COLOR}
              strokeWidth={1 / view.scale}
              dash={[8 / view.scale, 6 / view.scale]}
              listening={false}
            />
          )}

          {draft && tool !== 'text' && tool !== 'image' && tool !== 'select' && (
            tool === 'ellipse' ? (
              <Ellipse
                x={draft.x + draft.width / 2}
                y={draft.y + draft.height / 2}
                radiusX={draft.width / 2}
                radiusY={draft.height / 2}
                fill={DESIGN_DRAFT_FILL}
                stroke={DESIGN_SELECTION_COLOR}
                strokeWidth={1 / view.scale}
                dash={[6 / view.scale, 4 / view.scale]}
                listening={false}
              />
            ) : tool === 'line' ? (
              <Line
                points={[draft.x, draft.y, draft.x + draft.width, draft.y]}
                stroke={DESIGN_SELECTION_COLOR}
                strokeWidth={2 / view.scale}
                listening={false}
              />
            ) : (
              <Rect
                x={draft.x}
                y={draft.y}
                width={draft.width}
                height={draft.height}
                fill={DESIGN_DRAFT_FILL}
                stroke={DESIGN_SELECTION_COLOR}
                strokeWidth={1 / view.scale}
                dash={[6 / view.scale, 4 / view.scale]}
                listening={false}
              />
            )
          )}

          <Transformer
            ref={transformerRef}
            rotateEnabled
            flipEnabled={false}
            keepRatio={false}
            anchorSize={8}
            anchorCornerRadius={4}
            anchorFill={DESIGN_ANCHOR_FILL}
            anchorStroke={DESIGN_ANCHOR_STROKE}
            borderStroke={DESIGN_SELECTION_COLOR}
            borderStrokeWidth={1.5}
            padding={2}
            boundBoxFunc={(oldBox, nextBox) => (
              nextBox.width < ELEMENT_MIN_SIZE || nextBox.height < ELEMENT_MIN_SIZE ? oldBox : nextBox
            )}
            onTransformStart={onBeginHistory}
            onTransformEnd={() => {
              if (selectedElement) handleTransformEnd(selectedElement)
            }}
            visible={false}
          />
        </Layer>
      </Stage>

      {editingId && editingElement?.type === 'text' && editBox && (
        <textarea
          ref={textareaRef}
          value={editingText}
          onChange={(event) => setEditingText(event.target.value)}
          onBlur={commitEditing}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditingRef.current = true
              setEditingId(null)
            }
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              commitEditing()
            }
          }}
          aria-label="编辑画布文字"
          className="absolute z-20 resize-none overflow-hidden rounded-sm ring-1 ring-primary/60 bg-transparent p-0 outline-none"
          style={{
            left: editBox.x,
            top: editBox.y,
            width: editBox.width,
            height: editBox.height,
            color: editingElement.color,
            fontFamily: CANVAS_FONT_STACKS[editingElement.fontFamily],
            fontSize: editingElement.fontSize * view.scale,
            fontWeight: editingElement.fontWeight,
            lineHeight: editingElement.lineHeight,
            letterSpacing: editingElement.letterSpacing * view.scale,
            textAlign: editingElement.align,
            background: project.artboard.background,
            transform: editingElement.rotation ? `rotate(${editingElement.rotation}deg)` : undefined,
            transformOrigin: 'left top',
          }}
        />
      )}
    </div>
  )
})
