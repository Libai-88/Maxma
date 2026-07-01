<template>
  <div class="memory-panel">
    <MomentCard />

    <!-- 搜索与过滤栏 -->
    <div class="search-filter-bar">
      <div class="search-input-wrapper">
        <span class="search-icon">&#128269;</span>
        <input
          v-model="searchQuery"
          class="search-input"
          type="text"
          placeholder="搜索记忆..."
        />
        <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">&#10005;</button>
      </div>
      <div v-if="allThemes.length > 0" class="theme-filters">
        <button
          class="theme-chip"
          :class="{ active: !selectedTheme }"
          @click="selectedTheme = ''"
        >全部</button>
        <button
          v-for="theme in allThemes"
          :key="theme"
          class="theme-chip"
          :class="{ active: selectedTheme === theme }"
          @click="selectedTheme = selectedTheme === theme ? '' : theme"
        >{{ theme }}</button>
      </div>
    </div>

    <!-- Vignette 瀑布流（默认启用） -->
    <template v-if="useVignette">
      <!-- 骨架屏：加载中且无数据 -->
      <div v-if="loading && sections.length === 0" class="skeleton-container">
        <div v-for="i in 3" :key="i" class="skeleton-card">
          <div class="skeleton-pulse"></div>
        </div>
      </div>

      <!-- 有数据 -->
      <div v-else-if="filteredSections.length > 0" class="sections-container">
        <SectionCard
          v-for="section in filteredSections"
          :key="section.theme"
          :theme="section.theme"
          :items="section.items"
          @edit-item="handleEditItem"
        />
      </div>

      <!-- 搜索无结果 -->
      <div v-else-if="!loading && (searchQuery || selectedTheme)" class="memory-empty">
        未找到匹配的记忆条目。
      </div>

      <!-- 空数据 -->
      <div v-else-if="!loading" class="memory-empty">
        还没有记忆，开始对话吧。
      </div>
    </template>

    <!-- 回退：Markdown 叙事（当 Vignette 关闭或出错时） -->
    <template v-else>
      <div class="memory-body">
        <div v-if="loading && !narrative" class="memory-loading">
          加载中……
        </div>
        <div v-else-if="narrative">
          <RenderMarkdown :content="narrative" />
        </div>
        <div v-else class="memory-empty">
          暂无记忆叙事。开始一段对话后，AI 会自动生成关于你的记忆。
        </div>
      </div>
    </template>

    <!-- 编辑弹窗 -->
    <div v-if="editDialog.show" class="edit-overlay" @click.self="editDialog.show = false">
      <div class="edit-dialog">
        <h3 class="edit-title">编辑记忆</h3>
        <div class="edit-field">
          <label>内容</label>
          <textarea v-model="editDialog.content" rows="3" class="edit-textarea" maxlength="150"></textarea>
          <span class="edit-counter">{{ editDialog.content.length }}/150</span>
        </div>
        <div class="edit-field">
          <label>分区</label>
          <input v-model="editDialog.theme" class="edit-input" />
        </div>
        <div class="edit-actions">
          <button class="edit-btn cancel" @click="editDialog.show = false">取消</button>
          <button class="edit-btn save" :disabled="!editDialog.content.trim()" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import type { VignetteSection } from '@/types'
import MomentCard from '@/components/MomentCard.vue'
import SectionCard from '@/components/SectionCard.vue'
import RenderMarkdown from '@/components/RenderMarkdown.vue'

/** 可通过开发者工具切换为 false 回退到 Markdown 渲染 */
const useVignette = ref(true)

const narrative = ref('')
const sections = ref<VignetteSection[]>([])
const loading = ref(false)

// 搜索与过滤
const searchQuery = ref('')
const selectedTheme = ref('')

// 编辑弹窗
const editDialog = ref({
  show: false,
  id: '',
  content: '',
  theme: '',
})

/** 所有分区名（用于过滤标签） */
const allThemes = computed(() => sections.value.map(s => s.theme))

/** 过滤后的 sections */
const filteredSections = computed(() => {
  let result = sections.value

  // 按分区过滤
  if (selectedTheme.value) {
    result = result.filter(s => s.theme === selectedTheme.value)
  }

  // 按关键词过滤
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result
      .map(section => ({
        ...section,
        items: section.items.filter(item =>
          item.description.toLowerCase().includes(q)
        ),
      }))
      .filter(section => section.items.length > 0)
  }

  return result
})

function handleEditItem(item: { id: string; description: string; theme: string }) {
  editDialog.value = {
    show: true,
    id: item.id,
    content: item.description,
    theme: item.theme,
  }
}

async function saveEdit() {
  if (!editDialog.value.content.trim() || !editDialog.value.id) return
  try {
    await api.updateMemory(
      editDialog.value.id,
      editDialog.value.content.trim(),
      editDialog.value.theme.trim(),
    )
    editDialog.value.show = false
    await refresh()
  } catch (e) {
    console.error('Failed to update memory:', e)
  }
}

async function refresh() {
  loading.value = true
  try {
    if (useVignette.value) {
      const res = await api.getMemories()
      sections.value = res.sections
    } else {
      const res = await api.getNarrative()
      narrative.value = res.narrative
    }
  } catch {
    sections.value = []
    narrative.value = ''
  } finally {
    loading.value = false
  }
}

onMounted(() => refresh())
</script>

<style scoped>
.memory-panel {
  max-width: 768px;
  margin: 0 auto;
}

/* ── 搜索与过滤栏 ── */
.search-filter-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  transition: border-color 0.15s;
}
.search-input-wrapper:focus-within {
  border-color: var(--accent);
}
.search-icon {
  font-size: 14px;
  opacity: 0.5;
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--text-primary);
  font-family: inherit;
}
.search-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.6;
}
.search-clear {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s;
}
.search-clear:hover {
  background: var(--bg-secondary);
}
.theme-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.theme-chip {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 100px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.theme-chip:hover {
  border-color: var(--accent-light);
  color: var(--text-primary);
}
.theme-chip.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

/* ── 瀑布流容器 ── */
.sections-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── 骨架屏 ── */
.skeleton-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skeleton-card {
  height: 80px;
  border-radius: var(--radius);
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 20px;
}
.skeleton-pulse {
  width: 60%;
  height: 16px;
  background: var(--bg-secondary);
  border-radius: 4px;
  animation: skeleton-fade 1.8s ease-in-out infinite;
}

@keyframes skeleton-fade {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.9; }
}

/* ── 空态 / 加载占位（回退路径用） ── */
.memory-body {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}
.memory-body .markdown-body {
  line-height: 1.8;
}
.memory-empty,
.memory-loading {
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
  padding: 40px 0;
}

/* ── 编辑弹窗 ── */
.edit-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.edit-dialog {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}
.edit-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 16px;
  color: var(--text-primary);
}
.edit-field {
  margin-bottom: 12px;
}
.edit-field label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.edit-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-primary);
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.edit-textarea:focus {
  border-color: var(--accent);
}
.edit-counter {
  display: block;
  text-align: right;
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.edit-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-primary);
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.edit-input:focus {
  border-color: var(--accent);
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.edit-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
  font-family: inherit;
  transition: all 0.15s;
}
.edit-btn.cancel {
  background: transparent;
  color: var(--text-secondary);
}
.edit-btn.cancel:hover {
  background: var(--bg-secondary);
}
.edit-btn.save {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.edit-btn.save:hover:not(:disabled) {
  opacity: 0.9;
}
.edit-btn.save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
