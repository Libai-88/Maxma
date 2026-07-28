import { ref, type Ref } from 'vue'
import { api } from '@/api'
import { createLogger } from '@/utils/logger'
import type { ImageRef, ParsedRef } from '@/utils/references'

const log = createLogger('ChatInput:Image')

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']
const MAX_IMAGE_SIZE = 20 * 1024 * 1024 // 20MB

interface UseImageAttachmentOptions {
  refs: Ref<ParsedRef[]>
  showMenu: Ref<boolean>
}

/**
 * 图片附件：拖拽、粘贴、文件选择、上传、错误提示
 */
export function useImageAttachment({ refs, showMenu }: UseImageAttachmentOptions) {
  const isDragover = ref(false)
  const imageError = ref<string | null>(null)
  let dragCounter = 0
  let _imageErrorTimer: ReturnType<typeof setTimeout> | null = null

  function showImageError(msg: string) {
    imageError.value = msg
    if (_imageErrorTimer) clearTimeout(_imageErrorTimer)
    _imageErrorTimer = setTimeout(() => {
      if (_imageErrorTimer && imageError.value === msg) {
        imageError.value = null
        _imageErrorTimer = null
      }
    }, 5000)
  }

  /** 通过文件选择器选择图片 */
  async function pickImage() {
    showMenu.value = false
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = async () => {
      if (!input.files) return
      for (const file of Array.from(input.files)) {
        await handleImageFile(file)
      }
    }
    input.click()
  }

  /** 处理单个图片文件：校验 → 上传 → 添加到 refs */
  async function handleImageFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!file.type.startsWith('image/') && !IMAGE_EXTS.includes(ext)) {
      log.warn('非图片文件:', file.name)
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      log.warn('图片过大:', file.size, file.name)
      showImageError(`图片超过 20MB 限制：${file.name}`)
      return
    }

    const preview = URL.createObjectURL(file)
    const label = file.name || 'image'
    refs.value.push({ type: 'image', label, path: '', preview } as ImageRef)

    try {
      const result = await api.uploadImage(file)
      const idx = refs.value.findIndex(r => r.type === 'image' && (r as ImageRef).preview === preview)
      if (idx === -1) {
        URL.revokeObjectURL(preview)
        return
      }
      const entry = refs.value[idx] as ImageRef
      entry.path = result.path
      log.debug('image uploaded:', result.path)
    } catch (e) {
      log.error('image upload failed:', e)
      const errMsg = e instanceof Error ? e.message : '图片上传失败，请重试'
      showImageError(errMsg)
      const idx = refs.value.findIndex(r => r.type === 'image' && (r as ImageRef).preview === preview)
      if (idx !== -1) {
        refs.value.splice(idx, 1)
      }
      URL.revokeObjectURL(preview)
    }
  }

  function onDragEnter(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return
    dragCounter++
    isDragover.value = true
  }

  function onDragOver(_e: DragEvent) {
    // 保持 isDragover 状态
  }

  function onDragLeave(_e: DragEvent) {
    dragCounter--
    if (dragCounter <= 0) {
      dragCounter = 0
      isDragover.value = false
    }
  }

  async function onDrop(e: DragEvent) {
    isDragover.value = false
    dragCounter = 0
    const files = e.dataTransfer?.files
    if (!files) return
    let hasNonImage = false
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        await handleImageFile(file)
      } else {
        hasNonImage = true
      }
    }
    if (hasNonImage) {
      showImageError('仅支持拖拽图片文件，其他文件请使用"选择文件"')
    }
  }

  function cleanup() {
    if (_imageErrorTimer) clearTimeout(_imageErrorTimer)
    _imageErrorTimer = null
  }

  return {
    isDragover,
    imageError,
    showImageError,
    pickImage,
    handleImageFile,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    cleanup,
  }
}
