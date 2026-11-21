/**
 * 设计画布的纯函数模型：画板预设、默认元素、归一化、吸附与几何计算。
 * 这里不碰 Konva 或 React，便于单测。
 */
import { generateUUID } from '@/utils/env'
import type {
  ArtboardPreset,
  CanvasFontFamily,
  CanvasFontWeight,
  CanvasImageFit,
  CanvasTextAlign,
  DesignArtboard,
  DesignAsset,
  DesignElement,
  DesignImageElement,
  DesignProject,
  DesignShapeElement,
  DesignTextElement,
} from '@/types/designCanvas'

export const ARTBOARD_PRESETS: readonly ArtboardPreset[] = [
  { id: 'social-square', label: '社媒方图', width: 1080, height: 1080, hint: '1:1 · 帖子与封面' },
  { id: 'social-story', label: '竖版故事', width: 1080, height: 1350, hint: '4:5 · 小红书与 Story' },
  { id: 'wide-cover', label: '横版封面', width: 1920, height: 1080, hint: '16:9 · 视频与文章头图' },
  { id: 'a4-poster', label: 'A4 海报', width: 1240, height: 1754, hint: 'A4 · 打印海报' },
  { id: 'mobile-ui', label: '手机界面', width: 390, height: 844, hint: 'iPhone · 页面草图' },
  { id: 'web-hero', label: '网页首屏', width: 1440, height: 1024, hint: '桌面 · 站点主视觉' },
] as const

export interface CanvasColor {
  id: string
  label: string
  value: string
}

/** 设计色板：中性 + 低饱和。刻意不含紫色。 */
export const CANVAS_PALETTE: readonly CanvasColor[] = [
  { id: 'paper', label: '纸白', value: '#FFFFFF' },
  { id: 'bone', label: '暖白', value: '#F7F3EA' },
  { id: 'sand', label: '沙色', value: '#E9E1D2' },
  { id: 'ink', label: '墨黑', value: '#16181D' },
  { id: 'graphite', label: '石墨', value: '#3B4048' },
  { id: 'stone', label: '石灰', value: '#8A8F98' },
  { id: 'ocean', label: '深海', value: '#2F5D7C' },
  { id: 'moss', label: '苔绿', value: '#4F6B52' },
  { id: 'clay', label: '陶土', value: '#C96F4A' },
  { id: 'gold', label: '麦金', value: '#C8A24A' },
  { id: 'rosewood', label: '玫瑰棕', value: '#B85C6B' },
] as const

export const DESIGN_SELECTION_COLOR = '#2F5D7C'
export const DESIGN_GUIDE_COLOR = '#C96F4A'
export const DESIGN_ANCHOR_FILL = '#FFFFFF'
export const DESIGN_ANCHOR_STROKE = '#2F5D7C'
export const DESIGN_BOARD_SHADOW = 'rgba(15, 23, 42, 0.32)'
export const DESIGN_DRAFT_FILL = 'rgba(47, 93, 124, 0.14)'
export const DESIGN_TEXT_DEFAULT_COLOR = '#16181D'
export const DESIGN_SHAPE_DEFAULT_FILL = '#C96F4A'
export const DESIGN_IMAGE_PLACEHOLDER = '#EFECE4'
export const DESIGN_IMAGE_PLACEHOLDER_STROKE = '#B8B2A6'

export const CANVAS_MIN_ZOOM = 0.05
export const CANVAS_MAX_ZOOM = 4
export const ELEMENT_MIN_SIZE = 8

export const CANVAS_FONT_STACKS: Record<CanvasFontFamily, string> = {
  sans: 'Geist Variable, ui-sans-serif, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace',
}

const MAX_ELEMENTS = 200
const FONT_WEIGHTS: readonly CanvasFontWeight[] = [400, 500, 600, 700]
const FONT_FAMILIES: readonly CanvasFontFamily[] = ['sans', 'serif', 'mono']
const TEXT_ALIGNS: readonly CanvasTextAlign[] = ['left', 'center', 'right']
const IMAGE_FITS: readonly CanvasImageFit[] = ['cover', 'contain']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function readString(value: unknown, fallback: string, maxLength = 240): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.slice(0, maxLength)
  return trimmed.trim() ? trimmed : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().slice(0, 40)
  return trimmed || fallback
}

export function createDefaultProject(name = '未命名设计'): DesignProject {
  return {
    version: 1,
    name,
    artboard: { width: 1080, height: 1080, background: '#FFFFFF' },
    elements: [],
    updatedAt: Date.now(),
  }
}

export function findArtboardPreset(width: number, height: number): ArtboardPreset | null {
  return ARTBOARD_PRESETS.find((preset) => preset.width === width && preset.height === height) ?? null
}

export function presetProjectArtboard(project: DesignProject, preset: ArtboardPreset): DesignProject {
  return {
    ...project,
    artboard: { ...project.artboard, width: preset.width, height: preset.height },
    updatedAt: Date.now(),
  }
}

export function nextElementName(elements: readonly DesignElement[], type: DesignElement['type']): string {
  const label = type === 'text' ? '文字' : type === 'image' ? '图片' : type === 'rect' ? '矩形' : type === 'ellipse' ? '椭圆' : '线条'
  const prefix = `${label} `
  const used = elements
    .map((element) => element.name)
    .filter((name) => name.startsWith(prefix))
    .map((name) => Number(name.slice(prefix.length)))
    .filter((value) => Number.isInteger(value) && value > 0)
  return `${prefix}${Math.max(0, ...used) + 1}`
}

export function createTextElement(x: number, y: number, elements: readonly DesignElement[]): DesignTextElement {
  return {
    id: generateUUID(),
    type: 'text',
    name: nextElementName(elements, 'text'),
    x: Math.round(x),
    y: Math.round(y),
    width: 720,
    height: 220,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text: '双击编辑文字',
    fontSize: 56,
    fontWeight: 700,
    fontFamily: 'sans',
    color: DESIGN_TEXT_DEFAULT_COLOR,
    align: 'left',
    lineHeight: 1.15,
    letterSpacing: 0,
  }
}

export function createShapeElement(
  type: 'rect' | 'ellipse' | 'line',
  x: number,
  y: number,
  width: number,
  height: number,
  elements: readonly DesignElement[],
): DesignShapeElement {
  const line = type === 'line'
  return {
    id: generateUUID(),
    type,
    name: nextElementName(elements, type),
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(ELEMENT_MIN_SIZE, Math.round(width)),
    height: line ? 4 : Math.max(ELEMENT_MIN_SIZE, Math.round(height)),
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    fill: line ? 'transparent' : DESIGN_SHAPE_DEFAULT_FILL,
    stroke: line ? DESIGN_TEXT_DEFAULT_COLOR : 'transparent',
    strokeWidth: line ? 4 : 0,
    radius: type === 'rect' ? 12 : 0,
  }
}

export function createImageElement(
  asset: Pick<DesignAsset, 'id' | 'name' | 'width' | 'height'>,
  artboard: DesignArtboard,
  elements: readonly DesignElement[],
): DesignImageElement {
  const maxWidth = artboard.width * 0.64
  const maxHeight = artboard.height * 0.64
  const naturalWidth = Math.max(1, asset.width)
  const naturalHeight = Math.max(1, asset.height)
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1)
  const width = Math.max(32, Math.round(naturalWidth * scale))
  const height = Math.max(32, Math.round(naturalHeight * scale))
  return {
    id: generateUUID(),
    type: 'image',
    name: nextElementName(elements, 'image'),
    x: Math.round((artboard.width - width) / 2),
    y: Math.round((artboard.height - height) / 2),
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    assetId: asset.id,
    alt: asset.name.replace(/\.[^.]+$/, ''),
    fit: 'cover',
    radius: 0,
  }
}

function normalizeElement(value: unknown, index: number, seenIds: Set<string>): DesignElement | null {
  if (!isRecord(value)) return null
  const type = value.type
  if (type !== 'text' && type !== 'image' && type !== 'rect' && type !== 'ellipse' && type !== 'line') return null

  const rawId = typeof value.id === 'string' && value.id.trim() ? value.id : `element-${index}`
  const id = seenIds.has(rawId) ? generateUUID() : rawId
  seenIds.add(id)

  const base = {
    id,
    name: readString(value.name, type === 'text' ? '文字' : type === 'image' ? '图片' : type === 'rect' ? '矩形' : type === 'ellipse' ? '椭圆' : '线条', 80),
    x: readNumber(value.x, 0, -8192, 8192),
    y: readNumber(value.y, 0, -8192, 8192),
    width: readNumber(value.width, 160, ELEMENT_MIN_SIZE, 4096),
    height: readNumber(value.height, type === 'line' ? 4 : 120, 1, 4096),
    rotation: readNumber(value.rotation, 0, -180, 180),
    opacity: readNumber(value.opacity, 1, 0, 1),
    locked: readBoolean(value.locked, false),
    hidden: readBoolean(value.hidden, false),
  }

  if (type === 'text') {
    return {
      ...base,
      type,
      text: readString(value.text, '文字', 20_000),
      fontSize: readNumber(value.fontSize, 64, 6, 600),
      fontWeight: FONT_WEIGHTS.includes(value.fontWeight as CanvasFontWeight) ? value.fontWeight as CanvasFontWeight : 700,
      fontFamily: FONT_FAMILIES.includes(value.fontFamily as CanvasFontFamily) ? value.fontFamily as CanvasFontFamily : 'sans',
      color: readColor(value.color, DESIGN_TEXT_DEFAULT_COLOR),
      align: TEXT_ALIGNS.includes(value.align as CanvasTextAlign) ? value.align as CanvasTextAlign : 'left',
      lineHeight: readNumber(value.lineHeight, 1.15, 0.6, 4),
      letterSpacing: readNumber(value.letterSpacing, 0, -20, 120),
    }
  }

  if (type === 'image') {
    const assetId = typeof value.assetId === 'string' ? value.assetId.trim() : ''
    if (!assetId) return null
    return {
      ...base,
      type,
      assetId,
      alt: readString(value.alt, base.name, 160),
      fit: IMAGE_FITS.includes(value.fit as CanvasImageFit) ? value.fit as CanvasImageFit : 'cover',
      radius: readNumber(value.radius, 0, 0, 4096),
    }
  }

  return {
    ...base,
    type,
    height: Math.max(type === 'line' ? 1 : ELEMENT_MIN_SIZE, base.height),
    fill: readColor(value.fill, type === 'line' ? 'transparent' : DESIGN_SHAPE_DEFAULT_FILL),
    stroke: readColor(value.stroke, 'transparent'),
    strokeWidth: readNumber(value.strokeWidth, 0, 0, 240),
    radius: type === 'rect' ? readNumber(value.radius, 12, 0, 4096) : 0,
  }
}

export function normalizeDesignProject(value: unknown): DesignProject {
  if (!isRecord(value)) return createDefaultProject()
  const artboardRaw = isRecord(value.artboard) ? value.artboard : {}
  const artboard: DesignArtboard = {
    width: Math.round(readNumber(artboardRaw.width, 1080, 64, 4096)),
    height: Math.round(readNumber(artboardRaw.height, 1080, 64, 4096)),
    background: readColor(artboardRaw.background, '#FFFFFF'),
  }
  const seenIds = new Set<string>()
  const elements = Array.isArray(value.elements)
    ? value.elements
      .slice(0, MAX_ELEMENTS)
      .map((element, index) => normalizeElement(element, index, seenIds))
      .filter((element): element is DesignElement => element !== null)
    : []
  return {
    version: 1,
    name: readString(value.name, '未命名设计', 80),
    artboard,
    elements,
    updatedAt: readNumber(value.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
  }
}

export function normalizeDesignAsset(value: unknown): DesignAsset | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : ''
  if (!id || !dataUrl.startsWith('data:image/')) return null
  return {
    id,
    name: readString(value.name, '图片', 120),
    mime: readString(value.mime, 'image/png', 80),
    width: Math.round(readNumber(value.width, 1, 1, 8192)),
    height: Math.round(readNumber(value.height, 1, 1, 8192)),
    dataUrl,
    createdAt: readNumber(value.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
  }
}

export interface DragRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapGuides {
  x?: number
  y?: number
}

export interface SnapResult {
  x: number
  y: number
  guides: SnapGuides
}

function nearestSnap(sides: number[], targets: number[], tolerance: number): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null
  for (const side of sides) {
    for (const target of targets) {
      const delta = target - side
      if (Math.abs(delta) > tolerance) continue
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, target }
    }
  }
  return best
}

/** 元素拖动吸附：画板边/中线与其它元素的三条参考线。 */
export function snapElementRect(
  rect: DragRect,
  artboard: DesignArtboard,
  others: readonly DesignElement[],
  tolerance: number,
): SnapResult {
  const xSides = [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
  const ySides = [rect.y, rect.y + rect.height / 2, rect.y + rect.height]
  const xTargets = [0, artboard.width / 2, artboard.width]
  const yTargets = [0, artboard.height / 2, artboard.height]
  for (const element of others) {
    if (element.hidden) continue
    xTargets.push(element.x, element.x + element.width / 2, element.x + element.width)
    yTargets.push(element.y, element.y + element.height / 2, element.y + element.height)
  }
  const xSnap = nearestSnap(xSides, xTargets, tolerance)
  const ySnap = nearestSnap(ySides, yTargets, tolerance)
  return {
    x: xSnap ? Math.round(rect.x + xSnap.delta) : rect.x,
    y: ySnap ? Math.round(rect.y + ySnap.delta) : rect.y,
    guides: {
      x: xSnap?.target,
      y: ySnap?.target,
    },
  }
}

export interface ImageFitRect {
  x: number
  y: number
  width: number
  height: number
}

export function fitImageRect(
  frameWidth: number,
  frameHeight: number,
  imageWidth: number,
  imageHeight: number,
  fit: CanvasImageFit,
): ImageFitRect {
  const naturalWidth = Math.max(1, imageWidth)
  const naturalHeight = Math.max(1, imageHeight)
  const scale = fit === 'cover'
    ? Math.max(frameWidth / naturalWidth, frameHeight / naturalHeight)
    : Math.min(frameWidth / naturalWidth, frameHeight / naturalHeight)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height,
  }
}

export function reorderElements(
  elements: readonly DesignElement[],
  id: string,
  direction: 'up' | 'down',
): DesignElement[] {
  const index = elements.findIndex((element) => element.id === id)
  const nextIndex = direction === 'up' ? index + 1 : index - 1
  if (index < 0 || nextIndex < 0 || nextIndex >= elements.length) return [...elements]
  const next = [...elements]
  const [item] = next.splice(index, 1)
  if (!item) return [...elements]
  next.splice(nextIndex, 0, item)
  return next
}

export function clampZoom(value: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, value))
}

export function computeFitView(artboard: DesignArtboard, width: number, height: number, margin = 32): { x: number; y: number; scale: number } {
  const availableWidth = Math.max(1, width - margin * 2)
  const availableHeight = Math.max(1, height - margin * 2)
  const scale = clampZoom(Math.min(availableWidth / artboard.width, availableHeight / artboard.height))
  return {
    x: (width - artboard.width * scale) / 2,
    y: (height - artboard.height * scale) / 2,
    scale,
  }
}

export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

export function elementTypeLabel(type: DesignElement['type']): string {
  return type === 'text' ? '文字' : type === 'image' ? '图片' : type === 'rect' ? '矩形' : type === 'ellipse' ? '椭圆' : '线条'
}
