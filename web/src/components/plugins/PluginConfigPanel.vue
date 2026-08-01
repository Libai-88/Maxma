<template>
  <div ref="rootEl" class="config-panel">
    <form @submit.prevent="handleSubmit">
      <div v-for="(prop, key) in schema.properties" :key="key" class="form-field">
        <label :for="key" class="form-label">
          {{ prop.title || key }}
          <span v-if="schema.required?.includes(key)" class="required">*</span>
        </label>
        <p v-if="prop.description" class="form-hint">{{ prop.description }}</p>

        <!-- String -->
        <input
          v-if="prop.type === 'string' && !prop.enum"
          :id="key"
          v-model="localConfig[key]"
          type="text"
          class="form-input"
        />

        <!-- Enum (Select) -->
        <select
          v-else-if="prop.enum"
          :id="key"
          v-model="localConfig[key]"
          class="form-select"
        >
          <option v-for="opt in prop.enum" :key="String(opt)" :value="opt">
            {{ opt }}
          </option>
        </select>

        <!-- Number -->
        <input
          v-else-if="prop.type === 'number'"
          :id="key"
          v-model.number="localConfig[key]"
          type="number"
          class="form-input"
        />

        <!-- Boolean -->
        <label v-else-if="prop.type === 'boolean'" class="form-checkbox">
          <input
            :id="key"
            v-model="localConfig[key]"
            type="checkbox"
          />
          <span>启用</span>
        </label>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">保存配置</button>
        <button type="button" class="btn" @click="handleReset">重置</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PluginConfigSchema } from '@/types/plugin'
import { useButtonFx } from '@/composables/useButtonFx'

const props = defineProps<{
  schema: PluginConfigSchema
  config: Record<string, unknown>
}>()

const emit = defineEmits<{
  update: [config: Record<string, unknown>]
}>()

const localConfig = ref<Record<string, unknown>>({ ...props.config })

const rootEl = ref<HTMLElement | null>(null)

// 保存（主 CTA）：磁吸 + 弹性
useButtonFx(() => rootEl.value, '.btn-primary', { magnetic: 10, bounceIcon: false })
// 重置（危险）：hover 左倾抖动
useButtonFx(() => rootEl.value, '.form-actions .btn:not(.btn-primary)', { danger: true, bounceIcon: false })

watch(() => props.config, (newConfig) => {
  localConfig.value = { ...newConfig }
}, { deep: true })

function handleSubmit() {
  emit('update', { ...localConfig.value })
}

function handleReset() {
  localConfig.value = { ...props.config }
}
</script>

<style scoped>
.config-panel {
  padding: 0;
}

.form-field {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 0.9em;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.required {
  color: #ef4444;
}

.form-hint {
  font-size: 0.8em;
  color: var(--text-tertiary);
  margin: 4px 0 8px;
}

.form-input,
.form-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9em;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--accent);
}

.form-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.form-checkbox input {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.btn {
  padding: 8px 20px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 0.9em;
  /* transform 交给 GSAP（hover 弹性/磁吸/抖动），不参与 CSS 过渡 */
  transition: background 0.15s var(--ease-out),
              border-color 0.15s var(--ease-out),
              color 0.15s var(--ease-out);
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
</style>
