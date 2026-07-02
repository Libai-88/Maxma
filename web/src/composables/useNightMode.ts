import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

export type NightModeSetting = 'auto' | 'on' | 'off'

const STORAGE_KEY = 'maxma.nightMode'
const nightModeSetting = ref<NightModeSetting>(readSetting())
const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | null = null
let consumers = 0

function readSetting(): NightModeSetting {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'auto' || saved === 'on' || saved === 'off') return saved
  } catch {
    // ignore storage failures
  }
  return 'auto'
}

const isLateNight = computed(() => {
  const hour = now.value.getHours()
  return hour >= 23 || hour < 6
})

const isNightMode = computed(() =>
  nightModeSetting.value === 'on' || (nightModeSetting.value === 'auto' && isLateNight.value)
)

watch(nightModeSetting, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // ignore storage failures
  }
})

function startClock() {
  if (timer) return
  now.value = new Date()
  timer = setInterval(() => {
    now.value = new Date()
  }, 60_000)
}

function stopClock() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

export function cycleNightModeSetting() {
  nightModeSetting.value =
    nightModeSetting.value === 'auto' ? 'on'
    : nightModeSetting.value === 'on' ? 'off'
    : 'auto'
}

export function useNightModeState() {
  return { nightModeSetting, isNightMode, isLateNight }
}

export function useNightModeClock() {
  onMounted(() => {
    consumers++
    startClock()
  })

  onUnmounted(() => {
    consumers = Math.max(0, consumers - 1)
    if (consumers === 0) stopClock()
  })

  return { nightModeSetting, isNightMode, isLateNight, cycleNightModeSetting }
}
