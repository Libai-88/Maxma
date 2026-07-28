import { computed, ref } from 'vue'
import type { ImageRef, ParsedRef } from '@/utils/references'
import { REF_CHIP_CONFIG } from '@/utils/references'

/**
 * 文件引用列表管理：增删、图片/非图片分离、图标/tooltip 查询
 */
export function useFileRefs() {
  const refs = ref<ParsedRef[]>([])

  const imageRefs = computed(() => refs.value.filter((r): r is ImageRef => r.type === 'image'))
  const nonImageRefs = computed(() => refs.value.filter((r): r is Exclude<ParsedRef, ImageRef> => r.type !== 'image'))

  function getRefIndex(imgRef: ImageRef): number {
    return refs.value.indexOf(imgRef)
  }

  function getNonImageRefIndex(r: Exclude<ParsedRef, ImageRef>): number {
    return refs.value.indexOf(r as ParsedRef)
  }

  function addRef(r: ParsedRef) {
    refs.value.push(r)
  }

  function removeRef(idx: number) {
    const item = refs.value[idx]
    if (item && item.type === 'image' && (item as ImageRef).preview?.startsWith('blob:')) {
      URL.revokeObjectURL((item as ImageRef).preview)
    }
    refs.value.splice(idx, 1)
  }

  /** TransitionGroup before-leave：冻结退场元素位置，防止 flex 跳跃 */
  function freezeLeavePos(el: Element) {
    const htmlEl = el as HTMLElement
    const parent = htmlEl.offsetParent as HTMLElement
    if (parent) {
      htmlEl.style.left = htmlEl.offsetLeft + 'px'
      htmlEl.style.top = htmlEl.offsetTop + 'px'
    }
  }

  function getRefIcon(r: ParsedRef): string {
    return REF_CHIP_CONFIG[r.type]?.icon ?? 'file'
  }

  function getRefTooltip(r: ParsedRef): string {
    const base = REF_CHIP_CONFIG[r.type]?.tooltip(r) ?? r.label
    if ('blocked' in r && r.blocked) {
      return `${base}\n已阻挡：${r.blockedReason || '路径被阻挡，无法访问'}`
    }
    return base
  }

  /** 释放所有图片预览 URL 并清空列表 */
  function clearRefs() {
    for (const r of refs.value) {
      if (r.type === 'image' && r.preview.startsWith('blob:')) {
        URL.revokeObjectURL(r.preview)
      }
    }
    refs.value = []
  }

  return {
    refs,
    imageRefs,
    nonImageRefs,
    getRefIndex,
    getNonImageRefIndex,
    addRef,
    removeRef,
    freezeLeavePos,
    getRefIcon,
    getRefTooltip,
    clearRefs,
  }
}
