<template>
  <div class="welcome-screen">
    <div v-if="store.loading" class="welcome-loading">
      <div class="welcome-loading-spinner"></div>
      <p class="welcome-loading-text">加载中...</p>
    </div>
    <div v-else-if="store.error" class="welcome-error">
      <p class="welcome-error-text">加载失败：{{ store.error }}</p>
      <button class="welcome-error-retry" @click="store.loadProfile()">重试</button>
    </div>
    <div v-else class="welcome-content">
      <div class="welcome-avatar">{{ store.profile.avatar }}</div>
      <h1 class="welcome-name">{{ store.profile.name || 'Maxma' }}</h1>
      <p class="welcome-scene">{{ sceneText }}</p>
      <p class="welcome-greeting">{{ store.profile.greeting || '你好呀，今天想聊些什么？' }}</p>

      <!-- 主操作：随便聊聊 -->
      <div class="welcome-actions">
        <button class="action-btn action-btn--primary" @click="$emit('start', '随便聊聊')">
          <span class="action-icon" v-html="chatBubbleSvg"></span>
          <span>随便聊聊</span>
        </button>
        <button class="action-btn" @click="$emit('start', '帮我看看最近有什么好玩的')">
          <span class="action-icon" v-html="searchSvg"></span>
          <span>帮我个忙</span>
        </button>
      </div>

      <!-- 示例提示：分场景给出可点击的具体 prompt，降低上手门槛 -->
      <section class="example-prompts" aria-label="试试这些">
        <div class="example-title">试试这些 ✨</div>
        <div class="example-chips">
          <button
            v-for="ex in examples"
            :key="ex.text"
            class="example-chip"
            :class="`chip--${ex.tone}`"
            @click="$emit('start', ex.text)"
            :title="ex.hint"
          >
            <span class="example-chip-icon">{{ ex.icon }}</span>
            <span class="example-chip-text">{{ ex.label }}</span>
          </button>
        </div>
        <p class="example-hint">点击任一示例即可开始；也可以在下方输入框直接输入你的问题。</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePersonaStore } from '../stores/persona'
import chatBubbleRaw from '../assets/icons/welcome/chat-bubble.svg?raw'
import searchRaw from '../assets/icons/welcome/search.svg?raw'

const store = usePersonaStore()
defineEmits<{ start: [message: string] }>()

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
  { icon: '📝', label: '帮我写周报', text: '帮我写一份本周工作周报，要点列出主要完成的事项、遇到的问题和下周计划', tone: 'office', hint: '办公党：让 AI 帮你起草文档' },
  { icon: '🌐', label: '翻译一段文档', text: '请帮我把一段中文翻译成英文，我会把内容贴进来', tone: 'office', hint: '办公党：跨语言文档处理' },
  { icon: '🌤️', label: '今天天气怎么样', text: '今天天气怎么样？', tone: 'daily', hint: '新手：试试内置天气工具' },
  { icon: '✅', label: '管理我的待办', text: '帮我看看今天的待办事项', tone: 'daily', hint: '新手：连接 Todoist 工具' },
  { icon: '💻', label: '写一段 Python', text: '帮我写一段 Python 脚本，读取当前目录下所有 .csv 文件并合并', tone: 'tech', hint: '极客：让 Agent 直接写代码' },
  { icon: '🔍', label: '搜索最新资讯', text: '帮我搜索一下最近关于 AI Agent 的最新资讯', tone: 'tech', hint: '极客：调用网络搜索工具' },
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
  width: 100%;
  max-width: 560px;
  min-width: 0;
  box-sizing: border-box;
  text-align: center;
}
.welcome-loading { text-align: center; color: var(--text-secondary); }
.welcome-loading-spinner {
  display: inline-block;
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: welcome-spin 0.7s linear infinite;
  margin-bottom: 12px;
}
@keyframes welcome-spin { to { transform: rotate(360deg); } }
.welcome-loading-text { font-size: 14px; margin: 0; }
.welcome-error { text-align: center; color: var(--status-error); }
.welcome-error-text { font-size: 14px; margin: 0 0 12px; }
.welcome-error-retry {
  padding: 6px 16px;
  border: 1px solid var(--status-error);
  border-radius: 6px;
  background: transparent;
  color: var(--status-error);
  cursor: pointer;
  font-size: 13px;
}
.welcome-avatar { font-size: 48px; margin-bottom: 12px; }
.welcome-name { font-size: 24px; font-weight: 600; color: var(--text-primary, #1f2937); margin: 0 0 16px; }
.welcome-scene { font-size: 15px; color: var(--text-secondary, #6b7280); line-height: 1.7; margin: 0 0 10px; }
.welcome-greeting { font-size: 17px; color: var(--text-primary, #1f2937); font-weight: 500; margin: 0 0 28px; }
.welcome-actions { display: flex; gap: 12px; justify-content: center; margin-bottom: 28px; }
.action-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; background: var(--bg-card, #fff); font-size: 15px; color: var(--text-primary, #1f2937); cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s; }
.action-btn:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}
.action-btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}
.action-btn--primary:hover {
  background: color-mix(in srgb, var(--accent) 88%, #000);
  color: var(--bg-primary);
  border-color: color-mix(in srgb, var(--accent) 88%, #000);
}
@media (prefers-reduced-motion: no-preference) {
  .action-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px var(--shadow-color);
  }
  .action-btn:active {
    transform: scale(0.98);
  }
}
.action-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; line-height: 0; flex-shrink: 0; }
.action-icon :deep(svg) { width: 100%; height: 100%; }

/* ── 示例提示 ── */
.example-prompts {
  margin-top: 4px;
}
.example-title {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-bottom: 10px;
  letter-spacing: 0.3px;
}
.example-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
	  font-size: 14px;
	  cursor: pointer;
	  transition: border-color 0.15s, color 0.15s, background 0.15s, transform 0.15s;
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
.example-chip-icon { font-size: 14px; line-height: 1; }
.example-chip-text { white-space: nowrap; }

/* 不同画像的色调提示（轻量、不打扰） */
.chip--office { border-color: color-mix(in srgb, var(--accent) 24%, var(--border)); }
.chip--tech { border-color: color-mix(in srgb, var(--status-ok) 24%, var(--border)); }
.chip--daily { border-color: var(--border); }

.example-hint {
  margin: 12px 0 0;
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

/* ── 入场动画（依次浮现） ── */
@media (prefers-reduced-motion: no-preference) {
  .welcome-avatar {
    animation: welcome-fade-in 0.6s ease-out both;
  }
  .welcome-name {
    animation: welcome-fade-in 0.6s ease-out 0.15s both;
  }
  .welcome-scene {
    animation: welcome-fade-in 0.6s ease-out 0.3s both;
  }
  .welcome-greeting {
    animation: welcome-fade-in 0.6s ease-out 0.45s both;
  }
  .welcome-actions {
    animation: welcome-fade-in 0.6s ease-out 0.6s both;
  }
  .example-prompts {
    animation: welcome-fade-in 0.6s ease-out 0.75s both;
  }
}
@keyframes welcome-fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
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
