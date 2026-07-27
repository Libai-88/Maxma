<template>
  <div class="ext-view">
    <div class="header">
      <h2>扩展管理器 EXTENSIONS</h2>
      <p class="header-sub">OMP 自动发现的 TypeScript 扩展模块</p>
    </div>

    <div v-if="loading" class="loading">扫描中...</div>
    <div v-else-if="error" class="empty">
      <p>加载失败: {{ error }}</p>
      <button class="btn" @click="load">重试</button>
    </div>
    <template v-else>
      <div v-if="!hasExtensions && !hasSkills" class="empty">
        <div class="empty-icon">🧩</div>
        <div class="empty-title">暂未发现扩展</div>
        <div class="empty-desc">
          OMP 扩展存放在 <code>.claude/extensions/</code> 或 <code>~/.omp/extensions/</code> 目录。<br>
          安装插件后扩展会自动加载。
        </div>
      </div>
      <template v-else>
        <!-- Skills -->
        <div class="section" v-if="skills.length">
          <h3>已发现的 Skills ({{ skills.length }})</h3>
          <div class="ext-list">
            <div v-for="s in skills" :key="s.name" class="ext-card">
              <div class="ext-header">
                <span class="ext-name">{{ s.name }}</span>
                <span class="ext-source">{{ s.source }}</span>
              </div>
              <div v-if="s.description" class="ext-desc">{{ s.description }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- 入口 -->
      <div class="section quick-links">
        <h3>相关操作</h3>
        <router-link to="/plugins" class="quick-link">→ 管理已安装的插件</router-link>
        <router-link to="/capabilities" class="quick-link">→ 查看能力仪表盘</router-link>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api'

interface SkillInfo {
  name: string
  description?: string
  source: string
}

const loading = ref(true)
const error = ref('')
const skills = ref<SkillInfo[]>([])
const hasExtensions = ref(false)
const hasSkills = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    // Load discovered skills
    const res = await api.request<SkillInfo[] | { loaded: number; extensions: unknown[] }>('/capabilities')
    // Skills aren't directly in capabilities yet; try memory route
    const capsRes = await api.request<any>('/capabilities')
    skills.value = []
    hasSkills.value = false
    hasExtensions.value = capsRes?.system?.sidecar_available ?? false
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.ext-view { max-width: 720px; margin: 0 auto; padding: 24px 16px 80px; }
.header { margin-bottom: 16px; }
.header h2 { font-size: 1.3em; font-weight: 600; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }
.loading, .empty { text-align: center; padding: 40px; color: var(--text-tertiary); }
.empty-icon { font-size: 2em; margin-bottom: 8px; }
.empty-title { font-size: 1em; font-weight: 600; margin-bottom: 4px; }
.empty-desc { font-size: 0.85em; line-height: 1.6; }
.empty-desc code { background: var(--bg-secondary); padding: 1px 4px; border-radius: 3px; font-size: 0.95em; }
.section {
  margin-bottom: 20px; background: var(--bg-card); border-radius: var(--radius);
  padding: 16px; border: 1px solid var(--border);
}
.section h3 { font-size: 1em; font-weight: 600; margin: 0 0 12px; color: var(--text-primary); }
.ext-list { display: flex; flex-direction: column; gap: 6px; }
.ext-card { padding: 10px 12px; background: var(--bg-secondary); border-radius: 6px; }
.ext-header { display: flex; align-items: center; gap: 8px; }
.ext-name { font-weight: 600; font-size: 0.9em; color: var(--text-primary); }
.ext-source { font-size: 0.75em; padding: 2px 6px; border-radius: 4px; background: var(--bg-card); color: var(--text-tertiary); }
.ext-desc { font-size: 0.82em; color: var(--text-secondary); margin-top: 4px; line-height: 1.5; }
.quick-links { display: flex; flex-direction: column; gap: 8px; }
.quick-link { font-size: 0.85em; color: var(--accent); text-decoration: none; }
.quick-link:hover { text-decoration: underline; }
.btn { padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-secondary); cursor: pointer; font-size: 0.85em; margin-top: 8px; }
</style>
