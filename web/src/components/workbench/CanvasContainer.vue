<template>
  <div class="canvas-container">
    <div v-if="cards.length === 0" class="canvas-empty">
      <span class="empty-icon">&#128204;</span>
      <p>画布为空</p>
      <p class="empty-hint">点击工具结果上的图钉按钮，将重要内容固定到画布</p>
    </div>
    <div v-else class="canvas-list">
      <div
        v-for="card in cards"
        :key="card.id"
        class="canvas-card-wrapper"
      >
        <component
          v-if="getCardComponent(card.type)"
          :is="getCardComponent(card.type)!"
          :card="card"
          @remove="$emit('remove', card.id)"
        />
        <div v-else class="canvas-card-fallback">
          <span>未知卡片类型: {{ card.type }}</span>
          <button @click="$emit('remove', card.id)">&times;</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CanvasCard } from '@/types/workbench'
import { getCardComponent } from './canvas-registry'

defineProps<{
  cards: CanvasCard[]
}>()

defineEmits<{
  remove: [id: string]
}>()
</script>

<style scoped>
.canvas-container {
  min-height: 100%;
}

.canvas-empty {
  text-align: center;
  padding: 60px 16px;
  color: var(--text-secondary, #999);
}

.empty-icon {
  font-size: 32px;
  display: block;
  margin-bottom: 12px;
}

.empty-hint {
  font-size: 12px;
  margin-top: 8px;
  opacity: 0.7;
}

.canvas-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.canvas-card-wrapper {
  position: relative;
}

.canvas-card-fallback {
  padding: 12px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary, #999);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
