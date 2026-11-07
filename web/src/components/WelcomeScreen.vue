<template>
  <div class="welcome-screen">
    <MultiStepLoader
      :loading="store.loading"
      :steps="loadingSteps"
      :default-duration="1500"
      :prevent-close="true"
      @complete="() => {}"
    />
    <div v-if="store.error" class="ds-state ds-state--error welcome-feedback">
      <p class="welcome-error-text">加载失败：{{ store.error }}</p>
      <button class="ds-btn" @click="store.loadProfile()">重试</button>
    </div>
    <div v-if="!store.loading && !store.error" ref="contentEl" class="welcome-content">
      <Ripple
        v-if="!calmMotion"
        class="ripple-bg ds-decor"
        :base-circle-size="140"
        :base-circle-opacity="0.08"
        :circle-opacity-downgrade-ratio="0.015"
        :wave-speed="60"
        :space-between-circle="60"
        :number-of-circles="4"
      />

      <!-- 非对称编排：左侧题字（墨），右侧可执行的起点清单（朱砂序号）。
           不做「居中头像 + 问候语 + 一排 chip」的通用 AI 模板。 -->
      <div class="welcome-grid">
        <div class="welcome-intro">
          <p class="welcome-eyebrow">MAXMA · 首席思维伙伴</p>
          <div class="welcome-avatar"><SingularityBackground /></div>
          <h1 class="welcome-name">{{ store.profile.name || 'Maxma' }}</h1>
          <p class="welcome-scene">{{ sceneText }}</p>
          <p class="welcome-greeting">{{ store.profile.greeting || '你好呀，今天想聊些什么？' }}</p>
          <div class="welcome-rule" aria-hidden="true"></div>
          <div class="welcome-actions">
            <button class="action-btn action-btn--primary" @click="handleStart('随便聊聊')">
              <span class="action-icon" v-html="chatBubbleSvg"></span>
              <span>随便聊聊</span>
            </button>
            <button class="action-btn" @click="handleStart('帮我看看最近有什么好玩的')">
              <span class="action-icon" v-html="searchSvg"></span>
              <span>帮我个忙</span>
            </button>
          </div>
        </div>

        <section class="example-prompts" aria-label="试试这些">
          <div class="example-heading">
            <p class="example-index">01 / 从一句话开始</p>
            <h2 class="example-title">试试这些</h2>
            <p class="example-lead">点击任一示例即可开始；也可以在下方输入框直接输入你的问题。</p>
          </div>
          <ol class="example-list">
            <li v-for="(ex, index) in examples" :key="ex.text">
              <button
                type="button"
                class="prompt-row"
                @click="handleStart(ex.text)"
                :title="ex.hint"
              >
                <span class="prompt-no">{{ String(index + 1).padStart(2, '0') }}</span>
                <Icon :name="ex.icon" :size="16" class="prompt-icon" aria-hidden="true" />
                <span class="prompt-copy">
                  <strong>{{ ex.label }}</strong>
                  <small>{{ ex.hint }}</small>
                </span>
                <span class="prompt-arrow" aria-hidden="true">→</span>
              </button>
            </li>
          </ol>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePersonaStore } from '../stores/persona'
import Icon from './Icon.vue'
import MultiStepLoader from './inspira/MultiStepLoader.vue'
import type { Step } from './inspira/MultiStepLoader.vue'
import SingularityBackground from './SingularityBackground.vue'
import Ripple from './Ripple.vue'
import { gsap, useGsap, easeMap, lazyLoadPlugin } from '@/composables/useGsap'
import { useMotion } from '@/composables/useMotion'
import chatBubbleRaw from '../assets/icons/welcome/chat-bubble.svg?raw'
import searchRaw from '../assets/icons/welcome/search.svg?raw'

const store = usePersonaStore()
const emit = defineEmits<{ start: [message: string] }>()
const contentEl = ref<HTMLElement | null>(null)
const { calm: calmMotion } = useMotion()

const loadingSteps: Step[] = [
  { text: '正在翻开笔记本…' },
  { text: '整理最近的记忆…' },
  { text: '马上就好' },
]

// 磁吸微交互只在「完整」动效模式启用；克制模式保持静态、可预测。
useGsap((ctx, contextSafe) => {
  if (calmMotion.value) return
  watch(() => store.loading, contextSafe((loading) => {
    if (loading || !contentEl.value) return
    const btn = contentEl.value.querySelector<HTMLElement>('.action-btn--primary')
    if (!btn) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const strength = 15
    const xTo = gsap.quickTo(btn, 'x', { duration: 0.35, ease: 'power3' })
    const yTo = gsap.quickTo(btn, 'y', { duration: 0.35, ease: 'power3' })
    const onMove = (e: MouseEvent) => {
      const r = btn.getBoundingClientRect()
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
      xTo(nx * strength)
      yTo(ny * strength)
    }
    const onLeave = () => { xTo(0); yTo(0) }
    btn.classList.add('magnetic')
    btn.addEventListener('mousemove', onMove)
    btn.addEventListener('mouseleave', onLeave)
    ctx.add(() => {
      btn.removeEventListener('mousemove', onMove)
      btn.removeEventListener('mouseleave', onLeave)
      btn.classList.remove('magnetic')
    })
  }))
})

// 入场编排同样只在完整模式播放；克制模式下内容从一开始就可见。
const { contextSafe } = useGsap(() => {
  if (calmMotion.value) return
  watch(() => store.loading, contextSafe(async (loading) => {
    if (loading || !contentEl.value) return
    const root = contentEl.value
    const q = gsap.utils.selector(root)
    const tl = gsap.timeline({ defaults: { ease: easeMap.out, duration: 0.45 } })
    tl.from(q('.welcome-intro'), { autoAlpha: 0, y: 16, duration: 0.5 })
      .from(q('.example-heading'), { autoAlpha: 0, y: 12 }, '<0.12')
      .from(q('.prompt-row'), { autoAlpha: 0, y: 10, stagger: 0.04 }, '<0.1')

    const nameEl = root.querySelector<HTMLElement>('.welcome-name')
    if (nameEl) {
      try {
        const { SplitText } = await lazyLoadPlugin('SplitText')
        const split = SplitText.create(nameEl, { type: 'chars', charsClass: 'welcome-char', aria: 'auto' })
        gsap.from(split.chars, {
          yPercent: 135,
          autoAlpha: 0,
          rotateX: -90,
          transformPerspective: 720,
          duration: 0.72,
          delay: 0.25,
          ease: 'back.out(2.6)',
          stagger: 0.06,
          onComplete: () => split.revert(),
        })
      } catch { /* SplitText 加载失败则跳过字符动画 */ }
    }
  }), { immediate: true })
}, { scope: () => contentEl.value })

// 点击任意入口：完整模式下元素优雅退场后再 emit；克制模式直接开始。
function handleStart(msg: string) {
  const root = contentEl.value
  if (!root || calmMotion.value) { emit('start', msg); return }
  contextSafe(() => {
    gsap.to(root.querySelectorAll(':scope > *:not(.welcome-aura)'), {
      opacity: 0, y: -18, duration: 0.24, stagger: 0.028, overwrite: 'auto',
      onComplete: () => emit('start', msg),
    })
  })()
}

const chatBubbleSvg = computed(() => chatBubbleRaw.replace(/<\?xml[^>]*\?>/, '').trim())
const searchSvg = computed(() => searchRaw.replace(/<\?xml[^>]*\?>/, '').trim())

const sceneText = computed(() => {
  if (store.profile.scene) {
    return `${store.profile.scene}，Maxma 正趴在桌上等你。`
  }
  return 'Maxma 正趴在桌上等你。'
})

// 示例提示：覆盖三类画像的典型场景
// - tone: 'office' (Power Office User) / 'daily' (Novice) / 'tech' (Enthusiast)
const examples = computed(() => [
  { icon: 'file-page', label: '帮我写周报', text: '帮我写一份本周工作周报，要点列出主要完成的事项、遇到的问题和下周计划', hint: '办公党：让 AI 帮你起草文档' },
  { icon: 'doc-reader', label: '翻译一段文档', text: '请帮我把一段中文翻译成英文，我会把内容贴进来', hint: '办公党：跨语言文档处理' },
  { icon: 'weather-partly-cloudy', label: '今天天气怎么样', text: '今天天气怎么样？', hint: '新手：试试内置天气工具' },
  { icon: 'checkmark', label: '管理我的待办', text: '帮我看看今天的待办事项', hint: '新手：连接 Todoist 工具' },
  { icon: 'python', label: '写一段 Python', text: '帮我写一段 Python 脚本，读取当前目录下所有 .csv 文件并合并', hint: '极客：让 Agent 直接写代码' },
  { icon: 'search', label: '搜索最新资讯', text: '帮我搜索一下最近关于 AI Agent 的最新资讯', hint: '极客：调用网络搜索工具' },
])
</script>

<style scoped>
.welcome-screen {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-24) var(--view-gutter);
  overflow-x: hidden;
  overflow-y: auto;
}
.welcome-content {
  position: relative;
  width: 100%;
  max-width: var(--view-max-width-narrow);
  min-width: 0;
  box-sizing: border-box;
  margin-block: auto;
}
.welcome-feedback { max-width: 420px; margin-inline: auto; }
.welcome-error-text { margin: 0; }

.ripple-bg {
  position: absolute;
  inset: -80px;
  z-index: -1;
  pointer-events: none;
  mask-image: linear-gradient(to bottom, white 40%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, white 40%, transparent 100%);
}

/* ── 非对称栅格：题字列 + 起点清单列 ── */
.welcome-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: var(--space-40);
  align-items: start;
}
.welcome-intro {
  min-width: 0;
  padding-top: var(--space-8);
  border-left: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
  padding-left: var(--space-24);
}
.welcome-eyebrow {
  margin: 0 0 var(--space-16);
  font-size: var(--fs-hint);
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-text);
}

/* 圆角方形头像：避开「清一色圆形头像」的通用感 */
.welcome-avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--space-16);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  box-shadow: var(--shadow-sm);
}
.welcome-name {
  font-size: var(--fs-display-xl);
  font-weight: 600;
  font-family: var(--font-display);
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin: 0 0 var(--space-8);
  text-wrap: balance;
}
.welcome-scene {
  font-size: var(--fs-ui);
  color: var(--text-tertiary);
  line-height: 1.7;
  margin: 0 0 var(--space-8);
}
.welcome-greeting {
  font-size: var(--fs-display-md);
  font-family: var(--font-display);
  color: var(--text-secondary);
  font-weight: 500;
  margin: 0;
  text-wrap: pretty;
}

/* 墨痕分隔线：左对齐而非居中 */
.welcome-rule {
  width: 48px;
  height: 2px;
  margin: var(--space-24) 0;
  background: linear-gradient(90deg, var(--accent), transparent);
  opacity: 0.6;
}
.welcome-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-12);
}
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-12) var(--space-24);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  font-size: var(--fs-body);
  font-family: var(--font-body);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out),
              transform var(--duration-instant) var(--ease-spring);
}
.action-btn--primary {
  background: var(--accent-solid);
  border-color: var(--accent-solid);
  color: var(--accent-solid-text);
}
.action-btn.magnetic { transition-property: background, color, border-color, box-shadow; }
.action-btn.magnetic:hover { transform: none; }
.action-btn:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--accent-text);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}
.action-btn--primary:hover {
  background: var(--accent-solid);
  color: var(--accent-solid-text);
  border-color: var(--accent-solid);
}
@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
  .action-btn:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
}
.action-btn:active { transform: scale(0.98); }
.action-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; line-height: 0; flex-shrink: 0; }
.action-icon :deep(svg) { width: 100%; height: 100%; }

/* ── 起点清单：序号 + 说明的有序列，不做 chip 云 ── */
.example-heading { margin-bottom: var(--space-16); }
.example-index {
  margin: 0 0 var(--space-8);
  font-size: var(--fs-hint);
  letter-spacing: 0.12em;
  color: var(--text-tertiary);
}
.example-title {
  margin: 0 0 var(--space-8);
  font-family: var(--font-display);
  font-size: var(--fs-display-md);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}
.example-lead {
  margin: 0;
  font-size: var(--fs-hint);
  color: var(--text-tertiary);
  line-height: 1.6;
}
.example-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}
.example-list li { border-bottom: 1px solid var(--border); }
.prompt-row {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  width: 100%;
  padding: var(--space-12) var(--space-8);
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: var(--font-body);
  color: var(--text-primary);
  transition: background var(--duration-fast) var(--ease-out), padding-left var(--duration-fast) var(--ease-out);
}
.prompt-no {
  flex: 0 0 auto;
  min-width: 24px;
  font-family: var(--font-mono);
  font-size: var(--fs-hint);
  font-variant-numeric: tabular-nums;
  color: var(--accent-text);
}
.prompt-icon { flex: 0 0 auto; color: var(--text-secondary); }
.prompt-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.prompt-copy strong { font-size: var(--fs-body); font-weight: 500; }
.prompt-copy small { font-size: var(--fs-hint); color: var(--text-tertiary); line-height: 1.4; }
.prompt-arrow { flex: 0 0 auto; opacity: 0; color: var(--accent-text); transition: opacity var(--duration-fast) var(--ease-out); }
@media (hover: hover) and (pointer: fine) {
  .prompt-row:hover { background: var(--bg-hover); padding-left: var(--space-16); }
  .prompt-row:hover .prompt-arrow { opacity: 1; }
}
.prompt-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* ── 衬线/无衬线字体切换适配 ── */
.font-sans .welcome-name,
.font-sans .welcome-greeting,
.font-sans .example-title { font-family: var(--font-ui); }

/* 窄窗口：两列收回单列，清单仍保持有序列形态 */
@media (max-width: 767px) {
  .welcome-screen { align-items: flex-start; padding: var(--space-16) var(--space-16) var(--space-32); }
  .welcome-grid { grid-template-columns: 1fr; gap: var(--space-24); }
  .welcome-intro { padding-left: var(--space-16); }
  .welcome-avatar { width: 48px; height: 48px; }
  .welcome-rule { margin: var(--space-16) 0; }
  .action-btn { padding: var(--space-8) var(--space-16); }
}
@media (max-height: 780px) and (min-width: 768px) {
  .welcome-screen { padding-block: var(--space-12); }
  .welcome-avatar { display: none; }
  .welcome-rule { margin: var(--space-16) 0; }
}
</style>
