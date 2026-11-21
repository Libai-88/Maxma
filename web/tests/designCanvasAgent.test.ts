import { describe, expect, test } from 'bun:test'

import type { DesignAsset } from '../src/types/designCanvas.ts'
import {
  applyDesignOperations,
  summarizeDesignProject,
} from '../src/components/workbench/design/canvasAgentOperations.ts'
import { createDefaultProject } from '../src/components/workbench/design/canvasModel.ts'

const imageAsset: DesignAsset = {
  id: 'asset-1',
  name: 'hero.png',
  mime: 'image/png',
  width: 320,
  height: 180,
  dataUrl: 'data:image/png;base64,AA==',
  createdAt: 1,
}

describe('Agent 画布操作模型', () => {
  test('一批 add_text/add_shape/rename 顺序执行，并选中最后新增元素', () => {
    const result = applyDesignOperations(createDefaultProject('未命名设计'), [
      { op: 'rename', name: '发布会主视觉' },
      {
        op: 'add_text',
        text: '让设计自己发生',
        x: 72,
        y: 80,
        width: 720,
        height: 220,
        fontSize: 72,
        fontWeight: 700,
        color: '#16181D',
      },
      {
        op: 'add_shape',
        shape: 'rect',
        x: 72,
        y: 760,
        width: 380,
        height: 120,
        fill: '#C96F4A',
        radius: 24,
      },
    ])

    expect(result.changed).toBe(true)
    expect(result.addedIds).toHaveLength(2)
    expect(result.project.name).toBe('发布会主视觉')
    expect(result.project.elements).toHaveLength(2)
    expect(result.project.elements[0]?.type).toBe('text')
    expect(result.project.elements[1]?.type).toBe('rect')
    expect(result.selectedId).toBe(result.addedIds[1])
  })

  test('add_image 只给宽度时按原图比例算高度，并写出 assetId', () => {
    const result = applyDesignOperations(createDefaultProject(), [
      {
        op: 'add_image',
        asset: imageAsset,
        x: 60,
        y: 60,
        width: 640,
        name: '主图',
        fit: 'cover',
      },
    ])

    const element = result.project.elements[0]
    expect(element?.type).toBe('image')
    if (element?.type !== 'image') throw new Error('expected image')
    expect(element.assetId).toBe('asset-1')
    expect(element.width).toBe(640)
    expect(element.height).toBe(360)
    expect(element.x).toBe(60)
  })

  test('update/remove/reorder 在同一个项目快照上继续生效，且不改变元素 type', () => {
    const base = applyDesignOperations(createDefaultProject(), [
      { op: 'add_shape', shape: 'rect', name: '底层', x: 10, y: 10, width: 200, height: 100 },
      { op: 'add_shape', shape: 'ellipse', name: '顶层', x: 30, y: 30, width: 200, height: 100 },
    ])
    const [firstId, secondId] = base.addedIds
    if (!firstId || !secondId) throw new Error('missing ids')

    const result = applyDesignOperations(base.project, [
      { op: 'update', id: secondId, patch: { x: 300, y: 260, fill: '#2F5D7C' } },
      { op: 'reorder', id: firstId, direction: 'up' },
    ], base.selectedId)

    expect(result.project.elements.map((element) => element.name)).toEqual(['顶层', '底层'])
    const moved = result.project.elements.find((element) => element.id === secondId)
    expect(moved?.x).toBe(300)
    expect(moved?.y).toBe(260)

    expect(() => applyDesignOperations(base.project, [
      { op: 'update', id: secondId, patch: { type: 'text' } },
    ])).toThrow('不允许改变元素 type')
  })

  test('坐标夹紧在画板内，超长文本与未知操作被明确拒绝', () => {
    const result = applyDesignOperations(createDefaultProject(), [
      { op: 'add_shape', shape: 'rect', x: 5000, y: -80, width: 300, height: 100 },
    ])
    const element = result.project.elements[0]
    expect(element?.x).toBe(780)
    expect(element?.y).toBe(0)

    expect(() => applyDesignOperations(createDefaultProject(), [
      { op: 'add_text', text: '' },
    ])).toThrow('add_text 需要非空 text')
    expect(() => applyDesignOperations(createDefaultProject(), [
      { op: 'explode' } as never,
    ])).toThrow('未知 operation')
    expect(() => applyDesignOperations(createDefaultProject(), [])).toThrow('operations 不能为空')
  })

  test('read 摘要只保留长文本预览，并带出选中元素', () => {
    const longText = '长'.repeat(400)
    const result = applyDesignOperations(createDefaultProject('摘要项目'), [
      { op: 'add_text', text: longText, name: '正文' },
    ])
    const summary = summarizeDesignProject(result.project, result.selectedId)
    const element = summary.elements[0]

    expect(summary.name).toBe('摘要项目')
    expect(summary.elementCount).toBe(1)
    expect(summary.selectedId).toBe(element?.id)
    expect(String(element?.text)).toHaveLength(321)
    expect(String(element?.text).endsWith('…')).toBe(true)
  })
})
