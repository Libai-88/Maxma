/**
 * 设计画布的 Agent 操作模型：纯函数、单事务、可单测。
 *
 * 这里只改项目数据结构，不碰 React/Konva/IndexedDB。图片资源由 bridge 先落成
 * DesignAsset，再以 `asset` 字段注入 add_image；这样撤销栈仍只保存元数据。
 */
import { generateUUID } from '@/utils/env'
import type {
  CanvasFontFamily,
  CanvasFontWeight,
  CanvasImageFit,
  CanvasTextAlign,
  DesignAsset,
  DesignElement,
  DesignProject,
} from '@/types/designCanvas'
import {
  ARTBOARD_PRESETS,
  ELEMENT_MIN_SIZE,
  createImageElement,
  createShapeElement,
  createTextElement,
  normalizeDesignProject,
  reorderElements,
} from './canvasModel'

const MAX_OPERATIONS = 60
const MAX_ELEMENTS = 200
const MAX_TEXT_LENGTH = 20_000
const MAX_NAME_LENGTH = 80

const FONT_WEIGHTS: readonly CanvasFontWeight[] = [400, 500, 600, 700]
const FONT_FAMILIES: readonly CanvasFontFamily[] = ['sans', 'serif', 'mono']
const TEXT_ALIGNS: readonly CanvasTextAlign[] = ['left', 'center', 'right']
const IMAGE_FITS: readonly CanvasImageFit[] = ['cover', 'contain']
const SHAPES = ['rect', 'ellipse', 'line'] as const

type ShapeType = (typeof SHAPES)[number]

export type CanvasAgentOperation =
  | { op: 'rename'; name: string }
  | { op: 'preset'; preset: string }
  | { op: 'artboard'; width?: number; height?: number; background?: string }
  | {
      op: 'add_text'
      text: string
      x?: number
      y?: number
      width?: number
      height?: number
      name?: string
      fontSize?: number
      fontWeight?: CanvasFontWeight
      fontFamily?: CanvasFontFamily
      color?: string
      align?: CanvasTextAlign
      lineHeight?: number
      letterSpacing?: number
      rotation?: number
      opacity?: number
    }
  | {
      op: 'add_shape'
      shape: ShapeType
      x?: number
      y?: number
      width?: number
      height?: number
      name?: string
      fill?: string
      stroke?: string
      strokeWidth?: number
      radius?: number
      rotation?: number
      opacity?: number
    }
  | {
      op: 'add_image'
      /** bridge 注入：图片已落成 IndexedDB 资源。 */
      asset?: DesignAsset
      x?: number
      y?: number
      width?: number
      height?: number
      name?: string
      fit?: CanvasImageFit
      radius?: number
      rotation?: number
      opacity?: number
    }
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'remove'; id: string }
  | { op: 'duplicate'; id: string }
  | { op: 'reorder'; id: string; direction: 'up' | 'down' }
  | { op: 'select'; id: string | null }
  | { op: 'clear' }
  | { op: 'undo' }
  | { op: 'redo' }

export interface CanvasAgentApplyResult {
  project: DesignProject
  changed: boolean
  selectedId: string | null
  addedIds: string[]
  changedIds: string[]
  removedIds: string[]
  messages: string[]
  history: boolean
}

export interface CanvasAgentElementSummary {
  id: string
  type: DesignElement['type']
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  locked: boolean
  hidden: boolean
  [key: string]: unknown
}

export interface CanvasAgentProjectSummary {
  name: string
  artboard: DesignProject['artboard']
  elementCount: number
  elements: CanvasAgentElementSummary[]
  selectedId: string | null
  updatedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : fallback
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.trim().slice(0, 40) || fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampElementBox(
  element: DesignElement,
  artboard: DesignProject['artboard'],
): DesignElement {
  const width = clamp(Math.round(element.width), ELEMENT_MIN_SIZE, artboard.width)
  const height = clamp(
    Math.round(element.height),
    element.type === 'line' ? 1 : ELEMENT_MIN_SIZE,
    artboard.height,
  )
  return {
    ...element,
    width,
    height,
    x: Math.round(clamp(element.x, 0, Math.max(0, artboard.width - width))),
    y: Math.round(clamp(element.y, 0, Math.max(0, artboard.height - height))),
  }
}

function findElement(project: DesignProject, id: string): DesignElement {
  const element = project.elements.find((item) => item.id === id)
  if (!element) throw new Error(`找不到元素 ${id}`)
  return element
}

function applyTextSize(
  element: DesignElement,
  artboard: DesignProject['artboard'],
  op: Record<string, unknown>,
): DesignElement {
  const fallbackWidth = Math.min(720, Math.round(artboard.width * 0.86))
  const width = clamp(Math.round(readNumber(op.width, fallbackWidth)), ELEMENT_MIN_SIZE, artboard.width)
  const fallbackHeight = Math.min(220, Math.round(artboard.height * 0.2))
  const height = clamp(Math.round(readNumber(op.height, fallbackHeight)), ELEMENT_MIN_SIZE, artboard.height)
  return {
    ...element,
    width,
    height,
    x: Math.round(readNumber(op.x, artboard.width * 0.07)),
    y: Math.round(readNumber(op.y, artboard.height * 0.09)),
    rotation: readNumber(op.rotation, 0),
    opacity: clamp(readNumber(op.opacity, 1), 0, 1),
  }
}

function appendElement(
  project: DesignProject,
  element: DesignElement,
  addedIds: string[],
): DesignProject {
  if (project.elements.length >= MAX_ELEMENTS) {
    throw new Error(`画布元素超过上限 ${MAX_ELEMENTS}`)
  }
  addedIds.push(element.id)
  return { ...project, elements: [...project.elements, element] }
}

/** 把 Agent 操作应用到项目快照；一个 operations 数组只产生一次撤销记录。 */
export function applyDesignOperations(
  source: DesignProject,
  operations: readonly CanvasAgentOperation[],
  currentSelectedId: string | null = null,
): CanvasAgentApplyResult {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('operations 不能为空')
  }
  if (operations.length > MAX_OPERATIONS) {
    throw new Error(`一次最多提交 ${MAX_OPERATIONS} 个操作`)
  }

  let project = source
  let selectedId = currentSelectedId
  let changed = false
  const addedIds: string[] = []
  const changedIds: string[] = []
  const removedIds: string[] = []
  const messages: string[] = []

  for (const raw of operations) {
    if (!isRecord(raw) || typeof raw.op !== 'string') throw new Error('operation 必须是带 op 的对象')
    const op = raw.op

    if (op === 'rename') {
      const name = readString(raw.name, '', MAX_NAME_LENGTH)
      if (!name) throw new Error('rename 需要非空 name')
      project = { ...project, name }
      changed = true
      changedIds.push('project')
      continue
    }

    if (op === 'preset') {
      const key = readString(raw.preset, '', 80)
      const preset = ARTBOARD_PRESETS.find((item) => item.id === key || item.label === key)
      if (!preset) throw new Error(`未知画板预设 ${key}`)
      project = {
        ...project,
        artboard: { ...project.artboard, width: preset.width, height: preset.height },
      }
      changed = true
      changedIds.push('artboard')
      messages.push(`画板切换为 ${preset.label} ${preset.width}×${preset.height}`)
      continue
    }

    if (op === 'artboard') {
      const width = clamp(Math.round(readNumber(raw.width, project.artboard.width)), 64, 4096)
      const height = clamp(Math.round(readNumber(raw.height, project.artboard.height)), 64, 4096)
      const background = readColor(raw.background, project.artboard.background)
      project = { ...project, artboard: { width, height, background } }
      changed = true
      changedIds.push('artboard')
      continue
    }

    if (op === 'add_text') {
      const text = readString(raw.text, '', MAX_TEXT_LENGTH)
      if (!text) throw new Error('add_text 需要非空 text')
      const base = createTextElement(
        readNumber(raw.x, project.artboard.width * 0.07),
        readNumber(raw.y, project.artboard.height * 0.09),
        project.elements,
      )
      const sized = applyTextSize(base, project.artboard, raw)
      const element: DesignElement = {
        ...sized,
        type: 'text',
        text,
        name: readString(raw.name, base.name, MAX_NAME_LENGTH),
        fontSize: clamp(readNumber(raw.fontSize, base.fontSize), 6, 600),
        fontWeight: FONT_WEIGHTS.includes(raw.fontWeight as CanvasFontWeight)
          ? raw.fontWeight as CanvasFontWeight
          : base.fontWeight,
        fontFamily: FONT_FAMILIES.includes(raw.fontFamily as CanvasFontFamily)
          ? raw.fontFamily as CanvasFontFamily
          : base.fontFamily,
        color: readColor(raw.color, base.color),
        align: TEXT_ALIGNS.includes(raw.align as CanvasTextAlign)
          ? raw.align as CanvasTextAlign
          : base.align,
        lineHeight: clamp(readNumber(raw.lineHeight, base.lineHeight), 0.6, 4),
        letterSpacing: clamp(readNumber(raw.letterSpacing, base.letterSpacing), -20, 120),
      }
      project = appendElement(project, clampElementBox(element, project.artboard), addedIds)
      selectedId = element.id
      changed = true
      continue
    }

    if (op === 'add_shape') {
      const shape = SHAPES.includes(raw.shape as ShapeType) ? raw.shape as ShapeType : null
      if (!shape) throw new Error('add_shape 的 shape 必须是 rect/ellipse/line')
      const fallbackWidth = Math.min(320, Math.round(project.artboard.width * 0.42))
      const fallbackHeight = shape === 'line' ? 4 : Math.min(220, Math.round(project.artboard.height * 0.24))
      const base = createShapeElement(
        shape,
        readNumber(raw.x, project.artboard.width * 0.08),
        readNumber(raw.y, project.artboard.height * 0.12),
        readNumber(raw.width, fallbackWidth),
        readNumber(raw.height, fallbackHeight),
        project.elements,
      )
      const element: DesignElement = {
        ...base,
        type: shape,
        name: readString(raw.name, base.name, MAX_NAME_LENGTH),
        fill: readColor(raw.fill, base.fill),
        stroke: readColor(raw.stroke, base.stroke),
        strokeWidth: clamp(readNumber(raw.strokeWidth, base.strokeWidth), 0, 240),
        radius: shape === 'rect' ? clamp(readNumber(raw.radius, base.radius), 0, 4096) : 0,
        rotation: readNumber(raw.rotation, 0),
        opacity: clamp(readNumber(raw.opacity, 1), 0, 1),
      }
      project = appendElement(project, clampElementBox(element, project.artboard), addedIds)
      selectedId = element.id
      changed = true
      continue
    }

    if (op === 'add_image') {
      const assetRaw = raw.asset
      if (
        !isRecord(assetRaw)
        || typeof assetRaw.id !== 'string'
        || typeof assetRaw.name !== 'string'
        || typeof assetRaw.width !== 'number'
        || typeof assetRaw.height !== 'number'
        || typeof assetRaw.dataUrl !== 'string'
      ) {
        throw new Error('add_image 缺少已落盘的图片 asset')
      }
      const asset = assetRaw as unknown as DesignAsset
      const base = createImageElement(asset, project.artboard, project.elements)
      const requestedWidth = raw.width === undefined ? undefined : Math.round(readNumber(raw.width, base.width))
      const requestedHeight = raw.height === undefined ? undefined : Math.round(readNumber(raw.height, base.height))
      let width = requestedWidth ?? base.width
      let height = requestedHeight ?? base.height
      if (requestedWidth !== undefined && requestedHeight === undefined) {
        height = Math.round((requestedWidth * asset.height) / Math.max(1, asset.width))
      } else if (requestedHeight !== undefined && requestedWidth === undefined) {
        width = Math.round((requestedHeight * asset.width) / Math.max(1, asset.height))
      }
      const element: DesignElement = {
        ...base,
        width,
        height,
        x: Math.round(readNumber(raw.x, base.x)),
        y: Math.round(readNumber(raw.y, base.y)),
        name: readString(raw.name, base.name, MAX_NAME_LENGTH),
        fit: IMAGE_FITS.includes(raw.fit as CanvasImageFit) ? raw.fit as CanvasImageFit : base.fit,
        radius: clamp(readNumber(raw.radius, base.radius), 0, 4096),
        rotation: readNumber(raw.rotation, 0),
        opacity: clamp(readNumber(raw.opacity, 1), 0, 1),
      }
      project = appendElement(project, clampElementBox(element, project.artboard), addedIds)
      selectedId = element.id
      changed = true
      continue
    }

    if (op === 'update') {
      const id = readString(raw.id, '', 128)
      if (!id) throw new Error('update 需要 id')
      const patch = raw.patch
      if (!isRecord(patch)) throw new Error('update 的 patch 必须是对象')
      const target = findElement(project, id)
      if (patch.type !== undefined && patch.type !== target.type) {
        throw new Error('update 不允许改变元素 type')
      }
      project = {
        ...project,
        elements: project.elements.map((item) => (
          item.id === id ? { ...item, ...patch, id, type: target.type } as DesignElement : item
        )),
      }
      changed = true
      changedIds.push(id)
      continue
    }

    if (op === 'remove') {
      const id = readString(raw.id, '', 128)
      if (!id) throw new Error('remove 需要 id')
      findElement(project, id)
      project = { ...project, elements: project.elements.filter((item) => item.id !== id) }
      removedIds.push(id)
      if (selectedId === id) selectedId = null
      changed = true
      continue
    }

    if (op === 'duplicate') {
      const id = readString(raw.id, '', 128)
      if (!id) throw new Error('duplicate 需要 id')
      const source = findElement(project, id)
      const copy: DesignElement = {
        ...source,
        id: generateUUID(),
        name: `${source.name.slice(0, 74)} 副本`,
        x: source.x + 24,
        y: source.y + 24,
      }
      project = appendElement(project, copy, addedIds)
      selectedId = copy.id
      changed = true
      continue
    }

    if (op === 'reorder') {
      const id = readString(raw.id, '', 128)
      const direction = raw.direction === 'down' ? 'down' : raw.direction === 'up' ? 'up' : null
      if (!id || !direction) throw new Error('reorder 需要 id 与 direction(up/down)')
      findElement(project, id)
      project = { ...project, elements: reorderElements(project.elements, id, direction) }
      changed = true
      changedIds.push(id)
      continue
    }

    if (op === 'select') {
      const id = raw.id === null ? null : readString(raw.id, '', 128)
      if (id) findElement(project, id)
      selectedId = id
      continue
    }

    if (op === 'clear') {
      for (const item of project.elements) removedIds.push(item.id)
      project = { ...project, elements: [] }
      selectedId = null
      changed = true
      continue
    }

    if (op === 'undo' || op === 'redo') {
      throw new Error(`${op} 不能和其他操作混在一次 canvas_apply 中`)
    }

    throw new Error(`未知 operation ${op}`)
  }

  const normalized = normalizeDesignProject({ ...project, updatedAt: Date.now() })
  if (normalized.elements.length !== project.elements.length) {
    messages.push('部分元素被归一化丢弃（缺少图片资源或元素数量超过上限）')
  }
  return {
    project: normalized,
    changed,
    selectedId,
    addedIds,
    changedIds,
    removedIds,
    messages,
    history: changed,
  }
}

function textPreview(text: string): string {
  return text.length > 320 ? `${text.slice(0, 320)}…` : text
}

/** 给模型读的状态：保留定位/编辑所需字段，长文本只给预览。 */
export function summarizeDesignProject(
  project: DesignProject,
  selectedId: string | null = null,
): CanvasAgentProjectSummary {
  const elements: CanvasAgentElementSummary[] = project.elements.map((element) => {
    const base = {
      id: element.id,
      type: element.type,
      name: element.name,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
      rotation: element.rotation,
      opacity: element.opacity,
      locked: element.locked,
      hidden: element.hidden,
    }
    if (element.type === 'text') {
      return {
        ...base,
        text: textPreview(element.text),
        fontSize: element.fontSize,
        fontWeight: element.fontWeight,
        fontFamily: element.fontFamily,
        color: element.color,
        align: element.align,
        lineHeight: element.lineHeight,
        letterSpacing: element.letterSpacing,
      }
    }
    if (element.type === 'image') {
      return {
        ...base,
        assetId: element.assetId,
        alt: element.alt,
        fit: element.fit,
        radius: element.radius,
      }
    }
    return {
      ...base,
      fill: element.fill,
      stroke: element.stroke,
      strokeWidth: element.strokeWidth,
      radius: element.radius,
    }
  })
  return {
    name: project.name,
    artboard: project.artboard,
    elementCount: elements.length,
    elements,
    selectedId,
    updatedAt: project.updatedAt,
  }
}

export function normalizeAgentOperations(value: unknown): CanvasAgentOperation[] {
  if (!Array.isArray(value)) throw new Error('operations 必须是数组')
  return value as CanvasAgentOperation[]
}
