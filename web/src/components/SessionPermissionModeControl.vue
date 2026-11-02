<template>
  <PermissionModeControl
    :available-modes="availableModes"
    :mode="mode"
    :busy="busy"
    @change="updateMode"
  />
  <span v-if="errorMessage" ref="errorRef" class="permission-mode-error" role="status" aria-live="polite">
    {{ errorMessage }}
  </span>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { PermissionMode } from '@/types'
import { ref, watch } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import PermissionModeControl from './PermissionModeControl.vue'

const props = defineProps<{
  sessionId: string
}>()

const errorRef = ref<HTMLElement | null>(null)

// 错误提示出现时淡入滑落
useGsap((_ctx, contextSafe) => {
  watch(errorMessage, contextSafe((msg) => {
    if (!msg) return
    const el = errorRef.value
    if (!el) return
    gsap.fromTo(el,
      { opacity: 0, y: -4 },
      { opacity: 1, y: 0, duration: 0.25, ease: easeMap.out, clearProps: 'transform' })
  }), { flush: 'post' })
})

/**
 * 可用档位来自服务端 `available_permission_modes`——非空即可交互。
 *
 * 这里以前读的是 `response.permission_modes_enabled`，而后端从不产出该字段
 * （它回的是 `enabled`），于是恒为 undefined → 控件恒禁用 → 用户每次切换都被
 * `updateMode()` 的 `if (!enabled)` 静默吞掉。四档在 kernel 里一直是真实生效的，
 * 断的只是这条 UI 链。没有 feature flag，所以也不再回一个恒 true 的布尔量。
 */
const availableModes = ref<PermissionMode[]>([])
const mode = ref<PermissionMode>('ask')
const busy = ref(false)
const errorMessage = ref('')
let requestGeneration = 0

function isCurrentSession(sessionId: string, generation: number): boolean {
  return props.sessionId === sessionId && requestGeneration === generation
}

async function load(sessionId: string) {
  const generation = ++requestGeneration
  availableModes.value = []
  mode.value = 'ask'
  busy.value = false
  errorMessage.value = ''

  if (!sessionId) return

  try {
    const response = await api.getSessionPermissionMode(sessionId)
    if (!isCurrentSession(sessionId, generation)) return
    availableModes.value = response.available_permission_modes
    mode.value = response.permission_mode
  } catch {
    // 能力探测失败不新增 UI：保持隐藏（空清单），下一次载入会话时重试。
  }
}

async function updateMode(nextMode: PermissionMode) {
  const sessionId = props.sessionId
  const generation = requestGeneration
  if (availableModes.value.length === 0 || busy.value || !sessionId) return

  busy.value = true
  errorMessage.value = ''
  try {
    const response = await api.setSessionPermissionMode(sessionId, nextMode)
    if (!isCurrentSession(sessionId, generation)) return
    availableModes.value = response.available_permission_modes
    mode.value = response.permission_mode
    // 不再补发 WS update_auto_approve（PERM-LIVE-001 的旧注释）。Bun 后端是
    // in-process 直调 kernel：PUT 经 set_permission_mode RPC 改的就是运行中
    // 会话的 record.permissionMode，审批门按闭包读它，切换即时生效
    // （bun-backend/tests/permission-mode-contract.test.ts 锁住这条链）。
    // 而 update_auto_approve 走的是 set_auto_approve，它只会把模式写成
    // auto / ask——补发会把刚选定的档位改掉：read_only 静默退回 ask，
    // operate 被升级成 auto。那是 Python/sidecar 跨进程时代的遗留。
  } catch {
    if (!isCurrentSession(sessionId, generation)) return
    // 这条链后端只会回 404（会话不存在）/ 422（档位非法），没有"功能未开"
    // 的 409；旧代码为 409 写的降级分支永远命中不了，删掉。
    errorMessage.value = '无法更新会话权限，请稍后重试。'
  } finally {
    if (isCurrentSession(sessionId, generation)) busy.value = false
  }
}

watch(() => props.sessionId, sessionId => { void load(sessionId) }, { immediate: true })
</script>

<style scoped>
.permission-mode-error {
  max-width: 240px;
  color: var(--status-warn-text);
  font-size: 12px;
  line-height: 1.35;
}
</style>
