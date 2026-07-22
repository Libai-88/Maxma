<template>
  <div class="onboarding-backdrop" role="presentation">
    <section class="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <header class="onboarding-header"><div><p class="eyebrow">MAXMAHERE</p><h2 id="onboarding-title">{{ titles[step] }}</h2></div><button class="skip" type="button" @click="skip">跳过</button></header>
      <div class="stepper" aria-label="引导进度"><span v-for="(_, index) in titles" :key="index" :class="{ active: index === step, complete: index < step }"></span></div>
      <div v-if="step === 0" class="step-content">
        <!-- 价值主张：让 Novice 在被要求填表前先理解 Maxma 是什么 -->
        <div class="intro-block">
          <p class="intro-lead"><strong>Maxma</strong> 是一款本地优先的 AI 桌面工作站——把大模型对话、工具调用、长期记忆与人设系统整合在一个应用里，所有数据都保存在你的电脑上。</p>
          <div class="intro-chips" aria-label="核心能力">
            <span class="intro-chip"><Icon name="chat" :size="12" />多模型对话</span>
            <span class="intro-chip"><Icon name="tool" :size="12" />MCP 工具</span>
            <span class="intro-chip"><Icon name="sparkles" :size="12" />Skills 技能</span>
            <span class="intro-chip"><Icon name="memory" :size="12" />长期记忆</span>
            <span class="intro-chip"><Icon name="sparkles" :size="12" />人设系统</span>
            <span class="intro-chip"><Icon name="lock" :size="12" />本地优先</span>
          </div>
        </div>
        <p class="form-note">这些偏好只保存在当前设备，之后可从设置中调整。</p>
        <label>称呼<input v-model.trim="displayName" maxlength="80" autocomplete="name" placeholder="选填" /></label>
        <label>语言<select v-model="language"><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
      </div>
      <div v-else-if="step === 1" class="step-content">
        <p>连接一个模型提供商后，即可开始对话。不会在此页面收集或显示 API Key。</p>
        <p class="health-note" :class="providerReady ? 'ok' : 'attention'">{{ providerReady ? '检测到可用的模型服务。' : '尚未检测到可用的模型服务——可点击下方按钮前往配置。' }}</p>
        <div class="step-tip">
          <Icon class="tip-icon" name="info" :size="14" />
          <div class="tip-text">不知道选哪个？<strong>DeepSeek</strong> 注册即送免费额度、中文表现优秀；<strong>Ollama</strong> 完全本地运行、无需 API Key。</div>
        </div>
        <button class="secondary" type="button" @click="openProviders">前往模型设置</button>
      </div>
      <div v-else-if="step === 2" class="step-content">
        <p>选择你偏好的界面主题和工作方式。</p>
        <div class="theme-options"><button v-for="theme in quickThemes" :key="theme.id" type="button" class="theme-option" :class="{ selected: storedTheme === theme.id }" @click="setTheme(theme.id)"><span class="theme-swatch" :class="`swatch--${theme.id}`"></span>{{ theme.name }}</button></div>
        <label>工作区<select v-model="workspace"><option value="personal">个人对话</option><option value="project">项目工作</option></select></label>
      </div>
      <div v-else class="step-content">
        <!-- 完成引导：给出明确的"下一步"指引，避免用户完成后迷失 -->
        <p class="ready-lead">准备就绪！现在可以开始使用 Maxma 了。</p>
        <div class="next-steps">
          <div class="next-step">
            <span class="next-step-no">1</span>
            <div class="next-step-body">
              <div class="next-step-title">回到对话页开始聊天</div>
              <div class="next-step-desc">点击左侧「对话」入口，输入任何问题或试试内置示例。</div>
            </div>
          </div>
          <div class="next-step">
            <span class="next-step-no">2</span>
            <div class="next-step-body">
              <div class="next-step-title">按需扩展能力</div>
              <div class="next-step-desc">想读写文件？配置 <strong>MCP</strong>。想固定流程？创建 <strong>Skill</strong>。想记住偏好？启用 <strong>长期记忆</strong>。</div>
            </div>
          </div>
          <div class="next-step">
            <span class="next-step-no">3</span>
            <div class="next-step-body">
              <div class="next-step-title">查看帮助与对比</div>
              <div class="next-step-desc">不确定 Maxma 是否适合你？前往「设置 → 帮助」查看与 Claude Desktop / ChatGPT Desktop 的对比。</div>
            </div>
          </div>
        </div>
        <p class="form-note">没有配置模型时，你仍可查看已有的会话与本地内容；之后随时可从「设置」重新打开此引导。</p>
      </div>
      <footer class="onboarding-footer"><button v-if="step > 0" class="secondary" type="button" @click="step -= 1">上一步</button><span v-else></span><button class="primary" type="button" @click="next">{{ step === titles.length - 1 ? '开始使用' : '继续' }}</button></footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { HealthResponse } from '@/types'
import { THEMES, useTheme } from '@/composables/useTheme'
import { useOnboardingStore } from '@/stores/onboarding'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ health: HealthResponse | null }>()
const emit = defineEmits<{ openProviders: [] }>()
const onboarding = useOnboardingStore()
const { storedTheme, setTheme } = useTheme()
const step = ref(0)
const titles = ['欢迎使用', '连接模型', '设定工作区', '快速了解']
const quickThemes = THEMES.filter(theme => ['suying', 'ultraline', 'night'].includes(theme.id))
const displayName = ref(onboarding.snapshot.preferences.displayName)
const language = ref(onboarding.snapshot.preferences.language)
const workspace = ref(onboarding.snapshot.preferences.workspace)
	const providerReady = computed(() => props.health?.llm?.status === 'ok')
watch([displayName, language, workspace], () => onboarding.updatePreferences({ displayName: displayName.value, language: language.value, workspace: workspace.value }))
function skip() { onboarding.complete() }
function next() { if (step.value === titles.length - 1) onboarding.complete(); else step.value += 1 }
function openProviders() { emit('openProviders') }
</script>

<style scoped>
.onboarding-backdrop { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(24, 27, 29, 0.44); }
.onboarding { width: min(100%, 560px); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-card); box-shadow: var(--shadow-lg); }
.onboarding-header, .onboarding-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 24px; }.onboarding-header { border-bottom: 1px solid var(--border); }.onboarding-footer { border-top: 1px solid var(--border); }
h2 { margin: 3px 0 0; font-size: 22px; color: var(--text-primary); }.eyebrow { color: var(--text-tertiary); font-size: 12px; letter-spacing: 0.08em; }
.skip, .primary, .secondary, .theme-option { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 16px; font: inherit; font-size: 14px; cursor: pointer; }.skip, .secondary, .theme-option { background: transparent; color: var(--text-secondary); }.primary { background: var(--accent); border-color: var(--accent); color: var(--bg-primary); }.primary:focus-visible, .secondary:focus-visible, .skip:focus-visible, .theme-option:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.stepper { display: flex; gap: 6px; padding: 18px 24px 0; }.stepper span { display: block; height: 3px; flex: 1; background: var(--border); }.stepper .active, .stepper .complete { background: var(--accent); }
.step-content { display: grid; gap: 18px; min-height: 260px; padding: 28px; color: var(--text-secondary); line-height: 1.7; background: var(--bg-card); }.step-content p { margin: 0; }label { display: grid; gap: 6px; color: var(--text-primary); font-size: 14px; }input, select { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-primary); font: inherit; padding: 10px 12px; }input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }.health-note { border-left: 3px solid var(--border); padding-left: 10px; }.health-note.ok { border-color: var(--status-ok); }.health-note.attention { border-color: var(--status-warn); }.theme-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }.theme-option { display: grid; gap: 8px; text-align: left; }.theme-option.selected { border-color: var(--accent); color: var(--text-primary); }.theme-swatch { display: block; height: 30px; border: 1px solid var(--border); border-radius: 3px; }
/* ── Step 0 价值主张 ── */
.intro-block { display: grid; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-secondary); }
.intro-lead { font-size: 13px; color: var(--text-secondary); line-height: 1.7; }
.intro-lead strong { color: var(--text-primary); font-weight: 600; }
.intro-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.intro-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; font-size: 12px; color: var(--text-secondary); background: var(--bg-secondary); border-radius: 100px; }
.form-note { font-size: 12px; color: var(--text-tertiary); }
/* ── Step 1 提示卡片 ── */
.step-tip { display: flex; gap: 10px; padding: 10px 12px; border: 1px dashed var(--border); border-radius: var(--radius-sm); background: var(--bg-secondary); font-size: 12px; line-height: 1.6; }
.tip-icon { flex-shrink: 0; color: var(--text-secondary); }
.tip-text { color: var(--text-secondary); }
.tip-text strong { color: var(--text-primary); font-weight: 600; }
/* ── Step 3 完成引导 ── */
.ready-lead { font-size: 15px; color: var(--text-primary); font-weight: 600; }
.next-steps { display: grid; gap: 10px; }
.next-step { display: flex; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-secondary); }
.next-step-no { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--bg-primary); font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.next-step-body { flex: 1; min-width: 0; }
.next-step-title { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
.next-step-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
.next-step-desc strong { color: var(--text-primary); font-weight: 600; }
.swatch--suying { background: #F7F4EE; }
.swatch--ultraline { background: #FFFFFF; }
.swatch--night { background: #0D1117; }
.swatch--midnight { background: #3B4A54; }
.swatch--high-contrast { background: #FAF8F7; }
@media (max-width: 520px) { .onboarding-backdrop { padding: 12px; }.onboarding-header, .onboarding-footer, .step-content { padding-left: 18px; padding-right: 18px; }.theme-options { grid-template-columns: 1fr; } }
</style>
