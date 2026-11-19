/** dsh-meme 图库模型（与后端 /api/stickers/* 对齐）。 */
export interface StickerMeme {
  packId: string
  packName: string
  path: string
  url: string
  tag: string
  caption: string
  keywords: string
  file_name: string
}

export interface StickerPack {
  id: string
  name: string
  description?: string
  version?: string
  count: number
  license?: string
  source?: 'bundled' | 'user' | 'remote' | 'legacy' | string
  enabled: boolean
  path: string
  cover?: string
  covers?: string[]
  updatedAt?: number
}

export interface StickerSettings {
  packId: string
  enabledPacks: string[]
  layoutMode: 'inline' | 'stacked'
  pickerSendOnClick: boolean
  pickerAttachImage: boolean
  sendGear: 'auto' | 'active' | 'always' | 'off'
  sendMode: 'auto' | 'image' | 'text'
  promptEnabled: boolean
  remoteDirUrl: string
  remoteSubs: string[]
  opacity: number
  scale: number
}

export interface StickerIndexPayload {
  ok: boolean
  total: number
  tags: Array<{ tag: string; count: number }>
  packs: StickerPack[]
  memes: StickerMeme[]
}
