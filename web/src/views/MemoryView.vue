<template>
  <div class="memory-view">
    <div class="header">
      <h2>记忆 Memory</h2>
      <p class="header-sub">AI 自动记录的长期事实——偏好、背景、历史决策。可删除不准确项；如需强制 AI 永远遵循，请写入 SOUL。</p>
    </div>

    <!-- Novice 引导：记忆 vs SOUL 区别 + confidence 含义 -->
    <details class="intro-card" open>
      <summary>什么是「记忆」？与 SOUL 人设有何不同？</summary>
      <div class="intro-body">
        <p>
          <strong>记忆（Memory）</strong>是 AI 在对话中<strong>自动</strong>记录的事实——
          你说「我对花生过敏」，AI 会写一条记忆；下次你再问餐厅推荐时，它会自动避开含花生的菜。
        </p>
        <p>
          <strong>SOUL 人设</strong>则是你<strong>手动</strong>定义的、AI 永远遵循的角色规范（语气、专业领域、行为准则）——
          SOUL 不会被遗忘，记忆可能会被 AI 判断为「过时」而不再调用。
        </p>
        <p>
          简单原则：<em>临时偏好让 AI 自动记；长期规范用 SOUL 固定。</em>
        </p>
        <p class="intro-note">
          💡 每条记忆的 <strong>置信度</strong>是 AI 对该事实的把握程度（0-100%）。新事实通常置信度较低，
          多次确认后会升高；低于 50% 的记忆可能是 AI 的误判，建议核对后删除。
        </p>
        <div class="confidence-legend">
          <span class="legend-title">置信度颜色分级：</span>
          <span class="legend-item"><span class="legend-dot conf-low"></span>&lt; 50% 灰色（建议核对）</span>
          <span class="legend-item"><span class="legend-dot conf-mid"></span>50-80% 默认色（一般可信）</span>
          <span class="legend-item"><span class="legend-dot conf-high"></span>&gt; 80% 绿色（高度可信）</span>
        </div>
      </div>
    </details>

    <div class="edit-hint">
      如需编辑记忆，请前往 <router-link to="/soul" class="edit-link">SOUL 人设</router-link> 页面，
      或在对话中告诉 AI「忘记 XX / 记住 XX」。
    </div>

    <div v-if="store.loading" class="loading">加载中...</div>
    <template v-else>
      <div v-if="store.facts.length === 0" class="empty">
        <div class="empty-icon">🧠</div>
        <div class="empty-title">暂无记忆数据</div>
        <div class="empty-desc">
          与 AI 对话后，OMP 会自动记录有价值的事实。<br>
          例如告诉 AI「我是前端工程师，主要用 React」——它会记住并在后续对话中应用。
          <router-link to="/" class="empty-link">→ 返回对话</router-link>
        </div>
      </div>
      <div v-else class="fact-list">
        <div v-for="fact in store.facts" :key="fact.id" class="fact-card">
          <div class="fact-content">{{ fact.content }}</div>
          <div class="fact-meta">
            <span class="fact-cat" :title="`类别：${fact.category}`">{{ categoryLabel(fact.category) }}</span>
            <span
              class="fact-confidence"
              :class="`conf-${confidenceLevel(fact.confidence)}`"
              :title="confidenceTitle(fact.confidence)"
            >
              {{ (fact.confidence * 100).toFixed(0) }}% 把握
            </span>
            <span class="fact-time">{{ formatTime(fact.updatedAt) }}</span>
            <button class="fact-delete" @click="handleDelete(fact.id)" title="删除此记忆">✕</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useMemoryStore } from '../stores/memory'
const store = useMemoryStore()

const categoryLabels: Record<string, string> = {
  preference: '偏好',
  event: '事件',
  fact: '事实',
  relationship: '关系',
  identity: '身份',
  background: '背景',
  goal: '目标',
  skill: '技能',
  project: '项目',
  context: '上下文',
  history: '历史',
  opinion: '观点',
  other: '其他',
}

function categoryLabel(cat: string): string {
  return categoryLabels[cat] || cat
}

/**
 * 置信度三档分级：低（<0.5 灰，可能误判）/ 中（0.5-0.8 默认）/ 高（>0.8 绿，高度可信）。
 * 与 intro-card 的图例保持一致，让 Novice 一眼扫到需要核对的低置信项。
 */
function confidenceLevel(conf: number): 'low' | 'mid' | 'high' {
  if (conf < 0.5) return 'low'
  if (conf > 0.8) return 'high'
  return 'mid'
}

function confidenceTitle(conf: number): string {
  const pct = (conf * 100).toFixed(0)
  const level = confidenceLevel(conf)
  const hint = level === 'low'
    ? '（偏低，可能是 AI 误判，建议核对后删除）'
    : level === 'high'
      ? '（高度可信）'
      : '（一般可信）'
  return `AI 对此事实的把握程度：${pct}%${hint}`
}

function formatTime(t: string) { return t ? new Date(t).toLocaleDateString('zh-CN') : '-' }

function handleDelete(id: string) {
  if (!window.confirm('确定删除这条记忆吗？删除后 AI 将不再记得此事（不影响对话历史）。')) return
  store.deleteFact(id)
}

onMounted(() => { store.fetchFacts() })
</script>

<style scoped>
.memory-view { flex: 1; overflow-y: auto; padding: 24px; max-width: 800px; margin: 0 auto; width: 100%; box-sizing: border-box; }
.header { margin-bottom: 16px; }
.header h2 { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0 0 4px; }
.header-sub { margin: 0; font-size: 0.82em; color: var(--text-secondary); line-height: 1.5; }

/* ── 引导卡片 ── */
.intro-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  margin-bottom: 16px;
}
.intro-card > summary {
  padding: 10px 14px;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  list-style: none;
  position: relative;
  padding-right: 32px;
}
.intro-card > summary::-webkit-details-marker { display: none; }
.intro-card > summary::after {
  content: '▸';
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.intro-card[open] > summary::after { transform: translateY(-50%) rotate(90deg); }
.intro-body {
  padding: 0 14px 12px;
  font-size: 0.83em;
  color: var(--text-secondary);
  line-height: 1.7;
}
.intro-body p { margin: 0 0 8px; }
.intro-body strong { color: var(--text-primary); font-weight: 600; }
.intro-body em { color: var(--accent); font-style: normal; font-weight: 600; }
.intro-note {
  font-size: 0.92em;
  color: var(--text-tertiary);
  margin-top: 8px !important;
}

.edit-hint { margin-bottom: 16px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); font-size: 13px; color: var(--text-secondary); line-height: 1.5; }
.edit-link { color: var(--accent); text-decoration: none; font-weight: 600; }
.edit-link:hover { text-decoration: underline; }

.loading { padding: 48px; text-align: center; color: var(--text-tertiary); font-size: 14px; }
.empty {
  padding: 48px 32px;
  text-align: center;
  color: var(--text-tertiary);
}
.empty-icon { font-size: 40px; margin-bottom: 12px; }
.empty-title { font-size: 1em; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }
.empty-desc {
  font-size: 0.85em;
  color: var(--text-tertiary);
  line-height: 1.7;
}
.empty-link {
  display: inline-block;
  margin-top: 10px;
  color: var(--accent);
  text-decoration: none;
  font-weight: 600;
}
.empty-link:hover { text-decoration: underline; }

.fact-list { display: flex; flex-direction: column; gap: 8px; }
.fact-card { padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card); }
.fact-content { font-size: 14px; color: var(--text-primary); margin-bottom: 8px; line-height: 1.5; }
.fact-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text-tertiary); }
.fact-cat { padding: 1px 8px; border-radius: 100px; background: var(--bg-secondary); text-transform: uppercase; letter-spacing: 0.3px; cursor: help; }
.fact-confidence {
  font-family: 'SF Mono', monospace;
  cursor: help;
  padding: 1px 8px;
  border-radius: 100px;
  font-weight: 600;
  transition: background 0.15s, color 0.15s;
}
/* 三档颜色分级：与 intro-card 图例对齐 */
.fact-confidence.conf-low {
  color: var(--text-tertiary);
  background: color-mix(in srgb, var(--text-tertiary) 12%, transparent);
}
.fact-confidence.conf-mid {
  color: var(--text-secondary);
  background: var(--bg-secondary);
}
.fact-confidence.conf-high {
  color: var(--status-ok);
  background: color-mix(in srgb, var(--status-ok) 12%, transparent);
}

/* ── 置信度图例 ── */
.confidence-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 0.92em;
  color: var(--text-tertiary);
}
.legend-title { font-weight: 600; color: var(--text-secondary); }
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.legend-dot.conf-low {
  background: var(--text-tertiary);
  opacity: 0.6;
}
.legend-dot.conf-mid {
  background: var(--text-secondary);
}
.legend-dot.conf-high {
  background: var(--status-ok);
}
.fact-time { font-family: 'SF Mono', monospace; }
.fact-delete { margin-left: auto; background: none; border: none; cursor: pointer; color: var(--text-tertiary); padding: 2px 6px; border-radius: 4px; }
.fact-delete:hover { background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card)); color: var(--status-error); }

@media (max-width: 640px) {
  .memory-view { padding: 18px 16px; }
}
</style>
