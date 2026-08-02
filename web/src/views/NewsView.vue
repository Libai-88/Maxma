<template>
  <div class="news-view" ref="newsViewRef">
    <!-- 标题栏 -->
    <BlurReveal>
      <div class="header">
        <h2>更新动态 News</h2>
        <span class="news-count" v-if="!loading && !loadError">共 {{ news.length }} 条更新</span>
      </div>
    </BlurReveal>

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
          <GlareCard v-for="entry in news" :key="entry.id">
            <NewsCard :entry="entry" />
          </GlareCard>
        </div>
      </div>

      <Timeline v-if="timelineItems.length > 0" :items="timelineItems" class="version-timeline" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { NewsEntry } from '@/types'
import NewsCard from '@/components/NewsCard.vue'
import { computed, onMounted, ref } from 'vue'
import { createLogger } from '@/utils/logger'
import { useReveal } from '@/composables/useReveal'
import BlurReveal from '@/components/inspira/BlurReveal.vue'
import GlareCard from '@/components/inspira/GlareCard.vue'
import Timeline from '@/components/inspira/Timeline.vue'

const log = createLogger('NewsView')

const news = ref<NewsEntry[]>([])
const loading = ref(false)
const loadError = ref(false)
const newsViewRef = ref<HTMLElement | null>(null)
const cardGridRef = ref<HTMLElement | null>(null)

// 版本时间轴数据
const timelineItems = computed(() => {
  const seen = new Set<string>()
  return news.value
    .filter(entry => {
      if (seen.has(entry.version)) return false
      seen.add(entry.version)
      return true
    })
    .map(entry => ({
      title: entry.version,
      description: '',
      date: '',
    }))
})

// 新闻卡片错落入场（加载完成后）
useReveal(() => cardGridRef.value, '.news-card', { stagger: 0.06 })

async function loadNews() {
  loading.value = true
  loadError.value = false
  try {
    const res = await api.listNews()
    news.value = res.news.sort((a, b) => b.pr_number - a.pr_number)
  } catch (e: unknown) {
    log.error('加载更新动态失败', e)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadNews()
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
  font-size: var(--fs-display-lg);
  font-weight: 600;
  font-family: var(--font-display);
  letter-spacing: -0.01em;
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
</style>
