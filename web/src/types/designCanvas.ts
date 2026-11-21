/** 设计画布的数据模型。 */

export type CanvasElementType = 'text' | 'image' | 'rect' | 'ellipse' | 'line'
export type CanvasTool = 'select' | 'pan' | 'text' | 'image' | 'rect' | 'ellipse' | 'line'
export type CanvasFontFamily = 'sans' | 'serif' | 'mono'
export type CanvasFontWeight = 400 | 500 | 600 | 700
export type CanvasTextAlign = 'left' | 'center' | 'right'
export type CanvasImageFit = 'cover' | 'contain'

export interface DesignArtboard {
  width: number
  height: number
  background: string
}

interface DesignElementBase {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  locked: boolean
  hidden: boolean
}

export interface DesignTextElement extends DesignElementBase {
  type: 'text'
  text: string
  fontSize: number
  fontWeight: CanvasFontWeight
  fontFamily: CanvasFontFamily
  color: string
  align: CanvasTextAlign
  lineHeight: number
  letterSpacing: number
}

export interface DesignImageElement extends DesignElementBase {
  type: 'image'
  assetId: string
  alt: string
  fit: CanvasImageFit
  radius: number
}

export interface DesignShapeElement extends DesignElementBase {
  type: 'rect' | 'ellipse' | 'line'
  fill: string
  stroke: string
  strokeWidth: number
  radius: number
}

export type DesignElement = DesignTextElement | DesignImageElement | DesignShapeElement

/** 图片单独存在 IndexedDB，项目里只引用 assetId，避免撤销快照复制整张图。 */
export interface DesignAsset {
  id: string
  name: string
  mime: string
  width: number
  height: number
  dataUrl: string
  createdAt: number
}

export interface DesignProject {
  version: 1
  name: string
  artboard: DesignArtboard
  /** 数组顺序就是图层顺序：0 在最底层，末尾在最上层。 */
  elements: DesignElement[]
  updatedAt: number
}

export interface ArtboardPreset {
  id: string
  label: string
  width: number
  height: number
  hint: string
}

export interface CanvasView {
  x: number
  y: number
  scale: number
}
