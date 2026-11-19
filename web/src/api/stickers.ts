import { ensureTokenLoaded, getToken, request } from '@/api'
import { getApiBase } from '@/utils/env'
import type { StickerIndexPayload, StickerPack, StickerSettings } from '@/types/sticker'

export interface StickerMarketPack {
  id: string
  name: string
  version: string
  description: string
  maintainer: string
  license: string
  homepage: string
  count: number
  archiveUrl: string
  sha256: string
  preview: string
  keywords: string[]
  installed: boolean
  installedVersion?: string
}

export function getStickerMarket(refresh = false) {
  return request<{
    ok: boolean
    sourceUrl: string
    source: string
    fetchedAt: number
    packs: StickerMarketPack[]
    warning?: string
  }>(`/stickers/market${refresh ? '?refresh=1' : ''}`)
}

export function installStickerMarketPack(id: string) {
  return request<{ ok: boolean; id: string; total: number; replaced: boolean }>('/stickers/market/install', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

export function importStickerPack(file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<{ ok: boolean; id: string; total: number; replaced: boolean }>('/stickers/packs/import', {
    method: 'POST',
    body: form,
  })
}

/** 导出走浏览器下载；Token 用 query，img/download 无法自定义头。 */
export async function downloadStickerPack(packId: string) {
  await ensureTokenLoaded()
  const base = getApiBase()
  const res = await fetch(`${base}/stickers/packs/${encodeURIComponent(packId)}/export?token=${encodeURIComponent(getToken())}`)
  if (!res.ok) throw new Error(`导出失败 (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${packId}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function deleteStickerPack(packId: string) {
  return request<{ ok: boolean }>(`/stickers/packs/${encodeURIComponent(packId)}`, { method: 'DELETE' })
}

/** 图库索引；packId=all 时按设置里的已启用图库聚合。 */
export function getStickerIndex(packId = 'all') {
  return request<StickerIndexPayload>(`/stickers/index?packId=${encodeURIComponent(packId)}`)
}

export function getStickerPacks() {
  return request<{ ok: boolean; packs: StickerPack[] }>('/stickers/packs')
}

export function getStickerSettings() {
  return request<{ ok: boolean; settings: StickerSettings }>('/stickers/settings')
}

export function saveStickerSettings(patch: Partial<StickerSettings>) {
  return request<{ ok: boolean; settings: StickerSettings }>('/stickers/settings', {
    method: 'POST',
    body: JSON.stringify(patch),
  })
}

export function updateStickerMeme(body: {
  packId: string
  path: string
  tag?: string
  caption?: string
  keywords?: string
}) {
  return request<{ ok: boolean; meme?: unknown }>('/stickers/memes/update', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteStickerMeme(packId: string, path: string) {
  return request<{ ok: boolean }>(`/stickers/memes?packId=${encodeURIComponent(packId)}&path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  })
}

export function scanStickerPack(packId: string) {
  return request<{ ok: boolean; pack?: StickerPack }>(`/stickers/packs/${encodeURIComponent(packId)}/scan`, {
    method: 'POST',
  })
}

export function activateStickerPack(packId: string) {
  return request<{ ok: boolean; settings?: StickerSettings }>(`/stickers/packs/${encodeURIComponent(packId)}/activate`, {
    method: 'POST',
    body: JSON.stringify({ packId }),
  })
}
