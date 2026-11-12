import { cn } from '@/lib/utils'

/**
 * 贴纸（表情）图块 —— 统一展示口径。
 *
 * 贴纸库的固有尺寸从 29×29 到 256×256，还有 2.9:1 的宽条；直接塞进气泡会
 * 出现「有的正常、有的被压扁、有的显得很窄」。统一口径为：
 * **固定高 96px + 等比缩放 + 最宽 160px + object-contain**：
 *  - 29×29 小图被放大到 96 高，不再缩成一角；
 *  - 256×256 显示为 96×96；
 *  - 256×48 宽条按比例缩到 160×30，不被拉伸、不裁切。
 *
 * 为什么不用 `Attachment`/`AttachmentMedia`：后者的媒体槽是**缩略图语义**
 * （`aspect-square` + `object-cover`，会裁掉宽图/高图），而贴纸必须完整展示。
 * shadcn 没有裸图片原语，尺寸纪律由本组件统一（类全部来自设计系统，
 * 颜色/圆角走 token，不写死值）。
 */
export function Sticker({ path, src, alt = '贴纸', className }: {
  /** 相对贴纸根的路径（`category/file.webp`），对应消息里的 `<sticker:path>`。 */
  path?: string
  /** 已带 `/api/stickers/...` 前缀的完整地址（例如通道回传的 stickerUrl）。 */
  src?: string
  alt?: string
  className?: string
}) {
  const resolved = path ? `/api/stickers/${path}` : src
  if (!resolved) return null
  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn('my-1 inline-block h-24 w-auto max-w-40 rounded-lg object-contain align-middle', className)}
    />
  )
}