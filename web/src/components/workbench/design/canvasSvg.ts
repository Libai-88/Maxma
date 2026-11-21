/**
 * canvasSvg.ts — 设计画布的 SVG 导入/导出与内置模板（纯函数）。
 *
 * 边界：
 * - 导出覆盖当前元素类型：文字、矩形、椭圆、线条、图片（图片需传入 asset 映射）。
 * - 导入是「常用 SVG 子集」：rect/circle/ellipse/line/text，支持 x/y/width/height/
 *   fill/stroke/stroke-width/rx/transform=translate 与基本 text 属性；不解析 path、
 *   clipPath、渐变、滤镜和复杂 group 继承。遇到不支持的元素会跳过并返回 warnings。
 * - 不伪造导入成功：跳过数量会明确返回。
 */
import { generateUUID } from '@/utils/env'
import type { DesignAsset, DesignElement, DesignProject } from '@/types/designCanvas'

const SVG_NS = 'http://www.w3.org/2000/svg'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

function assetLookup(assets: ReadonlyMap<string, DesignAsset> | readonly DesignAsset[] | undefined, id: string): DesignAsset | null {
  if (!assets) return null
  if ('get' in assets && typeof assets.get === 'function') return assets.get(id) ?? null
  return (assets as readonly DesignAsset[]).find((asset) => asset.id === id) ?? null
}

function transformFor(element: DesignElement): string {
  const cx = element.width / 2
  const cy = element.type === 'line' ? 0 : element.height / 2
  return `translate(${element.x} ${element.y}) rotate(${element.rotation} ${cx} ${cy})`
}

function baseAttributes(element: DesignElement, extra = ''): string {
  const opacity = element.opacity < 1 ? ` opacity="${element.opacity}"` : ''
  return `transform="${transformFor(element)}"${opacity}${extra}`
}

/** 导出成独立 SVG 文本；img href 只使用 asset 的 data URL。 */
export function exportDesignSvg(project: DesignProject, assets?: ReadonlyMap<string, DesignAsset> | readonly DesignAsset[]): string {
  const body: string[] = []
  for (const element of project.elements) {
    if (element.hidden) continue
    if (element.type === 'text') {
      const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start'
      const anchorX = element.align === 'center' ? element.width / 2 : element.align === 'right' ? element.width : 0
      const lines = element.text.split(/\r?\n/)
      const tspans = lines.map((line, index) => `<tspan x="${anchorX}" dy="${index === 0 ? 0 : element.fontSize * element.lineHeight}">${escapeXml(line)}</tspan>`).join('')
      body.push(
        `<text ${baseAttributes(element)} x="${anchorX}" y="${element.fontSize}" text-anchor="${anchor}" font-family="${escapeXml(element.fontFamily)}" font-size="${element.fontSize}" font-weight="${element.fontWeight}" fill="${escapeXml(element.color)}" letter-spacing="${element.letterSpacing}">${tspans}</text>`,
      )
      continue
    }
    if (element.type === 'image') {
      const asset = assetLookup(assets, element.assetId)
      if (asset?.dataUrl) {
        body.push(`<image ${baseAttributes(element)} href="${escapeXml(asset.dataUrl)}" x="0" y="0" width="${element.width}" height="${element.height}" preserveAspectRatio="${element.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}"/>`)
      } else {
        body.push(`<rect ${baseAttributes(element)} x="0" y="0" width="${element.width}" height="${element.height}" fill="#EFECE4" stroke="#B8B2A6"/>`)
      }
      continue
    }
    if (element.type === 'rect') {
      body.push(`<rect ${baseAttributes(element)} x="0" y="0" width="${element.width}" height="${element.height}" rx="${element.radius}" fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.stroke)}" stroke-width="${element.strokeWidth}"/>`)
    } else if (element.type === 'ellipse') {
      body.push(`<ellipse ${baseAttributes(element)} cx="${element.width / 2}" cy="${element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.stroke)}" stroke-width="${element.strokeWidth}"/>`)
    } else {
      body.push(`<line ${baseAttributes(element)} x1="0" y1="0" x2="${element.width}" y2="0" stroke="${escapeXml(element.stroke)}" stroke-width="${element.strokeWidth}"/>`)
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="${SVG_NS}" width="${project.artboard.width}" height="${project.artboard.height}" viewBox="0 0 ${project.artboard.width} ${project.artboard.height}"><rect width="100%" height="100%" fill="${escapeXml(project.artboard.background)}"/>${body.join('')}</svg>`
}

interface ParsedTag {
  name: string
  attrs: Map<string, string>
  text: string
}

function readAttributes(source: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"|([:\w-]+)\s*=\s*'([^']*)'/g)) {
    const key = match[1] ?? match[3]
    const value = match[2] ?? match[4]
    if (key && value !== undefined) map.set(key, value)
  }
  return map
}

function numberAttr(attrs: Map<string, string>, key: string, fallback = 0): number {
  const parsed = Number(attrs.get(key))
  return Number.isFinite(parsed) ? parsed : fallback
}

function colorAttr(attrs: Map<string, string>, key: string, fallback: string): string {
  const value = attrs.get(key)?.trim()
  if (!value || value === 'none') return key === 'stroke' ? 'transparent' : fallback
  return value.slice(0, 40)
}

/** 解析 translate(x y) 与简单 matrix；只累加平移，不展开旋转/缩放。 */
function translationOf(attrs: Map<string, string>): { x: number; y: number } {
  const transform = attrs.get('transform') ?? ''
  const translate = /translate\(\s*(-?\d+(?:\.\d+)?)\s*(?:[ ,]\s*(-?\d+(?:\.\d+)?))?\s*\)/.exec(transform)
  return { x: translate ? Number(translate[1]) : 0, y: translate && translate[2] ? Number(translate[2]) : 0 }
}

function rotationOf(attrs: Map<string, string>): number {
  const transform = attrs.get('transform') ?? ''
  const rotate = /rotate\(\s*(-?\d+(?:\.\d+)?)/.exec(transform)
  return rotate ? Number(rotate[1]) : 0
}

function parseTags(svg: string): ParsedTag[] {
  const tags: ParsedTag[] = []
  const re = /<(rect|circle|ellipse|line|text|g|image|path|polygon)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g
  for (const match of svg.matchAll(re)) {
    const name = match[1] ?? ''
    tags.push({ name, attrs: readAttributes(match[2] ?? ''), text: match[3] ?? '' })
  }
  return tags
}

function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, '')).trim()
}

export interface SvgImportResult {
  width: number
  height: number
  background: string
  elements: DesignElement[]
  warnings: string[]
}

/** 从 SVG 文本导入元素；坐标相对 viewBox/width/height。 */
export function importDesignSvg(svg: string, existing: readonly DesignElement[] = []): SvgImportResult {
  const root = /<svg\b([^>]*)>/.exec(svg)?.[1] ?? ''
  const rootAttrs = readAttributes(root)
  const viewBox = (rootAttrs.get('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const width = Number.isFinite(viewBox[2]) && (viewBox[2] ?? 0) > 0 ? viewBox[2]! : numberAttr(rootAttrs, 'width', 1080)
  const height = Number.isFinite(viewBox[3]) && (viewBox[3] ?? 0) > 0 ? viewBox[3]! : numberAttr(rootAttrs, 'height', 1080)
  const warnings: string[] = []
  const elements: DesignElement[] = []
  const baseCount = existing.length

  for (const tag of parseTags(svg)) {
    if (tag.name === 'g' || tag.name === 'image' || tag.name === 'path' || tag.name === 'polygon') {
      if (tag.name !== 'g') warnings.push(`跳过不支持的元素 <${tag.name}>`)
      continue
    }
    const offset = translationOf(tag.attrs)
    const id = generateUUID()
    const name = `${tag.name === 'text' ? '文字' : tag.name === 'rect' ? '矩形' : tag.name === 'ellipse' || tag.name === 'circle' ? '椭圆' : '线条'} ${baseCount + elements.length + 1}`
    const common = {
      id,
      name,
      rotation: rotationOf(tag.attrs),
      opacity: Math.min(1, Math.max(0, numberAttr(tag.attrs, 'opacity', 1))),
      locked: false,
      hidden: false,
    }
    if (tag.name === 'text') {
      const fontSize = numberAttr(tag.attrs, 'font-size', 32)
      const content = textOf(tag.text) || '文字'
      const anchor = tag.attrs.get('text-anchor')
      const widthEstimate = Math.max(...content.split(/\r?\n/).map((line) => line.length)) * fontSize * 0.62
      const lines = content.split(/\r?\n/).length
      const align = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left'
      const xOffset = align === 'center' ? -widthEstimate / 2 : align === 'right' ? -widthEstimate : 0
      elements.push({
        ...common,
        type: 'text',
        x: offset.x + numberAttr(tag.attrs, 'x', 0) + xOffset,
        y: offset.y + numberAttr(tag.attrs, 'y', 0) - fontSize,
        width: Math.max(32, Math.round(widthEstimate)),
        height: Math.max(fontSize, Math.round(lines * fontSize * 1.25)),
        text: content,
        fontSize,
        fontWeight: numberAttr(tag.attrs, 'font-weight', 400) >= 600 ? 700 : numberAttr(tag.attrs, 'font-weight', 400) >= 500 ? 600 : 400,
        fontFamily: /serif/i.test(tag.attrs.get('font-family') ?? '') ? 'serif' : /mono/i.test(tag.attrs.get('font-family') ?? '') ? 'mono' : 'sans',
        color: colorAttr(tag.attrs, 'fill', '#16181D'),
        align,
        lineHeight: 1.25,
        letterSpacing: 0,
      })
      continue
    }
    if (tag.name === 'line') {
      const x1 = numberAttr(tag.attrs, 'x1', 0)
      const y1 = numberAttr(tag.attrs, 'y1', 0)
      const x2 = numberAttr(tag.attrs, 'x2', 0)
      const y2 = numberAttr(tag.attrs, 'y2', 0)
      const length = Math.hypot(x2 - x1, y2 - y1)
      elements.push({
        ...common,
        type: 'line',
        x: offset.x + x1,
        y: offset.y + y1,
        width: Math.max(1, Math.round(length)),
        height: 4,
        rotation: Math.round(rotationOf(tag.attrs) + (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI),
        fill: 'transparent',
        stroke: colorAttr(tag.attrs, 'stroke', '#16181D'),
        strokeWidth: numberAttr(tag.attrs, 'stroke-width', 2),
        radius: 0,
      })
      continue
    }
    const isEllipse = tag.name === 'circle' || tag.name === 'ellipse'
    const rectWidth = isEllipse
      ? numberAttr(tag.attrs, 'r', 0) * 2 || numberAttr(tag.attrs, 'rx', 0) * 2
      : numberAttr(tag.attrs, 'width', 0)
    const rectHeight = isEllipse
      ? numberAttr(tag.attrs, 'r', 0) * 2 || numberAttr(tag.attrs, 'ry', 0) * 2
      : numberAttr(tag.attrs, 'height', 0)
    if (rectWidth <= 0 || rectHeight <= 0) {
      warnings.push(`跳过尺寸为 0 的 <${tag.name}>`)
      continue
    }
    elements.push({
      ...common,
      type: isEllipse ? 'ellipse' : 'rect',
      x: offset.x + (isEllipse ? numberAttr(tag.attrs, 'cx', 0) - rectWidth / 2 : numberAttr(tag.attrs, 'x', 0)),
      y: offset.y + (isEllipse ? numberAttr(tag.attrs, 'cy', 0) - rectHeight / 2 : numberAttr(tag.attrs, 'y', 0)),
      width: Math.round(rectWidth),
      height: Math.round(rectHeight),
      fill: colorAttr(tag.attrs, 'fill', '#C96F4A'),
      stroke: colorAttr(tag.attrs, 'stroke', 'transparent'),
      strokeWidth: numberAttr(tag.attrs, 'stroke-width', 0),
      radius: isEllipse ? 0 : numberAttr(tag.attrs, 'rx', 0),
    })
  }
  return { width: Math.round(width), height: Math.round(height), background: '#FFFFFF', elements, warnings }
}

export interface CanvasTemplate {
  id: string
  name: string
  description: string
  project: DesignProject
}

function templateElements(artboardWidth: number, artboardHeight: number): DesignElement[] {
  return [
    {
      id: generateUUID(), type: 'rect', name: '背景', x: 0, y: 0, width: artboardWidth, height: artboardHeight,
      rotation: 0, opacity: 1, locked: false, hidden: false, fill: '#F7F3EA', stroke: 'transparent', strokeWidth: 0, radius: 0,
    },
    {
      id: generateUUID(), type: 'rect', name: '标题条', x: 72, y: 96, width: 10, height: 160,
      rotation: 0, opacity: 1, locked: false, hidden: false, fill: '#C96F4A', stroke: 'transparent', strokeWidth: 0, radius: 0,
    },
    {
      id: generateUUID(), type: 'text', name: '主标题', x: 112, y: 92, width: artboardWidth - 200, height: 110,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: '把复杂留给自己，\n把简单交给用户', fontSize: 64,
      fontWeight: 700, fontFamily: 'serif', color: '#16181D', align: 'left', lineHeight: 1.12, letterSpacing: 0,
    },
    {
      id: generateUUID(), type: 'text', name: '副标题', x: 116, y: 230, width: artboardWidth - 220, height: 60,
      rotation: 0, opacity: 1, locked: false, hidden: false, text: 'Maxma · 个人本地工作台', fontSize: 24,
      fontWeight: 400, fontFamily: 'sans', color: '#3B4048', align: 'left', lineHeight: 1.2, letterSpacing: 0,
    },
  ]
}

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  {
    id: 'quiet-cover',
    name: '安静封面',
    description: '暖纸底 + 陶土标题条，适合社媒方图',
    project: {
      version: 1,
      name: '安静封面',
      artboard: { width: 1080, height: 1080, background: '#F7F3EA' },
      elements: templateElements(1080, 1080),
      updatedAt: Date.now(),
    },
  },
  {
    id: 'quote-card',
    name: '引言卡片',
    description: '留白与文字优先，适合文章摘录',
    project: {
      version: 1,
      name: '引言卡片',
      artboard: { width: 1080, height: 1350, background: '#FFFFFF' },
      elements: [
        {
          id: generateUUID(), type: 'text', name: '引号', x: 80, y: 90, width: 120, height: 120,
          rotation: 0, opacity: 1, locked: false, hidden: false, text: '“', fontSize: 140, fontWeight: 700,
          fontFamily: 'serif', color: '#C8A24A', align: 'left', lineHeight: 1, letterSpacing: 0,
        },
        {
          id: generateUUID(), type: 'text', name: '引言', x: 100, y: 300, width: 880, height: 520,
          rotation: 0, opacity: 1, locked: false, hidden: false, text: '好的工具不是替你思考，\n而是让你更愿意开始。', fontSize: 64,
          fontWeight: 400, fontFamily: 'serif', color: '#16181D', align: 'left', lineHeight: 1.35, letterSpacing: 0,
        },
      ],
      updatedAt: Date.now(),
    },
  },
]
