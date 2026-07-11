<template>
  <PermissionModeControl
    :enabled="enabled"
    :mode="mode"
    :busy="busy"
    @change="updateMode"
  />
  <span v-if="errorMessage" class="permission-mode-error" role="status" aria-live="polite">
    {{ errorMessage }}
  </span>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { PermissionMode } from '@/types'
import { ref, watch } from 'vue'
import PermissionModeControl from './PermissionModeControl.vue'

const props = defineProps<{
  sessionId: string
}>()

const enabled = ref(false)
const mode = ref<PermissionMode>('ask')
const busy = ref(false)
const errorMessage = ref('')
let requestGeneration = 0

function isCurrentSession(sessionId: string, generation: number): boolean {
  return props.sessionId === sessionId && requestGeneration === generation
}

function isFeatureUnavailable(error: unknown): boolean {
  return error instanceof Error && /\b409\b/.test(error.message)
}

async function load(sessionId: string) {
  const generation = ++requestGeneration
  enabled.value = false
  mode.value = 'ask'
  busy.value = false
  errorMessage.value = ''

  if (!sessionId) return

  try {
    const response = await api.getSessionPermissionMode(sessionId)
    if (!isCurrentSession(sessionId, generation)) return
    enabled.value = response.permission_modes_enabled
    mode.value = response.permission_mode
  } catch {
    // A failed initial capability probe must not create a new UI surface.
    // The normal session controls remain available and the next session load retries.
  }
}

async function updateMode(nextMode: PermissionMode) {
  const sessionId = props.sessionId
  const generation = requestGeneration
  if (!enabled.value || busy.value || !sessionId) return

  busy.value = true
  errorMessage.value = ''
  try {
    const response = await api.setSessionPermissionMode(sessionId, nextMode)
    if (!isCurrentSession(sessionId, generation)) return
    enabled.value = response.permission_modes_enabled
    mode.value = response.permission_mode
  } catch (error) {
    if (!isCurrentSession(sessionId, generation)) return
    if (isFeatureUnavailable(error)) {
      enabled.value = false
      mode.value = 'ask'
      errorMessage.value = '权限模式当前不可用，已继续使用逐次确认。'
    } else {
      errorMessage.value = '无法更新会话权限，请稍后重试。'
    }
  } finally {
    if (isCurrentSession(sessionId, generation)) busy.value = false
  }
}

watch(() => props.sessionId, sessionId => { void load(sessionId) }, { immediate: true })
</script>

<style scoped>
.permission-mode-error {
  max-width: 240px;
  color: var(--status-warn, #b45309);
  font-size: 12px;
  line-height: 1.35;
}
</style>
