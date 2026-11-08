<template>
  <div class="news-view ds-view" ref="newsViewRef">
    <!-- 标题栏 -->
    <BlurReveal>
      <div class="header view-header view-header--split">
        <h2>更新动态</h2>
        <div class="view-header__actions">
          <span class="news-count" v-if="!loading && !loadError">共 {{ news.length }} 条更新</span>
        </div>
      </div>
    </BlurReveal>

    <div class="news-body">
      <!-- 卡片列表 -->
      <div class="news-content">
        <!-- 骨架屏：加载中显示 3 个占位卡片，避免「只剩文字加载中」的廉价感 -->
        <div v-if="loading" class="skeleton-grid">
          <div v-for="i in 3" :key="i" class="skeleton-card">
            <div class="skeleton-line ds-skeleton ds-skeleton-line skeleton-title"></div>
            <div class="skeleton-line ds-skeleton ds-skeleton-line skeleton-text"></div>
            <div class="skeleton-line ds-skeleton ds-skeleton-line skeleton-text short"></div>
          </div>
        </div>
        <!-- 加载失败：明确告诉用户「加载失败」而非误显示「暂无更新」 -->
        <div v-else-if="loadError" class="empty ds-state ds-state--bare">
          <div class="empty-icon ds-state__icon"><Icon name="warning" :size="24" /></div>
          <div class="empty-title ds-state__title">加载失败</div>
          <div class="empty-desc ds-state__desc">
            无法获取更新动态，可能是后端未启动或网络异常。<br>
            <div class="ds-state__actions"><button class="retry-btn" @click="loadNews">重试</button></div>
          </div>
        </div>
        <div v-else-if="news.length === 0" class="empty ds-state ds-state--bare">
          <div class="empty-icon ds-state__icon"><Icon name="file-page" :size="24" /></div>
          <div class="empty-title ds-state__title">暂无更新动态</div>
          <div class="empty-desc ds-state__desc">Maxma 新版本与功能更新会在这里展示。</div>
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
import Icon from '@/components/Icon.vue'
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
}

.news-count {
  font-size: 13px;
  color: var(--text-secondary);
}

.news-body {
  position: relative;
}

.news-content {
  max-width: var(--chat-column-width);
  margin: 0 auto;
}

.empty-icon { font-size: 36px; margin-bottom: 12px; }
.empty-title { font-size: 1em; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.empty-desc { font-size: 0.85em; color: var(--text-tertiary); line-height: 1.6; }
.retry-btn {
  margin-top: 12px;
  padding: var(--space-6) var(--space-16);
  font-size: 0.85em;
  font-family: inherit;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
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
  padding: var(--space-16);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
}
.skeleton-line {
  height: 12px;
  margin-bottom: 8px;
}
.skeleton-title { height: 18px; width: 60%; margin-bottom: 12px; }
.skeleton-text { width: 100%; }
.skeleton-text.short { width: 70%; margin-bottom: 0; }

.card-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
</style>
