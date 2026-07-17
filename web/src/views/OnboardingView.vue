<template>
  <div class="onboarding-backdrop" role="presentation">
    <section class="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <header class="onboarding-header"><div><p class="eyebrow">MAXMAHERE</p><h2 id="onboarding-title">{{ titles[step] }}</h2></div><button class="skip" type="button" @click="skip">跳过</button></header>
      <div class="stepper" aria-label="引导进度"><span v-for="(_, index) in titles" :key="index" :class="{ active: index === step, complete: index < step }"></span></div>
      <div v-if="step === 0" class="step-content">
        <p>这些偏好只保存在当前设备，之后可从设置中调整。</p>
        <label>称呼<input v-model.trim="displayName" maxlength="80" autocomplete="name" placeholder="选填" /></label>
        <label>语言<select v-model="language"><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
      </div>
      <div v-else-if="step === 1" class="step-content">
        <p>连接一个模型提供商后，即可开始对话。不会在此页面收集或显示 API Key。</p>
        <p class="health-note" :class="providerReady ? 'ok' : 'attention'">{{ providerReady ? '检测到可用的模型服务。' : '尚未检测到可用的模型服务。' }}</p>
        <button class="secondary" type="button" @click="openProviders">前往模型设置</button>
      </div>
      <div v-else-if="step === 2" class="step-content">
        <p>选择你偏好的界面主题和工作方式。</p>
        <div class="theme-options"><button v-for="theme in quickThemes" :key="theme.id" type="button" class="theme-option" :class="{ selected: storedTheme === theme.id }" @click="setTheme(theme.id)"><span class="theme-swatch" :class="`swatch--${theme.id}`"></span>{{ theme.name }}</button></div>
        <label>工作区<select v-model="workspace"><option value="personal">个人对话</option><option value="project">项目工作</option></select></label>
      </div>
      <div v-else class="step-content"><p>从左侧创建或切换会话；模型、记忆和工具状态会在运行状态中汇总显示。</p><p>没有配置模型时，你仍可查看已有的会话与本地内容。</p></div>
      <footer class="onboarding-footer"><button v-if="step > 0" class="secondary" type="button" @click="step -= 1">上一步</button><span v-else></span><button class="primary" type="button" @click="next">{{ step === titles.length - 1 ? '开始使用' : '继续' }}</button></footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { HealthResponse } from '@/types'
import { THEMES, useTheme } from '@/composables/useTheme'
import { useOnboardingStore } from '@/stores/onboarding'

const props = defineProps<{ health: HealthResponse | null }>()
const emit = defineEmits<{ openProviders: [] }>()
const onboarding = useOnboardingStore()
const { storedTheme, setTheme } = useTheme()
const step = ref(0)
const titles = ['欢迎使用', '连接模型', '设定工作区', '快速了解']
const quickThemes = THEMES.filter(theme => ['warm-paper', 'midnight', 'high-contrast'].includes(theme.id))
const displayName = ref(onboarding.snapshot.preferences.displayName)
const language = ref(onboarding.snapshot.preferences.language)
const workspace = ref(onboarding.snapshot.preferences.workspace)
const providerReady = computed(() => props.health?.llm.status === 'ok')
watch([displayName, language, workspace], () => onboarding.updatePreferences({ displayName: displayName.value, language: language.value, workspace: workspace.value }))
function skip() { onboarding.complete() }
function next() { if (step.value === titles.length - 1) onboarding.complete(); else step.value += 1 }
function openProviders() { emit('openProviders') }
</script>

<style scoped>
.onboarding-backdrop { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(24, 27, 29, 0.44); }
.onboarding { width: min(100%, 560px); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-card); box-shadow: var(--shadow-lg); }
.onboarding-header, .onboarding-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 24px; }.onboarding-header { border-bottom: 1px solid var(--border); }.onboarding-footer { border-top: 1px solid var(--border); }
h2 { margin: 3px 0 0; font-size: 21px; color: var(--text-primary); }.eyebrow { color: var(--text-tertiary); font-size: 11px; letter-spacing: 0.08em; }
.skip, .primary, .secondary, .theme-option { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 12px; font: inherit; font-size: 13px; cursor: pointer; }.skip, .secondary, .theme-option { background: transparent; color: var(--text-secondary); }.primary { background: var(--accent); border-color: var(--accent); color: var(--bg-primary); }.primary:focus-visible, .secondary:focus-visible, .skip:focus-visible, .theme-option:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.stepper { display: flex; gap: 6px; padding: 18px 24px 0; }.stepper span { display: block; height: 3px; flex: 1; background: var(--border); }.stepper .active, .stepper .complete { background: var(--accent); }
.step-content { display: grid; gap: 16px; min-height: 236px; padding: 24px; color: var(--text-secondary); line-height: 1.6; }.step-content p { margin: 0; }label { display: grid; gap: 6px; color: var(--text-primary); font-size: 13px; }input, select { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-primary); font: inherit; padding: 9px 10px; }input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }.health-note { border-left: 3px solid var(--border); padding-left: 10px; }.health-note.ok { border-color: var(--status-ok); }.health-note.attention { border-color: #d97706; }.theme-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }.theme-option { display: grid; gap: 6px; text-align: left; }.theme-option.selected { border-color: var(--accent); color: var(--text-primary); }.theme-swatch { display: block; height: 30px; border: 1px solid var(--border); border-radius: 3px; }
.swatch--warm-paper { background: #F8F4ED; }
.swatch--midnight { background: #3B4A54; }
.swatch--high-contrast { background: #FAF8F7; }
@media (max-width: 520px) { .onboarding-backdrop { padding: 12px; }.onboarding-header, .onboarding-footer, .step-content { padding-left: 18px; padding-right: 18px; }.theme-options { grid-template-columns: 1fr; } }
</style>
