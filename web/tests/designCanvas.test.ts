import { describe, expect, test } from 'bun:test'

import {
  ARTBOARD_PRESETS,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  computeFitView,
  createDefaultProject,
  createImageElement,
  createShapeElement,
  createTextElement,
  findArtboardPreset,
  fitImageRect,
  formatZoom,
  normalizeDesignAsset,
  normalizeDesignProject,
  presetProjectArtboard,
  reorderElements,
  snapElementRect,
} from '../src/components/workbench/design/canvasModel.ts'

describe('设计画布纯模型', () => {
  test('默认项目是 1080×1080 白底、空元素、版本 1', () => {
    const project = createDefaultProject('发布会主视觉')
    expect(project.version).toBe(1)
    expect(project.name).toBe('发布会主视觉')
    expect(project.artboard).toEqual({ width: 1080, height: 1080, background: '#FFFFFF' })
    expect(project.elements).toEqual([])
  })

  test('六个画板预设都有正尺寸与独立 id，默认项目能匹配社媒方图', () => {
    expect(ARTBOARD_PRESETS).toHaveLength(6)
    expect(new Set(ARTBOARD_PRESETS.map((preset) => preset.id)).size).toBe(6)
    for (const preset of ARTBOARD_PRESETS) {
      expect(preset.width).toBeGreaterThan(0)
      expect(preset.height).toBeGreaterThan(0)
    }
    expect(findArtboardPreset(1080, 1080)?.id).toBe('social-square')
    expect(findArtboardPreset(999, 999)).toBeNull()
  })

  test('应用画板预设只改画板尺寸，底色和元素保留', () => {
    const project = createDefaultProject()
    project.artboard.background = '#F7F3EA'
    project.elements.push(createTextElement(20, 30, []))
    const next = presetProjectArtboard(project, ARTBOARD_PRESETS[3])
    expect(next.artboard.width).toBe(1240)
    expect(next.artboard.height).toBe(1754)
    expect(next.artboard.background).toBe('#F7F3EA')
    expect(next.elements).toHaveLength(1)
  })

  test('normalizeDesignProject 夹紧画板尺寸、丢弃无 assetId 的图片、去重 id', () => {
    const normalized = normalizeDesignProject({
      version: 1,
      name: '  测试  ',
      artboard: { width: 99999, height: 1, background: '  #000000  ' },
      elements: [
        { id: 'dup', type: 'text', text: 'A', x: 0, y: 0, width: 100, height: 100 },
        { id: 'dup', type: 'text', text: 'B', x: 0, y: 0, width: 100, height: 100 },
        { type: 'image', x: 0, y: 0, width: 100, height: 100 },
        { type: 'rect', x: 0, y: 0, width: 100, height: 100 },
        { type: 'unknown', x: 0, y: 0 },
      ],
    })
    expect(normalized.artboard.width).toBe(4096)
    expect(normalized.artboard.height).toBe(64)
    expect(normalized.artboard.background).toBe('#000000')
    expect(normalized.elements).toHaveLength(3)
    expect(normalized.elements[0]?.id).toBe('dup')
    expect(normalized.elements[1]?.id).not.toBe('dup')
    expect(normalized.elements[2]?.type).toBe('rect')
  })

  test('normalizeDesignProject 对垃圾输入回退到默认项目，而不是抛错', () => {
    expect(normalizeDesignProject(null).artboard.width).toBe(1080)
    expect(normalizeDesignProject('nope').elements).toEqual([])
    expect(normalizeDesignProject({ elements: 'nope' }).elements).toEqual([])
  })

  test('normalizeDesignAsset 只接受 data:image 资源，尺寸夹在 1–8192', () => {
    expect(normalizeDesignAsset({ id: 'a', dataUrl: 'javascript:alert(1)' })).toBeNull()
    expect(normalizeDesignAsset({ id: '', dataUrl: 'data:image/png;base64,AA' })).toBeNull()
    const asset = normalizeDesignAsset({
      id: 'a',
      name: 'x.png',
      dataUrl: 'data:image/png;base64,AA',
      width: 0,
      height: 99999,
    })
    expect(asset?.width).toBe(1)
    expect(asset?.height).toBe(8192)
  })

  test('computeFitView 按短边适配并居中；缩放永远落在允许区间', () => {
    const fit = computeFitView({ width: 1080, height: 1080, background: '#fff' }, 1000, 800, 40)
    expect(fit.scale).toBeCloseTo(720 / 1080, 6)
    expect(fit.x).toBeCloseTo(140, 6)
    expect(fit.y).toBeCloseTo(40, 6)
    expect(computeFitView({ width: 10, height: 10, background: '#fff' }, 100, 100, 0).scale).toBe(CANVAS_MAX_ZOOM)
    expect(computeFitView({ width: 10000, height: 10000, background: '#fff' }, 10, 10, 0).scale).toBe(CANVAS_MIN_ZOOM)
  })

  test('snapElementRect 吸画板左边缘并只返回命中的参考线', () => {
    const snapped = snapElementRect(
      { x: 6, y: 300, width: 100, height: 100 },
      { width: 1080, height: 1080, background: '#fff' },
      [],
      8,
    )
    expect(snapped.x).toBe(0)
    expect(snapped.guides.x).toBe(0)
    expect(snapped.y).toBe(300)
    expect(snapped.guides.y).toBeUndefined()
  })

  test('snapElementRect 吸其它元素边缘，忽略隐藏元素', () => {
    const other = { ...createShapeElement('rect', 500, 300, 200, 120, []), id: 'other' }
    const hidden = { ...createShapeElement('rect', 700, 300, 100, 100, []), hidden: true }
    const snapped = snapElementRect(
      { x: 493, y: 300, width: 60, height: 100 },
      { width: 1080, height: 1080, background: '#fff' },
      [other, hidden],
      8,
    )
    expect(snapped.x).toBe(500)
    expect(snapped.guides.x).toBe(500)
  })

  test('reorderElements 上移下移一层，越界返回原顺序副本', () => {
    const a = createTextElement(0, 0, [])
    const b = createTextElement(0, 0, [a])
    const c = createTextElement(0, 0, [a, b])
    expect(reorderElements([a, b, c], a.id, 'up').map((item) => item.id)).toEqual([b.id, a.id, c.id])
    expect(reorderElements([a, b, c], c.id, 'down').map((item) => item.id)).toEqual([a.id, c.id, b.id])
    expect(reorderElements([a, b, c], a.id, 'down').map((item) => item.id)).toEqual([a.id, b.id, c.id])
    expect(reorderElements([a, b, c], c.id, 'up').map((item) => item.id)).toEqual([a.id, b.id, c.id])
    expect(reorderElements([a, b, c], 'missing', 'up')).toHaveLength(3)
  })

  test('fitImageRect 的 cover 裁切与 contain 留边几何正确', () => {
    expect(fitImageRect(200, 100, 100, 100, 'cover')).toEqual({ x: 0, y: -50, width: 200, height: 200 })
    expect(fitImageRect(200, 100, 100, 100, 'contain')).toEqual({ x: 50, y: 0, width: 100, height: 100 })
  })

  test('createImageElement 按画板 64% 上限等比缩放并居中', () => {
    const element = createImageElement(
      { id: 'asset', name: 'wide.png', width: 4000, height: 2000 },
      { width: 1000, height: 1000, background: '#fff' },
      [],
    )
    expect(element.width).toBe(640)
    expect(element.height).toBe(320)
    expect(element.x).toBe(180)
    expect(element.y).toBe(340)
    expect(element.fit).toBe('cover')
  })

  test('formatZoom 四舍五入成百分比，且没有浮点尾巴', () => {
    expect(formatZoom(0.6666)).toBe('67%')
    expect(formatZoom(2)).toBe('200%')
  })
})
