<template>
  <DirectionAwareHover class="news-card">
    <!-- 3D 倾斜监听的目标元素：ref 绑定到真实 DOM（组件 ref 拿到的是组件实例，不能 addEventListener） -->
    <div ref="rootEl" class="news-card-inner">
      <!-- 标题行：类型徽章 + 英文标题 -->
      <div class="card-header">
        <div class="card-title-row">
          <span class="card-type-badge" :class="'type-' + entry.type">{{ typeLabel }}</span>
          <span class="card-en-title">{{ entry.en_title || entry.title }}</span>
        </div>
        <span v-if="entry.version" class="version-badge">{{ entry.version }}</span>
      </div>

      <!-- 中文副标题 -->
      <div v-if="entry.en_title" class="card-subtitle">{{ entry.title }}</div>

      <!-- 描述（分段） -->
      <div class="news-description">
        <p v-for="(para, i) in paragraphs" :key="i" class="desc-para">{{ para }}</p>
      </div>

      <!-- 标签列表 -->
      <div class="card-models-tags">
        <span v-for="tag in entry.tags" :key="tag" class="model-tag">{{ tag }}</span>
      </div>

      <!-- 底部：PR -->
      <div class="news-footer">
        <span class="news-pr">#{{ entry.pr_number }}</span>
      </div>
    </div>
  </DirectionAwareHover>
</template>

<script setup lang="ts">
import type { NewsEntry } from '@/types'
import { computed, ref } from 'vue'
import DirectionAwareHover from '@/components/inspira/DirectionAwareHover.vue'
import { gsap, useGsap } from '@/composables/useGsap'

const props = defineProps<{ entry: NewsEntry }>()

// 3D 倾斜：鼠标位置驱动 rotationX/rotationY（quickTo 平滑跟手）
const rootEl = ref<HTMLElement | null>(null)
useGsap((ctx) => {
  const el = rootEl.value
  if (!el) return
  gsap.set(el, { transformPerspective: 700 })
  const rxTo = gsap.quickTo(el, 'rotationX', { duration: 0.35, ease: 'power2' })
  const ryTo = gsap.quickTo(el, 'rotationY', { duration: 0.35, ease: 'power2' })
  const onMove = (e: MouseEvent) => {
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    ryTo(px * 12)
    rxTo(-py * 12)
  }
  const onLeave = () => {
    rxTo(0)
    ryTo(0)
  }
  el.addEventListener('mousemove', onMove)
  el.addEventListener('mouseleave', onLeave)
  // 卸载时移除原生监听（ctx.revert 只回滚动画，不清理 addEventListener）
  ctx.add(() => {
    el.removeEventListener('mousemove', onMove)
    el.removeEventListener('mouseleave', onLeave)
  })
})

const typeLabelMap: Record<string, string> = {
  feat: '新功能',
  enhance: '增强',
  fix: '修复',
  refactor: '重构',
  docs: '文档',
}

const typeLabel = computed(() => typeLabelMap[props.entry.type] ?? props.entry.type)

const paragraphs = computed(() => {
  const text = props.entry.description
  // 按句号分割，过滤空串，每句补回句号
  return text.split('。').filter(s => s.trim()).map(s => s.trim() + '。')
})
</script>

<style scoped>
.news-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.25s ease, border-color 0.25s ease;
}
.news-card-inner {
  display: flex;
  flex-direction: column;
  gap: 10px;
  will-change: transform;
}
.news-card:hover {
  box-shadow: var(--shadow-lg);
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border));
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.card-en-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
}

.card-subtitle {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-tertiary);
  line-height: 1.4;
  margin-top: -2px;
}

.card-type-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  padding: 2px 8px;
  border-radius: 100px;
  flex-shrink: 0;
  white-space: nowrap;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  transition: background 0.2s, color 0.2s;
}

/* 各类型的 hover 颜色使用 overlay 方案，确保与主题兼容 */
.news-card:hover .card-type-badge.type-feat {
	  background: color-mix(in srgb, var(--status-ok) 20%, var(--bg-card));
	  color: var(--status-ok);
	}
	
	.news-card:hover .card-type-badge.type-enhance {
	  background: color-mix(in srgb, var(--status-info) 20%, var(--bg-card));
	  color: var(--status-info);
	}
	
	.news-card:hover .card-type-badge.type-fix {
	  background: color-mix(in srgb, var(--status-warn) 20%, var(--bg-card));
	  color: var(--status-warn);
	}
	
	.news-card:hover .card-type-badge.type-refactor {
	  background: color-mix(in srgb, var(--accent) 20%, var(--bg-card));
	  color: var(--accent);
	}

.news-card:hover .card-type-badge.type-docs {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.version-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--text-primary);
  color: var(--bg-primary);
  flex-shrink: 0;
  font-family: 'SF Mono', 'Consolas', monospace;
}

.news-description {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.desc-para {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}

.card-models-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-tag {
  font-size: 11px;
  padding: 3px 8px;
  background: var(--bg-secondary);
  border-radius: 6px;
  color: var(--text-tertiary);
  font-family: 'SF Mono', 'Consolas', monospace;
}

.news-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.news-pr {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: 'SF Mono', 'Consolas', monospace;
}
</style>
