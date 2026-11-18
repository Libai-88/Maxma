// web/src/utils/floatingWindow.ts
//
// 悬浮小窗的位置计算（纯函数，便于单测）。
//
// 为什么抽出来：SteeringWindow 与 TaskReviewWindow 都需要"拖动后钳回视口、
// 默认停靠右下、记得上次位置"。各写一套的代价是两套边界行为不一致——
// 比如一个用 8px 边距、另一个用 16px，窗口拖到边缘时看起来像"漏出去了"。

export interface FloatingPos {
  x: number
  y: number
}

export interface FloatingSize {
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

/** 拖动落点与视口边缘的最小间距。 */
export const FLOATING_MARGIN = 8

/** 把窗口钳进视口，避免拖出屏幕后找不回来。 */
export function clampFloatingPos(pos: FloatingPos, size: FloatingSize, viewport: Viewport): FloatingPos {
  return {
    x: Math.min(Math.max(FLOATING_MARGIN, pos.x), Math.max(FLOATING_MARGIN, viewport.width - size.width - FLOATING_MARGIN)),
    y: Math.min(Math.max(FLOATING_MARGIN, pos.y), Math.max(FLOATING_MARGIN, viewport.height - size.height - FLOATING_MARGIN)),
  }
}

/**
 * 没有保存位置时的默认落点：右下角、输入框上方。
 * 窗口比视口还高时贴住上边（而不是被顶出去）。
 */
export function defaultFloatingPos(
  size: FloatingSize,
  viewport: Viewport,
  opts: { margin?: number; composerReserve?: number } = {},
): FloatingPos {
  const margin = opts.margin ?? 16
  const composerReserve = opts.composerReserve ?? 96
  return {
    x: Math.max(margin, viewport.width - size.width - margin),
    y: Math.max(margin, viewport.height - size.height - composerReserve),
  }
}

/** 读取上次拖动的位置；存储不可用或内容损坏时返回 null（回退到默认锚点）。 */
export function readStoredPos(key: string, storage?: Pick<Storage, 'getItem'> | null): FloatingPos | null {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FloatingPos>
    return typeof parsed?.x === 'number' && typeof parsed?.y === 'number' ? { x: parsed.x, y: parsed.y } : null
  } catch {
    return null
  }
}

export function writeStoredPos(key: string, pos: FloatingPos, storage?: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(key, JSON.stringify(pos))
  } catch {
    /* 存储不可用（隐私模式/配额满）不影响本次拖动 */
  }
}
