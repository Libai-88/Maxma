<template>
  <div class="news-view" ref="newsViewRef">
    <!-- 标题栏 -->
    <div class="header">
      <h2>更新动态 News</h2>
      <span class="news-count" v-if="!loading && !loadError">共 {{ news.length }} 条更新</span>
    </div>

    <div class="news-body">
      <!-- 卡片列表 -->
      <div class="news-content">
        <!-- 骨架屏：加载中显示 3 个占位卡片，避免「只剩文字加载中」的廉价感 -->
        <div v-if="loading" class="skeleton-grid">
          <div v-for="i in 3" :key="i" class="skeleton-card">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line skeleton-text"></div>
            <div class="skeleton-line skeleton-text short"></div>
          </div>
        </div>
        <!-- 加载失败：明确告诉用户「加载失败」而非误显示「暂无更新」 -->
        <div v-else-if="loadError" class="empty">
          <div class="empty-icon">⚠️</div>
          <div class="empty-title">加载失败</div>
          <div class="empty-desc">
            无法获取更新动态，可能是后端未启动或网络异常。<br>
            <button class="retry-btn" @click="loadNews">重试</button>
          </div>
        </div>
        <div v-else-if="news.length === 0" class="empty">
          <div class="empty-icon">📰</div>
          <div class="empty-title">暂无更新动态</div>
          <div class="empty-desc">Maxma 新版本与功能更新会在这里展示。</div>
        </div>
        <div v-else class="card-grid" ref="cardGridRef">
          <NewsCard v-for="entry in news" :key="entry.id" :entry="entry" />
        </div>
      </div>

      <!-- 版本演进时间轴 -->
      <div v-if="versionNodes.length > 0" ref="timelineRef" class="version-timeline">
        <div class="tl-track"></div>
        <div
          v-for="node in versionNodes"
          :key="node.version"
          class="tl-node"
          :ref="(el) => setCssProp(el, 'top', node.top + 'px')"
        >
          <div class="tl-dot"></div>
          <span class="tl-label">{{ node.version }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { NewsEntry } from '@/types'
import NewsCard from '@/components/NewsCard.vue'
import { onMounted, onUnmounted, ref, watchEffect, type ComponentPublicInstance } from 'vue'

const news = ref<NewsEntry[]>([])
const loading = ref(false)
const loadError = ref(false)
const newsViewRef = ref<HTMLElement | null>(null)
const cardGridRef = ref<HTMLElement | null>(null)
const timelineRef = ref<HTMLElement | null>(null)
const tlBounds = ref<{ top: string; height: string }>()
const versionNodes = ref<{ version: string; top: number }[]>([])

// CSP-safe CSSOM helper: apply style property via setProperty (replaces :style binding)
function setCssProp(el: Element | ComponentPublicInstance | null, prop: string, value: string) {
  if (el instanceof HTMLElement) el.style.setProperty(prop, value)
}

// CSP-safe CSSOM: position timeline via style.setProperty (was :style tlBounds)
watchEffect(() => {
  const el = timelineRef.value
  const bounds = tlBounds.value
  if (!el || !bounds) return
  el.style.setProperty('top', bounds.top)
  el.style.setProperty('height', bounds.height)
}, { flush: 'post' })

let observer: ResizeObserver | null = null

function updateTimelineBounds() {
  const grid = cardGridRef.value
  const body = grid?.closest<HTMLElement>('.news-body')
  if (!body || !grid) return

  const cards = grid.querySelectorAll<HTMLElement>('.news-card')
  if (cards.length < 2) return

  const bodyRect = body.getBoundingClientRect()
  const firstRect = cards[0].getBoundingClientRect()
  const lastRect = cards[cards.length - 1].getBoundingClientRect()

  const top = firstRect.top + firstRect.height / 2 - bodyRect.top
  const bottom = lastRect.top + lastRect.height / 2 - bodyRect.top

  tlBounds.value = {
    top: top + 'px',
    height: (bottom - top) + 'px',
  }

  // 根据卡片实际 DOM 位置计算版本圆点的 top 值，而非按索引均分
  const tlTop = bodyRect.top + top
  const seen = new Set<string>()
  const nodes: { version: string; top: number }[] = []
  news.value.forEach((entry, idx) => {
    if (seen.has(entry.version)) return
    seen.add(entry.version)
    const card = cards[idx]
    if (!card) return
    const cardRect = card.getBoundingClientRect()
    nodes.push({
      version: entry.version,
      top: cardRect.top + cardRect.height / 2 - tlTop,
    })
  })
  versionNodes.value = nodes
}

async function loadNews() {
  loading.value = true
  loadError.value = false
  try {
    const res = await api.listNews()
    news.value = res.news.sort((a, b) => b.pr_number - a.pr_number)
    requestAnimationFrame(updateTimelineBounds)
  } catch (e: unknown) {
    console.error('加载更新动态失败', e)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadNews()
  observer = new ResizeObserver(updateTimelineBounds)
  if (newsViewRef.value) {
    observer.observe(newsViewRef.value)
  }
})

onUnmounted(() => {
  observer?.disconnect()
})

</script>

<style scoped>
.news-view {
  flex: 1;
  overflow-y: auto;
  padding: 40px 48px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}

.header h2 {
  font-size: 20px;
  font-weight: 700;
}

.news-count {
  font-size: 13px;
  color: var(--text-secondary);
}

.news-body {
  position: relative;
}

.news-content {
  max-width: 720px;
  margin: 0 auto;
}

.loading,
.empty {
  text-align: center;
  color: var(--text-secondary);
  padding: 40px 0;
}
.empty-icon { font-size: 36px; margin-bottom: 12px; }
.empty-title { font-size: 1em; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.empty-desc { font-size: 0.85em; color: var(--text-tertiary); line-height: 1.6; }
.retry-btn {
  margin-top: 12px;
  padding: 6px 16px;
  font-size: 0.85em;
  font-family: inherit;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.retry-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ── 骨架屏 ── */
.skeleton-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.skeleton-card {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
}
.skeleton-line {
  height: 12px;
  background: linear-gradient(
    90deg,
    var(--bg-secondary) 0%,
    color-mix(in srgb, var(--bg-secondary) 50%, var(--bg-card)) 50%,
    var(--bg-secondary) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
  border-radius: 4px;
  margin-bottom: 8px;
}
.skeleton-title { height: 18px; width: 60%; margin-bottom: 12px; }
.skeleton-text { width: 100%; }
.skeleton-text.short { width: 70%; margin-bottom: 0; }
@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton-line { animation: none; }
}

.card-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── 版本时间轴 ── */

.version-timeline {
  position: absolute;
  left: calc(75% + 180px);
  transform: translateX(-50%);
  width: 80px;
  pointer-events: none;
}

.tl-track {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border);
  transform: translateX(-50%);
}

.tl-node {
  position: absolute;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 8px;
  transform: translateY(-50%);
}

.tl-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-primary);
  flex-shrink: 0;
  position: relative;
  left: -4px;
}

.tl-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: 'SF Mono', 'Consolas', monospace;
  white-space: nowrap;
  padding-left: 12px;
}
</style>
