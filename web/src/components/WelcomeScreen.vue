<template>
  <div class="welcome-screen">
    <div v-if="store.loading" ref="loadingEl" class="welcome-loading" role="status" aria-live="polite">
      <BrandSeal size="md" class="welcome-loading-seal" />
      <div class="welcome-loading-lines">
        <p v-for="line in loadingLines" :key="line" class="welcome-loading-line">{{ line }}</p>
      </div>
    </div>
    <div v-else-if="store.error" class="welcome-error">
      <p class="welcome-error-text">加载失败：{{ store.error }}</p>
      <button class="welcome-error-retry" @click="store.loadProfile()">重试</button>
    </div>
    <div v-else ref="contentEl" class="welcome-content">
      <div class="welcome-aura" aria-hidden="true"></div>
      <div class="welcome-avatar"><span aria-hidden="true">{{ store.profile.avatar }}</span></div>
      <h1 class="welcome-name">{{ store.profile.name || 'Maxma' }}</h1>
      <p class="welcome-scene">{{ sceneText }}</p>
      <p class="welcome-greeting">{{ store.profile.greeting || '你好呀，今天想聊些什么？' }}</p>
      <div class="welcome-rule" aria-hidden="true"></div>

      <!-- 主操作：随便聊聊 -->
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

      <!-- 示例提示：分场景给出可点击的具体 prompt，降低上手门槛 -->
      <section class="example-prompts" aria-label="试试这些">
        <div class="example-title">试试这些 <Icon name="sparkles" :size="14" aria-hidden="true" /></div>
        <div class="example-chips">
          <button
            v-for="ex in examples"
            :key="ex.text"
            class="example-chip"
            :class="`chip--${ex.tone}`"
            @click="handleStart(ex.text)"
            :title="ex.hint"
          >
            <Icon class="example-chip-icon" :name="ex.icon" :size="14" aria-hidden="true" />
            <span class="example-chip-text">{{ ex.label }}</span>
          </button>
        </div>
        <p class="example-hint">点击任一示例即可开始；也可以在下方输入框直接输入你的问题。</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePersonaStore } from '../stores/persona'
import Icon from './Icon.vue'
import BrandSeal from './brand/BrandSeal.vue'
import { gsap, useGsap, easeMap, lazyLoadPlugin } from '@/composables/useGsap'
import chatBubbleRaw from '../assets/icons/welcome/chat-bubble.svg?raw'
import searchRaw from '../assets/icons/welcome/search.svg?raw'

const store = usePersonaStore()
const emit = defineEmits<{ start: [message: string] }>()
const contentEl = ref<HTMLElement | null>(null)
const loadingEl = ref<HTMLElement | null>(null)

// 加载态叙事：品牌印章弹簧弹出 + 三行等待文案依次浮现
const loadingLines = ['正在翻开笔记本…', '整理最近的记忆…', '马上就好']

useGsap((_ctx, contextSafe) => {
  watch(() => store.loading, contextSafe((loading) => {
    if (!loading || !loadingEl.value) return
    const root = loadingEl.value
    const q = gsap.utils.selector(root)
    gsap.timeline({ defaults: { ease: easeMap.out } })
      .from(q('.welcome-loading-seal'), { scale: 0.4, autoAlpha: 0, rotation: -14, duration: 0.45, ease: easeMap.spring })
      .from(q('.welcome-loading-line'), { autoAlpha: 0, y: 8, duration: 0.35, stagger: 0.42 }, '-=0.15')
  }))
})

// 磁吸微交互：primary 按钮鼠标靠近时轻微吸附跟随、移出回弹（品牌签名手感）
// quickTo 高频更新，transform 由 GSAP 接管（CSS .magnetic 去掉 transform transition 避免双缓冲）
useGsap((ctx, contextSafe) => {
  watch(() => store.loading, contextSafe((loading) => {
    if (loading || !contentEl.value) return
    const btn = contentEl.value.querySelector<HTMLElement>('.action-btn--primary')
    if (!btn) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const strength = 8
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
      btn.classList.remove('magnetic')
      btn.removeEventListener('mousemove', onMove)
      btn.removeEventListener('mouseleave', onLeave)
    })
  }))
})

// 入场编排：store 加载完成（welcome-content 渲染）后依次浮现
// 高级编排：aura 光晕扩散 + 头像弹性弹出 + 名字 SplitText 字符级 3D reveal + 区块交错
const { contextSafe } = useGsap(() => {
  watch(() => store.loading, contextSafe(async (loading) => {
    if (loading || !contentEl.value) return
    const root = contentEl.value
    const q = gsap.utils.selector(root)
    // 盖章式入场：头像从上方砸落 + elastic 回弹，文本区块错落放大，张力集中在首屏
    const tl = gsap.timeline({ defaults: { ease: easeMap.out, duration: 0.5 } })
    tl.from(q('.welcome-aura'),     { opacity: 0, duration: 1.2, ease: 'power1.inOut' })
      .from(q('.welcome-avatar'),   { opacity: 0, y: -52, scale: 0.4, rotation: -16, duration: 0.8, ease: 'elastic.out(1, 0.5)' }, '-=0.9')
      .from(q('.welcome-scene'),    { opacity: 0, y: 20, scale: 0.98 }, '<0.15')
      .from(q('.welcome-greeting'), { opacity: 0, y: 20, scale: 0.98 }, '<0.1')
      .from(q('.welcome-rule'),     { opacity: 0, scaleX: 0, duration: 0.5 }, '<0.06')
      .from(q('.welcome-actions'),  { opacity: 0, y: 28, scale: 0.9, duration: 0.55, ease: easeMap.spring }, '<0.12')
      .from(q('.example-prompts'),  { opacity: 0, y: 24, duration: 0.5 }, '<0.14')

    // 名字字符级 3D reveal（SplitText 按需加载；一次性动画，播完 revert 保持 DOM 干净）
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

// 点击任意入口：其余元素优雅退场后再 emit
function handleStart(msg: string) {
  const root = contentEl.value
  if (!root) { emit('start', msg); return }
  contextSafe(() => {
    gsap.to(root.querySelectorAll(':scope > *:not(.welcome-aura)'), {
      opacity: 0, y: -8, duration: 0.2, stagger: 0.02, overwrite: 'auto',
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
  { icon: 'file-page', label: '帮我写周报', text: '帮我写一份本周工作周报，要点列出主要完成的事项、遇到的问题和下周计划', tone: 'office', hint: '办公党：让 AI 帮你起草文档' },
  { icon: 'doc-reader', label: '翻译一段文档', text: '请帮我把一段中文翻译成英文，我会把内容贴进来', tone: 'office', hint: '办公党：跨语言文档处理' },
  { icon: 'weather-partly-cloudy', label: '今天天气怎么样', text: '今天天气怎么样？', tone: 'daily', hint: '新手：试试内置天气工具' },
  { icon: 'checkmark', label: '管理我的待办', text: '帮我看看今天的待办事项', tone: 'daily', hint: '新手：连接 Todoist 工具' },
  { icon: 'python', label: '写一段 Python', text: '帮我写一段 Python 脚本，读取当前目录下所有 .csv 文件并合并', tone: 'tech', hint: '极客：让 Agent 直接写代码' },
  { icon: 'search', label: '搜索最新资讯', text: '帮我搜索一下最近关于 AI Agent 的最新资讯', tone: 'tech', hint: '极客：调用网络搜索工具' },
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
  padding: 48px 24px;
  overflow-x: hidden;
  overflow-y: auto;
}
.welcome-content {
  position: relative;
  width: 100%;
  max-width: 560px;
  min-width: 0;
  box-sizing: border-box;
  text-align: center;
}

/* ── 氛围光晕：朱砂淡彩径向渐变 ── */
.welcome-aura {
  position: absolute;
  inset: -60px -80px;
  z-index: -1;
  pointer-events: none;
  animation: maxma-aura-breathe 7s ease-in-out infinite;
  background:
    radial-gradient(ellipse 55% 45% at 50% 30%, color-mix(in srgb, var(--accent) 5%, transparent), transparent 70%),
    radial-gradient(ellipse 40% 35% at 65% 60%, color-mix(in srgb, var(--accent-pink, var(--accent)) 4%, transparent), transparent 70%);
}

.welcome-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-16);
  color: var(--text-secondary);
  text-align: center;
}
.welcome-loading-seal { margin-bottom: 4px; }
.welcome-loading-lines {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.welcome-loading-line {
  font-size: var(--fs-ui);
  line-height: 1.5;
  margin: 0;
}
.welcome-error { text-align: center; color: var(--status-error); }
.welcome-error-text { font-size: var(--fs-ui); margin: 0 0 12px; }
.welcome-error-retry {
  padding: 6px 16px;
  border: 1px solid var(--status-error);
  border-radius: var(--radius-input);
  background: transparent;
  color: var(--status-error);
  cursor: pointer;
  font-size: var(--fs-caption);
  transition: background var(--duration-fast) var(--ease-out);
}
.welcome-error-retry:hover {
  background: color-mix(in srgb, var(--status-error) 8%, transparent);
}

/* ── 头像：光环 + 柔影 ── */
.welcome-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  margin-bottom: var(--space-16);
  font-size: 42px;
  line-height: 1;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
  box-shadow:
    0 0 0 6px color-mix(in srgb, var(--accent) 5%, transparent),
    var(--shadow-md);
}
.welcome-name {
  font-size: var(--fs-display-xl);
  font-weight: 600;
  font-family: var(--font-display);
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin: 0 0 var(--space-8);
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
}

/* ── 墨痕分隔线 ── */
.welcome-rule {
  width: 48px;
  height: 2px;
  margin: var(--space-24) auto;
  border-radius: 1px;
  background: linear-gradient(90deg, transparent, var(--accent) 30%, var(--accent) 70%, transparent);
  opacity: 0.5;
}

.welcome-actions { display: flex; gap: var(--space-12); justify-content: center; margin-bottom: var(--space-24); }
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  padding: 12px 24px;
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
/* 磁吸按钮：transform 由 GSAP quickTo 接管，去掉 transform 过渡避免双缓冲跟手滞后 */
.action-btn.magnetic {
  transition-property: background, color, border-color, box-shadow;
}
.action-btn.magnetic:hover {
  transform: none;
}
.action-btn:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}
.action-btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-inverse);
}
.action-btn--primary:hover {
  background: var(--accent-hover);
  color: var(--text-inverse);
  border-color: var(--accent-hover);
}
@media (prefers-reduced-motion: no-preference) {
  .action-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px var(--shadow-color);
  }
  .action-btn--primary:hover {
    box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .action-btn:active {
    transform: scale(0.98);
  }
}
.action-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; line-height: 0; flex-shrink: 0; }
.action-icon :deep(svg) { width: 100%; height: 100%; }

/* ── 示例提示 ── */
.example-prompts {
  margin-top: var(--space-4);
}
.example-title {
  font-size: var(--fs-caption);
  color: var(--text-tertiary);
  margin-bottom: 10px;
  letter-spacing: 0.3px;
}
.example-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-8);
  justify-content: center;
}
.example-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--fs-ui);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              transform var(--duration-instant) var(--ease-spring);
}
.example-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-card));
}
@media (prefers-reduced-motion: no-preference) {
  .example-chip:hover { transform: translateY(-1px); }
  .example-chip:active { transform: scale(0.97); }
}
.example-chip-icon { display: inline-flex; width: 14px; height: 14px; color: inherit; }
.example-chip-text { white-space: nowrap; }

/* 不同画像的色调提示（轻量、不打扰） */
.chip--office { border-color: color-mix(in srgb, var(--accent) 24%, var(--border)); }
.chip--tech { border-color: color-mix(in srgb, var(--status-ok) 24%, var(--border)); }
.chip--daily { border-color: var(--border); }

.example-hint {
  margin: var(--space-12) 0 0;
  font-size: var(--fs-hint);
  color: var(--text-tertiary);
  line-height: 1.5;
}

/* ── 衬线/无衬线字体切换适配 ── */
.font-sans .welcome-name,
.font-sans .welcome-greeting {
  font-family: var(--font-ui);
}

/* 响应式：窄屏垂直堆叠主操作按钮 */
@media (max-width: 480px) {
  .welcome-screen {
    align-items: flex-start;
    padding: 28px 16px 32px;
  }
  .welcome-content { margin-block: auto; }
  .welcome-avatar { line-height: 1; }
  .welcome-actions { flex-direction: column; }
  .action-btn { width: 100%; justify-content: center; }
  .example-hint { margin-top: 0; }
}
</style>
