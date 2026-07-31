import { onUnmounted } from 'vue'

/**
 * Konami Code 监听（↑↑↓↓←→←→BA）。
 * 序列完整触发时回调一次并重置；按键不匹配则回到起点（若匹配首个按键则停在 1）。
 * 组件卸载自动移除监听。
 */
export function useKonami(cb: () => void) {
  const SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']
  let idx = 0

  const onKey = (e: KeyboardEvent) => {
    // 避免在输入框/编辑态触发彩蛋，防止误伤正在打字的内容
    const el = e.target as HTMLElement | null
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el?.isContentEditable) return
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (key === SEQUENCE[idx]) {
      idx++
      if (idx === SEQUENCE.length) {
        idx = 0
        cb()
      }
    } else {
      idx = key === SEQUENCE[0] ? 1 : 0
    }
  }

  window.addEventListener('keydown', onKey)
  onUnmounted(() => window.removeEventListener('keydown', onKey))
}
