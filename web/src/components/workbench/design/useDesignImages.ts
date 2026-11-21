/**
 * 设计图片资源：导入时统一缩放/编码后写入 IndexedDB；
 * 渲染时按 assetId 懒加载成 HTMLImageElement，供 Konva 与导出共用。
 */
import { useEffect, useMemo, useState } from 'react'

import { generateUUID } from '@/utils/env'
import type { DesignAsset, DesignProject } from '@/types/designCanvas'
import { loadDesignAsset, saveDesignAsset } from './designCanvasStorage'

const MAX_SOURCE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_EDGE = 2400
const imageCache = new Map<string, HTMLImageElement>()

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = src
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function resizedDataUrl(image: HTMLImageElement, mime: string): string {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height))
  if (scale >= 1 && mime !== 'image/png') return image.src
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return image.src
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const webp = canvas.toDataURL('image/webp', 0.9)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png')
}

/** 把已解码的 data URL 归一化、缩放并写入资源库；Agent 导入与用户选图共用。 */
async function persistDesignAsset(source: string, name: string, mimeHint: string): Promise<DesignAsset | null> {
  if (!source.startsWith('data:image/')) return null
  if (source.length > MAX_SOURCE_BYTES * 1.4) return null
  const image = await loadHtmlImage(source)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) return null
  const dataUrl = resizedDataUrl(image, mimeHint)
  const finalImage = dataUrl === source ? image : await loadHtmlImage(dataUrl)
  const asset: DesignAsset = {
    id: generateUUID(),
    name: name || '图片',
    mime: dataUrl.slice(5, dataUrl.indexOf(';')),
    width: finalImage.naturalWidth || width,
    height: finalImage.naturalHeight || height,
    dataUrl,
    createdAt: Date.now(),
  }
  const stored = await saveDesignAsset(asset)
  void stored
  imageCache.set(asset.id, finalImage)
  return asset
}

/** 把用户选择的图片转成可持久化的资源；太大时缩到 2400px。 */
export async function createDesignAsset(file: File): Promise<DesignAsset | null> {
  if (!file.type.startsWith('image/') || file.size > MAX_SOURCE_BYTES) return null
  const source = await readAsDataUrl(file)
  return persistDesignAsset(source, file.name, file.type)
}

/** Agent 从本地路径导入时，由工具侧读成 data URL；这里只负责落库与缩放。 */
export async function createDesignAssetFromDataUrl(
  source: string,
  name: string,
  mimeHint = 'image/png',
): Promise<DesignAsset | null> {
  return persistDesignAsset(source, name, mimeHint)
}

async function ensureCachedImage(id: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(id)
  if (cached) return cached
  const asset = await loadDesignAsset(id)
  if (!asset) return null
  try {
    const image = await loadHtmlImage(asset.dataUrl)
    imageCache.set(id, image)
    return image
  } catch {
    return null
  }
}

export function cachedDesignImage(id: string): HTMLImageElement | undefined {
  return imageCache.get(id)
}

/** 项目里引用到的图片按 assetId 加载；新增元素后无需整页刷新。 */
export function useDesignImages(project: DesignProject | null): Record<string, HTMLImageElement> {
  const ids = useMemo(() => {
    if (!project) return [] as string[]
    return Array.from(new Set(
      project.elements
        .filter((element) => element.type === 'image')
        .map((element) => element.assetId),
    ))
  }, [project])
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({})
  const idKey = ids.join('|')

  useEffect(() => {
    let cancelled = false
    const ids = idKey ? idKey.split('|') : []
    const cached: Record<string, HTMLImageElement> = {}
    for (const id of ids) {
      const image = imageCache.get(id)
      if (image) cached[id] = image
    }
    if (Object.keys(cached).length) {
      setImages((previous) => ({ ...previous, ...cached }))
    }
    const missing = ids.filter((id) => !imageCache.has(id))
    for (const id of missing) {
      void ensureCachedImage(id).then((image) => {
        if (cancelled || !image) return
        setImages((previous) => (previous[id] === image ? previous : { ...previous, [id]: image }))
      })
    }
    return () => { cancelled = true }
  }, [idKey])

  return images
}

export function clearDesignImageCache(): void {
  imageCache.clear()
}
