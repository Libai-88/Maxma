import { describe, expect, test } from 'bun:test'

import { createDefaultProject, createShapeElement, createTextElement } from '../src/components/workbench/design/canvasModel.ts'
import { CANVAS_TEMPLATES, exportDesignSvg, importDesignSvg } from '../src/components/workbench/design/canvasSvg.ts'

describe('画布 SVG 与模板', () => {
  test('导出包含画板背景、文字与形状，并转义文本', () => {
    const project = createDefaultProject('测试 & 封面')
    project.elements = [
      createTextElement(100, 200, []),
      createShapeElement('rect', 20, 30, 200, 80, []),
      createShapeElement('ellipse', 300, 120, 120, 80, []),
    ]
    project.elements[0]!.name = '主标题'
    if (project.elements[0]?.type === 'text') project.elements[0].text = 'A & B <C>'
    const svg = exportDesignSvg(project)
    expect(svg).toContain('<svg xmlns=')
    expect(svg).toContain('width="1080" height="1080"')
    expect(svg).toContain('A &amp; B &lt;C&gt;')
    expect(svg).toContain('<rect')
    expect(svg).toContain('<ellipse')
    expect(svg).not.toContain('<g ')
  })

  test('导入常见 SVG 子集并报告不支持项', () => {
    const svg = `<svg width="800" height="600" viewBox="0 0 800 600">
      <rect x="10" y="20" width="120" height="80" fill="#C96F4A" rx="8"/>
      <circle cx="400" cy="300" r="50" fill="#2F5D7C"/>
      <line x1="100" y1="500" x2="700" y2="500" stroke="#16181D" stroke-width="2"/>
      <text x="20" y="120" font-size="40" fill="#16181D">你好 &amp; Maxma</text>
      <path d="M0 0 L10 10"/>
    </svg>`
    const result = importDesignSvg(svg)
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    expect(result.elements).toHaveLength(4)
    expect(result.elements.map((element) => element.type).sort()).toEqual(['ellipse', 'line', 'rect', 'text'])
    expect(result.warnings.some((warning) => warning.includes('path'))).toBe(true)
    expect(result.elements.find((element) => element.type === 'text')?.text).toBe('你好 & Maxma')
  })

  test('导出再导入能保留元素数量与基本位置', () => {
    const project = createDefaultProject('往返')
    project.elements = [
      createTextElement(90, 140, []),
      createShapeElement('rect', 40, 60, 160, 90, []),
      createShapeElement('line', 0, 300, 500, 4, []),
    ]
    const result = importDesignSvg(exportDesignSvg(project))
    expect(result.elements).toHaveLength(3)
    const rect = result.elements.find((element) => element.type === 'rect')
    expect(rect).toMatchObject({ x: 40, y: 60, width: 160, height: 90 })
  })

  test('内置模板都有正尺寸与元素，且不含紫色', () => {
    expect(CANVAS_TEMPLATES.length).toBeGreaterThanOrEqual(2)
    for (const template of CANVAS_TEMPLATES) {
      expect(template.project.artboard.width).toBeGreaterThan(0)
      expect(template.project.elements.length).toBeGreaterThan(0)
      const serialized = JSON.stringify(template.project).toLowerCase()
      expect(serialized).not.toMatch(/#[0-9a-f]{0,2}(6a0dad|8a2be2|9370db|7b68ee|9400d3)/)
    }
  })
})
