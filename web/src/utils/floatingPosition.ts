// web/src/utils/floatingPosition.ts

export interface PlacementRect {
  width: number
  height: number
}

export interface PlacementResult {
  left: number
  top: number
  origin: string // CSS transform-origin
}

const FLOATING_INPUT_WIDTH_RATIO = 2 / 9 // 视口宽度的 2/9
const VIEWPORT_PADDING = 16

/**
 * 智能定位浮动元素，确保不超出视口边界。
 * @param anchorRect 锚点（如选区）的 BoundingClientRect
 * @param elementSize 浮动元素的宽高
 * @param viewportW 视口宽度
 * @param viewportH 视口高度
 * @param preferredPlacement 优先方向 'top' | 'bottom' | 'right' | 'left'
 */
export function computeFloatingInputPosition(
  anchorRect: DOMRect,
  elementSize: PlacementRect,
  viewportW: number,
  viewportH: number,
  preferredPlacement: 'top' | 'bottom' | 'right' | 'left' = 'bottom',
): PlacementResult {
  const width = elementSize.width || viewportW * FLOATING_INPUT_WIDTH_RATIO
  const height = elementSize.height || 120

  const anchorCenterX = anchorRect.left + anchorRect.width / 2
  const anchorCenterY = anchorRect.top + anchorRect.height / 2

  let left: number
  let top: number
  let origin: string

  switch (preferredPlacement) {
    case 'top':
      left = anchorCenterX - width / 2
      top = anchorRect.top - height - 8
      origin = 'center bottom'
      break
    case 'bottom':
      left = anchorCenterX - width / 2
      top = anchorRect.bottom + 8
      origin = 'center top'
      break
    case 'right':
      left = anchorRect.right + 8
      top = anchorCenterY - height / 2
      origin = 'left center'
      break
    case 'left':
      left = anchorRect.left - width - 8
      top = anchorCenterY - height / 2
      origin = 'right center'
      break
  }

  // clamp 到视口内
  left = Math.max(VIEWPORT_PADDING, Math.min(left, viewportW - width - VIEWPORT_PADDING))
  top = Math.max(VIEWPORT_PADDING, Math.min(top, viewportH - height - VIEWPORT_PADDING))

  // 如果 preferredPlacement 被截断，调整 origin
  if (preferredPlacement === 'top' && top > anchorRect.top - height) {
    origin = 'center top'
    top = anchorRect.bottom + 8
  }
  if (preferredPlacement === 'bottom' && top < anchorRect.bottom) {
    origin = 'center bottom'
    top = anchorRect.top - height - 8
  }

  return { left, top, origin }
}
