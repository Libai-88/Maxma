import { ref, watch } from 'vue'

const STORAGE_KEY = 'maxma.paper_texture'
const enabled = ref(true)

try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved !== null) enabled.value = saved === 'true'
} catch { /* noop */ }

watch(enabled, (v) => {
  try { localStorage.setItem(STORAGE_KEY, String(v)) } catch { /* noop */ }
  document.body.classList.toggle('paper-texture', v)
})

export function usePaperTexture() {
  function toggle() { enabled.value = !enabled.value }
  function set(v: boolean) { enabled.value = v }
  return { enabled, toggle, set }
}
